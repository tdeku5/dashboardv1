import { db } from './db'

// Display order is intentional and user-curated. Keep as-is.
//
// fxTicker: TradingView ticker for the currency pair, or null for USD.
// fxDirection:
//   'mul' → ticker is USD-per-local (e.g. GBPUSD: USD per GBP). usd_value = local_value × rate.
//   'div' → ticker is local-per-USD (e.g. USDJPY: JPY per USD).  usd_value = local_value ÷ rate.
export interface CountryDef {
  displayName: string
  ticker: string
  currency: string
  fxTicker: string | null
  fxDirection: 'mul' | 'div' | null
}

export const COUNTRIES: ReadonlyArray<CountryDef> = [
  { displayName: 'United States',  ticker: 'SPY',     currency: 'USD', fxTicker: null,      fxDirection: null  },
  { displayName: 'United Kingdom', ticker: 'FTSE100', currency: 'GBP', fxTicker: 'GBPUSD',  fxDirection: 'mul' },
  { displayName: 'Germany',        ticker: 'DAX',     currency: 'EUR', fxTicker: 'EURUSD',  fxDirection: 'mul' },
  { displayName: 'France',         ticker: 'CAC40',   currency: 'EUR', fxTicker: 'EURUSD',  fxDirection: 'mul' },
  { displayName: 'Italy',          ticker: 'FTMIB',   currency: 'EUR', fxTicker: 'EURUSD',  fxDirection: 'mul' },
  { displayName: 'Japan',          ticker: 'NKY',     currency: 'JPY', fxTicker: 'USDJPY',  fxDirection: 'div' },
  { displayName: 'Hong Kong',      ticker: 'HSI',     currency: 'HKD', fxTicker: 'USDHKD',  fxDirection: 'div' },
  { displayName: 'Canada',         ticker: 'TSX:TSX', currency: 'CAD', fxTicker: 'USDCAD',  fxDirection: 'div' },
  { displayName: 'Australia',      ticker: 'ASX',     currency: 'AUD', fxTicker: 'AUDUSD',  fxDirection: 'mul' },
  { displayName: 'New Zealand',    ticker: 'NZX50',   currency: 'NZD', fxTicker: 'NZDUSD',  fxDirection: 'mul' },
]

export type CountryLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface CountryReturns {
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  '6m':  number | null
  ytd:   number | null
}

export interface CountryReturnsRow {
  displayName: string
  ticker: string
  currency: string
  currentPrice: number | null
  returnsLocal: CountryReturns
  returnsUsd: CountryReturns
}

export interface CountryReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<CountryLookbackKey, string | null>
  countries: CountryReturnsRow[]
  warnings: string[]
  missingIndexTickers?: string[]
  missingFxTickers?: string[]
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

const EMPTY_LOOKBACK: Record<CountryLookbackKey, string | null> = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

const EMPTY_RETURNS: CountryReturns = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

function pctChange(curr: number, base: number): number {
  return Math.round(((curr - base) / base) * 10000) / 100
}

// usdValue: convert one local-currency price into USD given an FX rate and direction.
function usdValue(local: number, fxRate: number, direction: 'mul' | 'div'): number {
  return direction === 'mul' ? local * fxRate : local / fxRate
}

