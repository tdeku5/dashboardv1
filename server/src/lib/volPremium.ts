// Derived comparison metrics for the US rates VOL page: implied MOVE against
// the realized analogue produced by lib/realizedMove.ts.
//
// Pure and dependency-free — no DB, no clock. The DB join lives in
// server/src/usRatesVol.ts and the route only shapes the response.
//
// ── Alignment (contemporaneous) ─────────────────────────────────────────────
// MOVE at date t prices volatility over the FORWARD window [t, t+21]; the
// trailing realized vol at t measures [t−21, t]. This compares them at the same
// date, which is standard practice and the only version computable up to the
// current session. The page states the convention rather than hiding it.
//
// ── These z-scores are CENTERED, and that is correct ────────────────────────
// Do not carry the zero-mean rule over from realizedMove.ts. That rule applies
// to a realized-VOLATILITY estimator, where the quantity being estimated is the
// second moment an option prices. Here we are standardising a LEVEL (the
// premium in bp) against its own recent distribution, and "how unusual is this
// value relative to its mean" is exactly a centered, Bessel-corrected z-score.
// This matches the existing precedent in crossAssetVol.rollingZ. Two different
// questions, two different estimators — neither is a bug in the other.

/** Trailing window for the z-score and percentile rank, in observations. */
export const PREMIUM_LOOKBACK_DAYS = 252

export interface PremiumInput {
  date: string
  /** Implied MOVE level, annualized bp. */
  move: number | null
  /** Realized blended index, annualized bp. */
  rvMove: number | null
}

export interface PremiumPoint {
  date: string
  move: number | null
  rvMove: number | null
  /** MOVE − RMOVE, annualized bp. Positive = implied above realized. */
  premiumBp: number | null
  /** MOVE / RMOVE. Null when RMOVE is 0 or null. */
  ratio: number | null
  /** z-score of premiumBp over the trailing 252 observations, inclusive. */
  premiumZ252: number | null
  /** Percentile rank of ratio over the trailing 252 observations, inclusive. */
  ratioPct252: number | null
  /** Trailing-252 mean of premiumBp — the centre line for the ±σ bands. */
  premiumMean252: number | null
  /** Trailing-252 sample stdev of premiumBp — the band unit. */
  premiumSd252: number | null
}

/** Premium and ratio for a single date. */
export function premiumAndRatio(move: number | null, rvMove: number | null): {
  premiumBp: number | null
  ratio: number | null
} {
  if (move === null || rvMove === null || !Number.isFinite(move) || !Number.isFinite(rvMove)) {
    return { premiumBp: null, ratio: null }
  }
  return {
    premiumBp: move - rvMove,
    // Guard the divide explicitly: a zero realized reading would otherwise
    // produce Infinity, which serialises to null in JSON and silently looks
    // like missing data rather than a degenerate input.
    ratio: rvMove === 0 ? null : move / rvMove,
  }
}

/**
 * Trailing-window mean and sample stdev, ending at (and including) index `end`.
 * Returns nulls unless the window is entirely non-null and full length.
 */
function trailingStats(values: ReadonlyArray<number | null>, end: number, window: number): {
  mean: number | null
  sd: number | null
} {
  const start = end - window + 1
  if (start < 0) return { mean: null, sd: null }
  let sum = 0
  for (let i = start; i <= end; i++) {
    const v = values[i]
    if (v === null || !Number.isFinite(v)) return { mean: null, sd: null }
    sum += v
  }
  const mean = sum / window
  let sse = 0
  for (let i = start; i <= end; i++) {
    const d = (values[i] as number) - mean
    sse += d * d
  }
  // Bessel-corrected: standardising a level against its own sample. See header.
  const sd = Math.sqrt(Math.max(0, sse / (window - 1)))
  return { mean, sd }
}

/**
 * Percentile rank of values[end] within the trailing window, as the share of
 * observations strictly below it, × 100. Matches crossAssetVol.windowedStats.
 */
