// CME FedWatch methodology — pure math.
//
// Sources:
//  - Lao & Mirza (2016), "CME Group FedWatch Tool – Fed Funds Futures
//    Probability Tree Calculator" (canonical PDF).
//  - CME SOFRWatch Tool Methodology page (for SR3 compounded-vs-weighted
//    treatment — v1 here uses the weighted-average simplification, see
//    `single-meeting solver` notes below).
//  - CME Central Bank Watch (constant proxy-to-policy spread for non-USD).
//
// Conventions used throughout this module:
//  - All rates are in **decimal** form (0.0366 = 3.66%). Callers convert at
//    the edge.
//  - The standard rate step is **25 bp = 0.0025**. Hard-coded; the spec says
//    we never need a different step.
//
// What lives here vs the caller:
//  - This module is pure: no DB, no Express, no clock reads. All inputs are
//    primitive values. That keeps it unit-testable.
//  - The caller (tvFedWatch.ts) handles: (a) pulling contract prices from
//    tv_series, (b) resolving which contract maps to which meeting month,
//    (c) deciding whether to bridge to a policy rate via a proxy/policy spread.
//
// TODO (compounded SOFR): SR3 final settlement uses compounded daily O/N
// SOFR over the 3-month reference period. v1 here treats the SR3 contract's
// implied rate as a simple weighted average of pre-/post-meeting rates over
// the contract month — the error from this is typically <2 bps at current
// rate levels per CME SOFRWatch documentation. Revisit if exact CME match
// is required.

export const BPS_STEP = 0.0025

// ── Single-meeting solver ───────────────────────────────────────────────────

/**
 * Scenario 1 — meeting in current month, NO meeting in the FOLLOWING month.
 * The following month's contract anchors the post-meeting rate, since no
 * further meeting perturbs the following month's average.
 *
 *     FFER(end)   = 100 - FF(following month)    // taken directly
 *     Implied     = 100 - FF(current month)
 *     FFER(start) = (N/M) × [ Implied - FFER(end) × ((N - M) / N) ]
 *
 * Rearrangement of the within-month weighted average
 *     Implied = (M/N) × FFER(start) + ((N-M)/N) × FFER(end)
 */
export function solveMeetingScenario1(args: {
  currentMonthImplied: number      // 100 - FF(current month), decimal
  followingMonthImplied: number    // 100 - FF(following month), decimal
  N: number                        // days in current month
  M: number                        // meeting day-of-month minus 1
}): { effrStart: number; effrEnd: number } {
  const { currentMonthImplied, followingMonthImplied, N, M } = args
  const effrEnd = followingMonthImplied
  // (N/M) only valid when there's at least one day before the meeting; for
  // M=0 (meeting on the 1st) the pre-meeting rate is undefined — degenerate
  // case, the caller should handle by using the prior month's contract.
  if (M === 0) {
    return { effrStart: NaN, effrEnd }
  }
  const effrStart = (N / M) * (currentMonthImplied - effrEnd * ((N - M) / N))
  return { effrStart, effrEnd }
}

/**
 * Scenario 2 — meeting in current month, NO meeting in the PRIOR month.
 * The prior month's contract anchors the pre-meeting rate.
 *
 *     FFER(start) = 100 - FF(prior month)
 *     Implied     = 100 - FF(meeting month)
 *     FFER(end)   = (N / (N - M)) × [ Implied - (M/N) × FFER(start) ]
 */
export function solveMeetingScenario2(args: {
  priorMonthImplied: number        // 100 - FF(prior month), decimal
  meetingMonthImplied: number      // 100 - FF(meeting month), decimal
  N: number                        // days in meeting month
  M: number                        // meeting day-of-month minus 1
}): { effrStart: number; effrEnd: number } {
  const { priorMonthImplied, meetingMonthImplied, N, M } = args
  const effrStart = priorMonthImplied
  // Symmetric degenerate case: meeting on the last day.
  if (N - M === 0) {
    return { effrStart, effrEnd: NaN }
  }
  const effrEnd = (N / (N - M)) * (meetingMonthImplied - (M / N) * effrStart)
  return { effrStart, effrEnd }
}

/**
 * Scenario 3 — chained: meetings in adjacent months. The post-meeting rate
 * of meeting t-1 IS the pre-meeting rate of meeting t. Walk the curve
 * forward, applying the within-month weighted-average inversion at each
 * step. effrStart for meeting t is taken from the caller (typically the
 * effrEnd of meeting t-1, or the current overnight rate for the first
 * meeting).
 */
export function solveMeetingChained(args: {
  meetingMonthImplied: number     // 100 - FF(meeting month), decimal
  effrStart: number               // known from prior meeting or current rate
  N: number
  M: number
}): { effrStart: number; effrEnd: number } {
  const { meetingMonthImplied, effrStart, N, M } = args
  if (N - M === 0) {
    return { effrStart, effrEnd: NaN }
  }
  const effrEnd = (N / (N - M)) * (meetingMonthImplied - (M / N) * effrStart)
  return { effrStart, effrEnd }
}

