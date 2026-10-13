// Per-row gradient color shading for heatmap cells. The cell's value is
// normalized against the row's max |value| so the row's strongest move anchors
// full saturation. Returns undefined when there's no data or the row is empty,
// which the caller should treat as "use the default surface background."
//
// One theme: 'red-blue' — red for positive (selloff), blue for negative
// (rally). Every caller passes it explicitly. The unused 'brown-teal' theme
// was removed (Asset Class Models revamp, Decision 2); this grid moves onto
// the --acm-heat-dir-* scale when its pages are converted.
//
// The 0.7 power curve keeps mid-magnitude moves visible instead of crushing
// them to near-neutral. 0.65 max opacity preserves text readability.

export type CellColorTheme = 'red-blue'

const THEME_RGB: Record<CellColorTheme, { positive: string; negative: string }> = {
  'red-blue':   { positive: '239, 83, 80',  negative: '96, 165, 250' },
}

export function getCellColor(
  value: number | null | undefined,
  rowMaxAbs: number,
  theme: CellColorTheme = 'red-blue',
): string | undefined {
  if (value == null || !Number.isFinite(value) || rowMaxAbs === 0) return undefined
  const intensity = value / rowMaxAbs
  const curved = Math.sign(intensity) * Math.pow(Math.abs(intensity), 0.7)
  const opacity = Math.abs(curved) * 0.65
  const rgb = curved > 0 ? THEME_RGB[theme].positive : THEME_RGB[theme].negative
  return `rgba(${rgb}, ${opacity})`
}
