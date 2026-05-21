import { db } from './db'

export interface Sector {
  ticker: string
  name: string
}

export const SECTORS: ReadonlyArray<Sector> = [
  { ticker: 'XLK',  name: 'Technology' },
  { ticker: 'XLE',  name: 'Energy' },
  { ticker: 'XLV',  name: 'Health Care' },
  { ticker: 'XLF',  name: 'Financials' },
  { ticker: 'XLY',  name: 'Consumer Discretionary' },
  { ticker: 'XLP',  name: 'Consumer Staples' },
  { ticker: 'XLI',  name: 'Industrials' },
  { ticker: 'XLC',  name: 'Communication Services' },
  { ticker: 'XLB',  name: 'Materials' },
  { ticker: 'XLU',  name: 'Utilities' },
  { ticker: 'XLRE', name: 'Real Estate' },
]

export type LookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface SectorReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface SectorAttributionRow {
  ticker: string
  name: string
  currentPrice: number | null
  returns: SectorReturns
}

export interface BenchmarkBlock {
  ticker: string
  currentPrice: number | null
  returns: SectorReturns
}

export interface SectorAttributionResponse {
  asOfDate: string | null
  lookbackDates: Record<LookbackKey, string | null>
  benchmark: BenchmarkBlock | null
  sectors: SectorAttributionRow[]
  missingTickers?: string[]
}

export const BENCHMARK_TICKER = 'SPY'

interface SeriesPoint {
  date: string
  ts: number
  close: number
}

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function shiftMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 - months, d))
  return dt.toISOString().slice(0, 10)
}

function findOnOrBefore(arr: SeriesPoint[], isoDate: string): SeriesPoint | null {
  let lo = 0, hi = arr.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].date <= isoDate) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best >= 0 ? arr[best] : null
}

function snapDate(distinctAsc: string[], targetIso: string): string | null {
  let lo = 0, hi = distinctAsc.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (distinctAsc[mid] <= targetIso) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best >= 0 ? distinctAsc[best] : null
}

function loadSeriesByTicker(): Map<string, SeriesPoint[]> {
  const tickers = [...SECTORS.map(s => s.ticker), BENCHMARK_TICKER]
  const placeholders = tickers.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol IN (${placeholders})
      AND close IS NOT NULL
      AND close > 0
    ORDER BY symbol, CAST(time AS INTEGER) ASC
  `).all(...tickers) as Array<{ symbol: string; time: string; close: number }>

  const byTicker = new Map<string, SeriesPoint[]>()
  for (const t of tickers) byTicker.set(t, [])
  for (const r of rows) {
    const ts = parseInt(r.time, 10)
    byTicker.get(r.symbol)!.push({ date: tsToDate(ts), ts, close: r.close })
  }
  return byTicker
}

function pctChange(curr: number, base: number): number {
  return Math.round(((curr - base) / base) * 10000) / 100
}

const EMPTY_LOOKBACK: Record<LookbackKey, string | null> = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

export function getSectorAttribution(): SectorAttributionResponse {
  const byTicker = loadSeriesByTicker()

  const missingTickers = SECTORS
    .filter(s => (byTicker.get(s.ticker)?.length ?? 0) === 0)
    .map(s => s.ticker)

  // If every ticker is missing, return an empty payload.
  if (missingTickers.length === SECTORS.length) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      benchmark: null,
      sectors: [],
      missingTickers,
    }
  }

  // As-of: the latest date that ALL non-missing tickers have data for. We use
  // the minimum of each ticker's latest date so the table is internally
  // consistent.
  let asOfDate: string | null = null
  for (const s of SECTORS) {
    const arr = byTicker.get(s.ticker)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOfDate === null || last < asOfDate) asOfDate = last
  }
  if (!asOfDate) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      benchmark: null,
      sectors: [],
      missingTickers: missingTickers.length ? missingTickers : undefined,
    }
  }

  // Distinct trading dates across the sector ETFs, ascending, up to as-of.
  const distinctSet = new Set<string>()
  for (const s of SECTORS) {
    const arr = byTicker.get(s.ticker)
    if (!arr) continue
    for (const r of arr) {
      if (r.date <= asOfDate) distinctSet.add(r.date)
    }
  }
  const distinctAsc = Array.from(distinctSet).sort()
  const asOfIdx = distinctAsc.length - 1

  const fiveDDate  = asOfIdx - 5 >= 0 ? distinctAsc[asOfIdx - 5] : distinctAsc[0] ?? null
  const oneMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 1))
  const threeMDate = snapDate(distinctAsc, shiftMonths(asOfDate, 3))
  const sixMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 6))
  const yr         = parseInt(asOfDate.slice(0, 4), 10)
  const ytdDate    = snapDate(distinctAsc, `${yr - 1}-12-31`)

  const lookbackDates: Record<LookbackKey, string | null> = {
    '5d': fiveDDate,
    '1m': oneMDate,
    '3m': threeMDate,
    '6m': sixMDate,
    ytd: ytdDate,
  }

  const sectors: SectorAttributionRow[] = SECTORS.map(s => {
    const arr = byTicker.get(s.ticker) ?? []
    if (arr.length === 0) {
      return {
        ticker: s.ticker,
        name: s.name,
        currentPrice: null,
        returns: { '5d': null, '1m': null, '3m': null, '6m': null, ytd: null },
      }
    }
    const cur = findOnOrBefore(arr, asOfDate!)
    const lookup = (date: string | null) => date ? findOnOrBefore(arr, date) : null
    const f5 = lookup(fiveDDate)
    const f1 = lookup(oneMDate)
    const f3 = lookup(threeMDate)
    const f6 = lookup(sixMDate)
    const fy = lookup(ytdDate)
    return {
      ticker: s.ticker,
      name: s.name,
      currentPrice: cur ? cur.close : null,
      returns: {
        '5d': cur && f5 ? pctChange(cur.close, f5.close) : null,
        '1m': cur && f1 ? pctChange(cur.close, f1.close) : null,
        '3m': cur && f3 ? pctChange(cur.close, f3.close) : null,
        '6m': cur && f6 ? pctChange(cur.close, f6.close) : null,
        ytd: cur && fy ? pctChange(cur.close, fy.close) : null,
      },
    }
  })

  // Benchmark (SPY) — uses the same lookback dates so relative comparison is
  // 1:1. Returns null if SPY is not in tv_series at all.
  const benchmark: BenchmarkBlock | null = (() => {
    const arr = byTicker.get(BENCHMARK_TICKER) ?? []
    if (arr.length === 0) return null
    const cur = findOnOrBefore(arr, asOfDate!)
    if (!cur) return null
    const lookup = (date: string | null) => date ? findOnOrBefore(arr, date) : null
    const f5 = lookup(fiveDDate)
    const f1 = lookup(oneMDate)
    const f3 = lookup(threeMDate)
    const f6 = lookup(sixMDate)
    const fy = lookup(ytdDate)
    return {
      ticker: BENCHMARK_TICKER,
      currentPrice: cur.close,
      returns: {
        '5d': f5 ? pctChange(cur.close, f5.close) : null,
        '1m': f1 ? pctChange(cur.close, f1.close) : null,
        '3m': f3 ? pctChange(cur.close, f3.close) : null,
        '6m': f6 ? pctChange(cur.close, f6.close) : null,
        ytd: fy ? pctChange(cur.close, fy.close) : null,
      },
    }
  })()

  return {
    asOfDate,
    lookbackDates,
    benchmark,
    sectors,
    ...(missingTickers.length ? { missingTickers } : {}),
  }
}
