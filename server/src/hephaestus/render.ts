// Hephaestus render engine — the ONE place chart specs become data. Both the
// chat preview and saved charts call renderSpec(); there is no second path.
// The model never touches this layer: table and column names come from the
// hardcoded resolution map below (keyed by the catalog row's source_table),
// series ids are bound as SQL parameters, and the uk_hpi metric column is
// whitelisted — nothing model-authored is ever interpolated into SQL.
//
// ── Frequency-alignment rule (documented contract) ──────────────────────────
// Series of different frequencies are merged by OUTER JOIN on ISO date:
// every date that appears in any series becomes a row; series without an
// observation on that date carry null. There is NO interpolation, forward-fill
// or resampling — the renderer never manufactures values. The client renders
// lines with connectNulls, which visually bridges the gaps between a monthly
// series' points when plotted against a daily one.
//
// Freshness: only FRED-backed series_observations rows are refreshed (via the
// same ensureFresh used by /api/fred — per-series lock + negative cache).
// BEA_* rows share that table but are NOT FRED series; the catalog's
// data_source field is the gate. A refresh failure downgrades to a warning —
// stored data is served rather than failing the chart.

import { db } from '../db'
import { ensureFresh as fredEnsureFresh } from '../routes/fred'
import type { CatalogRow, ChartSpecV1, SeriesInput, Transform } from './chartSpec'
import { lookupCatalog, listParams } from './catalogSearch'
import { applyTransform, computeDerived, frequencyBucket } from './transforms'

export const MAX_POINTS_PER_SERIES = 15000

export interface Point { date: string; value: number }

interface FetchOpts { from?: string; to?: string; limit?: number }

// ── Per-table resolution ─────────────────────────────────────────────────────

