import { db } from './db'

// Stable internal keys → actual tv_series symbols. The user's data ingests
// gold/oil vol under GVOL/OVOL (CBOE GVZ/OVX). Display names live on the
// frontend; the backend speaks in stable keys so the wire format never
// reflects the storage convention.
export const CROSS_ASSET_VOL_SYMBOLS = {
  vix:  'VIX',
  move: 'MOVE',
  gvz:  'GVOL',
  ovx:  'OVOL',
  bvol: 'BVOL',
} as const

export type CavKey = keyof typeof CROSS_ASSET_VOL_SYMBOLS
const KEYS: CavKey[] = ['vix', 'move', 'gvz', 'ovx', 'bvol']

export type CavRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export type CavLookbackKey = '6m' | '1y' | '2y' | '5y' | '10y'

// Rolling-window length per z-score lookback, in trading-day observations of
// the series itself. The window includes the current bar, so the first
// computable z-score for a series sits at its Nth observation.
export const LOOKBACK_TRADING_DAYS: Record<CavLookbackKey, number> = {
  '6m':  126,
  '1y':  252,
  '2y':  504,
  '5y':  1260,
  '10y': 2520,
}

interface DayPoint { date: string; close: number }

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function shiftCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - days))
  return dt.toISOString().slice(0, 10)
}

const CAL_DAYS: Record<Exclude<CavRangeKey, 'ytd' | 'all'>, number> = {
  '1m': 30, '3m': 90, '6m': 180,
  '1y': 365, '2y': 730, '5y': 1825,
  '10y': 3650, '15y': 5475, '20y': 7300,
}

function rangeStart(asOf: string, range: CavRangeKey, earliest: string): string {
  if (range === 'all') return earliest
  if (range === 'ytd') return `${asOf.slice(0, 4)}-01-01`
  return shiftCalendarDays(asOf, CAL_DAYS[range])
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
const round4 = (x: number) => Math.round(x * 10000) / 10000

// ── Levels endpoint ──────────────────────────────────────────────────────────

export type CavLevelsRow = {
  date: string
} & { [K in CavKey]: number | null }

export interface CavLevelsResponse {
  asOfDate: string | null
  range: CavRangeKey
  rangeStartDate: string | null
  series: CavLevelsRow[]
  missingSeries: CavKey[]
}

export function getCavLevels(range: CavRangeKey): CavLevelsResponse {
  const symbols = KEYS.map(k => CROSS_ASSET_VOL_SYMBOLS[k])
  const bySymbol = loadSeries(symbols)
  const missingSeries = KEYS.filter(k => (bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k])?.length ?? 0) === 0)

  let asOf: string | null = null
  let earliest: string | null = null
  for (const k of KEYS) {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    if (arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last > asOf) asOf = last
    const first = arr[0].date
    if (earliest === null || first < earliest) earliest = first
  }
  if (!asOf || !earliest) {
    return { asOfDate: null, range, rangeStartDate: null, series: [], missingSeries }
  }

  const startDate = rangeStart(asOf, range, earliest)

  const valueByKey: Record<CavKey, Map<string, number>> = {
    vix: new Map(), move: new Map(), gvz: new Map(), ovx: new Map(), bvol: new Map(),
  }
  const dateSet = new Set<string>()
  for (const k of KEYS) {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    const m = valueByKey[k]
    for (const p of arr) {
      if (p.date < startDate || p.date > asOf) continue
      m.set(p.date, p.close)
      dateSet.add(p.date)
    }
  }

  const dates = Array.from(dateSet).sort()
  const series: CavLevelsRow[] = dates.map(d => {
    const row = { date: d } as CavLevelsRow
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
    missingSeries,
  }
}

// ── Z-scores endpoint ────────────────────────────────────────────────────────

export interface CavZscoreCell {
  z: number | null
  value: number | null
  mean: number | null
  stdev: number | null
}

export type CavZscoreRow = {
  date: string
} & { [K in CavKey]: CavZscoreCell | null }

export interface CavZscoreResponse {
  asOfDate: string | null
  range: CavRangeKey
  rangeStartDate: string | null
  lookback: CavLookbackKey
  lookbackTradingDays: number
  series: CavZscoreRow[]
  notes: string[]
  // Per-key first date in the visible window where a z-score could be computed.
  // null = never valid in this window (e.g. BVOL at 10y lookback).
  firstValidDate: Record<CavKey, string | null>
  missingSeries: CavKey[]
}

