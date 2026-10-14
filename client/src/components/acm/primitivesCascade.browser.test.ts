// Real-browser (headless Chromium) cascade check for the primitives' colour
// channels. happy-dom has no cascade, so the unit tests can only see class
// names; this proves the COMPUTED colour/background is the intended token —
// it caught a specificity tie that left stat-tile tones and alert tints unapplied.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ViteDevServer } from 'vite'
import type { Browser, Page } from 'playwright'

const CLIENT = [process.cwd(), path.resolve(process.cwd(), 'client')].find(p => existsSync(path.join(p, 'vite.config.ts')))!
const CHROME = path.join(os.homedir(), '.cache/ms-playwright/chromium-1223/chrome-linux64/chrome')

describe.skipIf(!existsSync(CHROME))('primitive colour channels — computed in real Chromium', () => {
  let server: ViteDevServer
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    const { createServer } = await import('vite')
    server = await createServer({ root: CLIENT, configFile: path.join(CLIENT, 'vite.config.ts'), server: { port: 0, strictPort: false, hmr: false }, logLevel: 'silent' })
    await server.listen()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
    page = await browser.newPage()
    await page.goto(new URL('src/components/acm/__fixtures__/primitives-cascade.html', server.resolvedUrls!.local[0]).href)
    await page.waitForSelector('[data-case="nav"] [role="tab"]')
  }, 60_000)

  afterAll(async () => { await browser?.close(); await server?.close() })

  const ref = (token: string, prop: 'color' | 'backgroundColor') =>
    page.evaluate(([t, p]) => getComputedStyle(document.querySelector(`[data-ref="${t}"]`)!)[p as 'color'], [token, prop])
  const computed = (selector: string, prop: 'color' | 'backgroundColor' | 'outlineColor') =>
    page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)!)[p as 'color'], [selector, prop])

  it('stat tile: tone colours the value text (dir-up, negative)', async () => {
    expect(await computed('[data-case="tile-dir-up"] .acm-num', 'color')).toBe(await ref('acm-dir-up', 'color'))
    expect(await computed('[data-case="tile-negative"] .acm-num', 'color')).toBe(await ref('acm-negative', 'color'))
  })

  it('stat tile: alert tints the tile background + outline, value text stays primary', async () => {
    for (const [lvl, tint, line] of [['mild', 'acm-alert-mild-tint', 'acm-alert-mild'], ['strong', 'acm-alert-strong-tint', 'acm-alert-strong']]) {
      const tile = `[data-case="tile-alert-${lvl}"] > .acm-root`
      expect(await computed(tile, 'backgroundColor'), `${lvl} bg`).toBe(await ref(tint, 'backgroundColor'))
      expect(await computed(tile, 'outlineColor'), `${lvl} outline`).toBe(await ref(line, 'color'))
      expect(await computed(`${tile} .acm-num`, 'color'), `${lvl} text`).toBe(await ref('acm-text-primary', 'color'))
    }
  })

  it('data table: tone on value text, alert on the cell', async () => {
    const cell = (i: number) => `[data-case="table"] tbody tr:nth-child(${i}) td:nth-child(2)`
    expect(await computed(`${cell(1)} span`, 'color')).toBe(await ref('acm-positive', 'color'))
    expect(await computed(`${cell(2)} span`, 'color')).toBe(await ref('acm-negative', 'color'))
    expect(await computed(`${cell(3)} span`, 'color')).toBe(await ref('acm-dir-up', 'color'))
    expect(await computed(cell(3), 'backgroundColor')).toBe(await ref('acm-alert-mild-tint', 'backgroundColor'))
    expect(await computed(`${cell(4)} span`, 'color')).toBe(await ref('acm-dir-down', 'color'))
    expect(await computed(cell(4), 'backgroundColor')).toBe(await ref('acm-alert-strong-tint', 'backgroundColor'))
  })

  it('nav tier: active tab is accent-hover on accent-muted', async () => {
    const active = '[data-case="nav"] [aria-selected="true"]'
    expect(await computed(active, 'color')).toBe(await ref('acm-accent-hover', 'color'))
    expect(await computed(active, 'backgroundColor')).toBe(await ref('acm-accent-muted', 'backgroundColor'))
  })
})
