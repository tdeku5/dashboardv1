// @vitest-environment happy-dom
//
// Phase-2 acceptance demo for the US Rates VOL tab. No browser exists in this
// environment, so the page is mounted with @testing-library/react and asserted
// against the real DOM it produces.
//
// Three kinds of case, kept clearly separate:
//   • REAL DATA — payload rebuilt from the live SQLite database, with the
//     premium re-derived in the test rather than trusted from the route.
//   • FIXTURE — the renormalization and short-window paths, which NO REAL DATA
//     EXERCISES (TradingView's 2y/5y/10y/30y have no gaps, so the backfill
//     produced 9,640 rows with weights_renormalized = 1 on zero of them).
//     Labelled as fixtures wherever they appear.
//   • NAV — every pre-existing tab in the US rates row still mounts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRequire } from 'node:module'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { STIRDashboardPage } from './STIRDashboardPage'
import { UsRatesVolPage, buildPremiumChartData } from './UsRatesVolPage'
import type { UsRatesVolResponse, VolSeriesPoint } from '../hooks/useUsRatesVol'

interface StatementLike { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] }
interface DatabaseLike { prepare(sql: string): StatementLike; close(): void }
type DatabaseCtor = new (p: string, o?: { readonly?: boolean }) => DatabaseLike

const require = createRequire(path.join(process.cwd(), 'package.json'))
const Database = require('better-sqlite3') as DatabaseCtor
// happy-dom rewrites import.meta.url, and cwd differs between
// `npm test -w client` (client/) and `vitest --root client` (repo root), so
// probe both rather than assuming one.
const dbPath = [
  path.resolve(process.cwd(), '..', 'fred_data.db'),
  path.resolve(process.cwd(), 'fred_data.db'),
].find(p => existsSync(p)) ?? path.resolve(process.cwd(), '..', 'fred_data.db')

interface RealRow {
  date: string
  move: number
  rv_2y: number; rv_5y: number; rv_10y: number; rv_30y: number; rv_move: number
  weights_renormalized: number; n_obs: number
}

/** Last N inner-joined rows, read straight from the database. */
function loadRealRows(n: number): RealRow[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(`
      WITH implied AS (
        SELECT date(CAST(time AS INTEGER),'unixepoch') d, close move
        FROM tv_series WHERE symbol = 'MOVE' AND close IS NOT NULL
      )
      SELECT r.date, i.move, r.rv_2y, r.rv_5y, r.rv_10y, r.rv_30y, r.rv_move,
             r.weights_renormalized, r.n_obs
      FROM us_rates_realized_vol r JOIN implied i ON i.d = r.date
      ORDER BY r.date DESC LIMIT ?
    `).all(n).reverse() as RealRow[]
  } finally { db.close() }
}

function point(o: Partial<VolSeriesPoint> & { date: string }): VolSeriesPoint {
  return {
    date: o.date,
    move: o.move ?? null, rvMove: o.rvMove ?? null,
    rv2y: o.rv2y ?? null, rv5y: o.rv5y ?? null, rv10y: o.rv10y ?? null, rv30y: o.rv30y ?? null,
    weightsRenormalized: o.weightsRenormalized ?? false,
    nObs: o.nObs ?? 21,
    premiumBp: o.premiumBp ?? null, ratio: o.ratio ?? null,
    premiumZ252: o.premiumZ252 ?? null, ratioPct252: o.ratioPct252 ?? null,
    premiumMean252: o.premiumMean252 ?? null, premiumSd252: o.premiumSd252 ?? null,
  }
}

function payload(o: Partial<UsRatesVolResponse> & { series: VolSeriesPoint[] }): UsRatesVolResponse {
  const last = o.series[o.series.length - 1]
  return {
    range: '2y',
    asOfImplied: o.asOfImplied ?? last?.date ?? null,
    asOfRealized: o.asOfRealized ?? last?.date ?? null,
    impliedTrailsRealized: o.impliedTrailsRealized ?? false,
    rangeStartDate: o.series[0]?.date ?? null,
    lookbackDays: 252,
    series: o.series,
    latest: o.latest ?? {
      date: last?.date ?? null, move: last?.move ?? null, rvMove: last?.rvMove ?? null,
      premiumBp: last?.premiumBp ?? null, ratio: last?.ratio ?? null,
      premiumZ252: last?.premiumZ252 ?? null, ratioPct252: last?.ratioPct252 ?? null,
      weightsRenormalized: last?.weightsRenormalized ?? false,
    },
    contributions: o.contributions ?? [],
    renormalizedRanges: o.renormalizedRanges ?? [],
    joinStats: o.joinStats ?? {
      realizedRows: 0, impliedRows: 0, joined: 0,
      droppedRealizedOnly: 0, droppedImpliedOnly: 0, recentRealizedOnlyDates: [],
    },
  }
}

