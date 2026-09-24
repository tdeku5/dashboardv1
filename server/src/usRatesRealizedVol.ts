// Persistence and refresh for the realized MOVE index.
//
// Reads TradingView 2y/5y/10y/30y yields out of tv_series, hands them to the
// pure calculator in lib/realizedMove.ts, and upserts into us_rates_realized_vol.
// This module owns I/O only — every formula lives in the calculator.
//
// ── Date labelling ──────────────────────────────────────────────────────────
// tsToDate below is plain UTC truncation, matching crossAssetVol.tsToDate,
// hephaestus/render.epochToIso and routes/global.tsToDate. tv_series epochs are
// midnight Europe/London, so BST sessions are labelled one calendar day early
// (Monday sessions appear as Sunday). This is a KNOWN, DELIBERATE inheritance:
// the whole point of the VOL page is a difference between this table and the
// MOVE series in tv_series, and Hephaestus overlays them by date label, so a
// divergent convention here would draw the two lines a day apart on every BST
// date. See docs/tradingview-date-convention.md.
//
// Corollary: nothing here may filter rows by weekday. Order by epoch and take
// observations as they come.

import { db } from './db'
import {
  TENORS,
  computeRealizedMoveSeries,
  type RealizedMoveRow,
  type TenorKey,
  type TenorSeries,
  type YieldPoint,
} from './lib/realizedMove'

/** tv_series symbols backing each tenor, verified in Phase 0-B. */
export const TENOR_SYMBOLS: Readonly<Record<TenorKey, string>> = {
  '2y': 'US02Y',
  '5y': 'US05Y',
  '10y': 'US10Y',
  '30y': 'US30Y',
} as const

/**
 * Trailing output window recomputed by an incremental run. Generous on purpose:
 * re-deriving 40 dates is a few thousand multiplications against an already-warm
 * table, so the job is cheap enough to run every few hours.
 */
export const INCREMENTAL_WINDOW_DAYS = 40

/** Observations loaded per tenor on an incremental run: the window plus its lead-in. */
const INCREMENTAL_LOAD_OBS = INCREMENTAL_WINDOW_DAYS + 21 + 20

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

interface TvRow { time: string; close: number }

/**
 * Load a tenor's yield history ascending. `limitObs` takes the most recent N
 * observations; omit for the full series.
 */
function loadTenor(symbol: string, limitObs?: number): YieldPoint[] {
  const rows = limitObs === undefined
    ? db.prepare(`
        SELECT time, close FROM tv_series
        WHERE symbol = ? AND close IS NOT NULL
        ORDER BY CAST(time AS INTEGER) ASC
      `).all(symbol) as TvRow[]
    : (db.prepare(`
        SELECT time, close FROM tv_series
        WHERE symbol = ? AND close IS NOT NULL
        ORDER BY CAST(time AS INTEGER) DESC
        LIMIT ?
      `).all(symbol, limitObs) as TvRow[]).reverse()

  return rows.map(r => ({ date: tsToDate(parseInt(r.time, 10)), value: r.close }))
}

function loadAllTenors(limitObs?: number): { series: TenorSeries; rowsScanned: number } {
  const series = {} as TenorSeries
  let rowsScanned = 0
  for (const t of TENORS) {
    const points = loadTenor(TENOR_SYMBOLS[t], limitObs)
    series[t] = points
    rowsScanned += points.length
  }
  return { series, rowsScanned }
}

// ── Persisted row shape ──────────────────────────────────────────────────────

export interface RealizedVolRow {
  date: string
  rv_2y: number | null
  rv_5y: number | null
  rv_10y: number | null
  rv_30y: number | null
  rv_move: number | null
  weights_renormalized: number
  n_obs: number
  updated_at: string | null
}

function toDbRow(r: RealizedMoveRow): Omit<RealizedVolRow, 'updated_at'> {
  return {
    date: r.date,
    rv_2y: r.rv['2y'],
    rv_5y: r.rv['5y'],
    rv_10y: r.rv['10y'],
    rv_30y: r.rv['30y'],
    rv_move: r.rvMove,
    weights_renormalized: r.weightsRenormalized ? 1 : 0,
    n_obs: r.nObs,
  }
}

const VALUE_COLS = ['rv_2y', 'rv_5y', 'rv_10y', 'rv_30y', 'rv_move'] as const

/** True when the candidate is byte-identical to what is already stored. */
function unchanged(existing: RealizedVolRow, next: Omit<RealizedVolRow, 'updated_at'>): boolean {
  for (const c of VALUE_COLS) {
    if (existing[c] !== next[c]) return false
  }
  return existing.weights_renormalized === next.weights_renormalized && existing.n_obs === next.n_obs
}

/**
 * True when writing `next` would replace a stored number with null. A transient
 * empty read must never erase a real computed value, so these are skipped.
 */
function wouldNullOutStoredValue(existing: RealizedVolRow, next: Omit<RealizedVolRow, 'updated_at'>): boolean {
  return VALUE_COLS.some(c => existing[c] !== null && next[c] === null)
}

export interface SyncResult {
  mode: 'backfill' | 'incremental'
  rowsScanned: number
  datesComputed: number
  datesUpserted: number
  datesSkippedUnchanged: number
  datesSkippedProtected: number
  latestDate: string | null
}

