import { db } from './db'

export type CrudeProduct = 'wti' | 'brent'

interface ProductSpec {
  prefix: string
}

const PRODUCT_SPEC: Record<CrudeProduct, ProductSpec> = {
  wti:   { prefix: 'CL' },
  brent: { prefix: 'BRN' },
}

const MONTH_CODES = 'FGHJKMNQUVXZ'
const MONTH_CODE_MAP: Record<string, number> = {
  F: 0, G: 1, H: 2, J: 3, K: 4, M: 5,
  N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
}

export interface CrudeCurveContract {
  code: string
  current: number | null
  offset1: number | null
  offset2: number | null
}

export interface CrudeCurveResponse {
  product: CrudeProduct
  asOf: string
  offset1Date: string | null
  offset1Days: number
  offset2Date: string | null
  offset2Days: number
  contracts: CrudeCurveContract[]
}

interface ParsedSymbol {
  symbol: string
  monthCode: string
  monthIndex: number
  year: number
  sortKey: number
  code: string
}

function parseContractSymbol(symbol: string, prefix: string): ParsedSymbol | null {
  if (!symbol.startsWith(prefix)) return null
  const rest = symbol.slice(prefix.length)
  if (rest.length !== 2) return null
  const monthCode = rest[0].toUpperCase()
  const monthIndex = MONTH_CODE_MAP[monthCode]
  if (monthIndex === undefined) return null
  const digit = parseInt(rest[1], 10)
  if (isNaN(digit)) return null
  // Single-digit year: digit >= 5 → 202x, else → 203x
  // (Mirrors the convention used for STIR contracts in tvFutures.ts.)
  const year = digit >= 5 ? 2020 + digit : 2030 + digit
  const sortKey = year * 100 + MONTH_CODES.indexOf(monthCode)
  return { symbol, monthCode, monthIndex, year, sortKey, code: `${monthCode}${digit}` }
}

// First day of the month *after* the contract month — contract is "live" while asOf < cutoff.
function getExpiryCutoff(monthIndex: number, year: number): Date {
  const cutoffMonth = (monthIndex + 1) % 12
  const cutoffYear = monthIndex === 11 ? year + 1 : year
  return new Date(Date.UTC(cutoffYear, cutoffMonth, 1))
}

function tsToDate(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10)
}

interface RawRow { symbol: string; time: string; close: number }

function getDistinctTimestampsDesc(globPattern: string, limit: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT time FROM tv_series
    WHERE symbol GLOB ?
      AND close IS NOT NULL AND close > 0
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(globPattern, limit) as { time: string }[]
  return rows.map(r => r.time)
}

function getLatestRowsAtOrBefore(globPattern: string, asOfTs: string): RawRow[] {
  return db.prepare(`
    SELECT t.symbol, t.time, t.close
    FROM tv_series t
    INNER JOIN (
      SELECT symbol, MAX(CAST(time AS INTEGER)) AS max_time
      FROM tv_series
      WHERE symbol GLOB ?
        AND CAST(time AS INTEGER) <= ?
        AND close IS NOT NULL
        AND close > 0
      GROUP BY symbol
    ) latest ON latest.symbol = t.symbol AND CAST(t.time AS INTEGER) = latest.max_time
  `).all(globPattern, parseInt(asOfTs, 10)) as RawRow[]
}

function buildPriceMap(rows: RawRow[], prefix: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    const parsed = parseContractSymbol(row.symbol, prefix)
    if (!parsed) continue
    map.set(parsed.symbol, row.close)
  }
  return map
}

// ── Brent–WTI Front Month Spread ─────────────────────────────────────────────

export type SpreadLookback = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max'

const LOOKBACK_DAYS: Record<Exclude<SpreadLookback, 'max'>, number> = {
  '1m': 30,
  '3m': 91,
  '6m': 182,
  '1y': 365,
  '2y': 730,
  '5y': 1825,
}

export interface SpreadPoint {
  date: string
  brent: number
  wti: number
  spread: number
}

export interface SpreadStats {
  current: number
  min: number
  max: number
  mean: number
  median: number
  stdev: number
  zscore: number
}

export interface CrudeSpreadResponse {
  symbols: { brent: string; wti: string }
  lookback: SpreadLookback
  startDate: string | null
  endDate: string | null
  series: SpreadPoint[]
  stats: SpreadStats | null
  error?: string
}

const BRENT_FRONT = 'BRN'
const WTI_FRONT   = 'CL'

function symbolHasRows(symbol: string): boolean {
  const row = db.prepare(`SELECT 1 FROM tv_series WHERE symbol = ? LIMIT 1`).get(symbol)
  return row !== undefined
}

function computeStats(spreads: number[]): SpreadStats | null {
  if (spreads.length === 0) return null
  const current = spreads[spreads.length - 1]
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of spreads) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  const mean = sum / spreads.length
  let sqSum = 0
  for (const v of spreads) sqSum += (v - mean) ** 2
  // Sample stdev (n-1) when we have >1 obs; population otherwise.
  const stdev = spreads.length > 1 ? Math.sqrt(sqSum / (spreads.length - 1)) : 0
  const sorted = [...spreads].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
  const zscore = stdev > 0 ? (current - mean) / stdev : 0
  return { current, min, max, mean, median, stdev, zscore }
}