// Rolling sample stats (Bessel correction). Returns null when window not full.
// Uses Welford's online algorithm via incremental sums for O(1) updates.
function rollingZ(arr: DayPoint[], N: number): Array<{ date: string; value: number; mean: number | null; stdev: number | null; z: number | null }> {
  const out: Array<{ date: string; value: number; mean: number | null; stdev: number | null; z: number | null }> = []
  if (arr.length === 0) return out
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i].close
    sum += x
    sumSq += x * x
    if (i >= N) {
      const dropped = arr[i - N].close
      sum -= dropped
      sumSq -= dropped * dropped
    }
    if (i >= N - 1) {
      const mean = sum / N
      // Sample variance via Σx² − N·μ². Clamp tiny negatives from float drift.
      const variance = Math.max(0, (sumSq - N * mean * mean) / (N - 1))
      const stdev = Math.sqrt(variance)
      const z = stdev > 0 ? (x - mean) / stdev : null
      out.push({ date: arr[i].date, value: x, mean, stdev, z })
    } else {
      out.push({ date: arr[i].date, value: x, mean: null, stdev: null, z: null })
    }
  }
  return out
}

export function getCavZscores(range: CavRangeKey, lookback: CavLookbackKey): CavZscoreResponse {
  const N = LOOKBACK_TRADING_DAYS[lookback]
  const symbols = KEYS.map(k => CROSS_ASSET_VOL_SYMBOLS[k])
  const bySymbol = loadSeries(symbols)
  const missingSeries = KEYS.filter(k => (bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k])?.length ?? 0) === 0)

  let asOf: string | null = null
  let earliest: string | null = null
  for (const k of KEYS) {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    if (arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last > asOf) asOf = last
    const first = arr[0].date
    if (earliest === null || first < earliest) earliest = first
  }
  const firstValidDate: Record<CavKey, string | null> = {
    vix: null, move: null, gvz: null, ovx: null, bvol: null,
  }
  if (!asOf || !earliest) {
    return {
      asOfDate: null, range, rangeStartDate: null,
      lookback, lookbackTradingDays: N,
      series: [], notes: [], firstValidDate, missingSeries,
    }
  }

  const startDate = rangeStart(asOf, range, earliest)

  // Per-key rolling z over the full series, then sliced to the visible window.
  const rollingByKey: Record<CavKey, Array<{ date: string; value: number; mean: number | null; stdev: number | null; z: number | null }>> = {
    vix: [], move: [], gvz: [], ovx: [], bvol: [],
  }
  const dateSet = new Set<string>()
  for (const k of KEYS) {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    const rolled = rollingZ(arr, N)
    rollingByKey[k] = rolled
    for (const r of rolled) {
      if (r.date >= startDate && r.date <= asOf) dateSet.add(r.date)
    }
  }

  // Build per-key date→cell maps for the visible window.
  const cellByKeyDate: Record<CavKey, Map<string, CavZscoreCell>> = {
    vix: new Map(), move: new Map(), gvz: new Map(), ovx: new Map(), bvol: new Map(),
  }
  for (const k of KEYS) {
    for (const r of rollingByKey[k]) {
      if (r.date < startDate || r.date > asOf) continue
      cellByKeyDate[k].set(r.date, {
        z:     r.z     != null ? round4(r.z)     : null,
        value: r.value != null ? round2(r.value) : null,
        mean:  r.mean  != null ? round4(r.mean)  : null,
        stdev: r.stdev != null ? round4(r.stdev) : null,
      })
      if (firstValidDate[k] === null && r.z != null) firstValidDate[k] = r.date
    }
  }

  const dates = Array.from(dateSet).sort()
  const series: CavZscoreRow[] = dates.map(d => {
    const row = { date: d } as CavZscoreRow
    for (const k of KEYS) row[k] = cellByKeyDate[k].get(d) ?? null
    return row
  })

  // Insufficient-history notes: any series whose earliest valid z lands inside
  // (or beyond) the visible window — i.e. left edge of chart is missing data.
  const notes: string[] = []
  const labels: Record<CavKey, string> = {
    vix: 'VIX', move: 'MOVE', gvz: 'GVZ', ovx: 'OVX', bvol: 'BVOL',
  }
  for (const k of KEYS) {
    if (missingSeries.includes(k)) continue
    const fv = firstValidDate[k]
    if (fv === null) {
      notes.push(`${labels[k]}: insufficient history for ${lookback.toUpperCase()} z-score in this range.`)
    } else if (dates.length > 0 && fv > dates[0]) {
      notes.push(`${labels[k]}: insufficient history for ${lookback.toUpperCase()} z-score before ${fv}.`)
    }
  }

  return {
    asOfDate: asOf,
    range,
    rangeStartDate: dates[0] ?? null,
    lookback,
    lookbackTradingDays: N,
    series,
    notes,
    firstValidDate,
    missingSeries,
  }
}