function stubFetch(body: UsRatesVolResponse) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response))
}

/**
 * The .stat card whose label matches, as a container for scoped queries.
 * Matched on the statLabel class rather than bare text: "Implied MOVE" also
 * appears as a chart legend chip, and the realized value repeats in the
 * contribution table's total row.
 */
function statCard(label: string): HTMLElement {
  const labels = Array.from(document.querySelectorAll('[class*="statLabel"]'))
    .filter(el => (el.textContent ?? '').trim() === label)
  expect(labels, `expected exactly one stat labelled "${label}"`).toHaveLength(1)
  return labels[0].parentElement as HTMLElement
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// ── NAV: criterion 1 ─────────────────────────────────────────────────────────

describe('NAV — US rates tab row', () => {
  const US_RATES_TABS = [
    'STIR STRIPS', 'FORWARD PRICING', 'POLICY RATE', 'UST CURVE', 'VOL',
    'YIELD ATTRIBUTION', 'CREDIT', 'MONEY MARKETS', 'TREASURY AUCTIONS',
  ]

  beforeEach(() => {
    // Hold every request pending so tabs render their loading states.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined))
  })

  it('VOL sits immediately after UST CURVE, and no other tab moved', () => {
    const { container } = render(<MemoryRouter><STIRDashboardPage /></MemoryRouter>)
    const labels = Array.from(container.querySelectorAll('button'))
      .map(b => (b.textContent ?? '').trim())
      .filter(t => US_RATES_TABS.includes(t))
    // De-duplicate while preserving first-seen order.
    const order = labels.filter((t, i) => labels.indexOf(t) === i)
    expect(order).toEqual(US_RATES_TABS)
    expect(order[order.indexOf('UST CURVE') + 1]).toBe('VOL')
  })

  for (const tab of US_RATES_TABS) {
    it(`${tab} still mounts without throwing`, () => {
      const { container } = render(<MemoryRouter><STIRDashboardPage /></MemoryRouter>)
      const btn = Array.from(container.querySelectorAll('button'))
        .find(b => (b.textContent ?? '').trim() === tab)
      expect(btn, `tab button "${tab}" not found`).toBeDefined()
      expect(() => fireEvent.click(btn as HTMLButtonElement)).not.toThrow()
      expect(container.innerHTML.length).toBeGreaterThan(0)
    })
  }
})

// ── REAL DATA ────────────────────────────────────────────────────────────────

describe('REAL DATA — stat strip reflects the live database', () => {
  it('renders the real latest MOVE, realized and premium, re-derived in the test', async () => {
    const rows = loadRealRows(300)
    expect(rows.length).toBeGreaterThan(250)
    const last = rows[rows.length - 1]

    // Re-derive rather than trust the route: premium is MOVE − RMOVE.
    const expectedPremium = last.move - last.rv_move
    const expectedRatio = last.move / last.rv_move

    const series = rows.map(r => point({
      date: r.date, move: r.move, rvMove: r.rv_move,
      rv2y: r.rv_2y, rv5y: r.rv_5y, rv10y: r.rv_10y, rv30y: r.rv_30y,
      weightsRenormalized: r.weights_renormalized === 1, nObs: r.n_obs,
      premiumBp: r.move - r.rv_move, ratio: r.move / r.rv_move,
    }))
    stubFetch(payload({ series }))

    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)

    await screen.findByText('Contribution to the blend')
    expect(within(statCard('Implied MOVE')).getByText(last.move.toFixed(2))).toBeTruthy()
    expect(within(statCard('Realized (21d)')).getByText(last.rv_move.toFixed(2))).toBeTruthy()

    const sign = expectedPremium >= 0 ? '+' : '−'
    const premiumText = `${sign}${Math.abs(expectedPremium).toFixed(2)}`
    expect(within(statCard('Implied vol premium')).getByText(premiumText)).toBeTruthy()
    expect(within(statCard('Ratio')).getByText(`${expectedRatio.toFixed(3)}×`)).toBeTruthy()

    // Both as-of dates are the same when implied has not fallen behind.
    expect(screen.getAllByText(`as of ${last.date}`).length).toBeGreaterThan(0)
  })

  it('surfaces the two as-of dates when implied trails realized', async () => {
    const rows = loadRealRows(30)
    const last = rows[rows.length - 1]
    const series = rows.map(r => point({
      date: r.date, move: r.move, rvMove: r.rv_move,
      premiumBp: r.move - r.rv_move, ratio: r.move / r.rv_move,
    }))
    stubFetch(payload({
      series,
      asOfImplied: last.date,
      asOfRealized: '2026-09-23',
      impliedTrailsRealized: true,
    }))

    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    const warn = await screen.findByText(/Realized has printed for/)
    expect(warn.textContent).toContain('2026-09-23')
    expect(warn.textContent).toContain(last.date)
    // The staleness is explained, not silently absorbed.
    expect(screen.getByText(/stale-tip filter/)).toBeTruthy()
    expect(screen.getByText(/nothing is forward-filled/)).toBeTruthy()
  })
})

