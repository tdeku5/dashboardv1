// Reading an implied policy rate off a STIR strip at an arbitrary horizon.
//
// Pure and dependency-free: no DB, no clock, no logging. The Global Rates
// Summary route supplies the contracts and the anchor date; everything here is
// a function of those inputs, which is what makes the fixtures in
// forwardPolicyPath.test.ts deterministic.
//
// ── Why date-based and not index-based ──────────────────────────────────────
// The column this feeds used to be computed as a bare index offset from the
// front contract (contracts[4] − contracts[0]). The front contract sits up to a
// quarter out, so index 4 is ~14 months ahead rather than 12, and on a strip
// whose terminal lands at index 4–5 the result collapses to exactly 0.00 — it
// did so for UK, EU and CA at the Phase 0 measurement. Interpolating on the
// contract dates instead gives a number that matches what the column claims to
// show. See docs/prompts/global-rates-summary-phase0-decisions.md (D1).
//
// ── Approximation, stated plainly ──────────────────────────────────────────
// `expiryDate` is stored as the FIRST OF THE CONTRACT MONTH, not the true IMM
// date (3rd Wednesday), so a horizon can be off by up to ~3 weeks against the
// real settlement calendar. Accepted deliberately per D1 — converting to IMM
// dates is out of scope.
//
// The interpolated value is the implied 3M rate for the period STARTING at the
// target date; it is not a spot rate.

/** One strip contract, as much of TvFuturesContract as this module needs. */
export interface StripContract {
  symbol: string
  expiryDate: string
  impliedRate: number | null
}

/** Horizons the Global summary reads off each strip. */
export const FORWARD_HORIZON_MONTHS = { '6m': 6, '12m': 12 } as const
export type ForwardHorizonKey = keyof typeof FORWARD_HORIZON_MONTHS

export interface InterpolatedRate {
  /** The interpolated implied rate, in percent. */
  value: number
  /** Contract bracketing the target below (or exactly on it). */
  lower: StripContract
  /** Contract bracketing the target above (equals `lower` on an exact hit). */
  upper: StripContract
  /** Position of the target between lower and upper: 0 = on lower, 1 = on upper. */
  weight: number
  /** The resolved target date the value was read at. */
  targetDate: string
}

/** Reason an interpolation produced nothing — drives the caller's warn log. */
export type InterpolationFailure =
  | 'no-contracts'
  | 'before-strip'   // target precedes the first contract month
  | 'after-strip'    // target exceeds the last contract month

export type InterpolationResult =
  | { ok: true; rate: InterpolatedRate }
  | { ok: false; reason: InterpolationFailure; targetDate: string }

/**
 * Shift an ISO date by whole calendar months. Day-of-month is preserved where
 * it exists; JS Date normalizes an overflow (31 Jan + 1m → 3 Mar), which is
 * acceptable at these horizons and never shifts by more than a few days.
 */
export function addCalendarMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10)
}

/**
 * Linear interpolation of the implied rate at `targetDate` across the strip.
 *
 * Contracts with a null `impliedRate` are skipped rather than treated as zero.
 * NO EXTRAPOLATION: a target outside the strip's first/last contract month
 * returns a typed failure so the caller can emit null and warn once, rather
 * than being clamped to the nearest contract and silently reported as real.
 */
export function interpolateRateAtDate(
  contracts: readonly StripContract[],
  targetDate: string,
): InterpolationResult {
  const pts = contracts.filter(
    (c): c is StripContract & { impliedRate: number } =>
      c.impliedRate !== null && Number.isFinite(c.impliedRate),
  )
  if (pts.length === 0) return { ok: false, reason: 'no-contracts', targetDate }

  const t = Date.parse(`${targetDate}T00:00:00Z`)
  const first = Date.parse(`${pts[0].expiryDate}T00:00:00Z`)
  const last = Date.parse(`${pts[pts.length - 1].expiryDate}T00:00:00Z`)

  if (t < first) return { ok: false, reason: 'before-strip', targetDate }
  if (t > last) return { ok: false, reason: 'after-strip', targetDate }

  // Exactly on the first contract.
  if (t === first) {
    return { ok: true, rate: { value: pts[0].impliedRate, lower: pts[0], upper: pts[0], weight: 0, targetDate } }
  }

  for (let i = 1; i < pts.length; i++) {
    const lower = pts[i - 1]
    const upper = pts[i]
    const ta = Date.parse(`${lower.expiryDate}T00:00:00Z`)
    const tb = Date.parse(`${upper.expiryDate}T00:00:00Z`)
    if (t > tb) continue
    // t is in (ta, tb]. An exact hit on `upper` gives weight 1.
    const span = tb - ta
    const weight = span === 0 ? 0 : (t - ta) / span
    const value = lower.impliedRate + weight * (upper.impliedRate - lower.impliedRate)
    return { ok: true, rate: { value, lower, upper, weight, targetDate } }
  }

  // Unreachable given the bounds check above, but typed exhaustively.
  return { ok: false, reason: 'after-strip', targetDate }
}

/** Payload rounding convention shared with the rest of the summary route. */
export function toBpsRounded(ratePercentDiff: number): number {
  return +(ratePercentDiff * 100).toFixed(2)
}

export interface ForwardVsTerminal {
  /** Interpolated implied rate minus the terminal rate, in bps. */
  bps: number | null
  /** Present when the interpolation succeeded — carries the working for gate reports. */
  detail: InterpolatedRate | null
  /** Present when it failed, for the caller's one-time warn. */
  failure: InterpolationFailure | null
  targetDate: string
}

/**
 * `implied rate at (anchorDate + months) − terminalRate`, in bps.
 *
 * `terminalRate` must be the value already behind TERMINAL − OCR — pass it in
 * rather than recomputing, so the two columns can never disagree.
 */
export function forwardMinusTerminal(
  contracts: readonly StripContract[],
  anchorDate: string,
  months: number,
  terminalRate: number | null,
): ForwardVsTerminal {
  const targetDate = addCalendarMonths(anchorDate, months)
  const result = interpolateRateAtDate(contracts, targetDate)
  if (!result.ok) {
    return { bps: null, detail: null, failure: result.reason, targetDate }
  }
  if (terminalRate === null || !Number.isFinite(terminalRate)) {
    return { bps: null, detail: result.rate, failure: null, targetDate }
  }
  return {
    bps: toBpsRounded(result.rate.value - terminalRate),
    detail: result.rate,
    failure: null,
    targetDate,
  }
}
