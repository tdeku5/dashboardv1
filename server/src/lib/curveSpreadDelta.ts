// The spread change behind a curve-regime label.
//
// Pure: takes the four yield readings the regime classifier already fetched and
// returns the change in the spread over that same window. This exists so the
// Δ column and the regime label are produced by ONE calculation — the
// classifier was already computing `spreadChange` internally and discarding it,
// and a second spread calculator elsewhere could drift from it.
//
// Yields arrive in percent (tv_series convention); output is basis points,
// rounded to the payload's 2dp convention.

export interface SpreadDeltaInput {
  /** Short-leg yield now, in percent (e.g. the 2Y for 2s10s). */
  shortNow: number
  /** Short-leg yield at the lookback bar. */
  shortPrev: number
  /** Long-leg yield now (e.g. the 10Y for 2s10s). */
  longNow: number
  /** Long-leg yield at the lookback bar. */
  longPrev: number
}

export interface SpreadDelta {
  /** Short-leg change over the window, percent. */
  shortChange: number
  /** Long-leg change over the window, percent. */
  longChange: number
  /** Spread change over the window, percent — the classifier's input. */
  spreadChange: number
  /** The same spread change in bps, 2dp — the Δ column's value. */
  spreadBps: number
}

/**
 * Change in (long − short) over the window.
 *
 * Returns null if any leg is missing or non-finite, so a gap renders as a dash
 * rather than as 0.0 — a zero spread change is a real reading (an unmoved
 * curve) and must not be confused with absent data.
 */
export function computeSpreadDelta(input: Partial<SpreadDeltaInput>): SpreadDelta | null {
  const { shortNow, shortPrev, longNow, longPrev } = input
  if (
    shortNow == null || shortPrev == null || longNow == null || longPrev == null ||
    !Number.isFinite(shortNow) || !Number.isFinite(shortPrev) ||
    !Number.isFinite(longNow) || !Number.isFinite(longPrev)
  ) {
    return null
  }
  const shortChange = shortNow - shortPrev
  const longChange = longNow - longPrev
  const spreadChange = (longNow - shortNow) - (longPrev - shortPrev)
  return {
    shortChange,
    longChange,
    spreadChange,
    spreadBps: +(spreadChange * 100).toFixed(2),
  }
}