// ── FIXTURE: criterion 5 — renormalized weights ──────────────────────────────

describe('FIXTURE — renormalized weights (no real data exercises this path)', () => {
  // TradingView's 2y/5y/10y/30y carry no gaps, so the live table has
  // weights_renormalized = 1 on zero of its 9,640 rows. This fixture drives
  // the path the way a missing 30y would.
  const fixture = payload({
    series: [
      point({ date: '2026-09-21', move: 100, rvMove: 75, rv2y: 50, rv5y: 50, rv10y: 100, rv30y: null, weightsRenormalized: true, premiumBp: 25, ratio: 100 / 75 }),
      point({ date: '2026-09-22', move: 100, rvMove: 75, rv2y: 50, rv5y: 50, rv10y: 100, rv30y: null, weightsRenormalized: true, premiumBp: 25, ratio: 100 / 75 }),
    ],
    renormalizedRanges: [{ from: '2026-09-21', to: '2026-09-22', days: 2 }],
    contributions: [
      { tenor: '2y', weight: 0.25, rv: 50, contribution: 12.5, sharePct: 16.666666 },
      { tenor: '5y', weight: 0.25, rv: 50, contribution: 12.5, sharePct: 16.666666 },
      { tenor: '10y', weight: 0.50, rv: 100, contribution: 50, sharePct: 66.666666 },
      { tenor: '30y', weight: 0, rv: null, contribution: null, sharePct: null },
    ],
  })

  it('marks the stretch rather than leaving it silently different', async () => {
    stubFetch(fixture)
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    const warn = await screen.findByText(/Weights renormalized on 2 date\(s\)/)
    expect(warn).toBeTruthy()
    expect(screen.getByText('· 2026-09-21 → 2026-09-22 (2d)')).toBeTruthy()
    expect(screen.getByText(/not the standard 20\/20\/40\/20/)).toBeTruthy()
  })

  it('the contribution table shows 25 / 25 / 50 with the 30y as an em dash, not zero', async () => {
    stubFetch(fixture)
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Contribution to the blend')

    const table = screen.getByText('Contribution to the blend')
      .parentElement?.parentElement?.querySelector('table') as HTMLElement
    expect(table).toBeTruthy()
    const rowFor = (tenor: string) => {
      const cell = within(table).getByText(tenor)
      return Array.from((cell.closest('tr') as HTMLElement).querySelectorAll('td')).map(td => td.textContent ?? '')
    }
    expect(rowFor('2Y')).toEqual(['2Y', '25.0%', '50.00', '12.50', expect.stringContaining('16.7%')])
    expect(rowFor('5Y')).toEqual(['5Y', '25.0%', '50.00', '12.50', expect.stringContaining('16.7%')])
    expect(rowFor('10Y')).toEqual(['10Y', '50.0%', '100.00', '50.00', expect.stringContaining('66.7%')])
    // The missing tenor is a dash across the board — never a 0 that would read
    // as "this tenor was flat".
    expect(rowFor('30Y')).toEqual(['30Y', '—', '—', '—', '—'])
    expect(screen.getByText(/renormalized — a tenor was missing/)).toBeTruthy()
  })
})

// ── FIXTURE: criterion 6 — short window renders a dash, no interpolation ─────

