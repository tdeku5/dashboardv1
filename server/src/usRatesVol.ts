// US rates VOL page data: implied MOVE joined to the realized analogue, plus
// the derived premium metrics. I/O and assembly only — the arithmetic lives in
// lib/volPremium.ts and lib/realizedMove.ts.
//
// The join is an INNER join on date: a date is emitted only when BOTH an
// implied and a realized reading exist. Realized history reaches back to
// 1988-03-28 while MOVE starts 2002-11-12, so the early realized rows are
// dropped; the tip can also drop transiently when the ingest stale-tip filter
// withholds an unfilled MOVE bar (see docs/tradingview-date-convention.md).
// Both are real absences and are never filled in.
//
// Date labels follow the terminal's raw-UTC tv_series convention on both sides,
// so the join is exact. See docs/tradingview-date-convention.md.

import { db } from './db'
import { MOVE_WEIGHTS, TENORS, type TenorKey } from './lib/realizedMove'
import {
  PREMIUM_LOOKBACK_DAYS,
  computePremiumSeries,
  contributionBreakdown,
  renormalizedRanges,
  type ContributionRow,
  type FlaggedRange,
} from './lib/volPremium'
import { syncUsRatesRealizedVol, type SyncResult } from './usRatesRealizedVol'

/** tv_series symbol carrying the implied index. */
export const MOVE_SYMBOL = 'MOVE'

export type VolRangeKey = '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | 'all'

const RANGE_CAL_DAYS: Record<Exclude<VolRangeKey, 'ytd' | 'all'>, number> = {
  '1m': 30, '3m': 90, '6m': 180, '1y': 365, '2y': 730, '5y': 1825, '10y': 3650,
}

function shiftCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

function rangeStart(asOf: string, range: VolRangeKey, earliest: string): string {
  if (range === 'all') return earliest
  if (range === 'ytd') return `${asOf.slice(0, 4)}-01-01`
  return shiftCalendarDays(asOf, RANGE_CAL_DAYS[range])
}

export interface VolSeriesPoint {
  date: string
  move: number | null
  rvMove: number | null
  rv2y: number | null
  rv5y: number | null
  rv10y: number | null
  rv30y: number | null
  weightsRenormalized: boolean
  nObs: number
  premiumBp: number | null
  ratio: number | null
  premiumZ252: number | null
  ratioPct252: number | null
  premiumMean252: number | null
  premiumSd252: number | null
}

export interface VolLatest {
  date: string | null
  move: number | null
  rvMove: number | null
  premiumBp: number | null
  ratio: number | null
  premiumZ252: number | null
  ratioPct252: number | null
  weightsRenormalized: boolean
}

export interface VolJoinStats {
  realizedRows: number
  impliedRows: number
  joined: number
  /** Realized dates with no implied reading — pre-2002 history, plus any tip. */
  droppedRealizedOnly: number
  /** Implied dates with no realized reading. */
  droppedImpliedOnly: number
  /** The most recent few dropped realized-only dates, for the data-quality note. */
  recentRealizedOnlyDates: string[]
}

export interface UsRatesVolResponse {
  range: VolRangeKey
  /** Latest date carrying an implied reading (joined series). */
  asOfImplied: string | null
  /** Latest date carrying a realized reading, joined or not. */
  asOfRealized: string | null
  /** True when realized has printed for a session implied has not. */
  impliedTrailsRealized: boolean
  rangeStartDate: string | null
  lookbackDays: number
  series: VolSeriesPoint[]
  latest: VolLatest
  contributions: ContributionRow[]
  renormalizedRanges: FlaggedRange[]
  joinStats: VolJoinStats
}

interface JoinedRow {
  date: string
  move: number
  rv_2y: number | null
  rv_5y: number | null
  rv_10y: number | null
  rv_30y: number | null
  rv_move: number | null
  weights_renormalized: number
  n_obs: number
}

