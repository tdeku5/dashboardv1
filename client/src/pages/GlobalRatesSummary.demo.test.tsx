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
import { cellHeatStep } from '../lib/cellColor'
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
// R5c: the Δ columns are the cellColor named heatmap on the --acm-heat-rate-*
// scale (red = up, blue = down; addendum Decision 1), steps 1–4 by |Δ| ÷ the
// column's max — no longer an rgba alpha. Columns are tagged with data-col.

const heatStep = (cell: HTMLTableCellElement): { side: 'up' | 'down' | null; step: number } => {
  // data-heat mirrors the inline fill (happy-dom drops var() backgrounds from style)
  const m = /acm-heat-rate-(up|down)-(\d)/.exec(cell.getAttribute('data-heat') ?? '')
  return m ? { side: m[1] as 'up' | 'down', step: Number(m[2]) } : { side: null, step: 0 }
}

describe('heatmap styling', () => {
  it('curve Δ cells carry the same delta column tag as the yield Δ cells', async () => {
    const t = await summaryTable()
    const cells = Array.from(t.querySelectorAll('tbody tr')[0].querySelectorAll('td'))
    const col = (i: number) => cells[i].getAttribute('data-col') ?? ''
    for (const i of [1, 2, 3, 4, 6, 8]) expect(col(i)).toBe('delta')
    for (const i of [5, 7]) expect(col(i)).toBe('regime')
    for (const i of [10, 11, 12]) expect(col(i)).toBe('spread')
  })

  it('curve Δ cells get a rate-scale heat fill, scaled per column', async () => {
    const t = await summaryTable()
    // JP is the only negative 2s10s Δ in the 20D payload (-4.9 of max 18.19),
    // so it must take the blue (down) side while the positives take red (up).
    const rows = Array.from(t.querySelectorAll('tbody tr'))
    const cellFor = (ctry: string, i: number) => {
      const tr = rows.find(r => (r.querySelector('td')?.textContent ?? '').trim() === ctry)
      return (tr as HTMLTableRowElement).querySelectorAll('td')[i] as HTMLTableCellElement
    }
    expect(heatStep(cellFor('JP', 6)).side).toBe('down')
    expect(heatStep(cellFor('FR', 6)).side).toBe('up')
    // FR is the column max (18.19) → the strongest step; US is weaker.
    expect(heatStep(cellFor('FR', 6)).step).toBe(4)
    expect(heatStep(cellFor('US', 6)).step).toBeLessThan(heatStep(cellFor('FR', 6)).step)
    // Text stays primary on heat cells: the cells carry no tone class.
    expect(cellFor('FR', 6).getAttribute('class') ?? '').not.toMatch(/negative|positive/)
  })

  it('the two curve Δ columns are scaled independently of the yield Δ columns', async () => {
    const t = await summaryTable()
    const rows = Array.from(t.querySelectorAll('tbody tr'))
    const tr = rows.find(r => (r.querySelector('td')?.textContent ?? '').trim() === 'FR') as HTMLTableRowElement
    const tds = tr.querySelectorAll('td')
    // FR is the max of 2s10s Δ (+18.19) → the top step. FR's 2Y Δ (-5.78) is
    // scaled by the 2Y column's own max (JP -6.5), not by the 2s10s max: its
    // step matches 5.78 / 6.5 and differs from 5.78 / 18.19.
    expect(heatStep(tds[6] as HTMLTableCellElement).step).toBe(4)
    const fr2y = heatStep(tds[1] as HTMLTableCellElement).step
    expect(fr2y).toBe(cellHeatStep(-5.78, 6.5))
    expect(fr2y).not.toBe(cellHeatStep(-5.78, 18.19))
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

describe('column layout', () => {
  // R5c: columns size to their content (no fixed px widths); the browser probe
  // checks the table does not overflow its panel. Here: every column is tagged.
  it('all 13 columns are classified: 1 country, 6 Δ, 2 regime, 1 next move, 3 policy spread', async () => {
    const t = await summaryTable()
    const cols = Array.from(t.querySelectorAll('thead th')).map(th => th.getAttribute('data-col') ?? '')
    expect(cols).toHaveLength(13)
    expect(cols.filter(c => c === 'country')).toHaveLength(1)
    expect(cols.filter(c => c === 'delta')).toHaveLength(6)
    expect(cols.filter(c => c === 'regime')).toHaveLength(2)
    expect(cols.filter(c => c === 'nextmove')).toHaveLength(1)
    expect(cols.filter(c => c === 'spread')).toHaveLength(3)
  })
})
