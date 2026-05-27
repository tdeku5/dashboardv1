// Metals dashboard data (Commodities → Metals tab). All read-only over the
// existing `tv_series` table — no new ingestion.
//
// Three datasets, each mirroring an existing commodities/equities pattern:
//   1. getMetalsReturns()  — 5×5 returns heatmap (GC/SI/HG/PL/PA continuous),
//      computed exactly like the equities index-returns endpoint (usIndices.ts):
//      5D = 5 trading days back; 1M/3M/6M = calendar-month shift snapped to the
//      nearest trading day at/​before; YTD = prior-year 12-31 snapped.
//   2. getMetalCurves()    — Gold (GC) and Silver (SI) futures strips with a
//      current curve + two configurable lookback curves, same logic as
//      getCrudeCurve in crudeCurves.ts.
//   3. getMetalBasis()     — front-month continuous minus spot proxy over time
//      (Gold: GC − GOLD, Silver: SI − SILVER), same join as getCrudeSpread but
//      generalised over a (front, spot) symbol pair and returned without stats.
//
// tv_series.time is unix epoch SECONDS stored as TEXT; every comparison/sort
// uses CAST(time AS INTEGER) to avoid lexicographic ordering bugs.

import { db } from './db'

const MONTH_CODES = 'FGHJKMNQUVXZ'
const MONTH_CODE_MAP: Record<string, number> = {
  F: 0, G: 1, H: 2, J: 3, K: 4, M: 5,
  N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
}

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// ── 1. Returns heatmap ───────────────────────────────────────────────────────

export type MetalKey = 'GC' | 'SI' | 'HG' | 'PL' | 'PA'

// Continuous front-month symbols as stored in tv_series (bare root, not GC1!).
const METALS: Array<{ key: MetalKey; ticker: string; name: string }> = [
  { key: 'GC', ticker: 'GC', name: 'Gold' },
  { key: 'SI', ticker: 'SI', name: 'Silver' },
  { key: 'HG', ticker: 'HG', name: 'Copper' },
  { key: 'PL', ticker: 'PL', name: 'Platinum' },
  { key: 'PA', ticker: 'PA', name: 'Palladium' },
]

export type ReturnsLookback = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface MetalReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface MetalReturnsRow {
  key: MetalKey
  ticker: string
  name: string
  currentPrice: number | null
  returns: MetalReturns
}

export interface MetalsReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<ReturnsLookback, string | null>
  metals: MetalReturnsRow[]
  missingTickers?: string[]
}

interface SeriesPoint { date: string; close: number }

const round2 = (x: number) => Math.round(x * 100) / 100
const pctChange = (curr: number, base: number): number => round2(((curr - base) / base) * 100)

function shiftMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10)
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

// Continuous front-month returns are identical in shape across asset groups
// (metals, energy, …), so the computation is generic over a contract list.
interface ContractCfg { ticker: string; name: string }

export interface ContractReturnsRow {
  key: string
  ticker: string
  name: string
  currentPrice: number | null
  returns: MetalReturns
}

