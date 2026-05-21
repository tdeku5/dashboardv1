import { db } from './db'

// Stable internal keys matched to tv_series symbols. Display names live on the
// frontend.
export const US_INDEX_SYMBOLS = {
  SPX: 'SPX',
  NDX: 'NDX',
  DJI: 'DJI',
  RUT: 'RUT',
  RSP: 'RSP',
} as const

export type UsIndexKey = keyof typeof US_INDEX_SYMBOLS
const KEYS: UsIndexKey[] = ['SPX', 'NDX', 'DJI', 'RUT', 'RSP']

const DISPLAY_NAMES: Record<UsIndexKey, string> = {
  SPX: 'S&P 500',
  NDX: 'Nasdaq 100',
  DJI: 'Dow Jones Industrial',
  RUT: 'Russell 2000',
  RSP: 'S&P 500 Equal Weight',
}

export type IndexLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'
export type IndexRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

interface SeriesPoint {
  date: string
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

function shiftCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - days))
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

function loadSeriesBySymbol(): Map<UsIndexKey, SeriesPoint[]> {
  const placeholders = KEYS.map(() => '?').join(',')
  const symbols = KEYS.map((k) => US_INDEX_SYMBOLS[k])
  const rows = db
    .prepare(
      `SELECT symbol, time, close FROM tv_series
       WHERE symbol IN (${placeholders})
         AND close IS NOT NULL
         AND close > 0
       ORDER BY symbol, CAST(time AS INTEGER) ASC`,
    )
    .all(...symbols) as Array<{ symbol: string; time: string; close: number }>

  const out = new Map<UsIndexKey, SeriesPoint[]>()
  for (const k of KEYS) out.set(k, [])
  // Reverse-lookup symbol → key.
  const symbolToKey = new Map<string, UsIndexKey>()
  for (const k of KEYS) symbolToKey.set(US_INDEX_SYMBOLS[k], k)
  for (const r of rows) {
    const k = symbolToKey.get(r.symbol)
    if (!k) continue
    out.get(k)!.push({ date: tsToDate(parseInt(r.time, 10)), close: r.close })
  }
  return out
}

const round2 = (x: number) => Math.round(x * 100) / 100
const pctChange = (curr: number, base: number): number =>
  round2(((curr - base) / base) * 100)

// ── Returns (heatmap) endpoint ───────────────────────────────────────────────

export interface IndexReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface IndexReturnsRow {
  key: UsIndexKey
  ticker: string
  displayName: string
  currentPrice: number | null
  returns: IndexReturns
}

export interface IndexReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<IndexLookbackKey, string | null>
  indices: IndexReturnsRow[]
  missingTickers?: string[]
}

const EMPTY_LOOKBACK: Record<IndexLookbackKey, string | null> = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