// ── Step probability extraction ─────────────────────────────────────────────

export interface StepProbability {
  // Bucket center in decimal (e.g. 0.0375 = 3.75%).
  bucketCenter: number
  prob: number
}

/**
 * Convert a (start, end) pair of implied rates into a probability distribution
 * over the 25-bp rate buckets adjacent to start. The methodology:
 *
 *  1. Snap start to the nearest 25-bp grid point.
 *  2. Locate the two adjacent grid points (above and below) bracketing end.
 *  3. Linearly interpolate the probability between them.
 *
 * ZLB handling: when the lower bracket would fall below `zeroLowerBound`,
 * its mass is redirected to the next bucket up. Mathematically this is the
 * same as clamping the lower bracket at `zeroLowerBound` — if end < ZLB the
 * full probability mass lands on the unchanged (or first-above-ZLB) bucket.
 */
export function computeStepProbabilities(args: {
  effrStart: number
  effrEnd: number
  zeroLowerBound?: number          // default 0
}): StepProbability[] {
  const { effrStart, effrEnd } = args
  const zlb = args.zeroLowerBound ?? 0

  // The "current bucket" is the 25-bp band CONTAINING the pre-meeting rate.
  // Floor (not round) so a rate of 0.1325% (the CME PDF example) maps to the
  // [0, 25bp] bucket, not [12.5bp, 37.5bp]. This matches the CME definition
  // where the lower edge of the band IS the lower bound of the policy range.
  const startBucketLower = Math.floor(effrStart / BPS_STEP) * BPS_STEP

  // Raw expected change in 25-bp units (CME PDF: ΔR / 25bp). This is what
  // ultimately gives P(hike) = 53.6% on the canonical example.
  const deltaSteps = (effrEnd - effrStart) / BPS_STEP
  const floorStep = Math.floor(deltaSteps)
  const ceilStep = floorStep + 1
  const frac = deltaSteps - floorStep

  const lowerBucket = startBucketLower + floorStep * BPS_STEP
  const upperBucket = startBucketLower + ceilStep * BPS_STEP

  const lowerValid = lowerBucket >= zlb - 1e-9
  const upperValid = upperBucket >= zlb - 1e-9

  // ZLB redirect: if the lower outcome bucket is below the lower bound, its
  // probability mass moves to the upper bucket (CME: "decrease eliminated,
  // redirected to unchanged"). Symmetric pin if both buckets sit below.
  if (!lowerValid && upperValid) {
    return [{ bucketCenter: upperBucket, prob: 1 }]
  }
  if (lowerValid && !upperValid) {
    return [{ bucketCenter: lowerBucket, prob: 1 }]
  }
  if (!lowerValid && !upperValid) {
    return [{ bucketCenter: zlb, prob: 1 }]
  }

  const pLower = clamp01(1 - frac)
  const pUpper = clamp01(frac)
  const out: StepProbability[] = []
  if (pLower > 1e-6) out.push({ bucketCenter: lowerBucket, prob: pLower })
  if (pUpper > 1e-6) out.push({ bucketCenter: upperBucket, prob: pUpper })
  return out
}