function loadContinuousSeries(contracts: ContractCfg[]): Map<string, SeriesPoint[]> {
  const symbols = contracts.map(c => c.ticker)
  const placeholders = symbols.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT symbol, time, close FROM tv_series
    WHERE symbol IN (${placeholders})
      AND close IS NOT NULL AND close > 0
    ORDER BY symbol, CAST(time AS INTEGER) ASC
  `).all(...symbols) as Array<{ symbol: string; time: string; close: number }>

  const out = new Map<string, SeriesPoint[]>()
  for (const c of contracts) out.set(c.ticker, [])
  for (const r of rows) {
    const arr = out.get(r.symbol)
    if (arr) arr.push({ date: tsToDate(parseInt(r.time, 10)), close: r.close })
  }
  return out
}

const EMPTY_LOOKBACK: Record<ReturnsLookback, string | null> = {
  '5d': null, '1m': null, '3m': null, '6m': null, ytd: null,
}

interface ComputedReturns {
  asOfDate: string | null
  lookbackDates: Record<ReturnsLookback, string | null>
  rows: ContractReturnsRow[]
  missingTickers: string[]
}

function computeContinuousReturns(contracts: ContractCfg[]): ComputedReturns {
  const bySymbol = loadContinuousSeries(contracts)
  const missingTickers = contracts.filter(c => (bySymbol.get(c.ticker)?.length ?? 0) === 0).map(c => c.ticker)

  if (missingTickers.length === contracts.length) {
    return { asOfDate: null, lookbackDates: { ...EMPTY_LOOKBACK }, rows: [], missingTickers }
  }

  // As-of = last common trading day across all present contracts (MIN of latest).
  let asOfDate: string | null = null
  for (const c of contracts) {
    const arr = bySymbol.get(c.ticker)
    if (!arr || arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOfDate === null || last < asOfDate) asOfDate = last
  }
  if (!asOfDate) {
    return { asOfDate: null, lookbackDates: { ...EMPTY_LOOKBACK }, rows: [], missingTickers }
  }

  const distinctSet = new Set<string>()
  for (const c of contracts) {
    const arr = bySymbol.get(c.ticker)
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

  const lookbackDates: Record<ReturnsLookback, string | null> = {
    '5d': fiveDDate, '1m': oneMDate, '3m': threeMDate, '6m': sixMDate, ytd: ytdDate,
  }

  const rows: ContractReturnsRow[] = contracts.map(c => {
    const arr = bySymbol.get(c.ticker) ?? []
    if (arr.length === 0) {
      return {
        key: c.ticker, ticker: c.ticker, name: c.name, currentPrice: null,
        returns: { '5d': null, '1m': null, '3m': null, '6m': null, ytd: null },
      }
    }
    const cur = findOnOrBefore(arr, asOfDate!)
    const lookup = (date: string | null) => (date ? findOnOrBefore(arr, date) : null)
    const f5 = lookup(fiveDDate), f1 = lookup(oneMDate), f3 = lookup(threeMDate)
    const f6 = lookup(sixMDate),  fy = lookup(ytdDate)
    return {
      key: c.ticker, ticker: c.ticker, name: c.name,
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

  return { asOfDate, lookbackDates, rows, missingTickers }
}

export function getMetalsReturns(): MetalsReturnsResponse {
  const r = computeContinuousReturns(METALS)
  return {
    asOfDate: r.asOfDate,
    lookbackDates: r.lookbackDates,
    metals: r.rows as MetalReturnsRow[],
    ...(r.missingTickers.length ? { missingTickers: r.missingTickers } : {}),
  }
}

// ── Energy returns (CL / BRN / UHO / RBOB / NG continuous front-month) ────────

export interface EnergyReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<ReturnsLookback, string | null>
  energy: ContractReturnsRow[]
  missingTickers?: string[]
}

// Verified against tv_series: bare-root continuous symbols. Heating oil is
// 'UHO' here (no 'HO'); gasoline is 'RBOB' (no 'RB').
const ENERGY_CONTRACTS: ContractCfg[] = [
  { ticker: 'CL',   name: 'Crude Oil (WTI)' },
  { ticker: 'BRN',  name: 'Brent Crude' },
  { ticker: 'UHO',  name: 'Heating Oil' },
  { ticker: 'RBOB', name: 'RBOB Gasoline' },
  { ticker: 'NG',   name: 'Natural Gas' },
]

export function getEnergyReturns(): EnergyReturnsResponse {
  const r = computeContinuousReturns(ENERGY_CONTRACTS)
  return {
    asOfDate: r.asOfDate,
    lookbackDates: r.lookbackDates,
    energy: r.rows,
    ...(r.missingTickers.length ? { missingTickers: r.missingTickers } : {}),
  }
}

// ── 2. Futures curves (Gold / Silver) ────────────────────────────────────────

export type CurveMetal = 'gold' | 'silver'
const CURVE_PREFIX: Record<CurveMetal, string> = { gold: 'GC', silver: 'SI' }

export interface MetalCurveContract {
  code: string
  current: number | null
  offset1: number | null
  offset2: number | null
}

export interface MetalCurveData {
  product: CurveMetal
  asOf: string
  offset1Date: string | null
  offset1Days: number
  offset2Date: string | null
  offset2Days: number
  contracts: MetalCurveContract[]
  // Contracts whose latest bar was rejected as a bad/holiday "tip" (see
  // MAX_TIP_MOVE) and replaced with their prior good close.
  adjustedContracts: string[]
}

// Illiquid back-month metal contracts occasionally print a corrupt "last" on
// thin/holiday sessions (e.g. a Dec-27 gold contract jumping +17% in a day
// while spot is flat), which puts a spike in the otherwise-smooth strip. Mirror
// the documented tv_series stale-tip philosophy: if a contract's latest bar
// deviates from its prior bar by more than this fraction (a >3σ one-day move
// for gold/silver), treat it as an unfilled/bad tip and fall back to the prior
// good close. Normal daily moves on these contracts are well under 1%.
const MAX_TIP_MOVE = 0.04

interface ParsedSymbol {
  symbol: string
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
  // Single-digit year: >=5 → 202x, else → 203x (same convention as crude/STIR).
  const year = digit >= 5 ? 2020 + digit : 2030 + digit
  const sortKey = year * 100 + MONTH_CODES.indexOf(monthCode)
  return { symbol, monthIndex, year, sortKey, code: `${monthCode}${digit}` }
}

// Contract is live while asOf < first day of the month after the contract month.
function getExpiryCutoff(monthIndex: number, year: number): Date {
  const cutoffMonth = (monthIndex + 1) % 12
  const cutoffYear = monthIndex === 11 ? year + 1 : year
  return new Date(Date.UTC(cutoffYear, cutoffMonth, 1))
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
        AND close IS NOT NULL AND close > 0
      GROUP BY symbol
    ) latest ON latest.symbol = t.symbol AND CAST(t.time AS INTEGER) = latest.max_time
  `).all(globPattern, parseInt(asOfTs, 10)) as RawRow[]
}