// ── Summary stats endpoint ───────────────────────────────────────────────────

export type CavSummaryWindowKey = '6m' | '1y'

const SUMMARY_WINDOWS: Record<CavSummaryWindowKey, number> = {
  '6m': 126,
  '1y': 252,
}

// Trading-day offsets for the point-change columns. "1m" / "3m" snap to nearest
// trading day at ~21 / ~63 obs (calendar month / quarter, minus weekends).
// Values are absolute differences (current − prior close) in vol-index points,
// not percent changes — vol indices are themselves measured in points and
// traders read them in absolute moves.
const CHANGE_TD_OFFSETS = {
  '1d': 1,
  '5d': 5,
  '1m': 21,
  '3m': 63,
} as const

export interface CavSummaryChanges {
  '1d':  number | null
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  'ytd': number | null
}

export interface CavSummaryWindowed {
  '6m': number | null
  '1y': number | null
}

export interface CavSummaryTicker {
  ticker: string
  current: number | null
  changes: CavSummaryChanges
  zscore: CavSummaryWindowed
  ivRank: CavSummaryWindowed
  ivPercentile: CavSummaryWindowed
}

export interface CavSummaryResponse {
  asOfDate: string | null
  lookbackDates: {
    '1d':  string | null
    '5d':  string | null
    '1m':  string | null
    '3m':  string | null
    'ytd': string | null
  }
  tickers: CavSummaryTicker[]
}

// Trading-day offset lookup: returns the close N observations before the last
// bar in `arr`, or null if the series is too short.
function priorClose(arr: DayPoint[], offset: number): { date: string; close: number } | null {
  if (arr.length === 0) return null
  const idx = arr.length - 1 - offset
  if (idx < 0) return null
  return arr[idx]
}

// YTD baseline: latest close strictly before YYYY-01-01 of the current bar's
// year. Returns null if the series doesn't extend into the prior calendar year.
function priorYearEndClose(arr: DayPoint[]): { date: string; close: number } | null {
  if (arr.length === 0) return null
  const currYear = arr[arr.length - 1].date.slice(0, 4)
  const cutoff = `${currYear}-01-01`
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].date < cutoff) return arr[i]
  }
  return null
}

// Trailing-window stats over the last N observations (inclusive of current).
// Returns null fields when the series has fewer than N obs.
function windowedStats(arr: DayPoint[], N: number): {
  z: number | null
  rank: number | null
  percentile: number | null
} {
  if (arr.length < N) return { z: null, rank: null, percentile: null }
  const window = arr.slice(arr.length - N)
  const current = window[window.length - 1].close

  let sum = 0
  let min = Infinity
  let max = -Infinity
  let belowCount = 0
  for (const p of window) {
    sum += p.close
    if (p.close < min) min = p.close
    if (p.close > max) max = p.close
    if (p.close < current) belowCount++
  }
  const mean = sum / N
  let sqDev = 0
  for (const p of window) {
    const d = p.close - mean
    sqDev += d * d
  }
  const variance = sqDev / (N - 1)
  const stdev = Math.sqrt(Math.max(0, variance))
  const z = stdev > 0 ? (current - mean) / stdev : null
  const range = max - min
  const rank = range > 0 ? ((current - min) / range) * 100 : null
  const percentile = (belowCount / N) * 100

  return { z, rank, percentile }
}

