// @vitest-environment happy-dom
//
// PERMANENT per-view mount harness for ASSET CLASS MODELS (/stir).
//
// The section is one route whose three nav tiers (asset class → country →
// section) are React state, so each of the 55 views is reached by clicking
// the real nav, exactly as a user would. Fetches are held pending, so every
// view renders its loading state — no live data needed.
//
// For each view the harness asserts:
//   1. navigation reaches it (every nav label is exactly one button) and
//      nothing throws while mounting it;
//   2. its OWN identifying markers are present — text, plus for the seven
//      country curve pages (identical while loading) the data request the
//      view issues after the final click, and the absence of the GLOBAL
//      page's heading (GLOBAL also requests those curves);
//   3. it is identified UNIQUELY: of all 55 marker sets, only this view's
//      fully matches — so a view that silently renders another section fails.
// It also pins the nav itself: each tier exposes exactly the tabs listed
// here, so the harness cannot drift from the app.
//
// Built for the Asset Class Models design revamp (Phase 1, acceptance #5),
// kept as a standing regression test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { STIRDashboardPage } from './STIRDashboardPage'

interface View {
  /** Nav labels clicked in order. */
  path: string[]
  /** Text that must appear in the view (never a nav label). */
  text: string[]
  /** URL substrings the view must request after its final nav click. */
  requests?: string[]
  /** Text that must NOT appear — separates a view from a superset view (Global). */
  absent?: string[]
  placeholder?: boolean
}

const V: View[] = []
const view = (path: string[], text: string[], extra: Partial<View> = {}) => V.push({ path, text, ...extra })

// ── MACRO ───────────────────────────────────────────────────────────────────
view(['MACRO', 'REGIMES'], ['Regimes coming soon'], { placeholder: true })
view(['MACRO', 'CROSS ASSET VOL'], ['VOL LEVELS', 'VOL Z-SCORES'])

// ── RATES ───────────────────────────────────────────────────────────────────
view(['RATES', 'US', 'STIR STRIPS'], ['Loading strip monitor…', 'CURRENT SOFR'])
view(['RATES', 'US', 'FORWARD PRICING'], ['US: 3M SOFR'])
view(['RATES', 'US', 'POLICY RATE'], ['Loading FRED series…'])
view(['RATES', 'US', 'UST CURVE'], ['US TREASURY YIELD CURVE'])
view(['RATES', 'US', 'VOL'], ['US Rates — Volatility'])
view(['RATES', 'US', 'YIELD ATTRIBUTION'], ['5Y NOMINAL YIELD — CHANGE ATTRIBUTION'])
view(['RATES', 'US', 'CREDIT'], ['CREDIT SPREADS', 'HY SPREAD W UST CURVE REGIMES'])
view(['RATES', 'US', 'MONEY MARKETS'], ['MONEY MARKET RATE SPREADS'])
view(['RATES', 'US', 'TREASURY AUCTIONS'], ['Treasury Auction Monitor'])

view(['RATES', 'EU', 'STIR STRIPS'], ['Loading strip monitor…', 'CURRENT ECB DFR'])
view(['RATES', 'EU', 'FORWARD PRICING'], ['EU: 3M EURIBOR'])
view(['RATES', 'EU', 'POLICY RATE'], ['Loading EU term structure…'])
view(['RATES', 'EU', 'CREDIT'], ['HY SPREAD W EGB CURVE REGIMES'])
const NOT_GLOBAL = ['GLOBAL RATES SUMMARY']
view(['RATES', 'EU', 'BUND CURVE'], ['COMPRESSED'], { requests: ['/api/tv/yield-curve/bund'], absent: NOT_GLOBAL })
view(['RATES', 'EU', 'OAT CURVE'], ['COMPRESSED'], { requests: ['/api/tv/yield-curve/oat'], absent: NOT_GLOBAL })
view(['RATES', 'EU', 'BTP CURVE'], ['COMPRESSED'], { requests: ['/api/tv/yield-curve/btp'], absent: NOT_GLOBAL })

