import { db } from './db'

// Resolved against tv_series during initial investigation: BRDTH20/50/200 are
// the actual symbols ingested. Isolated here so the rest of the stack does
// not bake in TradingView's symbol convention.
export const BREADTH_SERIES = {
  d20:  'BRDTH20',
  d50:  'BRDTH50',
  d200: 'BRDTH200',
} as const

// Index these breadth series cover. The dashboard subtitle reads off this
// constant. If the ingested symbols are swapped to NYSE breadth (MMTW/MMFI/
// MMTH), update this label too.
export const BREADTH_INDEX_LABEL = 'S&P 500'

export type BreadthRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export interface BreadthSeriesRow {
  date: string
  d20:  number | null
  d50:  number | null
  d200: number | null
}

export interface BreadthResponse {
  asOfDate: string | null
  range: BreadthRangeKey
  rangeStartDate: string | null
  indexLabel: string
  series: BreadthSeriesRow[]
  // Keys ('d20' | 'd50' | 'd200') of series that have no rows in tv_series at
  // all — surfaced so the frontend can render a "missing data" hint.
  missingSeries: Array<'d20' | 'd50' | 'd200'>
}

interface DayPoint { date: string; close: number }

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// Calendar-day shift (matches the Brent–WTI spread chart convention — not
// trading days). The chart is calendar-time on the x-axis so this stays
// intuitive for a user picking "1 year" expecting Jan→Jan.
function shiftCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - days))
  return dt.toISOString().slice(0, 10)
}

const RANGE_DAYS: Record<Exclude<BreadthRangeKey, 'ytd' | 'all'>, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  '2y': 730,
  '5y': 1825,
  '10y': 3650,
  '15y': 5475,
  '20y': 7300,
}

function rangeStart(asOf: string, range: BreadthRangeKey, earliest: string): string {
  if (range === 'all') return earliest
  if (range === 'ytd') return `${asOf.slice(0, 4)}-01-01`
  return shiftCalendarDays(asOf, RANGE_DAYS[range])
}

function loadSeries(symbols: string[]): Map<string, DayPoint[]> {
  const placeholders = symbols.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol IN (${placeholders})
      AND close IS NOT NULL
    ORDER BY symbol, CAST(time AS INTEGER) ASC
  `).all(...symbols) as Array<{ symbol: string; time: string; close: number }>

  const out = new Map<string, DayPoint[]>()
  for (const s of symbols) out.set(s, [])
  for (const r of rows) {
    out.get(r.symbol)!.push({ date: tsToDate(parseInt(r.time, 10)), close: r.close })
  }
  return out
}

const round2 = (x: number) => Math.round(x * 100) / 100

export function getBreadth(range: BreadthRangeKey): BreadthResponse {
  const keys: Array<keyof typeof BREADTH_SERIES> = ['d20', 'd50', 'd200']
  const symbols = keys.map(k => BREADTH_SERIES[k])
  const bySymbol = loadSeries(symbols)

  const missingSeries = keys.filter(k => (bySymbol.get(BREADTH_SERIES[k])?.length ?? 0) === 0)

  // As-of: latest date across any present series. Each line stops at its own
  // latest bar; we do not trim to the common min so a single laggard series
  // does not freeze the whole chart.
  let asOf: string | null = null
  let earliest: string | null = null
  for (const k of keys) {
    const arr = bySymbol.get(BREADTH_SERIES[k]) ?? []
    if (arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last > asOf) asOf = last
    const first = arr[0].date
    if (earliest === null || first < earliest) earliest = first
  }
  if (!asOf || !earliest) {
    return {
      asOfDate: null,
      range,
      rangeStartDate: null,
      indexLabel: BREADTH_INDEX_LABEL,
      series: [],
      missingSeries,
    }
  }

  const startDate = rangeStart(asOf, range, earliest)

  // Outer join on date: every date that appears in any series within the
  // window contributes one row; missing values come back as null.
  const dateSet = new Set<string>()
  const valueByKeyDate: Record<'d20' | 'd50' | 'd200', Map<string, number>> = {
    d20: new Map(), d50: new Map(), d200: new Map(),
  }
  for (const k of keys) {
    const arr = bySymbol.get(BREADTH_SERIES[k]) ?? []
    const m = valueByKeyDate[k]
    for (const p of arr) {
      if (p.date < startDate || p.date > asOf) continue
      m.set(p.date, p.close)
      dateSet.add(p.date)
    }
  }

  const dates = Array.from(dateSet).sort()
  const series: BreadthSeriesRow[] = dates.map(d => {
    const v20  = valueByKeyDate.d20.get(d)
    const v50  = valueByKeyDate.d50.get(d)
    const v200 = valueByKeyDate.d200.get(d)
    return {
      date: d,
      d20:  v20  != null ? round2(v20)  : null,
      d50:  v50  != null ? round2(v50)  : null,
      d200: v200 != null ? round2(v200) : null,
    }
  })

  return {
    asOfDate: asOf,
    range,
    rangeStartDate: dates[0] ?? null,
    indexLabel: BREADTH_INDEX_LABEL,
    series,
    missingSeries,
  }
}