export function getUsRatesVol(range: VolRangeKey = '2y'): UsRatesVolResponse {
  // Inner join, expressed as such: the MOVE CTE relabels tv_series epochs with
  // the same raw-UTC truncation the realized table was written with.
  const rows = db.prepare(`
    WITH implied AS (
      SELECT date(CAST(time AS INTEGER), 'unixepoch') AS d, close AS move
      FROM tv_series
      WHERE symbol = ? AND close IS NOT NULL
    )
    SELECT r.date, i.move, r.rv_2y, r.rv_5y, r.rv_10y, r.rv_30y, r.rv_move,
           r.weights_renormalized, r.n_obs
    FROM us_rates_realized_vol r
    JOIN implied i ON i.d = r.date
    ORDER BY r.date ASC
  `).all(MOVE_SYMBOL) as JoinedRow[]

  const stats = db.prepare(`
    WITH implied AS (
      SELECT DISTINCT date(CAST(time AS INTEGER), 'unixepoch') AS d
      FROM tv_series WHERE symbol = ? AND close IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM us_rates_realized_vol)                                   AS realizedRows,
      (SELECT COUNT(*) FROM implied)                                                 AS impliedRows,
      (SELECT COUNT(*) FROM us_rates_realized_vol r JOIN implied i ON i.d = r.date)   AS joined,
      (SELECT COUNT(*) FROM us_rates_realized_vol r
        LEFT JOIN implied i ON i.d = r.date WHERE i.d IS NULL)                       AS droppedRealizedOnly,
      (SELECT COUNT(*) FROM implied i
        LEFT JOIN us_rates_realized_vol r ON i.d = r.date WHERE r.date IS NULL)       AS droppedImpliedOnly
  `).get(MOVE_SYMBOL) as Omit<VolJoinStats, 'recentRealizedOnlyDates'>

  const recentRealizedOnlyDates = (db.prepare(`
    WITH implied AS (
      SELECT DISTINCT date(CAST(time AS INTEGER), 'unixepoch') AS d
      FROM tv_series WHERE symbol = ? AND close IS NOT NULL
    )
    SELECT r.date FROM us_rates_realized_vol r
    LEFT JOIN implied i ON i.d = r.date
    WHERE i.d IS NULL ORDER BY r.date DESC LIMIT 5
  `).all(MOVE_SYMBOL) as Array<{ date: string }>).map(r => r.date)

  const asOfRealized = (db.prepare('SELECT MAX(date) AS d FROM us_rates_realized_vol')
    .get() as { d: string | null }).d

  // Derived metrics run over the FULL joined history, not the visible range, so
  // a 1M view still shows a true 252-day z-score rather than one computed from
  // 21 points.
  const derived = computePremiumSeries(
    rows.map(r => ({ date: r.date, move: r.move, rvMove: r.rv_move })),
  )

  const full: VolSeriesPoint[] = rows.map((r, i) => ({
    date: r.date,
    move: r.move,
    rvMove: r.rv_move,
    rv2y: r.rv_2y,
    rv5y: r.rv_5y,
    rv10y: r.rv_10y,
    rv30y: r.rv_30y,
    weightsRenormalized: r.weights_renormalized === 1,
    nObs: r.n_obs,
    premiumBp: derived[i].premiumBp,
    ratio: derived[i].ratio,
    premiumZ252: derived[i].premiumZ252,
    ratioPct252: derived[i].ratioPct252,
    premiumMean252: derived[i].premiumMean252,
    premiumSd252: derived[i].premiumSd252,
  }))

  const asOfImplied = full.length > 0 ? full[full.length - 1].date : null
  const earliest = full.length > 0 ? full[0].date : null

  const startDate = asOfImplied && earliest ? rangeStart(asOfImplied, range, earliest) : null
  const series = startDate === null ? [] : full.filter(p => p.date >= startDate)

  const last = full.length > 0 ? full[full.length - 1] : null
  const latest: VolLatest = {
    date: last?.date ?? null,
    move: last?.move ?? null,
    rvMove: last?.rvMove ?? null,
    premiumBp: last?.premiumBp ?? null,
    ratio: last?.ratio ?? null,
    premiumZ252: last?.premiumZ252 ?? null,
    ratioPct252: last?.ratioPct252 ?? null,
    weightsRenormalized: last?.weightsRenormalized ?? false,
  }

  // Contributions use the weights ACTUALLY applied on the latest date: the
  // stock 20/20/40/20, or the renormalized set when a tenor is missing.
  const latestRv: Record<TenorKey, number | null> = {
    '2y': last?.rv2y ?? null,
    '5y': last?.rv5y ?? null,
    '10y': last?.rv10y ?? null,
    '30y': last?.rv30y ?? null,
  }
  const presentWeightSum = TENORS.reduce(
    (s, t) => s + (latestRv[t] !== null ? MOVE_WEIGHTS[t] : 0), 0,
  )
  const contributions = contributionBreakdown(
    TENORS.map(t => ({
      tenor: t,
      weight: latestRv[t] === null || presentWeightSum <= 0 ? 0 : MOVE_WEIGHTS[t] / presentWeightSum,
      rv: latestRv[t],
    })),
  )

  return {
    range,
    asOfImplied,
    asOfRealized,
    impliedTrailsRealized:
      asOfImplied !== null && asOfRealized !== null && asOfRealized > asOfImplied,
    rangeStartDate: series.length > 0 ? series[0].date : null,
    lookbackDays: PREMIUM_LOOKBACK_DAYS,
    series,
    latest,
    contributions,
    renormalizedRanges: renormalizedRanges(series),
    joinStats: { ...stats, recentRealizedOnlyDates },
  }
}

/**
 * Manual refresh. Mitigates the known cron-misses-when-the-machine-sleeps
 * problem — the scheduled job is the primary path, this is the escape hatch.
 */
export function refreshUsRatesVol(): SyncResult {
  return syncUsRatesRealizedVol()
}
