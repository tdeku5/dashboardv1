// @vitest-environment happy-dom
//
// Phase-2 acceptance demo for the Global Rates Summary table. No browser exists
// in this environment, so the real GlobalRatesPage is mounted with
// @testing-library/react and the rendered DOM is asserted directly.
//
// The payloads in __fixtures__/ratesSummaryPayloads.ts were CAPTURED from the
// running server, so the expected strings below are what the client formatter
// actually produces from real server values — not numbers retyped from a gate
// report. (JS toFixed(1) turns 7.25 into "+7.3" where Python's %.1f gives
// "+7.2"; reading expectations off the rendered UI is the only safe way.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GlobalRatesPage } from './GlobalRatesPage'
import { RATES_SUMMARY_20D, RATES_SUMMARY_60D } from './__fixtures__/ratesSummaryPayloads'
import type { RatesSummaryResponse } from '../hooks/useGlobalRatesSummary'

const EXPECTED_HEADERS_20D = [
  'Country', '2Y Δ', '5Y Δ', '10Y Δ', '30Y Δ',
  '2s10s', '2s10s Δ (20D)', '10s30s', '10s30s Δ (20D)',
  'Next CB Move', 'Terminal − OCR (bps)', '+6M − Terminal (bps)', '+12M − Terminal (bps)',
]

const EXPECTED_ROWS = ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU']

/** Route rates-summary to `body`; hold every other request pending. */
function stubFetch(byRegimeLookback: Record<string, RatesSummaryResponse>) {
  vi.stubGlobal('fetch', (input: string) => {
    const url = String(input)
    if (url.includes('/api/global/rates-summary')) {
      const m = /regimeLookback=([^&]+)/.exec(url)
      const body = byRegimeLookback[m?.[1] ?? '20d']
      if (!body) return new Promise<Response>(() => undefined)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
    }
    return new Promise<Response>(() => undefined)
  })
}

/** The summary table, once the fetch has resolved and rows have painted. */
async function summaryTable(): Promise<HTMLTableElement> {
  const t = await waitFor(() => {
    const el = document.querySelector('table[class*="summaryTable"]')
    expect(el, 'summary table not rendered').toBeTruthy()
    expect(el?.querySelectorAll('tbody tr').length, 'no body rows yet').toBeGreaterThan(0)
    return el as HTMLTableElement
  })
  return t
}

function renderPage(): void {
  render(<MemoryRouter><GlobalRatesPage /></MemoryRouter>)
}

/** Wait until the header row carries `label` — the muted unit hint lives in a
 *  nested <span>, so the text is split and findByText cannot match it whole. */
async function waitForHeader(label: string): Promise<HTMLTableElement> {
  return waitFor(() => {
    const el = document.querySelector('table[class*="summaryTable"]') as HTMLTableElement | null
    expect(el).toBeTruthy()
    expect(headerTexts(el as HTMLTableElement)).toContain(label)
    return el as HTMLTableElement
  })
}

function headerTexts(t: HTMLTableElement): string[] {
  return Array.from(t.querySelectorAll('thead th')).map(
    th => (th.textContent ?? '').replace(/\s+/g, ' ').trim(),
  )
}

function bodyMatrix(t: HTMLTableElement): string[][] {
  return Array.from(t.querySelectorAll('tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').trim()),
  )
}

