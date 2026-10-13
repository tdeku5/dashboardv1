// Real-browser check (headless Chromium via Playwright) that a themed chart
// mounted OUTSIDE any .acm-root still draws its tick labels in IBM Plex Mono:
// the literal family name in chartTheme + the global @font-face rules in
// acm-tokens.css must be enough on their own.
//
// RECHARTS 3.7.0 LIMITATION (recorded, not asserted away): tick-interval
// measurement (cartesian/getTicks.js) calls getStringSize(value, { fontSize,
// letterSpacing }) — it never passes the font family, so the hidden
// measurement span measures tick labels in the <body> font (globals.css →
// system-ui), whatever the theme sets. <Label>/wrapped <Text> measurement
// (component/Text.js) DOES pass the family. The test measures and logs the
// width gap between the drawn face and the measured face on the real ticks.
//
// Starts its own Vite dev server on a free port and serves
// __fixtures__/chart-font-check.html. Skips (visibly) if the Playwright
// Chromium binary is not installed on this machine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ViteDevServer } from 'vite'
import type { Browser } from 'playwright'

const CLIENT = [process.cwd(), path.resolve(process.cwd(), 'client')].find(p => existsSync(path.join(p, 'vite.config.ts')))!
const CHROME = path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')
const haveChrome = existsSync(CHROME)

describe.skipIf(!haveChrome)('chart theme fonts — real Chromium, no .acm-root ancestor', () => {
  let server: ViteDevServer
  let browser: Browser
  let base = ''

  beforeAll(async () => {
    const { createServer } = await import('vite')
    server = await createServer({
      root: CLIENT,
      configFile: path.join(CLIENT, 'vite.config.ts'),
      server: { port: 0, strictPort: false, hmr: false },
      logLevel: 'silent',
    })
    await server.listen()
    base = server.resolvedUrls!.local[0]
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('Plex Mono is fetched, loaded and used for tick text; measured-vs-drawn tick width gap is recorded', async () => {
    const page = await browser.newPage()
    const fontResponses: Array<{ url: string; status: number }> = []
    page.on('response', r => { if (r.url().includes('/fonts/')) fontResponses.push({ url: r.url(), status: r.status() }) })

    await page.goto(new URL('src/components/acm/__fixtures__/chart-font-check.html', base).href)
    await page.waitForSelector('.recharts-cartesian-axis-tick-value')
    const result = await page.evaluate(async () => {
      await document.fonts.ready
      const tick = document.querySelector('.recharts-cartesian-axis-tick-value')!
      const span = document.getElementById('recharts_measurement_span')
      const faces = [...document.fonts].map(f => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, status: f.status }))
      // Width of every drawn tick label in the drawn face vs the body face Recharts measured in.
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:10px'
      document.body.appendChild(probe)
      const widthIn = (text: string, family: string) => { probe.style.fontFamily = family; probe.textContent = text; return probe.getBoundingClientRect().width }
      const labels = [...document.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(t => t.textContent ?? '')
      const drawn = getComputedStyle(tick).fontFamily
      const bodyFace = getComputedStyle(document.body).fontFamily
      const ratios = labels.map(l => widthIn(l, drawn) / widthIn(l, bodyFace))
      probe.remove()
      return {
        acmRootAncestor: !!document.getElementById('root')!.closest('.acm-root') || !!document.querySelector('.acm-root'),
        tickFamily: getComputedStyle(tick).fontFamily,
        spanFamily: span ? span.style.fontFamily : null,
        spanFontSize: span ? span.style.fontSize : null,
        bodyFace,
        widthRatioDrawnOverMeasured: { min: Math.min(...ratios), max: Math.max(...ratios) },
        monoLoaded: faces.filter(f => f.family === 'IBM Plex Mono' && f.status === 'loaded').map(f => f.weight),
        checkMono: document.fonts.check("10px 'IBM Plex Mono'"),
        tickCount: document.querySelectorAll('.recharts-cartesian-axis-tick-value').length,
      }
    })
    await page.close()
    console.log(JSON.stringify({ ...result, fontResponses: fontResponses.map(r => `${r.status} ${new URL(r.url).pathname}`) }, null, 2))

    expect(result.acmRootAncestor).toBe(false)
    expect(result.tickCount).toBeGreaterThan(0)
    expect(result.tickFamily).toMatch(/^"?IBM Plex Mono"?,/)
    // Recharts sets the measurement span's size but not its family (see header).
    expect(result.spanFontSize).toBe('10px')
    expect(result.spanFamily).toBe('')
    expect(result.monoLoaded).toContain('400')
    expect(result.checkMono).toBe(true)
    expect(fontResponses.some(r => r.url.endsWith('/fonts/ibm-plex-mono-latin-400.woff2') && r.status === 200)).toBe(true)
  }, 60_000)
})

