import { db } from './db'

// User-curated display order. Pairs are kept in market-standard quoting
// convention — no inversion. A positive return on USDJPY means USD strengthened
// vs JPY; a positive return on EURUSD means EUR strengthened vs USD.
export const FX_PAIRS: ReadonlyArray<string> = [
  'EURUSD',
  'GBPUSD',
  'USDCAD',
  'AUDUSD',
  'NZDUSD',
  'USDJPY',
  'USDCHF',
  'USDNOK',
  'USDSEK',
  'USDCNH',
]

// EM pairs grouped by region. Display order is intentional and matches the
// frontend grouping expectation. SGD lives under Asia EM by FX dashboard
// convention even though it's technically DM by some classifications.
//
// USDRUB caveat: the TradingView ruble feed is an offshore/synthetic rate that
// has diverged from the Moscow fixing in the post-2022 sanctions regime — the
// series is currently live and moving (verified end-2026-05), but treat its
// returns as directional rather than exchange-precise.
export const EM_FX_PAIRS: ReadonlyArray<{ region: string; pairs: string[] }> = [
  // CEEMEA: alphabetical by currency code. USDRUB slots between PLN and TRY.
  { region: 'CEEMEA',  pairs: ['USDHUF', 'USDPLN', 'USDRUB', 'USDTRY', 'USDZAR'] },
  // LatAm: curator order (not alphabetical). USDCLP appended at end.
  { region: 'LatAm',   pairs: ['USDMXN', 'USDBRL', 'USDCOP', 'USDCLP'] },
  // Asia EM: curator order (not alphabetical). USDTHB appended at end.
  { region: 'Asia EM', pairs: ['USDSGD', 'USDINR', 'USDIDR', 'USDKRW', 'USDMYR', 'USDTWD', 'USDPHP', 'USDTHB'] },
]

// Flattened view used internally for date-alignment calculations.
const EM_PAIR_REGION = new Map<string, string>()
const EM_PAIR_LIST: string[] = []
for (const g of EM_FX_PAIRS) {
  for (const p of g.pairs) {
    EM_PAIR_LIST.push(p)
    EM_PAIR_REGION.set(p, g.region)
  }
}

export type FxLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface FxReturns {
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  '6m':  number | null
  ytd:   number | null
}

export interface FxPairRow {
  pair: string
  currentPrice: number | null
  returns: FxReturns
}

export interface FxEmPairRow extends FxPairRow {
  region: string
}

export interface FxPairReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<FxLookbackKey, string | null>
  dmPairs: FxPairRow[]
  emPairs: FxEmPairRow[]
  warnings: string[]
  missingDmPairs?: string[]
  missingEmPairs?: string[]
}

interface SeriesPoint { date: string; ts: number; close: number }

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

function loadSeries(tickers: string[]): Map<string, SeriesPoint[]> {
  const placeholders = tickers.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol IN (${placeholders})
      AND close IS NOT NULL
      AND close > 0
    ORDER BY symbol, CAST(time AS INTEGER) ASC
  `).all(...tickers) as Array<{ symbol: string; time: string; close: number }>

  const out = new Map<string, SeriesPoint[]>()
  for (const t of tickers) out.set(t, [])
  for (const r of rows) {
    const ts = parseInt(r.time, 10)
    out.get(r.symbol)!.push({ date: tsToDate(ts), ts, close: r.close })
  }
  return out
}

const EMPTY_LOOKBACK: Record<FxLookbackKey, string | null> = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

const EMPTY_RETURNS: FxReturns = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

function pctChange(curr: number, base: number): number {
  return Math.round(((curr - base) / base) * 10000) / 100
}

export function getFxPairReturns(): FxPairReturnsResponse {
  const tickers = [...FX_PAIRS, ...EM_PAIR_LIST]
  const series = loadSeries(tickers)

  const missingDmPairs = FX_PAIRS.filter(p => (series.get(p)?.length ?? 0) === 0)
  const missingEmPairs = EM_PAIR_LIST.filter(p => (series.get(p)?.length ?? 0) === 0)
  const warnings: string[] = []

  // As-of: min of latest dates across the available pairs (skips missing).
  // This is the last common date across all 24 series — a single laggard
  // ticker pulls the whole table back to its latest bar.
  let asOfDate: string | null = null
  for (const t of tickers) {
    const arr = series.get(t)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOfDate === null || last < asOfDate) asOfDate = last
  }
  if (!asOfDate) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      dmPairs: [],
      emPairs: [],
      warnings: ['No FX data available in tv_series.'],
      ...(missingDmPairs.length ? { missingDmPairs } : {}),
      ...(missingEmPairs.length ? { missingEmPairs } : {}),
    }
  }

  // Stale-tip warning: if any individual pair's latest date is more than 7 days
  // ahead of as-of, the as-of date is being held back by a single laggard.
  let latestAnywhere: string | null = null
  let laggard: string | null = null
  for (const t of tickers) {
    const arr = series.get(t)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (latestAnywhere === null || last > latestAnywhere) latestAnywhere = last
    if (last === asOfDate) laggard = t
  }
  if (latestAnywhere && latestAnywhere > asOfDate) {
    const lagDays = (Date.parse(latestAnywhere) - Date.parse(asOfDate)) / 86_400_000
    if (lagDays > 7) {
      warnings.push(`As-of (${asOfDate}) lags the freshest pair by ${Math.round(lagDays)} days — ${laggard ?? 'one of the inputs'} may be stale.`)
    }
  }

  // Master FX trading calendar — union of dates across the available pairs,
  // truncated at as-of. FX trades 24/5 so this is roughly weekdays minus
  // global holidays.
  const distinctSet = new Set<string>()
  for (const t of tickers) {
    const arr = series.get(t)
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

  const lookbackDates: Record<FxLookbackKey, string | null> = {
    '5d': fiveDDate,
    '1m': oneMDate,
    '3m': threeMDate,
    '6m': sixMDate,
    ytd: ytdDate,
  }

  const computeRow = (pair: string): FxPairRow => {
    const arr = series.get(pair) ?? []
    if (arr.length === 0) {
      return { pair, currentPrice: null, returns: { ...EMPTY_RETURNS } }
    }
    const cur = findOnOrBefore(arr, asOfDate!)
    const lookup = (date: string | null) => date ? findOnOrBefore(arr, date) : null
    const r = (date: string | null) => {
      const base = lookup(date)
      return cur && base ? pctChange(cur.close, base.close) : null
    }
    return {
      pair,
      currentPrice: cur ? cur.close : null,
      returns: {
        '5d': r(fiveDDate),
        '1m': r(oneMDate),
        '3m': r(threeMDate),
        '6m': r(sixMDate),
        ytd: r(ytdDate),
      },
    }
  }

  const dmPairs: FxPairRow[] = FX_PAIRS.map(computeRow)
  const emPairs: FxEmPairRow[] = EM_PAIR_LIST.map(p => ({
    ...computeRow(p),
    region: EM_PAIR_REGION.get(p)!,
  }))

  return {
    asOfDate,
    lookbackDates,
    dmPairs,
    emPairs,
    warnings,
    ...(missingDmPairs.length ? { missingDmPairs } : {}),
    ...(missingEmPairs.length ? { missingEmPairs } : {}),
  }
}