function buildPriceMap(rows: RawRow[], prefix: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    const parsed = parseContractSymbol(row.symbol, prefix)
    if (parsed) map.set(parsed.symbol, row.close)
  }
  return map
}

// Latest two closes per contract symbol at/before asOfTs — used to vet the
// current curve's tip against the contract's prior bar.
function getLatestTwoBySymbol(globPattern: string, asOfTs: string): Map<string, { last: number; prev: number | null }> {
  const rows = db.prepare(`
    SELECT symbol, close, rn FROM (
      SELECT symbol, close,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY CAST(time AS INTEGER) DESC) AS rn
      FROM tv_series
      WHERE symbol GLOB ? AND CAST(time AS INTEGER) <= ? AND close IS NOT NULL AND close > 0
    ) WHERE rn <= 2
  `).all(globPattern, parseInt(asOfTs, 10)) as Array<{ symbol: string; close: number; rn: number }>
  const m = new Map<string, { last: number; prev: number | null }>()
  for (const r of rows) {
    const e = m.get(r.symbol) ?? { last: NaN, prev: null }
    if (r.rn === 1) e.last = r.close
    else if (r.rn === 2) e.prev = r.close
    m.set(r.symbol, e)
  }
  return m
}

export function getMetalCurve(metal: CurveMetal, offset1Days: number, offset2Days: number): MetalCurveData {
  const prefix = CURVE_PREFIX[metal]
  // Month code is a single letter F–Z; year a single digit. GLOB keeps the
  // continuous root (e.g. "GC") and spot ("GOLD") out of the strip.
  const globPattern = `${prefix}[FGHJKMNQUVXZ][0-9]`

  const maxOffset = Math.max(offset1Days, offset2Days, 0)
  const fetchLimit = Math.min(2000, maxOffset + 50)
  const timestamps = getDistinctTimestampsDesc(globPattern, fetchLimit)

  if (timestamps.length === 0) {
    return { product: metal, asOf: '', offset1Date: null, offset1Days, offset2Date: null, offset2Days, contracts: [], adjustedContracts: [] }
  }

  const currentTs = timestamps[0]
  const offset1Ts = timestamps[Math.min(offset1Days, timestamps.length - 1)] ?? null
  const offset2Ts = timestamps[Math.min(offset2Days, timestamps.length - 1)] ?? null

  // Current curve: vet each contract's tip against its prior bar.
  const latestTwo = getLatestTwoBySymbol(globPattern, currentTs)
  const adjustedContracts: string[] = []
  const currentPrice = (symbol: string): number | null => {
    const e = latestTwo.get(symbol)
    if (!e || !Number.isFinite(e.last)) return null
    if (e.prev != null && e.prev > 0 && Math.abs(e.last / e.prev - 1) > MAX_TIP_MOVE) {
      adjustedContracts.push(symbol)
      return e.prev
    }
    return e.last
  }

  const offset1Map = offset1Ts ? buildPriceMap(getLatestRowsAtOrBefore(globPattern, offset1Ts), prefix) : new Map()
  const offset2Map = offset2Ts ? buildPriceMap(getLatestRowsAtOrBefore(globPattern, offset2Ts), prefix) : new Map()

  const currentRows = getLatestRowsAtOrBefore(globPattern, currentTs)
  const parsedCurrent: ParsedSymbol[] = []
  for (const row of currentRows) {
    const p = parseContractSymbol(row.symbol, prefix)
    if (p) parsedCurrent.push(p)
  }

  const asOfDate = tsToDate(parseInt(currentTs, 10))
  const asOfDateObj = new Date(asOfDate + 'T00:00:00Z')
  const live = parsedCurrent.filter(p => getExpiryCutoff(p.monthIndex, p.year) > asOfDateObj)
  live.sort((a, b) => a.sortKey - b.sortKey)

  const contracts: MetalCurveContract[] = live.map(p => ({
    code: p.code,
    current: currentPrice(p.symbol),
    offset1: offset1Map.get(p.symbol) ?? null,
    offset2: offset2Map.get(p.symbol) ?? null,
  }))

  if (adjustedContracts.length > 0) {
    console.log(`[metals] ${metal} curve: rejected bad tips on ${adjustedContracts.join(', ')} (used prior close)`)
  }

  return {
    product: metal,
    asOf: asOfDate,
    offset1Date: offset1Ts ? tsToDate(parseInt(offset1Ts, 10)) : null,
    offset1Days,
    offset2Date: offset2Ts ? tsToDate(parseInt(offset2Ts, 10)) : null,
    offset2Days,
    contracts,
    adjustedContracts,
  }
}

