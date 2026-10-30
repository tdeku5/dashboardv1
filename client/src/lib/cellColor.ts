// Named heatmap: the cellColor grid (docs/asset-class-models-design-notes.md,
// rule 6 exception b). Red / blue on its own symmetric scale — an increase is
// --acm-heat-rate-up-* (the negative colour), a decrease --acm-heat-rate-down-*
// (the dir-down colour), both at the direction alphas, so equal moves shade
// identically. Used by STIR UST CURVE, the country curve pages and GLOBAL
// (where it shades signed z-scores of rate changes — a heatmap of change).
//
// A cell's value is normalised against its row / column max |value|, then put
// through the grid's original 0.7 power curve (which keeps mid-size moves
// visible) and bucketed into quarters of that curve: (0, .25] → step 1,
// (.25, .5] → 2, (.5, .75] → 3, (.75, 1] → 4. In raw |value| ÷ max terms the
// step edges are ≈ 13.8%, 37.1% and 66.3%.
//
// The fill sits on an opaque --acm-surface-panel base so nothing under the
// cell (row tints, page surfaces) stacks with it; cell text stays primary.
// Returns undefined — no fill, the surface shows through — for null, zero or
// an empty row.

export type CellColorTheme = 'red-blue'

const RATE_UP = [
  'var(--acm-heat-rate-up-1)', 'var(--acm-heat-rate-up-2)',
  'var(--acm-heat-rate-up-3)', 'var(--acm-heat-rate-up-4)',
] as const
const RATE_DOWN = [
  'var(--acm-heat-rate-down-1)', 'var(--acm-heat-rate-down-2)',
  'var(--acm-heat-rate-down-3)', 'var(--acm-heat-rate-down-4)',
] as const
const PANEL_BASE = 'var(--acm-surface-panel)'
const CURVE = 0.7
const THRESHOLDS = [0.25, 0.5, 0.75] as const

/** 1–4 for a non-zero value, 0 for no fill. Exported for tests. */
export function cellHeatStep(value: number | null | undefined, rowMaxAbs: number): number {
  if (value == null || !Number.isFinite(value) || value === 0 || !(rowMaxAbs > 0)) return 0
  const curved = Math.pow(Math.min(1, Math.abs(value) / rowMaxAbs), CURVE)
  return 1 + THRESHOLDS.filter(t => curved > t).length
}

export function getCellColor(
  value: number | null | undefined,
  rowMaxAbs: number,
  _theme: CellColorTheme = 'red-blue',
): string | undefined {
  const step = cellHeatStep(value, rowMaxAbs)
  if (step === 0) return undefined
  const fill = ((value as number) > 0 ? RATE_UP : RATE_DOWN)[step - 1]
  return `linear-gradient(${fill}, ${fill}), ${PANEL_BASE}`
}