const SINGLE_MARKET: Array<[country: string, overnight: string, market: string, curveTab: string, curveKey: string]> = [
  ['UK', 'CURRENT SONIA', 'UK: 3M SONIA', 'GILT CURVE', 'gilt'],
  ['CAD', 'CURRENT CORRA', 'CAD: 3M CORRA', 'CAD YIELD CURVE', 'cad'],
  ['JPY', 'CURRENT TONA', 'JPY: 3M TONA', 'JGB CURVE', 'jgb'],
  ['AUS', 'CURRENT AONIA', 'AUS: 90D BANK BILL', 'AGB CURVE', 'agb'],
]
for (const [c, overnight, market, curveTab, curveKey] of SINGLE_MARKET) {
  view(['RATES', c, 'STIR STRIPS'], ['Loading strip monitor…', overnight])
  view(['RATES', c, 'FORWARD PRICING'], [market])
  view(['RATES', c, 'POLICY RATE'], [`Loading ${c} term structure…`])
  view(['RATES', c, curveTab], ['COMPRESSED'], { requests: [`/api/tv/yield-curve/${curveKey}`], absent: NOT_GLOBAL })
}
view(['RATES', 'GLOBAL'], ['GLOBAL RATES SUMMARY'])

// ── EQUITIES ────────────────────────────────────────────────────────────────
view(['EQUITIES', 'US', 'INDEX COMPARISON'], ['INDEX LEVELS'])
view(['EQUITIES', 'US', 'SECTOR ATTRIBUTION'], ['Loading sector attribution…'])
view(['EQUITIES', 'US', 'BREADTH'], ['S&P 500 % of constituents above MA'])
view(['EQUITIES', 'US', 'VOL'], ['S&P 500 VOLATILITY'])
view(['EQUITIES', 'GLOBAL', 'COUNTRY RETURNS'], ['Loading country returns…'])
for (const c of ['UK', 'EU', 'CAD', 'JPY', 'AUS']) view(['EQUITIES', c], [`${c} equities coming soon`], { placeholder: true })

// ── FX ──────────────────────────────────────────────────────────────────────
view(['FX', 'US'], ['USD CROSSES — USD STRENGTH'])
for (const [c, ccy] of [['UK', 'GBP'], ['EU', 'EUR'], ['CAD', 'CAD'], ['JPY', 'JPY'], ['AUS', 'AUD']]) {
  view(['FX', c], [`Loading ${ccy} pair returns…`])
}

// ── COMMODITIES ─────────────────────────────────────────────────────────────
view(['COMMODITIES', 'ENERGY', 'CRUDE OIL'], ['ENERGY RETURNS', 'Brent–WTI Front Month Spread'])
view(['COMMODITIES', 'METALS'], ['METALS RETURNS'])
view(['COMMODITIES', 'AGS'], ['AGS models coming soon'], { placeholder: true })
view(['COMMODITIES', 'SOFTS'], ['SOFTS models coming soon'], { placeholder: true })

// ── Nav tabs each tier must expose (pins the harness to the app) ────────────
const NAV: Array<[path: string[], tabs: string[]]> = [
  [[], ['MACRO', 'RATES', 'EQUITIES', 'FX', 'COMMODITIES']],
  [['MACRO'], ['REGIMES', 'CROSS ASSET VOL']],
  [['RATES'], ['US', 'UK', 'EU', 'CAD', 'JPY', 'AUS', 'GLOBAL']],
  [['RATES', 'US'], ['STIR STRIPS', 'FORWARD PRICING', 'POLICY RATE', 'UST CURVE', 'VOL', 'YIELD ATTRIBUTION', 'CREDIT', 'MONEY MARKETS', 'TREASURY AUCTIONS']],
  [['RATES', 'EU'], ['STIR STRIPS', 'FORWARD PRICING', 'POLICY RATE', 'CREDIT', 'BUND CURVE', 'OAT CURVE', 'BTP CURVE']],
  ...SINGLE_MARKET.map(([c, , , curveTab]) => [['RATES', c], ['STIR STRIPS', 'FORWARD PRICING', 'POLICY RATE', curveTab]] as [string[], string[]]),
  [['EQUITIES'], ['US', 'UK', 'EU', 'CAD', 'JPY', 'AUS', 'GLOBAL']],
  [['EQUITIES', 'US'], ['INDEX COMPARISON', 'SECTOR ATTRIBUTION', 'BREADTH', 'VOL']],
  [['EQUITIES', 'GLOBAL'], ['COUNTRY RETURNS']],
  [['FX'], ['US', 'UK', 'EU', 'CAD', 'JPY', 'AUS']],
  [['COMMODITIES'], ['METALS', 'ENERGY', 'AGS', 'SOFTS']],
  [['COMMODITIES', 'ENERGY'], ['CRUDE OIL']],
]

