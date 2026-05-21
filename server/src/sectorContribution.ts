import { db } from './db'
import { SECTORS, BENCHMARK_TICKER } from './sectorAttribution'

export type ContribLookbackKey = '1d' | '1w' | '2w' | '1m' | '3m' | '6m' | '1y'
export type ContribRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

// Trading-day window length per lookback key. The bar at date t represents the
// rolling spy_close[t]/spy_close[t-N] − 1 return (and per-sector weighted
// equivalent). N=1 reproduces the daily-return chart.
export const LOOKBACK_TRADING_DAYS: Record<ContribLookbackKey, number> = {
  '1d': 1,
  '1w': 5,
  '2w': 10,
  '1m': 20,
  '3m': 63,
  '6m': 126,
  '1y': 252,
}

// Snapshot of SPY GICS sector weights. SPY publishes these via SSGA's daily
// holdings XLSX; this is institutionally standard practice for a 1-year
// attribution chart since weights drift only ~0.5%/month outside rebalances.
//
// Source: https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy
export const WEIGHTS_AS_OF = '2026-05-05'
export const SPY_SECTOR_WEIGHTS: Record<string, number> = {
  XLK:  0.3576, // Information Technology
  XLF:  0.1181, // Financials
  XLC:  0.1092, // Communication Services
  XLY:  0.0997, // Consumer Discretionary
  XLI:  0.0864, // Industrials
  XLV:  0.0840, // Health Care
  XLP:  0.0489, // Consumer Staples
  XLE:  0.0347, // Energy
  XLU:  0.0231, // Utilities
  XLB:  0.0193, // Materials
  XLRE: 0.0190, // Real Estate
}

export interface ContributionSeriesRow {
  date: string
  spy_return: number
  contributions: Record<string, number>
  // Closes per ticker on this date (SPY + sectors). Lets the client compute
  // cumulative returns over an arbitrary brushed sub-range without needing to
  // compound daily returns (which we don't expose) or invert rolling windows.
  closes: Record<string, number>
}

export interface ContributionResponse {
  asOfDate: string | null
  lookback: ContribLookbackKey
  lookbackDays: number
  range: ContribRangeKey
  rangeStartDate: string | null
  rangeEndDate: string | null
  weightsAsOf: string
  weights: Record<string, number>
  series: ContributionSeriesRow[]
  summary: {
    spy_return_total: number | null
    sector_returns_total: Record<string, number | null>
    sector_contributions_total: Record<string, number | null>
  }
}

interface DayPoint { date: string; close: number }

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function shiftMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 - months, d))
  return dt.toISOString().slice(0, 10)
}

function rangeTargetDate(
  asOf: string,
  range: ContribRangeKey,
  byTicker: Map<string, DayPoint[]>,
): string {
  switch (range) {
    case '1m':  return shiftMonths(asOf, 1)
    case '3m':  return shiftMonths(asOf, 3)
    case '6m':  return shiftMonths(asOf, 6)
    case 'ytd': {
      const yr = parseInt(asOf.slice(0, 4), 10)
      return `${yr}-01-01`
    }
    case '1y':  return shiftMonths(asOf, 12)
    case '2y':  return shiftMonths(asOf, 24)
    case '5y':  return shiftMonths(asOf, 60)
    case '10y': return shiftMonths(asOf, 120)
    case '15y': return shiftMonths(asOf, 180)
    case '20y': return shiftMonths(asOf, 240)
    case 'all': {
      // Earliest date all sector ETFs (and SPY) have history — XLC ('18) and
      // XLRE ('15) define the floor in practice.
      let latest = '1900-01-01'
      for (const arr of byTicker.values()) {
        if (arr.length === 0) continue
        if (arr[0].date > latest) latest = arr[0].date
      }
      return latest
    }
  }
}