export function getUsIndexReturns(): IndexReturnsResponse {
  const bySymbol = loadSeriesBySymbol()

  const missingTickers = KEYS
    .filter((k) => (bySymbol.get(k)?.length ?? 0) === 0)
    .map((k) => US_INDEX_SYMBOLS[k])

  if (missingTickers.length === KEYS.length) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      indices: [],
      missingTickers,
    }
  }

  // As-of: last common date across all non-missing tickers (MIN of each
  // ticker's latest date) so all rows reference the same trading day.
  let asOfDate: string | null = null
  for (const k of KEYS) {
    const arr = bySymbol.get(k)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOfDate === null || last < asOfDate) asOfDate = last
  }
  if (!asOfDate) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      indices: [],
      missingTickers: missingTickers.length ? missingTickers : undefined,
    }
  }

  // Distinct trading dates across all tickers, up to as-of.
  const distinctSet = new Set<string>()
  for (const k of KEYS) {
    const arr = bySymbol.get(k)
    if (!arr) continue
    for (const r of arr) if (r.date <= asOfDate) distinctSet.add(r.date)
  }
  const distinctAsc = Array.from(distinctSet).sort()
  const asOfIdx = distinctAsc.length - 1

  const fiveDDate  = asOfIdx - 5 >= 0 ? distinctAsc[asOfIdx - 5] : distinctAsc[0] ?? null
  const oneMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 1))
  const threeMDate = snapDate(distinctAsc, shiftMonths(asOfDate, 3))
  const sixMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 6))
  const yr         = parseInt(asOfDate.slice(0, 4), 10)
  const ytdDate    = snapDate(distinctAsc, `${yr - 1}-12-31`)

  const lookbackDates: Record<IndexLookbackKey, string | null> = {
    '5d': fiveDDate,
    '1m': oneMDate,
    '3m': threeMDate,
    '6m': sixMDate,
    ytd: ytdDate,
  }

  const indices: IndexReturnsRow[] = KEYS.map((k) => {
    const arr = bySymbol.get(k) ?? []
    if (arr.length === 0) {
      return {
        key: k,
        ticker: US_INDEX_SYMBOLS[k],
        displayName: DISPLAY_NAMES[k],
        currentPrice: null,
        returns: { '5d': null, '1m': null, '3m': null, '6m': null, ytd: null },
      }
    }
    const cur = findOnOrBefore(arr, asOfDate!)
    const lookup = (date: string | null) => (date ? findOnOrBefore(arr, date) : null)
    const f5 = lookup(fiveDDate)
    const f1 = lookup(oneMDate)
    const f3 = lookup(threeMDate)
    const f6 = lookup(sixMDate)
    const fy = lookup(ytdDate)
    return {
      key: k,
      ticker: US_INDEX_SYMBOLS[k],
      displayName: DISPLAY_NAMES[k],
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

  return {
    asOfDate,
    lookbackDates,
    indices,
    ...(missingTickers.length ? { missingTickers } : {}),
  }
}

// ── Levels (multi-axis chart) endpoint ───────────────────────────────────────

const CAL_DAYS: Record<Exclude<IndexRangeKey, 'ytd' | 'all'>, number> = {
  '1m':  30,  '3m':  90,  '6m':  180,
  '1y':  365, '2y':  730, '5y':  1825,
  '10y': 3650, '15y': 5475, '20y': 7300,
}

function rangeStart(asOf: string, range: IndexRangeKey, earliest: string): string {
  if (range === 'all') return earliest
  if (range === 'ytd') return `${asOf.slice(0, 4)}-01-01`
  return shiftCalendarDays(asOf, CAL_DAYS[range])
}

export type IndexLevelsRow = {
  date: string
} & { [K in UsIndexKey]: number | null }

export interface IndexLevelsResponse {
  asOfDate: string | null
  range: IndexRangeKey
  rangeStartDate: string | null
  series: IndexLevelsRow[]
  missingTickers: UsIndexKey[]
}

export function getUsIndexLevels(range: IndexRangeKey): IndexLevelsResponse {
  const bySymbol = loadSeriesBySymbol()
  const missingTickers = KEYS.filter((k) => (bySymbol.get(k)?.length ?? 0) === 0)

  // As-of for the levels chart: latest date across all non-missing tickers (max),
  // matching the Cross Asset Vol levels chart convention so the chart shows the
  // most recent data even when one series ends earlier.
  let asOf: string | null = null
  let earliest: string | null = null
  for (const k of KEYS) {
    const arr = bySymbol.get(k) ?? []
    if (arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last > asOf) asOf = last
    const first = arr[0].date
    if (earliest === null || first < earliest) earliest = first
  }
  if (!asOf || !earliest) {
    return { asOfDate: null, range, rangeStartDate: null, series: [], missingTickers }
  }

  const startDate = rangeStart(asOf, range, earliest)

  // Outer-join on date: include any date where at least one series has a value.
  const valueByKey: Record<UsIndexKey, Map<string, number>> = {
    SPX: new Map(), NDX: new Map(), DJI: new Map(), RUT: new Map(), RSP: new Map(),
  }
  const dateSet = new Set<string>()
  for (const k of KEYS) {
    const arr = bySymbol.get(k) ?? []
    const m = valueByKey[k]
    for (const p of arr) {
      if (p.date < startDate || p.date > asOf) continue
      m.set(p.date, p.close)
      dateSet.add(p.date)
    }
  }

  const dates = Array.from(dateSet).sort()
  const series: IndexLevelsRow[] = dates.map((d) => {
    const row = { date: d } as IndexLevelsRow
    for (const k of KEYS) {
      const v = valueByKey[k].get(d)
      row[k] = v != null ? round2(v) : null
    }
    return row
  })

  return {
    asOfDate: asOf,
    range,
    rangeStartDate: dates[0] ?? null,
    series,
    missingTickers,
  }
}