// ── Harness ─────────────────────────────────────────────────────────────────

let requests: string[] = []
beforeEach(() => {
  requests = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return new Promise<Response>(() => undefined) // hold pending: every view shows its loading state
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const buttonsLabelled = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].filter(b => b.textContent?.trim() === label)

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled() // lazy tabs: VOL, TREASURY AUCTIONS
    await new Promise(r => setTimeout(r, 20))
  })
}

/** Mount the page and click through `path`. Requests are recorded from the last click only. */
async function open(path: string[]) {
  const { container } = render(<MemoryRouter><STIRDashboardPage /></MemoryRouter>)
  await settle()
  for (const [i, label] of path.entries()) {
    const btns = buttonsLabelled(container, label)
    expect(btns, `nav "${label}" (step ${i + 1} of ${path.join(' > ')}) should be exactly one button`).toHaveLength(1)
    if (i === path.length - 1) requests = []
    await act(async () => { fireEvent.click(btns[0]) })
  }
  await settle()
  return container.querySelector('main') as HTMLElement
}

function matches(v: View, main: HTMLElement, reqs: string[]): boolean {
  const text = main.textContent ?? ''
  return v.text.every(t => text.includes(t))
    && (v.requests ?? []).every(r => reqs.some(u => u.includes(r)))
    && (v.absent ?? []).every(t => !text.includes(t))
}

const name = (v: View) => v.path.join(' > ')

describe('Asset Class Models — harness inventory', () => {
  it('covers 55 views, 8 of them placeholders, each path unique', () => {
    expect(V).toHaveLength(55)
    expect(V.filter(v => v.placeholder)).toHaveLength(8)
    expect(new Set(V.map(name)).size).toBe(55)
    console.log(`views: ${V.length} (${V.length - V.filter(v => v.placeholder).length} real + ${V.filter(v => v.placeholder).length} placeholders); by asset class: ` +
      ['MACRO', 'RATES', 'EQUITIES', 'FX', 'COMMODITIES'].map(a => `${a} ${V.filter(v => v.path[0] === a).length}`).join(', '))
  })

  for (const [path, tabs] of NAV) {
    it(`nav at [${path.join(' > ') || 'top'}] exposes exactly: ${tabs.join(', ')}`, async () => {
      const main = await open(path)
      // Every expected tab is a single button; no unexpected sibling tabs in its row.
      const rows = new Set<Element>()
      for (const t of tabs) {
        const b = buttonsLabelled(main, t)
        expect(b, t).toHaveLength(1)
        rows.add(b[0].parentElement!)
      }
      expect(rows.size, 'tabs share one row').toBe(1)
      const row = [...rows][0]
      expect([...row.querySelectorAll(':scope > button')].map(b => b.textContent?.trim())).toEqual(tabs)
    })
  }
})

describe('Asset Class Models — every view mounts and shows its own content', () => {
  for (const v of V) {
    it(`${name(v)}${v.placeholder ? ' (placeholder)' : ''}`, async () => {
      const main = await open(v.path)
      const text = main.textContent ?? ''
      for (const t of v.text) expect(text, `marker "${t}"`).toContain(t)
      for (const r of v.requests ?? []) expect(requests, `request ${r}`).toEqual(expect.arrayContaining([expect.stringContaining(r)]))
      for (const t of v.absent ?? []) expect(text, `absent "${t}"`).not.toContain(t)
      const matching = V.filter(w => matches(w, main, requests)).map(name)
      expect(matching, 'exactly this view is identified').toEqual([name(v)])
    })
  }
})