export function getMetalCurves(offset1Days: number, offset2Days: number): { gold: MetalCurveData; silver: MetalCurveData } {
  return {
    gold:   getMetalCurve('gold',   offset1Days, offset2Days),
    silver: getMetalCurve('silver', offset1Days, offset2Days),
  }
}

// ── 3. Spot − front-month basis (Gold / Silver) ──────────────────────────────

export type BasisLookback = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max'

const LOOKBACK_DAYS: Record<Exclude<BasisLookback, 'max'>, number> = {
  '1m': 30, '3m': 91, '6m': 182, '1y': 365, '2y': 730, '5y': 1825,
}

// front = continuous front-month future; spot = TradingView spot proxy.
const BASIS_SYMBOLS: Record<CurveMetal, { front: string; spot: string }> = {
  gold:   { front: 'GC', spot: 'GOLD' },
  silver: { front: 'SI', spot: 'SILVER' },
}

export interface BasisPoint {
  date: string
  front: number
  spot: number
  basis: number
}

export interface MetalBasisResponse {
  metal: CurveMetal
  symbols: { front: string; spot: string }
  lookback: BasisLookback
  startDate: string | null
  endDate: string | null
  series: BasisPoint[]
  error?: string
}

function symbolHasRows(symbol: string): boolean {
  return db.prepare(`SELECT 1 FROM tv_series WHERE symbol = ? LIMIT 1`).get(symbol) !== undefined
}

export function getMetalBasis(metal: CurveMetal, lookback: BasisLookback): MetalBasisResponse {
  const { front, spot } = BASIS_SYMBOLS[metal]
  const empty: MetalBasisResponse = {
    metal, symbols: { front, spot }, lookback, startDate: null, endDate: null, series: [],
  }

  if (!symbolHasRows(front)) return { ...empty, error: `${front} not found in tv_series — check ingestion` }
  if (!symbolHasRows(spot))  return { ...empty, error: `${spot} not found in tv_series — check ingestion` }

  const latest = db.prepare(`
    SELECT MAX(CAST(time AS INTEGER)) AS t FROM tv_series WHERE symbol IN (?, ?)
  `).get(front, spot) as { t: number | null }
  if (latest.t == null) return empty

  const endTs = latest.t
  const startTs = lookback === 'max' ? 0 : endTs - LOOKBACK_DAYS[lookback] * 86400

  const rows = db.prepare(`
    SELECT f.time AS time, f.close AS front, s.close AS spot
    FROM tv_series f
    INNER JOIN tv_series s
      ON CAST(f.time AS INTEGER) = CAST(s.time AS INTEGER)
    WHERE f.symbol = ? AND s.symbol = ?
      AND f.close IS NOT NULL AND s.close IS NOT NULL
      AND f.close > 0 AND s.close > 0
      AND CAST(f.time AS INTEGER) >= ?
      AND CAST(f.time AS INTEGER) <= ?
    ORDER BY CAST(f.time AS INTEGER) ASC
  `).all(front, spot, startTs, endTs) as Array<{ time: string; front: number; spot: number }>

  if (rows.length === 0) return empty

  const series: BasisPoint[] = rows.map(r => ({
    date: tsToDate(parseInt(r.time, 10)),
    front: r.front,
    spot: r.spot,
    basis: +(r.front - r.spot).toFixed(4),
  }))

  return {
    metal,
    symbols: { front, spot },
    lookback,
    startDate: series[0].date,
    endDate: series[series.length - 1].date,
    series,
  }
}
