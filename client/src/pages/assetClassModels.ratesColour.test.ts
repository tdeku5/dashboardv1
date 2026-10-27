// The red / green direction rule (docs/asset-class-models-design-notes.md,
// colour rule 6; docs/prompts/acm-revamp-rebase-and-red-green-direction.md +
// addendum): a yield / rate / spread change in the RATES area is red when it
// rises and green when it falls (hike red, cut green, futures price up green).
// Blue / orange carries no direction meaning. The --acm-dir-* pair is that
// red / green rule (aliases of --acm-negative / --acm-positive), so it may be
// used freely; what must NOT appear in the rates area is the orange / blue —
//
// except the TWO named exceptions:
//   (1) the cellColor grid (lib/cellColor.ts): heatmap BACKGROUNDS stay red /
//       blue on the symmetric rate scale (--acm-heat-rate-up-* / -down-*);
//       text on them follows red / green. Pinned to exactly those two scales.
//   (2) the US Rates VOL implied-vol premium (MOVE − RMOVE), a spread between
//       volatilities, not yields: orange / blue via UsRatesVolPage's
//       `premiumTone` (--acm-vol-premium-up / -down), on the premium only.
//
// Static scan, comments stripped, of the rates pages and everything they
// import (shared acm primitives / tokens / registry excluded — they define the
// families, they don't apply them). STIRDashboardPage itself hosts every asset
// class, so it is scanned as a single file rather than followed.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')]
  .find(p => existsSync(path.join(p, 'pages/STIRDashboardPage.tsx')))!

/** The RATES nav's views: the STIR page's inline rates sections + every standalone rates component. */
const RATES_ROOTS = [
  'pages/UsRatesVolPage.tsx',
  'pages/PolicyRatePage.tsx',
  'pages/TreasuryAuctionPage.tsx',
  'pages/CountryCurvePage.tsx',
  'pages/CountryTermStructure.tsx',
  'pages/GlobalRatesPage.tsx',
  'pages/GlobalForwardCurvesSection.tsx',
  'pages/GlobalPolicyPathRealRateSection.tsx',
  'pages/GlobalPolicyTermStructureSection.tsx',
  'pages/Global2s10sRegimeSection.tsx',
  'components/DailyChangeModal.tsx',
  'components/UKFundamentalModelPanel.tsx',
  'components/EUFundamentalModelPanel.tsx',
  'components/CAFundamentalModelPanel.tsx',
  'components/JPFundamentalModelPanel.tsx',
  'components/AUFundamentalModelPanel.tsx',
  'lib/cellColor.ts',
]
const SINGLE_FILES = ['pages/STIRDashboardPage.tsx', 'pages/STIRDashboardPage.module.css']
/** Infrastructure that defines the families rather than applying them. */
const INFRA = /^(components\/acm\/|styles\/|constants\/)/

/** Exception (2): the VOL premium. */
const VOL_PREMIUM = { file: 'pages/UsRatesVolPage.tsx', fn: 'premiumTone', arg: /premium/i }
/** Exception (1): the cellColor grid — the symmetric red / blue rate heat scale only. */
const CELL_COLOR = { file: 'lib/cellColor.ts', scales: ['rate-down', 'rate-up'] }

/** The premium's orange / blue (tokens, tones, classes) and the removed direction heat scale. */
const ORANGE_BLUE = /acm-vol-premium-|['"`]vol-premium-(?:up|down)['"`]|\bvolPremium(?:Up|Down)\b|heat-dir-/g

function closure(roots: string[]): string[] {
  const seen = new Set<string>()
  const stack = roots.map(r => path.join(SRC, r))
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s*|export\s[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    if (f.endsWith('.css')) continue
    for (const m of readFileSync(f, 'utf8').matchAll(re)) {
      const base = path.resolve(path.dirname(f), m[1])
      const hit = [base + '.tsx', base + '.ts', base, base + '/index.ts', base + '/index.tsx']
        .find(c => existsSync(c) && statSync(c).isFile() && /\.(tsx?|css)$/.test(c))
      if (hit && !path.relative(SRC, hit).endsWith('STIRDashboardPage.tsx')) stack.push(hit)
    }
  }
  return [...seen].map(f => path.relative(SRC, f).split(path.sep).join('/'))
}

const stripComments = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** Remove `function <name>(…) { … }` (balanced braces) from the source. */
function withoutFunction(src: string, name: string): { rest: string; body: string } {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) return { rest: src, body: '' }
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0
  const open = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) break
  }
  return { rest: src.slice(0, start) + src.slice(i + 1), body: src.slice(open, i + 1) }
}

describe('Rates colour rule — no direction token in the rates area except the two named exceptions', () => {
  const files = [...new Set([...SINGLE_FILES, ...closure(RATES_ROOTS)])].filter(f => !INFRA.test(f)).sort()
  const code = (f: string) => stripComments(readFileSync(path.join(SRC, f), 'utf8'))

  it('scans every rates view (inline STIR sections + standalone pages and their CSS)', () => {
    for (const r of [...RATES_ROOTS, ...SINGLE_FILES]) expect(files).toContain(r)
    expect(files.some(f => f.endsWith('.module.css'))).toBe(true)
    console.log(`rates-area files scanned: ${files.length}`)
  })

  it('no rates-area file uses the orange / blue premium colours for anything but the VOL premium', () => {
    const offenders = files.flatMap(f => {
      const src = f === VOL_PREMIUM.file ? withoutFunction(code(f), VOL_PREMIUM.fn).rest : code(f)
      return [...src.matchAll(ORANGE_BLUE)].map(m => `${f}: ${m[0]}`)
    })
    expect(offenders).toEqual([])
  })

  it('cellColor grid is red / blue on the symmetric rate scale: heat-rate-up for increase, heat-rate-down for decrease, nothing else', () => {
    const src = code(CELL_COLOR.file)
    const heat = [...new Set([...src.matchAll(/--acm-heat-([a-z-]+?)-(?:\$\{[^}]+\}|[1-4])/g)].map(m => m[1]))].sort()
    expect(heat).toEqual(CELL_COLOR.scales)
    expect(src, 'no legacy rgba shading left').not.toMatch(/rgba\(/)
  })

  it(`the VOL premium is the only use of ${VOL_PREMIUM.fn}, and it keeps its orange / blue (exception 2)`, () => {
    const src = code(VOL_PREMIUM.file)
    const { body } = withoutFunction(src, VOL_PREMIUM.fn)
    expect(body, 'premiumTone maps to the VOL-premium tones').toMatch(/'vol-premium-up'/)
    expect(body).toMatch(/'vol-premium-down'/)
    expect(body, 'never the red / green direction pair').not.toMatch(/'dir-(up|down)'|'positive'|'negative'/)
    const calls = [...src.matchAll(new RegExp(`\\b${VOL_PREMIUM.fn}\\(([^)]*)\\)`, 'g'))]
      .filter(m => !src.slice(Math.max(0, m.index! - 9), m.index).includes('function'))
    expect(calls.length, 'exactly one call site').toBe(1)
    for (const m of calls) expect(m[1], 'applied to the premium only').toMatch(VOL_PREMIUM.arg)
  })
})