// Tables shaped {idCol, dateCol, valueCol} — one row per (id, date).
const SIMPLE_SOURCES: Record<string, { idCol: string; dateCol: string; valueCol: string }> = {
  series_observations:       { idCol: 'series_id',    dateCol: 'date',        valueCol: 'value' },
  ons_observations:          { idCol: 'cdid',         dateCol: 'date',        valueCol: 'value' },
  eurostat_observations:     { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  ecb_observations:          { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  statcan_observations:      { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  estat_observations:        { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  au_macro_series:           { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  bojts_observations:        { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  overnight_rates:           { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  boe_observations:          { idCol: 'series_code',  dateCol: 'date',        valueCol: 'value' },
  hmrc_receipts:             { idCol: 'tax_head',     dateCol: 'date',        valueCol: 'value' },
  census_trade_observations: { idCol: 'series_id',    dateCol: 'date',        valueCol: 'value' },
  paye_rti:                  { idCol: 'metric',       dateCol: 'date',        valueCol: 'value' },
  sce_inflation_expectations:{ idCol: 'horizon',      dateCol: 'date',        valueCol: 'median_value' },
  dts_tax_deposits:          { idCol: 'deposit_type', dateCol: 'record_date', valueCol: 'amount' },
}

// uk_hpi is wide (one column per metric); whitelist prevents any non-metric
// identifier reaching the SELECT list.
const UK_HPI_METRICS = new Set([
  'average_price', 'average_price_sa', 'index_value', 'index_sa', 'annual_change',
  'monthly_change', 'price_detached', 'price_semi', 'price_terraced', 'price_flat', 'sales_volume',
])

function fetchAscWithWindow(sql: string, params: unknown[]): Point[] {
  // Queries are written ORDER BY date DESC LIMIT n so the cap keeps the most
  // recent points; reverse restores chronological order.
  const rows = db.prepare(sql).all(...params) as Array<{ date: string; value: number }>
  rows.reverse()
  return rows
}

function fetchSimple(cfg: { idCol: string; dateCol: string; valueCol: string }, table: string, id: string, opts: FetchOpts): Point[] {
  const params: unknown[] = [id]
  let where = `${cfg.idCol} = ? AND ${cfg.valueCol} IS NOT NULL`
  if (opts.from) { where += ` AND ${cfg.dateCol} >= ?`; params.push(opts.from) }
  if (opts.to) { where += ` AND ${cfg.dateCol} <= ?`; params.push(opts.to) }
  params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
  return fetchAscWithWindow(
    `SELECT ${cfg.dateCol} AS date, ${cfg.valueCol} AS value FROM ${table} WHERE ${where} ORDER BY ${cfg.dateCol} DESC LIMIT ?`,
    params,
  )
}

function isoToEpoch(iso: string, endOfDay: boolean): number {
  return Math.floor(Date.parse(`${iso}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) / 1000)
}

function epochToIso(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// tv_series / tv_ohlcv store `time` as epoch-second strings — lexicographic
// ordering is wrong; always CAST (same pattern as routes/tvYieldCurve.ts).
function fetchTv(table: 'tv_series' | 'tv_ohlcv', symbol: string, opts: FetchOpts): Point[] {
  const params: unknown[] = [symbol]
  let where = `symbol = ? AND close IS NOT NULL`
  if (table === 'tv_ohlcv') { where += ` AND timeframe = '1D'` }
  if (opts.from) { where += ` AND CAST(time AS INTEGER) >= ?`; params.push(isoToEpoch(opts.from, false)) }
  if (opts.to) { where += ` AND CAST(time AS INTEGER) <= ?`; params.push(isoToEpoch(opts.to, true)) }
  params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
  const rows = db.prepare(
    `SELECT time, close FROM ${table} WHERE ${where} ORDER BY CAST(time AS INTEGER) DESC LIMIT ?`
  ).all(...params) as Array<{ time: string; close: number }>
  rows.reverse()
  return rows.map(r => ({ date: epochToIso(parseInt(r.time, 10)), value: r.close }))
}

/**
 * Fetch the points for one catalog entry (+ param where applicable).
 * Throws with a descriptive message for shapes v1 cannot render.
 */
export function fetchSeriesPoints(row: CatalogRow, param: string | undefined, opts: FetchOpts = {}): Point[] {
  // Contract families: param is the member contract symbol in tv_series.
  if (row.series_kind === 'contract_family' && row.source_table === 'tv_series') {
    if (!param) throw new Error(`'${row.series_id}' requires a contract symbol param`)
    return fetchTv('tv_series', param, opts)
  }

  switch (row.source_table) {
    case 'tv_series':
      return fetchTv('tv_series', row.series_id, opts)
    case 'tv_ohlcv':
      return fetchTv('tv_ohlcv', row.series_id, opts)

    case 'uk_hpi': {
      // series_id = UKHPI:{region}:{metric}
      const parts = row.series_id.split(':')
      const metric = parts[2]
      const region = parts[1]
      if (parts.length !== 3 || !UK_HPI_METRICS.has(metric)) {
        throw new Error(`unrecognized uk_hpi series_id shape: '${row.series_id}'`)
      }
      const params: unknown[] = [region]
      let where = `region = ? AND ${metric} IS NOT NULL`
      if (opts.from) { where += ' AND date >= ?'; params.push(opts.from) }
      if (opts.to) { where += ' AND date <= ?'; params.push(opts.to) }
      params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
      return fetchAscWithWindow(
        `SELECT date, ${metric} AS value FROM uk_hpi WHERE ${where} ORDER BY date DESC LIMIT ?`,
        params,
      )
    }

    case 'ons_gdp_contributions': {
      // series_id = "{sector} [{period_type}]"
      const m = /^(.+) \[(.+)\]$/.exec(row.series_id)
      if (!m) throw new Error(`unrecognized ons_gdp_contributions series_id shape: '${row.series_id}'`)
      const params: unknown[] = [m[1], m[2]]
      let where = 'sector = ? AND period_type = ? AND value IS NOT NULL'
      if (opts.from) { where += ' AND date >= ?'; params.push(opts.from) }
      if (opts.to) { where += ' AND date <= ?'; params.push(opts.to) }
      params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
      return fetchAscWithWindow(
        `SELECT date, value FROM ons_gdp_contributions WHERE ${where} ORDER BY date DESC LIMIT ?`,
        params,
      )
    }

    case 'gilt_yield_curve': {
      // series_id = GILT_CURVE:{curve_type}; param = maturity in years.
      if (!param) throw new Error(`'${row.series_id}' requires a maturity param`)
      const maturity = Number(param)
      if (!Number.isFinite(maturity)) throw new Error(`gilt maturity param '${param}' is not a number`)
      const curveType = row.series_id.replace(/^GILT_CURVE:/, '')
      const params: unknown[] = [curveType, maturity]
      // Maturities are REALs generated from month grids; exact bind matches the
      // values list_params returned (both round-trip through the same storage).
      let where = 'curve_type = ? AND maturity = ? AND value IS NOT NULL'
      if (opts.from) { where += ' AND date >= ?'; params.push(opts.from) }
      if (opts.to) { where += ' AND date <= ?'; params.push(opts.to) }
      params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
      return fetchAscWithWindow(
        `SELECT date, value FROM gilt_yield_curve WHERE ${where} ORDER BY date DESC LIMIT ?`,
        params,
      )
    }

    case 'mts_fiscal_balance': {
      const params: unknown[] = []
      let where = 'monthly_amount IS NOT NULL'
      if (opts.from) { where += ' AND record_date >= ?'; params.push(opts.from) }
      if (opts.to) { where += ' AND record_date <= ?'; params.push(opts.to) }
      params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
      return fetchAscWithWindow(
        `SELECT record_date AS date, monthly_amount AS value FROM mts_fiscal_balance WHERE ${where} ORDER BY record_date DESC LIMIT ?`,
        params,
      )
    }

    case 'umich_inflation_expectations': {
      const params: unknown[] = []
      let where = 'px5 IS NOT NULL'
      if (opts.from) { where += ' AND date >= ?'; params.push(opts.from) }
      if (opts.to) { where += ' AND date <= ?'; params.push(opts.to) }
      params.push(opts.limit ?? MAX_POINTS_PER_SERIES)
      return fetchAscWithWindow(
        `SELECT date, px5 AS value FROM umich_inflation_expectations WHERE ${where} ORDER BY date DESC LIMIT ?`,
        params,
      )
    }

    default: {
      const cfg = SIMPLE_SOURCES[row.source_table]
      if (!cfg) throw new Error(`source_table '${row.source_table}' is not renderable in v1`)
      return fetchSimple(cfg, row.source_table, row.series_id, opts)
    }
  }
}

// ── Spec → chart data ────────────────────────────────────────────────────────

export interface RenderedSeries {
  key: string               // rows column key: s0, s1, …
  kind: 'direct' | 'derived'
  id: string                // direct: series_id; derived: "a.id op b.id"
  param?: string
  label: string
  axis: 'left' | 'right'
  units: string | null
  frequency: string | null
  seasonal_adjustment: string | null
  transform: Transform['type']
  pointCount: number
}

export interface RenderResult {
  title: string
  series: RenderedSeries[]
  /** Outer-joined rows, ascending ISO date; missing observations are null. */
  rows: Array<{ date: string } & Record<string, number | null | string>>
  leftAxisLabel?: string
  rightAxisLabel?: string
  warnings: string[]
}

export interface RenderDeps {
  lookup: (id: string) => CatalogRow | undefined
  fetchPoints: (row: CatalogRow, param: string | undefined, opts: FetchOpts) => Point[]
  /** Refresh hook — called ONLY for data_source === 'FRED' rows. */
  ensureFresh: (seriesId: string) => Promise<void>
}

export function defaultRenderDeps(): RenderDeps {
  return { lookup: lookupCatalog, fetchPoints: fetchSeriesPoints, ensureFresh: fredEnsureFresh }
}

export async function renderSpec(spec: ChartSpecV1, deps: RenderDeps = defaultRenderDeps()): Promise<RenderResult> {
  const warnings: string[] = []
  const series: RenderedSeries[] = []
  const perSeriesPoints: Point[][] = []

  // Resolve one input ref: catalog lookup, FRED-only freshness gate, fetch.
  // Fetched WITHOUT the `from` bound so lookback transforms (yoy/mom/diff/
  // rolling) have history to compute against; the range is applied after.
  const resolveInput = async (input: SeriesInput, path: string): Promise<{ row: CatalogRow; points: Point[] }> => {
    const row = deps.lookup(input.id)
    if (!row) throw new Error(`${path} '${input.id}' is not in the series catalog`)

    // FRED-only freshness gate: BEA_* ids live in series_observations too but
    // must never trigger a FRED API call (data_source distinguishes them).
    if (row.data_source === 'FRED' && row.source_table === 'series_observations') {
      try {
        await deps.ensureFresh(row.series_id)
      } catch (err) {
        warnings.push(`FRED refresh failed for ${row.series_id} (${err instanceof Error ? err.message : String(err)}) — serving stored data`)
      }
    }

    const points = deps.fetchPoints(row, input.param, { to: spec.to })
    // The cap keeps the most recent points; only warn when the truncation
    // actually cuts into the requested range (earliest kept point is later
    // than `from`, or no `from` was given at all).
    if (points.length >= MAX_POINTS_PER_SERIES && (!spec.from || (points[0] && points[0].date > spec.from))) {
      const w = `'${input.id}' hit the ${MAX_POINTS_PER_SERIES}-point cap — oldest points truncated`
      if (!warnings.includes(w)) warnings.push(w)
    }
    return { row, points }
  }

  const applyRange = (points: Point[]): Point[] =>
    spec.from ? points.filter(p => p.date >= spec.from!) : points

  for (const [i, s] of spec.series.entries()) {
    let points: Point[]
    let meta: Pick<RenderedSeries, 'kind' | 'id' | 'param' | 'label' | 'units' | 'frequency' | 'seasonal_adjustment'>

    if (s.kind === 'derived') {
      const [ra, rb] = [await resolveInput(s.a, `series[${i}].a`), await resolveInput(s.b, `series[${i}].b`)]
      // Derived ops compute ONLY on shared native observation dates (no fill).
      // Mixed input frequencies therefore yield at most the coarser frequency.
      const fa = frequencyBucket(ra.row.frequency)
      const fb = frequencyBucket(rb.row.frequency)
      const mixedFreq = fa !== null && fb !== null && fa !== fb
      if (mixedFreq) {
        warnings.push(`'${s.label}' mixes ${fa} and ${fb} inputs — derived points exist only on shared observation dates (at most ${fb === 'daily' ? fa : fb})`)
      }
      points = computeDerived(s.op, ra.points, rb.points)
      meta = {
        kind: 'derived',
        id: `${s.a.id} ${s.op} ${s.b.id}`,
        param: undefined,
        label: s.label,
        units: s.op === 'ratio' ? 'ratio' : (ra.row.units === rb.row.units ? ra.row.units : null),
        frequency: mixedFreq ? `mixed (${fa} / ${fb})` : ra.row.frequency,
        seasonal_adjustment: ra.row.seasonal_adjustment === rb.row.seasonal_adjustment ? (ra.row.seasonal_adjustment ?? null) : 'mixed',
      }
    } else {
      const r = await resolveInput(s, `series[${i}]`)
      points = r.points
      meta = {
        kind: 'direct',
        id: s.id,
        param: s.param,
        label: s.label ?? r.row.description ?? s.id,
        units: r.row.units,
        frequency: r.row.frequency,
        seasonal_adjustment: r.row.seasonal_adjustment ?? null,
      }
    }

    // Transform/range ordering: lookback transforms (yoy/mom/diff/rolling/
    // zscore) run BEFORE the range cut so they can see pre-range history;
    // rebase100 runs AFTER it — its base is the first point IN RANGE.
    const t = s.transform
    const needsHistory = t !== undefined && t.type !== 'level' && t.type !== 'rebase100'
    points = needsHistory
      ? applyRange(applyTransform(points, t))
      : applyTransform(applyRange(points), t)
    if (points.length === 0) warnings.push(`'${meta.label}' returned no observations in the requested range`)

    series.push({
      key: `s${i}`,
      ...meta,
      axis: s.axis ?? 'left',
      transform: s.transform?.type ?? 'level',
      pointCount: points.length,
    })
    perSeriesPoints.push(points)
  }

  // Outer join on ISO date (see frequency-alignment rule at top of file).
  const byDate = new Map<string, Record<string, number | null>>()
  perSeriesPoints.forEach((points, i) => {
    const key = `s${i}`
    for (const p of points) {
      let row = byDate.get(p.date)
      if (!row) { row = {}; byDate.set(p.date, row) }
      row[key] = p.value
    }
  })
  const dates = [...byDate.keys()].sort()
  const nullTemplate: Record<string, null> = {}
  series.forEach(s => { nullTemplate[s.key] = null })
  const rows = dates.map(date => ({ date, ...nullTemplate, ...byDate.get(date) }))

  return {
    title: spec.title,
    series,
    rows,
    leftAxisLabel: spec.leftAxisLabel,
    rightAxisLabel: spec.rightAxisLabel,
    warnings,
  }
}