const round2nullable = (x: number | null): number | null =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100

export function getCavSummary(): CavSummaryResponse {
  const symbols = KEYS.map(k => CROSS_ASSET_VOL_SYMBOLS[k])
  const bySymbol = loadSeries(symbols)

  // Global as-of: latest date present in any series. Used for lookbackDates.
  let asOf: string | null = null
  for (const k of KEYS) {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    if (arr.length === 0) continue
    const last = arr[arr.length - 1].date
    if (asOf === null || last > asOf) asOf = last
  }

  // Build a canonical trading-day calendar for lookbackDates by unioning all
  // tickers' dates. The 1d/5d/1m/3m offsets walk back through this union;
  // YTD takes the latest pre-Jan-01 date in the union.
  const dateUnion = new Set<string>()
  for (const k of KEYS) {
    for (const p of bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []) {
      dateUnion.add(p.date)
    }
  }
  const calendar = Array.from(dateUnion).sort()

  function calendarOffset(off: number): string | null {
    if (calendar.length === 0) return null
    const idx = calendar.length - 1 - off
    return idx >= 0 ? calendar[idx] : null
  }
  function calendarYTDDate(): string | null {
    if (!asOf) return null
    const cutoff = `${asOf.slice(0, 4)}-01-01`
    for (let i = calendar.length - 1; i >= 0; i--) {
      if (calendar[i] < cutoff) return calendar[i]
    }
    return null
  }

  const lookbackDates = {
    '1d':  calendarOffset(CHANGE_TD_OFFSETS['1d']),
    '5d':  calendarOffset(CHANGE_TD_OFFSETS['5d']),
    '1m':  calendarOffset(CHANGE_TD_OFFSETS['1m']),
    '3m':  calendarOffset(CHANGE_TD_OFFSETS['3m']),
    'ytd': calendarYTDDate(),
  }

  const tickers: CavSummaryTicker[] = KEYS.map((k) => {
    const arr = bySymbol.get(CROSS_ASSET_VOL_SYMBOLS[k]) ?? []
    const tickerLabel = k.toUpperCase()
    if (arr.length === 0) {
      return {
        ticker: tickerLabel,
        current: null,
        changes: { '1d': null, '5d': null, '1m': null, '3m': null, 'ytd': null },
        zscore: { '6m': null, '1y': null },
        ivRank: { '6m': null, '1y': null },
        ivPercentile: { '6m': null, '1y': null },
      }
    }
    const current = arr[arr.length - 1].close

    // Each ticker uses its own series for offsets. Per spec: if a ticker's
    // latest bar lags the global asOf, metrics still use the ticker's own
    // most-recent close. Returns the absolute point change (current − prior).
    function pointChange(off: number): number | null {
      const prior = priorClose(arr, off)
      if (!prior) return null
      return current - prior.close
    }

    const ytdBase = priorYearEndClose(arr)
    const ytdChange = ytdBase ? current - ytdBase.close : null

    const w6 = windowedStats(arr, SUMMARY_WINDOWS['6m'])
    const w1 = windowedStats(arr, SUMMARY_WINDOWS['1y'])

    return {
      ticker: tickerLabel,
      current: round2nullable(current),
      changes: {
        '1d':  round2nullable(pointChange(CHANGE_TD_OFFSETS['1d'])),
        '5d':  round2nullable(pointChange(CHANGE_TD_OFFSETS['5d'])),
        '1m':  round2nullable(pointChange(CHANGE_TD_OFFSETS['1m'])),
        '3m':  round2nullable(pointChange(CHANGE_TD_OFFSETS['3m'])),
        'ytd': round2nullable(ytdChange),
      },
      zscore: {
        '6m': w6.z != null ? Math.round(w6.z * 10000) / 10000 : null,
        '1y': w1.z != null ? Math.round(w1.z * 10000) / 10000 : null,
      },
      ivRank: {
        '6m': round2nullable(w6.rank),
        '1y': round2nullable(w1.rank),
      },
      ivPercentile: {
        '6m': round2nullable(w6.percentile),
        '1y': round2nullable(w1.percentile),
      },
    }
  })

  return { asOfDate: asOf, lookbackDates, tickers }
}