function trailingPercentile(values: ReadonlyArray<number | null>, end: number, window: number): number | null {
  const start = end - window + 1
  if (start < 0) return null
  const current = values[end]
  if (current === null || !Number.isFinite(current)) return null
  let below = 0
  for (let i = start; i <= end; i++) {
    const v = values[i]
    if (v === null || !Number.isFinite(v)) return null
    if (v < current) below++
  }
  return (below / window) * 100
}

/**
 * Compute the full derived series. Input must be ascending by date and should
 * already be inner-joined — but nulls are tolerated and simply propagate,
 * nulling any trailing window that contains one.
 */
export function computePremiumSeries(
  input: ReadonlyArray<PremiumInput>,
  lookback: number = PREMIUM_LOOKBACK_DAYS,
): PremiumPoint[] {
  const premiums: Array<number | null> = []
  const ratios: Array<number | null> = []
  for (const p of input) {
    const { premiumBp, ratio } = premiumAndRatio(p.move, p.rvMove)
    premiums.push(premiumBp)
    ratios.push(ratio)
  }

  return input.map((p, i) => {
    const { mean, sd } = trailingStats(premiums, i, lookback)
    const premium = premiums[i]
    return {
      date: p.date,
      move: p.move,
      rvMove: p.rvMove,
      premiumBp: premium,
      ratio: ratios[i],
      premiumZ252:
        mean !== null && sd !== null && sd > 0 && premium !== null
          ? (premium - mean) / sd
          : null,
      ratioPct252: trailingPercentile(ratios, i, lookback),
      premiumMean252: mean,
      premiumSd252: sd,
    }
  })
}

// ── Contribution breakdown ───────────────────────────────────────────────────

export interface ContributionRow {
  tenor: string
  weight: number
  rv: number | null
  /** weight × rv — the tenor's additive contribution to the blend. */
  contribution: number | null
  /** contribution as a share of the blend, in percent. */
  sharePct: number | null
}

/**
 * Per-tenor contribution to the blend on one date, using the weights actually
 * applied (renormalized ones when a tenor is missing). Shares are computed
 * against the sum of contributions, so they total 100% whether or not the
 * weights were renormalized.
 */
export function contributionBreakdown(
  tenors: ReadonlyArray<{ tenor: string; weight: number; rv: number | null }>,
): ContributionRow[] {
  const rows = tenors.map(t => ({
    tenor: t.tenor,
    weight: t.weight,
    rv: t.rv,
    contribution: t.rv === null || !Number.isFinite(t.rv) ? null : t.weight * t.rv,
    sharePct: null as number | null,
  }))
  const total = rows.reduce((s, r) => s + (r.contribution ?? 0), 0)
  if (total > 0) {
    for (const r of rows) {
      r.sharePct = r.contribution === null ? null : (r.contribution / total) * 100
    }
  }
  return rows
}

// ── Renormalized stretches ───────────────────────────────────────────────────

export interface FlaggedRange {
  from: string
  to: string
  days: number
}

/**
 * Collapse dates carrying weights_renormalized = 1 into contiguous runs, so the
 * page can mark a differently-weighted stretch rather than leaving it silently
 * different. Contiguity is by position in the supplied (ascending) series, not
 * by calendar distance.
 */
export function renormalizedRanges(
  rows: ReadonlyArray<{ date: string; weightsRenormalized: boolean }>,
): FlaggedRange[] {
  const out: FlaggedRange[] = []
  let start: string | null = null
  let last: string | null = null
  let days = 0
  for (const r of rows) {
    if (r.weightsRenormalized) {
      if (start === null) { start = r.date; days = 0 }
      last = r.date
      days++
    } else if (start !== null && last !== null) {
      out.push({ from: start, to: last, days })
      start = null; last = null; days = 0
    }
  }
  if (start !== null && last !== null) out.push({ from: start, to: last, days })
  return out
}