/**
 * Compute and upsert. Idempotent: a run over unchanged data writes nothing.
 *
 * First run (empty table) backfills from the earliest date on which ALL FOUR
 * tenors have a complete 21-day window; earlier dates, where the blend could
 * only ever be a partial index, are not written at all. Subsequent runs
 * recompute the trailing INCREMENTAL_WINDOW_DAYS output dates and upsert.
 */
export function syncUsRatesRealizedVol(): SyncResult {
  const existingCount = (db.prepare('SELECT COUNT(*) AS n FROM us_rates_realized_vol')
    .get() as { n: number }).n
  const mode: SyncResult['mode'] = existingCount === 0 ? 'backfill' : 'incremental'

  const { series, rowsScanned } = loadAllTenors(mode === 'backfill' ? undefined : INCREMENTAL_LOAD_OBS)
  const computed = computeRealizedMoveSeries(series)

  let candidates: RealizedMoveRow[]
  if (mode === 'backfill') {
    // Clamp to the first date where every tenor has a full window — before that
    // the index is structurally incomplete rather than merely missing a print.
    const firstComplete = computed.findIndex(r => TENORS.every(t => r.rv[t] !== null))
    candidates = firstComplete === -1 ? [] : computed.slice(firstComplete)
  } else {
    candidates = computed.slice(-INCREMENTAL_WINDOW_DAYS)
  }

  const upsert = db.prepare(`
    INSERT INTO us_rates_realized_vol
      (date, rv_2y, rv_5y, rv_10y, rv_30y, rv_move, weights_renormalized, n_obs, updated_at)
    VALUES
      (@date, @rv_2y, @rv_5y, @rv_10y, @rv_30y, @rv_move, @weights_renormalized, @n_obs, @updated_at)
    ON CONFLICT(date) DO UPDATE SET
      rv_2y                = excluded.rv_2y,
      rv_5y                = excluded.rv_5y,
      rv_10y               = excluded.rv_10y,
      rv_30y               = excluded.rv_30y,
      rv_move              = excluded.rv_move,
      weights_renormalized = excluded.weights_renormalized,
      n_obs                = excluded.n_obs,
      updated_at           = excluded.updated_at
  `)
  const getExisting = db.prepare('SELECT * FROM us_rates_realized_vol WHERE date = ?')
  const now = new Date().toISOString()

  let datesUpserted = 0
  let datesSkippedUnchanged = 0
  let datesSkippedProtected = 0

  db.transaction(() => {
    for (const r of candidates) {
      const next = toDbRow(r)
      const existing = getExisting.get(r.date) as RealizedVolRow | undefined
      if (existing) {
        if (unchanged(existing, next)) { datesSkippedUnchanged++; continue }
        if (wouldNullOutStoredValue(existing, next)) { datesSkippedProtected++; continue }
      }
      upsert.run({ ...next, updated_at: now })
      datesUpserted++
    }
  })()

  const latestDate = (db.prepare('SELECT MAX(date) AS d FROM us_rates_realized_vol')
    .get() as { d: string | null }).d

  const result: SyncResult = {
    mode, rowsScanned,
    datesComputed: candidates.length,
    datesUpserted, datesSkippedUnchanged, datesSkippedProtected,
    latestDate,
  }

  // Logged on every run, including no-op runs: when TradingView data goes stale
  // upstream, a run that computes 40 dates and upserts 0 with an unmoved
  // latestDate is what makes the staleness visibly upstream of this job.
  const protectedNote = datesSkippedProtected > 0
    ? `, ${datesSkippedProtected} protected (would have nulled a stored value)`
    : ''
  if (datesUpserted === 0) {
    console.log(
      `[us-rates-rv] ${mode}: scanned ${rowsScanned} tv_series rows, computed ${result.datesComputed} dates, ` +
      `nothing new to write (${datesSkippedUnchanged} unchanged${protectedNote}). Latest: ${latestDate ?? 'none'}`
    )
  } else {
    console.log(
      `[us-rates-rv] ${mode}: scanned ${rowsScanned} tv_series rows, computed ${result.datesComputed} dates, ` +
      `upserted ${datesUpserted} (${datesSkippedUnchanged} unchanged${protectedNote}). Latest: ${latestDate ?? 'none'}`
    )
  }
  return result
}

// ── Readers ──────────────────────────────────────────────────────────────────

export function getUsRatesRealizedVol(from?: string, to?: string): RealizedVolRow[] {
  const params: unknown[] = []
  let where = ''
  if (from) { where += `${where ? ' AND' : ' WHERE'} date >= ?`; params.push(from) }
  if (to) { where += `${where ? ' AND' : ' WHERE'} date <= ?`; params.push(to) }
  return db.prepare(
    `SELECT * FROM us_rates_realized_vol${where} ORDER BY date ASC`
  ).all(...params) as RealizedVolRow[]
}

export interface RealizedVolCoverage {
  rowCount: number
  firstDate: string | null
  lastDate: string | null
  renormalizedCount: number
}

export function getRealizedVolCoverage(): RealizedVolCoverage {
  return db.prepare(`
    SELECT COUNT(*)                                  AS rowCount,
           MIN(date)                                 AS firstDate,
           MAX(date)                                 AS lastDate,
           COALESCE(SUM(weights_renormalized), 0)    AS renormalizedCount
    FROM us_rates_realized_vol
  `).get() as RealizedVolCoverage
}