beforeEach(() => {
  stubFetch({ '20d': RATES_SUMMARY_20D, '60d': RATES_SUMMARY_60D })
  renderPage()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// ── Structure: 8 rows × 13 columns in the specified order ───────────────────

describe('column order and row set', () => {
  it('renders exactly 13 columns in the order the spec fixes', async () => {
    const t = await summaryTable()
    expect(headerTexts(t)).toEqual(EXPECTED_HEADERS_20D)
  })

  it('2s10s Δ sits immediately right of 2s10s, 10s30s Δ right of 10s30s', async () => {
    const h = headerTexts(await summaryTable())
    expect(h[h.indexOf('2s10s') + 1]).toBe('2s10s Δ (20D)')
    expect(h[h.indexOf('10s30s') + 1]).toBe('10s30s Δ (20D)')
  })

  it('renders exactly 8 rows: US, UK, DE, FR, IT, CA, JP, AU — no EU', async () => {
    const m = bodyMatrix(await summaryTable())
    expect(m).toHaveLength(8)
    expect(m.map(r => r[0])).toEqual(EXPECTED_ROWS)
    expect(m.map(r => r[0])).not.toContain('EU')
  })

  it('every row has 13 cells', async () => {
    for (const row of bodyMatrix(await summaryTable())) expect(row).toHaveLength(13)
  })

  it('the retired front-vs-12m column is gone from the header row', async () => {
    const h = headerTexts(await summaryTable()).join(' | ')
    expect(h).not.toMatch(/front/i)
    expect(h).toMatch(/\+6M − Terminal/)
    expect(h).toMatch(/\+12M − Terminal/)
  })
})

// ── Values, read off the rendered DOM ───────────────────────────────────────

describe('rendered values (expectations taken from the DOM, not from a report)', () => {
  it('US row renders every column through the signed-bps formatter', async () => {
    const m = bodyMatrix(await summaryTable())
    // Server: 2.9 / 2.9 / 0.7 / -0.7 | Bear Stp | 11.2 | Bear Flt | -2.9
    //         HIKE | 90 | -19.48 | -1.89
    expect(m[0]).toEqual([
      'US', '+2.9', '+2.9', '+0.7', '-0.7',
      'Bear Stp', '+11.2', 'Bear Flt', '-2.9',
      'HIKE', '+90.0', '-19.5', '-1.9',
    ])
  })

  it('DE 2s10s Δ renders +7.3 — toFixed(1) of 7.25, not +7.2', async () => {
    const m = bodyMatrix(await summaryTable())
    const de = m.find(r => r[0] === 'DE') as string[]
    expect(de[6]).toBe('+7.3')
  })

  it('JP shows the widest values in full, not truncated', async () => {
    const m = bodyMatrix(await summaryTable())
    const jp = m.find(r => r[0] === 'JP') as string[]
    expect(jp[10]).toBe('+212.1')    // Terminal − OCR
    expect(jp[11]).toBe('-106.6')    // +6M − Terminal
    expect(jp[12]).toBe('-78.5')     // +12M − Terminal
    // Nothing ellipsized anywhere in the row.
    for (const cell of jp) expect(cell).not.toMatch(/[…]|\.\.\./)
  })

  it('the longest regime labels render in full', async () => {
    const m = bodyMatrix(await summaryTable())
    const labels = m.flatMap(r => [r[5], r[7]])
    expect(labels).toContain('Flt Twist')      // JP 10s30s
    expect(labels).toContain('Stp Twist')      // AU 10s30s
    expect(labels).toContain('Bear Stp')
    expect(labels).toContain('Bull Flt')
    for (const l of labels) expect(l).not.toMatch(/[…]|\.\.\./)
  })

  it('DE / FR / IT share identical policy columns and differ on their own curves', async () => {
    const m = bodyMatrix(await summaryTable())
    const pick = (c: string) => m.find(r => r[0] === c) as string[]
    const [de, fr, it] = [pick('DE'), pick('FR'), pick('IT')]
    // Columns 9–12: Next CB Move, Terminal − OCR, +6M, +12M — identical by design.
    expect(de.slice(9)).toEqual(fr.slice(9))
    expect(de.slice(9)).toEqual(it.slice(9))
    expect(de.slice(9)).toEqual(['HIKE', '+124.0', '-16.6', '-0.6'])
    // Columns 1–8: their own Bund / OAT / BTP curves — must differ.
    expect(de.slice(1, 9)).not.toEqual(fr.slice(1, 9))
    expect(fr.slice(1, 9)).not.toEqual(it.slice(1, 9))
  })

  it('every numeric cell is signed-1dp or an em dash — never NaN, never bare 0', async () => {
    const m = bodyMatrix(await summaryTable())
    const NUMERIC_COLS = [1, 2, 3, 4, 6, 8, 10, 11, 12]
    for (const row of m) {
      for (const i of NUMERIC_COLS) {
        expect(row[i], `${row[0]} col ${i}`).toMatch(/^(—|[+-]?\d+\.\d)$/)
        expect(row[i]).not.toMatch(/NaN|Infinity|undefined/)
      }
    }
  })
})

// ── Heatmap: the curve Δ columns reuse the yield-Δ treatment ────────────────

describe('heatmap styling', () => {
  it('curve Δ cells carry the same colDelta class as the yield Δ cells', async () => {
    const t = await summaryTable()
    const cells = Array.from(t.querySelectorAll('tbody tr')[0].querySelectorAll('td'))
    const cls = (i: number) => cells[i].getAttribute('class') ?? ''
    for (const i of [1, 2, 3, 4, 6, 8]) expect(cls(i)).toMatch(/colDelta/)
    for (const i of [5, 7]) expect(cls(i)).toMatch(/colRegime/)
    for (const i of [10, 11, 12]) expect(cls(i)).toMatch(/colSpread/)
  })

  it('curve Δ cells get a background gradient, scaled per column', async () => {
    const t = await summaryTable()
    // JP is the only negative 2s10s Δ in the 20D payload (-4.9 of max 18.19),
    // so it must be blue-tinted while the positives are red-tinted.
    const rows = Array.from(t.querySelectorAll('tbody tr'))
    const cellFor = (ctry: string, i: number) => {
      const tr = rows.find(r => (r.querySelector('td')?.textContent ?? '').trim() === ctry)
      return (tr as HTMLTableRowElement).querySelectorAll('td')[i] as HTMLTableCellElement
    }
    expect(cellFor('JP', 6).style.background).toMatch(/rgba\(59, 130, 246/)   // blue
    expect(cellFor('FR', 6).style.background).toMatch(/rgba\(239, 68, 68/)    // red
    // FR is the column max (18.19) → strongest alpha of the positives.
    const frAlpha = Number(/,\s*([\d.]+)\)$/.exec(cellFor('FR', 6).style.background)?.[1])
    const usAlpha = Number(/,\s*([\d.]+)\)$/.exec(cellFor('US', 6).style.background)?.[1])
    expect(frAlpha).toBeGreaterThan(usAlpha)
    expect(frAlpha).toBeCloseTo(0.35, 2)
  })

  it('the two curve Δ columns are scaled independently of the yield Δ columns', async () => {
    const t = await summaryTable()
    const rows = Array.from(t.querySelectorAll('tbody tr'))
    const tr = rows.find(r => (r.querySelector('td')?.textContent ?? '').trim() === 'FR') as HTMLTableRowElement
    const tds = tr.querySelectorAll('td')
    // FR is the max of 2s10s Δ (+18.19) so alpha is capped, but FR's 2Y Δ
    // (-5.78) is NOT its column max (JP -6.5 is), so its alpha is lower.
    const a = (i: number) => Number(/,\s*([\d.]+)\)$/.exec((tds[i] as HTMLTableCellElement).style.background)?.[1])
    expect(a(6)).toBeCloseTo(0.35, 2)
    expect(a(1)).toBeLessThan(0.35)
  })
})

// ── D2: the window label comes from the response, and tracks the dropdown ───

describe('Regime Lookback drives both the header label and the Δ values', () => {
  it('switching to 60D relabels the headers and changes the Δ values', async () => {
    const t0 = await summaryTable()
    const before = bodyMatrix(t0)
    expect(headerTexts(t0)).toContain('2s10s Δ (20D)')
    const usBefore = (before.find(r => r[0] === 'US') as string[])[6]
    const deBefore = (before.find(r => r[0] === 'DE') as string[])[6]
    expect([usBefore, deBefore]).toEqual(['+11.2', '+7.3'])

    fireEvent.change(screen.getByLabelText('REGIME LOOKBACK:'), { target: { value: '60d' } })
    const t1 = await waitForHeader('2s10s Δ (60D)')
    const after = bodyMatrix(t1)
    expect(headerTexts(t1)).toContain('2s10s Δ (60D)')
    expect(headerTexts(t1)).toContain('10s30s Δ (60D)')
    // 20D → 60D: US +11.2 → +3.9, DE +7.3 → +1.8 (server values 3.9 / 1.83).
    expect((after.find(r => r[0] === 'US') as string[])[6]).toBe('+3.9')
    expect((after.find(r => r[0] === 'DE') as string[])[6]).toBe('+1.8')
    // Regime labels move with their Δ, as they must — UK flips sign and label.
    const ukAfter = after.find(r => r[0] === 'UK') as string[]
    expect(ukAfter[6]).toBe('-6.8')
    expect(ukAfter[5]).toBe('Bear Flt')
  })

  it('the yield Δ columns are untouched by the regime dropdown', async () => {
    const before = bodyMatrix(await summaryTable()).find(r => r[0] === 'US') as string[]
    fireEvent.change(screen.getByLabelText('REGIME LOOKBACK:'), { target: { value: '60d' } })
    const t1 = await waitForHeader('2s10s Δ (60D)')
    const after = bodyMatrix(t1).find(r => r[0] === 'US') as string[]
    expect(after.slice(1, 5)).toEqual(before.slice(1, 5))
  })

  it('the label is driven by regimeLookbackDays, not the dropdown state', async () => {
    // A deliberately mismatched payload: dropdown will say 20d, response says
    // 200. The header must follow the DATA so it can never mislabel it.
    cleanup()
    vi.unstubAllGlobals()
    stubFetch({ '20d': { ...RATES_SUMMARY_20D, regimeLookbackDays: 200 } })
    renderPage()
    const t = await summaryTable()
    expect(headerTexts(t)).toContain('2s10s Δ (200D)')
    expect(headerTexts(t)).not.toContain('2s10s Δ (20D)')
  })
})

// ── Nulls render as an em dash (no live data exercises this today) ──────────

describe('null rendering', () => {
  it('a null in any new column renders —, never 0.0 or NaN', async () => {
    // CA will hit this for real after the December contract roll, when its
    // 5-contract strip stops reaching +12M. Nothing is null in live data today,
    // so the path is driven here instead of hacked into the page.
    cleanup()
    vi.unstubAllGlobals()
    const holed: RatesSummaryResponse = {
      ...RATES_SUMMARY_20D,
      rows: RATES_SUMMARY_20D.rows.map(r =>
        r.country === 'CA'
          ? { ...r, delta2s10s: null, delta10s30s: null, fwd6mMinusTerminal: null, fwd12mMinusTerminal: null, terminalMinusOcr: null }
          : r,
      ),
    }
    stubFetch({ '20d': holed })
    renderPage()
    const t = await summaryTable()
    const ca = bodyMatrix(t).find(r => r[0] === 'CA') as string[]
    expect([ca[6], ca[8], ca[10], ca[11], ca[12]]).toEqual(['—', '—', '—', '—', '—'])
    for (const i of [6, 8, 10, 11, 12]) {
      expect(ca[i]).not.toBe('0.0')
      expect(ca[i]).not.toMatch(/NaN/)
    }
    // The other rows still render normally alongside the dashes.
    expect((bodyMatrix(t).find(r => r[0] === 'US') as string[])[6]).toBe('+11.2')
  })

  it('a null regime still renders — in its own column', async () => {
    cleanup()
    vi.unstubAllGlobals()
    const holed: RatesSummaryResponse = {
      ...RATES_SUMMARY_20D,
      rows: RATES_SUMMARY_20D.rows.map(r =>
        r.country === 'AU' ? { ...r, regime2s10s: null, delta2s10s: null } : r,
      ),
    }
    stubFetch({ '20d': holed })
    renderPage()
    const t = await summaryTable()
    const au = bodyMatrix(t).find(r => r[0] === 'AU') as string[]
    expect(au[5]).toBe('—')
    expect(au[6]).toBe('—')
  })
})

// ── Width budget (D3) ──────────────────────────────────────────────────────

describe('width budget', () => {
  it('the 13 declared column widths sum to 1188px, inside the 1200px container', async () => {
    // Mirrors the CSS: .colCountry 74 | .colDelta 84 ×6 | .colRegime 100 ×2
    //                 | .colNextMove 110 | .colSpread 100 ×3
    const t = await summaryTable()
    const classes = Array.from(t.querySelectorAll('thead th')).map(th => th.getAttribute('class') ?? '')
    const WIDTH: Array<[RegExp, number]> = [
      [/colCountry/, 74], [/colDelta/, 84], [/colRegime/, 100],
      [/colNextMove/, 110], [/colSpread/, 100],
    ]
    const total = classes.reduce((sum, c) => {
      const hit = WIDTH.find(([re]) => re.test(c))
      expect(hit, `unclassified column: ${c}`).toBeTruthy()
      return sum + (hit as [RegExp, number])[1]
    }, 0)
    expect(total).toBe(1188)
    expect(total).toBeLessThanOrEqual(1200)
    // 6 colDelta (4 yield + 2 curve), 2 colRegime, 3 colSpread.
    expect(classes.filter(c => /colDelta/.test(c))).toHaveLength(6)
    expect(classes.filter(c => /colRegime/.test(c))).toHaveLength(2)
    expect(classes.filter(c => /colSpread/.test(c))).toHaveLength(3)
  })
})
