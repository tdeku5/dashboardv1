// Per-row gradient color shading for heatmap cells. The cell's value is
// normalized against the row's max |value| so the row's strongest move anchors
// full saturation. Returns undefined when there's no data or the row is empty,
// which the caller should treat as "use the default surface background."
//
// Two themes are supported because two grids use different conventions:
// - 'brown-teal' (default) — Global Bond Yields heatmap. Brown for positive
//   moves (selloff), teal for negative moves (rally).
// - 'red-blue' — UST Historical Yield Changes + BE/Real heatmap. Red for
//   positive (selloff), blue for negative (rally), matching the delta bar
//   chart and the latest-curve color used elsewhere on the UST tab.
//
// The 0.7 power curve keeps mid-magnitude moves visible instead of crushing
// them to near-neutral. 0.65 max opacity preserves text readability.

export type CellColorTheme = 'brown-teal' | 'red-blue'

const THEME_RGB: Record<CellColorTheme, { positive: string; negative: string }> = {
  'brown-teal': { positive: '180, 120, 60', negative: '78, 201, 176' },
  'red-blue':   { positive: '239, 83, 80',  negative: '96, 165, 250' },
}

export function getCellColor(
  value: number | null | undefined,
  rowMaxAbs: number,
  theme: CellColorTheme = 'brown-teal',
): string | undefined {
  if (value == null || !Number.isFinite(value) || rowMaxAbs === 0) return undefined
  const intensity = value / rowMaxAbs
  const curved = Math.sign(intensity) * Math.pow(Math.abs(intensity), 0.7)
  const opacity = Math.abs(curved) * 0.65
  const rgb = curved > 0 ? THEME_RGB[theme].positive : THEME_RGB[theme].negative
  return `rgba(${rgb}, ${opacity})`
}
