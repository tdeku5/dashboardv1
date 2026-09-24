// Realized analogue of the ICE BofA MOVE index, computed from Treasury yields.
//
// Pure and dependency-free: no DB, no I/O, no clock. Everything here is a
// function of the yield points handed in. Persistence lives in
// server/src/usRatesRealizedVol.ts; the route only reads and derives.
//
// ── Construction ─────────────────────────────────────────────────────────────
// The MOVE is a curve-weighted average of normalized (basis-point) implied
// vol on 1-month Treasury options, weighted 20/20/40/20 across 2y/5y/10y/30y
// and quoted in annualized basis points. This mirrors that arithmetic exactly
// so the two series share an axis.
//
// Per tenor, over a rolling window of N = 21 trading days:
//
//   Δy_t   = (y_t − y_{t−1}) × 100          // yields quoted in percent → bp
//   σ_tenor = sqrt( (252 / N) × Σ Δy_t² )   // annualized bp, ZERO-MEAN
//
//   RMOVE = 0.20·σ_2y + 0.20·σ_5y + 0.40·σ_10y + 0.20·σ_30y
//
// The blend is a linear average OF THE VOLS, not the vol of a weighted yield
// portfolio. That is how the index itself is built, and matching its arithmetic
// is the entire point.
//
// ── Zero-mean is load-bearing. Do not "fix" this to sample variance. ─────────
// The daily changes are squared as they come: no mean subtraction, and an N
// (not N−1) denominator. The two estimators differ by exactly the squared mean,
// so centering always reports less vol, and what it removes is the window's
// directional drift. If 10s sell off a steady 2bp/day for a month, zero-mean
// reports ≈31.7bp annualized and centered reports ≈0 — yet that month paid a
// straddle holder daily, and the MOVE would not have printed zero.
//
// An option prices the expected SECOND MOMENT, not variance around a drift.
// Uncentered realized vol is the quantity that belongs on the same axis as an
// implied number. Over 21 observations the estimated mean also carries a
// standard error of ≈σ/√21 ≈ 22% of σ, so centering subtracts mostly noise,
// always downward.
//
// realizedMove.test.ts tests 1 and 2 exist to pin this. A centered
// implementation fails test 1.
//
// ── Ordering only — never filter by weekday ──────────────────────────────────
// `tv_series.time` is an epoch at midnight Europe/London, and the terminal
// labels bars by plain UTC truncation, so BST sessions carry the PREVIOUS
// calendar date: Monday sessions appear as Sunday and Fridays are undercounted.
// See docs/tradingview-date-convention.md. Consequently this module treats the
// input purely as an ordered sequence. Any getDay() filter, business-day
// calendar or weekend exclusion would silently drop real sessions and corrupt
// the 21-day window. realizedMove.test.ts pins this with a Sunday-labelled
// fixture.

// ── Constants ────────────────────────────────────────────────────────────────

/** Rolling window, in trading-day observations — matches the 1-month option tenor. */
export const RV_WINDOW_DAYS = 21

/** Annualization factor: trading days per year. */
export const TRADING_DAYS_PER_YEAR = 252

/**
 * Yield quoting convention, asserted here rather than inferred at the call site.
 * Phase 0-B verified against tv_series: US02Y/US05Y/US10Y/US30Y quote in
 * PERCENT (US10Y = 5.121, not 0.05121), and series_catalog independently
 * records units = '%'. A 0.01 move is therefore 1 basis point.
 */
export const YIELD_QUOTE_CONVENTION = 'percent' as const

/** Basis points per one unit of the quoting convention above. */
export const BP_PER_YIELD_UNIT = 100

export type TenorKey = '2y' | '5y' | '10y' | '30y'

/** Tenor order used for every per-tenor iteration and output. */
export const TENORS: readonly TenorKey[] = ['2y', '5y', '10y', '30y'] as const

/** MOVE curve weights. The one place these literals live. */
export const MOVE_WEIGHTS: Readonly<Record<TenorKey, number>> = {
  '2y': 0.20,
  '5y': 0.20,
  '10y': 0.40,
  '30y': 0.20,
} as const

// ── Types ────────────────────────────────────────────────────────────────────

/** One daily observation of a yield series, `value` in percent. */
export interface YieldPoint {
  date: string
  value: number
}

/** Rolling realized vol for a single tenor at a single date. */
export interface TenorVolPoint {
  date: string
  /** Annualized bp, or null when the trailing window is not exactly full. */
  sigma: number | null
  /** Valid Δy observations available in the trailing window (capped at N). */
  nObs: number
}

/** Result of blending per-tenor vols into the index. */
export interface BlendResult {
  rvMove: number | null
  /** True only when exactly one tenor was missing and weights were rescaled. */
  weightsRenormalized: boolean
  /** Tenors that contributed, in TENORS order. */
  contributing: TenorKey[]
  /** Weights actually applied, post-renormalization. Empty when rvMove is null. */
  appliedWeights: Partial<Record<TenorKey, number>>
}

/** One output row — shape mirrors the us_rates_realized_vol table. */
export interface RealizedMoveRow {
  date: string
  rv: Record<TenorKey, number | null>
  rvMove: number | null
  weightsRenormalized: boolean
  /** Max across tenors of the trailing-window Δy count. < N ⇒ short window. */
  nObs: number
}

/** Per-tenor input series, each ordered ascending by observation time. */
export type TenorSeries = Record<TenorKey, YieldPoint[]>

// ── Unit conversion ──────────────────────────────────────────────────────────

/**
 * Convert a yield difference expressed in the quoting convention into basis
 * points. With percent quoting, 0.01 → 1bp.
 */
