// "Nice ticks" for Asset Class Models y axes (R5 Step 2).
//
// Recharts' automatic ticks can land on steps like 0.45 that look uneven once
// the labels are rounded to the displayed precision (1.8, 1.4, 0.9, 0.5 …), or
// repeat outright (-3bp, -3bp). niceAxis picks the smallest step of
// 1, 2, 2.5 or 5 × 10ⁿ that is exactly representable at `dp` decimals and
// covers the values in at most `maxIntervals` intervals, so labels are evenly
// spaced and never repeat. Only the axis changes; the plotted data does not.

export interface NiceAxisOptions {
  /** Decimals the tick labels are displayed at. */
  dp: number
  /** Keep 0 inside the domain (e.g. a zero / threshold reference line). */
  includeZero?: boolean
  /** Upper bound on the number of intervals (ticks = intervals + 1). */
  maxIntervals?: number
}

export interface NiceAxis {
  domain: [number, number]
  ticks: number[]
}

const MANTISSAS = [1, 2, 2.5, 5] as const

/** Round away binary noise at a fixed precision; -0 → 0. */
function clean(v: number, dp: number): number {
  const r = Number(v.toFixed(dp + 2))
  return r === 0 ? 0 : r
}

/** True when `step` prints exactly at `dp` decimals (so 0.25 fails at 1dp). */
function representable(step: number, dp: number): boolean {
  const scaled = step * 10 ** dp
  return Math.abs(scaled - Math.round(scaled)) < 1e-9 && Math.round(scaled) >= 1
}

export function niceAxis(values: ReadonlyArray<number>, { dp, includeZero = false, maxIntervals = 5 }: NiceAxisOptions): NiceAxis {
  const finite = values.filter(Number.isFinite)
  let lo = finite.length ? Math.min(...finite) : 0
  let hi = finite.length ? Math.max(...finite) : 0
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  if (lo === hi) { const pad = 10 ** -dp; lo -= pad; hi += pad }

  const raw = (hi - lo) / maxIntervals
  for (let exp = Math.floor(Math.log10(raw)) - 1; ; exp++) {
    for (const m of MANTISSAS) {
      const step = clean(m * 10 ** exp, dp + 2)
      if (!representable(step, dp)) continue
      const a = clean(Math.floor(lo / step + 1e-9) * step, dp)
      const b = clean(Math.ceil(hi / step - 1e-9) * step, dp)
      const n = Math.round((b - a) / step)
      if (n <= maxIntervals) {
        const ticks = Array.from({ length: n + 1 }, (_, i) => clean(a + i * step, dp))
        return { domain: [a, b], ticks }
      }
    }
  }
}