export function getCountryReturns(): CountryReturnsResponse {
  const indexTickers = COUNTRIES.map(c => c.ticker)
  const fxTickers = Array.from(new Set(COUNTRIES.map(c => c.fxTicker).filter((t): t is string => t !== null)))
  const allTickers = [...indexTickers, ...fxTickers]

  const series = loadSeries(allTickers)

  const missingIndexTickers = indexTickers.filter(t => (series.get(t)?.length ?? 0) === 0)
  const missingFxTickers = fxTickers.filter(t => (series.get(t)?.length ?? 0) === 0)
  const warnings: string[] = []

  // As-of: min of latest dates across the available series. We deliberately
  // skip missing series so the response still works when an FX pair is absent.
  let asOfDate: string | null = null
  for (const t of allTickers) {
    const arr = series.get(t)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOfDate === null || last < asOfDate) asOfDate = last
  }
  if (!asOfDate) {
    return {
      asOfDate: null,
      lookbackDates: { ...EMPTY_LOOKBACK },
      countries: [],
      warnings: ['No price data available in tv_series.'],
      ...(missingIndexTickers.length ? { missingIndexTickers } : {}),
      ...(missingFxTickers.length ? { missingFxTickers } : {}),
    }
  }

  // Master trading calendar — union of dates seen across the available series,
  // truncated at as-of. Used to anchor the global lookback dates.
  const distinctSet = new Set<string>()
  for (const t of allTickers) {
    const arr = series.get(t)
    if (!arr) continue
    for (const r of arr) {
      if (r.date <= asOfDate) distinctSet.add(r.date)
    }
  }
  const distinctAsc = Array.from(distinctSet).sort()
  const asOfIdx = distinctAsc.length - 1

  // Stale-tip check: if as-of is more than 5 trading days behind the *table*'s
  // most recent date, surface a warning. Here "table" = max latest date across
  // any single series, ignoring the min-rule above.
  let latestAnywhere: string | null = null
  for (const t of allTickers) {
    const arr = series.get(t)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (latestAnywhere === null || last > latestAnywhere) latestAnywhere = last
  }
  if (latestAnywhere && latestAnywhere > asOfDate) {
    const lagDays = (Date.parse(latestAnywhere) - Date.parse(asOfDate)) / 86_400_000
    if (lagDays > 7) {
      warnings.push(`As-of (${asOfDate}) lags the freshest series by ${Math.round(lagDays)} days — one of the inputs may be stale.`)
    }
  }

  const fiveDDate  = asOfIdx - 5 >= 0 ? distinctAsc[asOfIdx - 5] : distinctAsc[0] ?? null
  const oneMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 1))
  const threeMDate = snapDate(distinctAsc, shiftMonths(asOfDate, 3))
  const sixMDate   = snapDate(distinctAsc, shiftMonths(asOfDate, 6))
  const yr         = parseInt(asOfDate.slice(0, 4), 10)
  const ytdDate    = snapDate(distinctAsc, `${yr - 1}-12-31`)

  const lookbackDates: Record<CountryLookbackKey, string | null> = {
    '5d': fiveDDate,
    '1m': oneMDate,
    '3m': threeMDate,
    '6m': sixMDate,
    ytd: ytdDate,
  }

  const countries: CountryReturnsRow[] = COUNTRIES.map(c => {
    const indexArr = series.get(c.ticker) ?? []
    if (indexArr.length === 0) {
      return {
        displayName: c.displayName,
        ticker: c.ticker,
        currency: c.currency,
        currentPrice: null,
        returnsLocal: { ...EMPTY_RETURNS },
        returnsUsd: { ...EMPTY_RETURNS },
      }
    }

    const cur = findOnOrBefore(indexArr, asOfDate!)
    const localLookup = (date: string | null) => date ? findOnOrBefore(indexArr, date) : null

    const lookupLocalReturn = (date: string | null) => {
      const base = localLookup(date)
      return cur && base ? pctChange(cur.close, base.close) : null
    }

    const returnsLocal: CountryReturns = {
      '5d': lookupLocalReturn(fiveDDate),
      '1m': lookupLocalReturn(oneMDate),
      '3m': lookupLocalReturn(threeMDate),
      '6m': lookupLocalReturn(sixMDate),
      ytd: lookupLocalReturn(ytdDate),
    }

    // USD: re-price the index in USD on each anchor date and take the proper
    // ratio. Skip when there's no FX series (USD home currency) or when the FX
    // ticker is missing from the table.
    let returnsUsd: CountryReturns
    if (c.fxTicker === null || c.fxDirection === null) {
      // SPY / USD home currency — passthrough.
      returnsUsd = { ...returnsLocal }
    } else {
      const fxArr = series.get(c.fxTicker) ?? []
      if (fxArr.length === 0) {
        returnsUsd = { ...EMPTY_RETURNS }
      } else {
        const curFx = findOnOrBefore(fxArr, asOfDate!)
        const fxLookup = (date: string | null) => date ? findOnOrBefore(fxArr, date) : null
        const lookupUsdReturn = (date: string | null) => {
          const baseIdx = localLookup(date)
          const baseFx = fxLookup(date)
          if (!cur || !curFx || !baseIdx || !baseFx) return null
          const curUsd = usdValue(cur.close, curFx.close, c.fxDirection!)
          const baseUsd = usdValue(baseIdx.close, baseFx.close, c.fxDirection!)
          if (baseUsd === 0) return null
          return Math.round(((curUsd / baseUsd) - 1) * 10000) / 100
        }
        returnsUsd = {
          '5d': lookupUsdReturn(fiveDDate),
          '1m': lookupUsdReturn(oneMDate),
          '3m': lookupUsdReturn(threeMDate),
          '6m': lookupUsdReturn(sixMDate),
          ytd: lookupUsdReturn(ytdDate),
        }
      }
    }

    return {
      displayName: c.displayName,
      ticker: c.ticker,
      currency: c.currency,
      currentPrice: cur ? cur.close : null,
      returnsLocal,
      returnsUsd,
    }
  })

  return {
    asOfDate,
    lookbackDates,
    countries,
    warnings,
    ...(missingIndexTickers.length ? { missingIndexTickers } : {}),
    ...(missingFxTickers.length ? { missingFxTickers } : {}),
  }
}