export function toBasisPoints(yieldDiff: number): number {
  return yieldDiff * BP_PER_YIELD_UNIT
}

// ── Core: zero-mean realized vol ─────────────────────────────────────────────

/**
 * Annualized zero-mean realized vol from a window of daily changes in bp.
 *
 *   σ = sqrt( (252 / N) × Σ Δ² )
 *
 * Requires EXACTLY RV_WINDOW_DAYS finite observations. A short window returns
 * null — it is never scaled up to a full one, because a partial window
 * annualized as though it were complete is a fabricated number.
 */
export function realizedVolFromDeltas(deltasBp: readonly number[]): number | null {
  if (deltasBp.length !== RV_WINDOW_DAYS) return null
  let sumSq = 0
  for (const d of deltasBp) {
    if (!Number.isFinite(d)) return null
    // Zero-mean: square as-is. No mean subtraction. See the header note.
    sumSq += d * d
  }
  return Math.sqrt((TRADING_DAYS_PER_YEAR / RV_WINDOW_DAYS) * sumSq)
}

/**
 * Rolling realized vol across a yield series. Emits one point per input
 * observation, in input order, with sigma null until the trailing window holds
 * exactly RV_WINDOW_DAYS valid Δy.
 *
 * The series is consumed as an ORDERED SEQUENCE — consecutive observations are
 * differenced regardless of the calendar distance between their labels. Sort by
 * observation time before calling; do not filter by weekday.
 */
export function rollingRealizedVol(series: readonly YieldPoint[]): TenorVolPoint[] {
  const out: TenorVolPoint[] = []
  if (series.length === 0) return out

  // deltas[i] is the change INTO series[i+1]; aligned to the later observation.
  const deltas: number[] = []
  for (let i = 1; i < series.length; i++) {
    deltas.push(toBasisPoints(series[i].value - series[i - 1].value))
  }

  // The first observation has no preceding change at all.
  out.push({ date: series[0].date, sigma: null, nObs: 0 })

  for (let i = 1; i < series.length; i++) {
    const available = Math.min(i, RV_WINDOW_DAYS)
    if (i < RV_WINDOW_DAYS) {
      out.push({ date: series[i].date, sigma: null, nObs: available })
      continue
    }
    const window = deltas.slice(i - RV_WINDOW_DAYS, i)
    const sigma = realizedVolFromDeltas(window)
    out.push({ date: series[i].date, sigma, nObs: sigma === null ? available : RV_WINDOW_DAYS })
  }
  return out
}

// ── Blend ────────────────────────────────────────────────────────────────────

/**
 * Blend per-tenor vols into the index.
 *
 * - All four present: the stock 20/20/40/20 weights, flag false.
 * - Exactly one missing: the remaining three weights are rescaled to sum to 1
 *   and the flag is set (a missing 30y gives 0.25/0.25/0.50 across 2s/5s/10s).
 * - Two or more missing: null. At that point it is a different index, so it is
 *   not reported as this one. The flag stays false — nothing was renormalized.
 */
export function blendMove(sigmas: Readonly<Record<TenorKey, number | null>>): BlendResult {
  const present = TENORS.filter(t => {
    const v = sigmas[t]
    return v !== null && Number.isFinite(v)
  })
  const missingCount = TENORS.length - present.length

  if (missingCount >= 2) {
    return { rvMove: null, weightsRenormalized: false, contributing: [], appliedWeights: {} }
  }

  const weightSum = present.reduce((s, t) => s + MOVE_WEIGHTS[t], 0)
  if (weightSum <= 0) {
    return { rvMove: null, weightsRenormalized: false, contributing: [], appliedWeights: {} }
  }

  const appliedWeights: Partial<Record<TenorKey, number>> = {}
  let rvMove = 0
  for (const t of present) {
    const w = MOVE_WEIGHTS[t] / weightSum
    appliedWeights[t] = w
    rvMove += w * (sigmas[t] as number)
  }

  return {
    rvMove,
    weightsRenormalized: missingCount === 1,
    contributing: present,
    appliedWeights,
  }
}

// ── Series assembly ──────────────────────────────────────────────────────────

/**
 * Compute the full realized-MOVE series from four per-tenor yield series.
 *
 * Each tenor's rolling vol is computed over its OWN observation sequence, then
 * joined by date label. Dates are the union across tenors, so a tenor absent on
 * a date is simply missing there and the renormalization rule applies — no
 * forward-fill, no interpolation, no substitution of a neighbouring tenor.
 */
export function computeRealizedMoveSeries(input: TenorSeries): RealizedMoveRow[] {
  const byTenor: Record<TenorKey, Map<string, TenorVolPoint>> = {
    '2y': new Map(), '5y': new Map(), '10y': new Map(), '30y': new Map(),
  }
  const dates = new Set<string>()

  for (const t of TENORS) {
    for (const p of rollingRealizedVol(input[t])) {
      byTenor[t].set(p.date, p)
      dates.add(p.date)
    }
  }

  return Array.from(dates).sort().map(date => {
    const rv: Record<TenorKey, number | null> = { '2y': null, '5y': null, '10y': null, '30y': null }
    let nObs = 0
    for (const t of TENORS) {
      const p = byTenor[t].get(date)
      if (!p) continue
      rv[t] = p.sigma
      if (p.nObs > nObs) nObs = p.nObs
    }
    const blend = blendMove(rv)
    return { date, rv, rvMove: blend.rvMove, weightsRenormalized: blend.weightsRenormalized, nObs }
  })
}