export function getCrudeSpread(lookback: SpreadLookback): CrudeSpreadResponse {
  const symbols = { brent: BRENT_FRONT, wti: WTI_FRONT }
  const empty: CrudeSpreadResponse = {
    symbols, lookback, startDate: null, endDate: null, series: [], stats: null,
  }

  if (!symbolHasRows(BRENT_FRONT)) {
    return { ...empty, error: `${BRENT_FRONT} not found in tv_series — check ingestion` }
  }
  if (!symbolHasRows(WTI_FRONT)) {
    return { ...empty, error: `${WTI_FRONT} not found in tv_series — check ingestion` }
  }

  // As-of = latest timestamp shared between either series. We compute the window
  // off the latest BRN timestamp so the start date is intuitive; the inner join
  // below drops days where either leg is missing.
  const latest = db.prepare(`
    SELECT MAX(CAST(time AS INTEGER)) AS t
    FROM tv_series
    WHERE symbol IN (?, ?)
  `).get(BRENT_FRONT, WTI_FRONT) as { t: number | null }
  if (latest.t == null) return empty

  const endTs = latest.t
  const startTs = lookback === 'max'
    ? 0
    : endTs - LOOKBACK_DAYS[lookback] * 86400

  const rows = db.prepare(`
    SELECT b.time AS time, b.close AS brent, c.close AS wti
    FROM tv_series b
    INNER JOIN tv_series c
      ON CAST(b.time AS INTEGER) = CAST(c.time AS INTEGER)
    WHERE b.symbol = ? AND c.symbol = ?
      AND b.close IS NOT NULL AND c.close IS NOT NULL
      AND b.close > 0 AND c.close > 0
      AND CAST(b.time AS INTEGER) >= ?
      AND CAST(b.time AS INTEGER) <= ?
    ORDER BY CAST(b.time AS INTEGER) ASC
  `).all(BRENT_FRONT, WTI_FRONT, startTs, endTs) as { time: string; brent: number; wti: number }[]

  if (rows.length === 0) return empty

  const series: SpreadPoint[] = rows.map(r => ({
    date: tsToDate(r.time),
    brent: r.brent,
    wti: r.wti,
    spread: +(r.brent - r.wti).toFixed(4),
  }))

  const stats = computeStats(series.map(p => p.spread))

  return {
    symbols,
    lookback,
    startDate: series[0].date,
    endDate: series[series.length - 1].date,
    series,
    stats,
  }
}

export function getCrudeCurve(
  product: CrudeProduct,
  offset1Days: number,
  offset2Days: number,
): CrudeCurveResponse {
  const { prefix } = PRODUCT_SPEC[product]
  const globPattern = `${prefix}[FGHJKMNQUVXZ]?`

  // Need at least max(offset)+1 distinct dates; cap generously to avoid scanning full table.
  const maxOffset = Math.max(offset1Days, offset2Days, 0)
  const fetchLimit = Math.min(2000, maxOffset + 50)
  const timestamps = getDistinctTimestampsDesc(globPattern, fetchLimit)

  if (timestamps.length === 0) {
    return {
      product,
      asOf: '',
      offset1Date: null,
      offset1Days,
      offset2Date: null,
      offset2Days,
      contracts: [],
    }
  }

  const currentTs = timestamps[0]
  // If user requests more lookback than we have, fall back to the oldest available date.
  const offset1Ts = timestamps[Math.min(offset1Days, timestamps.length - 1)] ?? null
  const offset2Ts = timestamps[Math.min(offset2Days, timestamps.length - 1)] ?? null

  const currentRows  = getLatestRowsAtOrBefore(globPattern, currentTs)
  const offset1Rows  = offset1Ts ? getLatestRowsAtOrBefore(globPattern, offset1Ts) : []
  const offset2Rows  = offset2Ts ? getLatestRowsAtOrBefore(globPattern, offset2Ts) : []

  const currentMap = buildPriceMap(currentRows, prefix)
  const offset1Map = buildPriceMap(offset1Rows, prefix)
  const offset2Map = buildPriceMap(offset2Rows, prefix)

  // Set of contracts = those that exist on the current as-of date.
  const parsedCurrent: ParsedSymbol[] = []
  for (const row of currentRows) {
    const p = parseContractSymbol(row.symbol, prefix)
    if (p) parsedCurrent.push(p)
  }

  // Filter expired contracts using the as-of date — same logic the STIR curve uses.
  const asOfDate = tsToDate(currentTs)
  const asOfDateObj = new Date(asOfDate + 'T00:00:00Z')
  const live = parsedCurrent.filter(p => getExpiryCutoff(p.monthIndex, p.year) > asOfDateObj)

  live.sort((a, b) => a.sortKey - b.sortKey)

  const contracts: CrudeCurveContract[] = live.map(p => ({
    code: p.code,
    current: currentMap.get(p.symbol) ?? null,
    offset1: offset1Map.get(p.symbol) ?? null,
    offset2: offset2Map.get(p.symbol) ?? null,
  }))

  return {
    product,
    asOf: asOfDate,
    offset1Date: offset1Ts ? tsToDate(offset1Ts) : null,
    offset1Days,
    offset2Date: offset2Ts ? tsToDate(offset2Ts) : null,
    offset2Days,
    contracts,
  }
}