describe('FIXTURE — fewer than 21 observations (no real data exercises this path)', () => {
  // The backfill starts at the first date all four tenors have a full window,
  // so every one of the 9,640 live rows has n_obs = 21. This fixture supplies
  // the short-window row the live table cannot.
  it('a null blend renders as an em dash in the stat strip, not 0', async () => {
    stubFetch(payload({
      series: [
        point({ date: '2026-09-21', move: 80, rvMove: 70, premiumBp: 10, ratio: 80 / 70 }),
        point({ date: '2026-09-22', move: 80, rvMove: null, nObs: 20 }),
      ],
    }))
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Realized (21d)')
    expect(within(statCard('Realized (21d)')).getByText('—')).toBeTruthy()
    expect(within(statCard('Implied vol premium')).getByText('—')).toBeTruthy()
    expect(within(statCard('Ratio')).getByText('—×')).toBeTruthy()
    expect(within(statCard('Premium 1y z-score')).getByText('—')).toBeTruthy()
    expect(within(statCard('Ratio 1y percentile')).getByText('—')).toBeTruthy()
  })

  it('chart data keeps the gap as null — a break, never a zero or a bridge', () => {
    // Paired with connectNulls={false} on every <Line>, a null datum is what
    // makes Recharts break the path instead of drawing through it.
    const data = buildPremiumChartData([
      point({ date: 'd1', premiumBp: 10, premiumMean252: 5, premiumSd252: 2 }),
      point({ date: 'd2', premiumBp: null, premiumMean252: null, premiumSd252: null }),
      point({ date: 'd3', premiumBp: 12, premiumMean252: 5, premiumSd252: 2 }),
    ])
    expect(data.map(d => d.premiumBp)).toEqual([10, null, 12])
    expect(data.map(d => d.band1hi)).toEqual([7, null, 7])
    expect(data.map(d => d.band1lo)).toEqual([3, null, 3])
    expect(data.map(d => d.band2hi)).toEqual([9, null, 9])
    expect(data.map(d => d.band2lo)).toEqual([1, null, 1])
    // Explicitly not zero-filled — 0 bp is a real premium reading.
    expect(data[1].premiumBp).not.toBe(0)
  })

  it('bands are absent until the 252-day window is full', () => {
    const data = buildPremiumChartData([
      point({ date: 'd1', premiumBp: 4, premiumMean252: null, premiumSd252: null }),
    ])
    expect(data[0].premiumBp).toBe(4)
    expect(data[0].band1hi).toBeNull()
    expect(data[0].band2lo).toBeNull()
  })
})

// ── Methodology panel: criterion 9 ───────────────────────────────────────────

describe('methodology panel documents the load-bearing conventions', () => {
  beforeEach(() => {
    stubFetch(payload({
      series: [point({ date: '2026-09-22', move: 95, rvMove: 91, premiumBp: 4, ratio: 95 / 91 })],
    }))
  })

  it('is collapsed by default and opens on click', async () => {
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Methodology')
    expect(screen.queryByText('Zero-mean, and why')).toBeNull()
    fireEvent.click(screen.getByText('▸ Show'))
    expect(screen.getByText('Zero-mean, and why')).toBeTruthy()
  })

  it('states the zero-mean convention and why', async () => {
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Methodology')
    fireEvent.click(screen.getByText('▸ Show'))
    expect(screen.getByText(/no mean subtraction, and\s+an N \(not N−1\) denominator/)).toBeTruthy()
    expect(screen.getAllByText(/second moment/).length).toBeGreaterThan(0)
    expect(screen.getByText(/≈31.7bp annualized while/)).toBeTruthy()
  })

  it('states the 21-day trailing vs same-date implied window convention', async () => {
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Methodology')
    fireEvent.click(screen.getByText('▸ Show'))
    expect(screen.getByText(/21-day trailing realized against same-date implied/)).toBeTruthy()
    expect(screen.getByText(/prices volatility over the forward window/)).toBeTruthy()
  })

  it('states N = 21, the √252 annualization, the weights and the renormalization rule', async () => {
    render(<MemoryRouter><UsRatesVolPage /></MemoryRouter>)
    await screen.findByText('Methodology')
    fireEvent.click(screen.getByText('▸ Show'))
    expect(screen.getByText(/N = 21/)).toBeTruthy()
    expect(screen.getByText(/√252/)).toBeTruthy()
    expect(screen.getByText(/20% \/ 20% \/ 40% \/ 20%/)).toBeTruthy()
    expect(screen.getByText(/0.25 \/ 0.25 \/ 0.50/)).toBeTruthy()
    expect(screen.getByText(/two or more/)).toBeTruthy()
  })
})