function clamp01(v: number): number {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

// ── Step probability as a *delta* distribution ──────────────────────────────
//
// `computeStepProbabilities` above returns the absolute bucket distribution
// IMPLIED for ONE meeting in isolation. For path-aware tree expansion we
// need each meeting's outcome expressed as a delta (the change in rate at
// that meeting), so we can convolve a single delta distribution across
// many possible prior-path rates.
//
// The CME methodology assumes: the implied rate change at a meeting is the
// market's expectation regardless of how we got there. So if meeting t has
// effrStart=3.50, effrEnd=3.60 implying a 60% chance of +25bp and 40% chance
// of unchanged, that 60/40 distribution applies whether the prior path ended
// at 3.50 or at 3.25 — the meeting's *change* is what's priced.

export interface DeltaProbability {
  // Delta in decimal (e.g. +0.0025 = +25bp, 0 = unchanged, -0.0025 = -25bp).
  delta: number
  prob: number
}

export function stepProbabilitiesAsDeltas(args: {
  effrStart: number
  effrEnd: number
  maxSteps?: number
}): DeltaProbability[] {
  const { effrStart, effrEnd, maxSteps = 4 } = args
  // Raw expected change in 25-bp units. We do NOT snap effrStart to the
  // grid — the CME methodology uses the raw delta as the probability driver.
  const deltaSteps = (effrEnd - effrStart) / BPS_STEP
  const floorStep = Math.floor(deltaSteps)
  const ceilStep = floorStep + 1
  const frac = deltaSteps - floorStep

  const clampedFloor = Math.max(-maxSteps, Math.min(maxSteps, floorStep))
  const clampedCeil = Math.max(-maxSteps, Math.min(maxSteps, ceilStep))
  if (clampedFloor === clampedCeil) {
    return [{ delta: clampedFloor * BPS_STEP, prob: 1 }]
  }

  const pLower = clamp01(1 - frac)
  const pUpper = clamp01(frac)
  const out: DeltaProbability[] = []
  if (pLower > 1e-6) out.push({ delta: clampedFloor * BPS_STEP, prob: pLower })
  if (pUpper > 1e-6) out.push({ delta: clampedCeil * BPS_STEP, prob: pUpper })
  return out
}

// ── Tree expansion ──────────────────────────────────────────────────────────
//
// Walk the meetings in order, convolving each meeting's delta distribution
// onto the running rate distribution. At each step:
//
//   newDist[bucket + delta] += oldDist[bucket] × P(delta)
//
// ZLB redirect: when the path's current rate is at the lower bound and the
// meeting's delta is negative, that probability mass is redirected to the
// unchanged (stay at ZLB) outcome. This matches the CME formulation where
// "decrease is eliminated and probability mass is redirected to unchanged"
// at the lower bound.

export interface MeetingDeltaSet {
  // For each meeting (in order), the per-meeting delta probability distribution.
  deltas: DeltaProbability[]
  // The implied (deterministic) rate AT THE END of this meeting, in decimal.
  // Used purely as commentary in the output, not for tree mechanics.
  impliedEndRate: number
}

export interface TreeRow {
  // Distribution over rate buckets (decimal bucket centers) after this meeting.
  bucketProbabilities: Map<number, number>
}

export function expandTree(args: {
  startingRate: number             // decimal; the rate going into meeting #1
  meetings: MeetingDeltaSet[]
  zeroLowerBound?: number
}): TreeRow[] {
  const { startingRate, meetings } = args
  const zlb = args.zeroLowerBound ?? 0

  // Initialize with all probability at the start bucket (containing the rate).
  // Floor matches the CME definition where the bucket's lower edge IS the
  // lower bound of the current policy range.
  const startBucket = Math.floor(startingRate / BPS_STEP) * BPS_STEP
  let dist = new Map<number, number>()
  dist.set(startBucket, 1)

  const rows: TreeRow[] = []
  for (const meeting of meetings) {
    const next = new Map<number, number>()
    for (const [bucket, bucketProb] of dist) {
      for (const { delta, prob } of meeting.deltas) {
        const naiveTarget = bucket + delta
        // ZLB redirect: if the meeting's delta would push the path below
        // the lower bound, redirect that mass to the unchanged outcome.
        const target = naiveTarget < zlb - 1e-9 ? bucket : roundToGrid(naiveTarget)
        const combined = bucketProb * prob
        if (combined > 1e-9) {
          next.set(target, (next.get(target) ?? 0) + combined)
        }
      }
    }
    // Renormalize (defensive — should already sum to ~1 modulo float drift).
    let sum = 0
    for (const v of next.values()) sum += v
    if (sum > 0 && Math.abs(sum - 1) > 1e-6) {
      for (const [k, v] of next) next.set(k, v / sum)
    }
    rows.push({ bucketProbabilities: next })
    dist = next
  }
  return rows
}

function roundToGrid(rate: number): number {
  return Math.round(rate / BPS_STEP) * BPS_STEP
}

// ── Range labels ────────────────────────────────────────────────────────────
//
// A 25-bp "bucket center" at decimal `c` represents the policy range
// [c, c + 25bp]. For a proxy rate like EFFR (which floats inside the Fed's
// target range), the policy range is the proxy bucket plus the constant
// proxy-to-policy spread. The label formatter takes the bucket center, adds
// the spread, snaps to the policy grid (same 25-bp grid for the Fed; trivial
// for an additive offset), and formats as "lo-hi" in percent.

export function bucketRangeLabel(
  bucketCenter: number,
  proxyToPolicySpread: number = 0,
): string {
  const lo = bucketCenter + proxyToPolicySpread
  const hi = lo + BPS_STEP
  return `${(lo * 100).toFixed(2)}-${(hi * 100).toFixed(2)}`
}

// ── Combined: single-meeting "Implied # cuts/hikes" ─────────────────────────

/** Expected delta in bps for a single meeting (signed). */
export function expectedChangeBps(effrStart: number, effrEnd: number): number {
  // Decimal-to-bps: ×10000.
  return Math.round((effrEnd - effrStart) * 10000 * 10) / 10
}

/** Number of 25-bp moves implied by a bps delta (signed, to 1 dp). */
export function impliedMoves(bps: number): number {
  return Math.round((bps / 25) * 10) / 10
}