function loadByTicker(tickers: string[]): Map<string, DayPoint[]> {
  const placeholders = tickers.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol IN (${placeholders})
      AND close IS NOT NULL
      AND close > 0
    ORDER BY symbol, CAST(time AS INTEGER) ASC
  `).all(...tickers) as Array<{ symbol: string; time: string; close: number }>

  const byTicker = new Map<string, DayPoint[]>()
  for (const t of tickers) byTicker.set(t, [])
  for (const r of rows) {
    byTicker.get(r.symbol)!.push({ date: tsToDate(parseInt(r.time, 10)), close: r.close })
  }
  return byTicker
}

function emptyResponse(
  lookback: ContribLookbackKey,
  range: ContribRangeKey,
  asOfDate: string | null,
): ContributionResponse {
  const nullByTicker: Record<string, number | null> = {}
  for (const s of SECTORS) nullByTicker[s.ticker] = null
  return {
    asOfDate,
    lookback,
    lookbackDays: LOOKBACK_TRADING_DAYS[lookback],
    range,
    rangeStartDate: null,
    rangeEndDate: null,
    weightsAsOf: WEIGHTS_AS_OF,
    weights: SPY_SECTOR_WEIGHTS,
    series: [],
    summary: {
      spy_return_total: null,
      sector_returns_total: { ...nullByTicker },
      sector_contributions_total: { ...nullByTicker },
    },
  }
}

const round4 = (x: number) => Math.round(x * 10000) / 10000
const round2 = (x: number) => Math.round(x * 100) / 100

export function getSectorContribution(
  lookback: ContribLookbackKey,
  range: ContribRangeKey,
): ContributionResponse {
  const tickers = [BENCHMARK_TICKER, ...SECTORS.map(s => s.ticker)]
  const byTicker = loadByTicker(tickers)

  // As-of: latest date all tickers share (defensive — sector + SPY are typically aligned).
  let asOf: string | null = null
  for (const t of tickers) {
    const arr = byTicker.get(t)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last < asOf) asOf = last
  }
  if (!asOf) return emptyResponse(lookback, range, null)

  // closeByDate: ticker -> Map<date, close>. Built once for O(1) lookups.
  const closeByDate = new Map<string, Map<string, number>>()
  for (const t of tickers) {
    const m = new Map<string, number>()
    for (const p of byTicker.get(t) ?? []) m.set(p.date, p.close)
    closeByDate.set(t, m)
  }

  // Anchor on SPY's trading calendar.
  const spy = byTicker.get(BENCHMARK_TICKER) ?? []
  if (spy.length === 0) return emptyResponse(lookback, range, asOf)

  const N = LOOKBACK_TRADING_DAYS[lookback]
  const target = rangeTargetDate(asOf, range, byTicker)

  // First SPY index on or after target — that's where the range visually starts.
  let rangeStartIdx = -1
  for (let i = 0; i < spy.length; i++) {
    if (spy[i].date >= target) { rangeStartIdx = i; break }
  }
  if (rangeStartIdx < 0) return emptyResponse(lookback, range, asOf)

  // Need N prior bars to compute the first rolling return. If the range starts
  // before that, trim the leading edge.
  const effectiveStartIdx = Math.max(rangeStartIdx, N)
  if (effectiveStartIdx >= spy.length) return emptyResponse(lookback, range, asOf)

  const spyMap = closeByDate.get(BENCHMARK_TICKER)!

  const series: ContributionSeriesRow[] = []
  for (let i = effectiveStartIdx; i < spy.length; i++) {
    const d = spy[i].date
    const dBase = spy[i - N].date
    const spyCur = spyMap.get(d)
    const spyBase = spyMap.get(dBase)
    if (spyCur === undefined || spyBase === undefined || spyBase === 0) continue
    const spyRet = (spyCur / spyBase - 1) * 100

    const contributions: Record<string, number> = {}
    const closes: Record<string, number> = { [BENCHMARK_TICKER]: spyCur }
    for (const s of SECTORS) {
      const m = closeByDate.get(s.ticker)!
      const cur = m.get(d)
      const base = m.get(dBase)
      const w = SPY_SECTOR_WEIGHTS[s.ticker] ?? 0
      // Treat missing bar (e.g. ETF predates its launch) as zero contribution
      // so the SPY line stays coherent across the chart.
      if (cur === undefined || base === undefined || base === 0) {
        contributions[s.ticker] = 0
      } else {
        contributions[s.ticker] = round4((cur / base - 1) * 100 * w)
        closes[s.ticker] = cur
      }
    }
    series.push({ date: d, spy_return: round4(spyRet), contributions, closes })
  }

  const rangeStartDate = series.length > 0 ? series[0].date : null
  const rangeEndDate = series.length > 0 ? series[series.length - 1].date : null

  // Cumulative summary over the visible range — independent of rolling lookback.
  const spyStart = rangeStartDate ? spyMap.get(rangeStartDate) : undefined
  const spyEnd = rangeEndDate ? spyMap.get(rangeEndDate) : undefined
  const spyTotal =
    spyStart !== undefined && spyEnd !== undefined && spyStart !== 0
      ? round2(((spyEnd / spyStart) - 1) * 100)
      : null

  const sectorReturnsTotal: Record<string, number | null> = {}
  const sectorContributionsTotal: Record<string, number | null> = {}
  for (const s of SECTORS) {
    const m = closeByDate.get(s.ticker)!
    const sc = rangeStartDate ? m.get(rangeStartDate) : undefined
    const ec = rangeEndDate ? m.get(rangeEndDate) : undefined
    const w = SPY_SECTOR_WEIGHTS[s.ticker] ?? 0
    if (sc !== undefined && ec !== undefined && sc !== 0) {
      const r = ((ec / sc) - 1) * 100
      sectorReturnsTotal[s.ticker] = round2(r)
      sectorContributionsTotal[s.ticker] = round2(r * w)
    } else {
      sectorReturnsTotal[s.ticker] = null
      sectorContributionsTotal[s.ticker] = null
    }
  }

  return {
    asOfDate: asOf,
    lookback,
    lookbackDays: N,
    range,
    rangeStartDate,
    rangeEndDate,
    weightsAsOf: WEIGHTS_AS_OF,
    weights: SPY_SECTOR_WEIGHTS,
    series,
    summary: {
      spy_return_total: spyTotal,
      sector_returns_total: sectorReturnsTotal,
      sector_contributions_total: sectorContributionsTotal,
    },
  }
}
