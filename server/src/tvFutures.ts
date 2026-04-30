import { db } from './db'
import { getMarket, STIR_MARKETS, type MarketKey } from './stirRegistry'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TvFuturesContract {
  symbol: string
  marketKey: string
  monthCode: string
  year: number
  expiryLabel: string
  expiryDate: string
  lastPrice: number | null
  impliedRate: number | null
  volume: number | null
  openInterest: number | null
}

export interface TvCurveResponse {
  rootSymbol: string
  currentDate: string
  lookbackDate: string
  lookbackDays: number
  currentCurve: TvFuturesContract[]
  lookbackCurve: TvFuturesContract[]
  availableDates: string[]
}

export interface TvContractHistoryResponse {
  symbol: string
  history: { date: string; impliedRate: number; lastPrice: number }[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const MONTH_CODES = 'FGHJKMNQUVXZ'
const MONTH_CODE_MAP: Record<string, number> = {
  F: 0, G: 1, H: 2, J: 3, K: 4, M: 5,
  N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
}
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// ── Symbol parsing ───────────────────────────────────────────────────────────

interface ParsedSymbol {
  symbol: string
  marketKey: string
  monthCode: string
  monthIndex: number
  year: number
}

function parseSymbol(symbol: string, prefix: string, yearDigits: 1 | 2, marketKey: string): ParsedSymbol | null {
  const rest = symbol.slice(prefix.length)
  if (rest.length < 2) return null

  const monthCode = rest[0].toUpperCase()
  const monthIndex = MONTH_CODE_MAP[monthCode]
  if (monthIndex === undefined) return null

  const yearPart = rest.slice(1)
  let year: number

  if (yearDigits === 1) {
    if (yearPart.length !== 1) return null
    const digit = parseInt(yearPart, 10)
    if (isNaN(digit)) return null
    year = digit >= 5 ? 2020 + digit : 2030 + digit
  } else {
    if (yearPart.length !== 2) return null
    const num = parseInt(yearPart, 10)
    if (isNaN(num)) return null
    year = 2000 + num
  }

  return { symbol, marketKey, monthCode, monthIndex, year }
}

function contractSortKey(c: ParsedSymbol): number {
  return c.year * 100 + MONTH_CODES.indexOf(c.monthCode)
}

function makeExpiryLabel(monthIndex: number, year: number): string {
  return `${MONTH_NAMES[monthIndex]} ${year}`
}

function makeExpiryDate(monthIndex: number, year: number): string {
  const m = String(monthIndex + 1).padStart(2, '0')
  return `${year}-${m}-01`
}

// Returns the date at which the contract should be filtered OUT of the forward curve.
// A contract is shown while asOf < cutoff. Cutoff = first day of the month AFTER the
// contract month, so contracts remain visible through their entire delivery month.
export function getContractExpiryCutoff(contract: { monthCode: string; year: number }): Date {
  const monthIndex = MONTH_CODE_MAP[contract.monthCode]
  if (monthIndex === undefined) return new Date(0)
  const cutoffMonth = (monthIndex + 1) % 12
  const cutoffYear = monthIndex === 11 ? contract.year + 1 : contract.year
  return new Date(Date.UTC(cutoffYear, cutoffMonth, 1))
}

// ── Helpers: timestamp conversion ────────────────────────────────────────────

function tsToDate(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10)
}

// ── DB queries ───────────────────────────────────────────────────────────────

interface RawSeriesRow {
  symbol: string
  time: string
  close: number
}

function getContractsForTimestamp(prefix: string, timestamp: string): RawSeriesRow[] {
  return db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol LIKE ? AND time = ?
    AND close IS NOT NULL AND close > 0
  `).all(`${prefix}%`, timestamp) as RawSeriesRow[]
}

function getTimestampForDate(prefix: string, targetDate: string): string | null {
  const endOfDay = new Date(targetDate + 'T23:59:59Z').getTime() / 1000
  const startOfDay = new Date(targetDate + 'T00:00:00Z').getTime() / 1000
  const row = db.prepare(`
    SELECT time FROM tv_series
    WHERE symbol LIKE ? AND CAST(time AS INTEGER) >= ? AND CAST(time AS INTEGER) <= ?
    LIMIT 1
  `).get(`${prefix}%`, startOfDay, endOfDay) as { time: string } | undefined
  return row?.time ?? null
}

function getDistinctTimestampsDesc(prefix: string, limit: number = 500): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT time FROM tv_series
    WHERE symbol LIKE ?
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(`${prefix}%`, limit) as { time: string }[]
  return rows.map(r => r.time)
}

function getNthPriorTimestamp(timestamps: string[], currentTs: string, offset: number): string | null {
  const idx = timestamps.indexOf(currentTs)
  if (idx === -1) {
    const currentNum = parseInt(currentTs, 10)
    let startIdx = 0
    for (let i = 0; i < timestamps.length; i++) {
      if (parseInt(timestamps[i], 10) < currentNum) {
        startIdx = i
        break
      }
    }
    return timestamps[startIdx + offset] ?? null
  }
  return timestamps[idx + 1 + offset] ?? null
}

// ── Build contract from parsed symbol + raw row ──────────────────────────────

function buildContract(parsed: ParsedSymbol, close: number): TvFuturesContract {
  return {
    symbol: parsed.symbol,
    marketKey: parsed.marketKey,
    monthCode: parsed.monthCode,
    year: parsed.year,
    expiryLabel: makeExpiryLabel(parsed.monthIndex, parsed.year),
    expiryDate: makeExpiryDate(parsed.monthIndex, parsed.year),
    lastPrice: close,
    impliedRate: +(100 - close).toFixed(4),
    volume: null,
    openInterest: null,
  }
}

function buildCurveFromRows(
  rows: RawSeriesRow[],
  prefix: string,
  yearDigits: 1 | 2,
  marketKey: string,
): TvFuturesContract[] {
  const contracts: (TvFuturesContract & { _sortKey: number })[] = []

  for (const row of rows) {
    const parsed = parseSymbol(row.symbol, prefix, yearDigits, marketKey)
    if (!parsed) continue
    contracts.push({ ...buildContract(parsed, row.close), _sortKey: contractSortKey(parsed) })
  }

  contracts.sort((a, b) => a._sortKey - b._sortKey)
  return contracts.map(({ _sortKey: _, ...c }) => c)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getTvCurve(
  marketKey: string,
  lookbackDays: number,
  asOfDate?: string,
): TvCurveResponse {
  const market = getMarket(marketKey)
  if (!market) {
    return {
      rootSymbol: marketKey,
      currentDate: '',
      lookbackDate: '',
      lookbackDays,
      currentCurve: [],
      lookbackCurve: [],
      availableDates: [],
    }
  }

  const { tickerPrefix, yearDigits, marketKey: resolvedKey } = market
  const timestamps = getDistinctTimestampsDesc(tickerPrefix)

  if (timestamps.length === 0) {
    return {
      rootSymbol: resolvedKey,
      currentDate: '',
      lookbackDate: '',
      lookbackDays,
      currentCurve: [],
      lookbackCurve: [],
      availableDates: [],
    }
  }

  let currentTs: string
  if (asOfDate) {
    const ts = getTimestampForDate(tickerPrefix, asOfDate)
    currentTs = ts ?? timestamps[0]
  } else {
    currentTs = timestamps[0]
  }

  const currentDate = tsToDate(currentTs)
  const currentRows = getContractsForTimestamp(tickerPrefix, currentTs)
  const currentCurve = buildCurveFromRows(currentRows, tickerPrefix, yearDigits, resolvedKey)

  const lookbackTs = getNthPriorTimestamp(timestamps, currentTs, Math.max(0, lookbackDays - 1))
  let lookbackCurve: TvFuturesContract[] = []
  let lookbackDate = ''

  if (lookbackTs) {
    lookbackDate = tsToDate(lookbackTs)
    const lookbackRows = getContractsForTimestamp(tickerPrefix, lookbackTs)
    lookbackCurve = buildCurveFromRows(lookbackRows, tickerPrefix, yearDigits, resolvedKey)
  }

  // Filter expired contracts using the current as-of date for BOTH curves so the
  // delta comparison aligns on the same set of contracts.
  const asOf = new Date(currentDate + 'T00:00:00Z')
  const isLive = (c: TvFuturesContract) => getContractExpiryCutoff(c) > asOf
  const liveCurrentCurve = currentCurve.filter(isLive)
  const liveLookbackCurve = lookbackCurve.filter(isLive)

  const availableDates = timestamps.map(t => tsToDate(t))

  return {
    rootSymbol: resolvedKey,
    currentDate,
    lookbackDate,
    lookbackDays,
    currentCurve: liveCurrentCurve,
    lookbackCurve: liveLookbackCurve,
    availableDates,
  }
}

export function getTvContractHistory(
  symbol: string,
  days: number,
): TvContractHistoryResponse {
  const rows = db.prepare(`
    SELECT time, close FROM tv_series
    WHERE symbol = ?
    AND close IS NOT NULL AND close > 0
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(symbol, days) as { time: string; close: number }[]

  const history = rows
    .reverse()
    .map(r => ({
      date: tsToDate(r.time),
      lastPrice: r.close,
      impliedRate: +(100 - r.close).toFixed(4),
    }))

  return { symbol, history }
}

export function getTvAvailableRoots(): {
  marketKey: string
  country: string
  displayName: string
  rateLabel: string
  productFamily: string
}[] {
  return STIR_MARKETS.map(m => ({
    marketKey: m.marketKey,
    country: m.country,
    displayName: m.displayName,
    rateLabel: m.rateLabel,
    productFamily: 'STIR',
  }))
}
