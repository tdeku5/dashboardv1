// Shared Recharts theme — Asset Class Models.
//
// One treatment for everything on a chart that is NOT a series colour: grid,
// axes, ticks, tooltip, reference lines, brush, legend. Series colours come
// from constants/identityColors.ts (what a line IS) or the --acm-* sign tokens
// (direction / valence of a value) — never from this file.
//
// Every colour, font and space is a var(--acm-*) reference, so charts must sit
// inside an `.acm-root` element (page wrapper or the chart-container
// primitive). Chromium resolves var() inside SVG presentation attributes
// (verified in Phase 1 with headless Chromium 148).
//
// MEASURED TEXT uses literals, not var(): Recharts sizes tick labels and
// <Label>s in a hidden span appended to <body> (recharts_measurement_span,
// util/DOMUtils.js) — outside .acm-root — copying fontSize / fontFamily /
// fontWeight from these props. A var() there resolves to the browser default,
// so labels would be measured in one face and drawn in another. Every font
// value on measured text (ticks, axis + reference labels, and the legend for
// consistency) is therefore a literal mirroring its token; chartTheme.test.ts
// pins each literal to the token's resolved value. Colours stay var() — they
// don't affect measurement. The @font-face rules in acm-tokens.css are global,
// so the literal family name still loads Plex outside .acm-root.
//
// Consolidates, at 7512e85: 3 CartesianGrid variants, 22 tick variants,
// 6 axis-stroke values, 7 Tooltip contentStyle variants.
import type { CSSProperties } from 'react'
import type { BrushProps, CartesianGridProps, LegendProps, ReferenceLineProps, XAxisProps, YAxisProps } from 'recharts'

const v = (token: string) => `var(--acm-${token})`

// ── Measured-text literals (see header) ─────────────────────────────────────

/** Mirrors --acm-fs-xs (10px) and --acm-fs-sm (11px). */
export const CHART_TICK_FONT_SIZE = 10
export const CHART_LABEL_FONT_SIZE = 11
/** Mirrors --acm-font-mono resolved through the global --font-mono. */
export const CHART_FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, 'Courier New', monospace"
/** Mirrors --acm-font-sans resolved through the global --font-sans. */
export const CHART_FONT_SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
/** Mirrors --acm-fw-regular. */
export const CHART_FONT_WEIGHT = 400

/**
 * Plot margin. Recharts needs numbers, so these mirror --acm-space-4 / -2 /
 * -2 / -1 (16 / 8 / 8 / 4 px), pinned by chartTheme.test.tsx.
 */
export const CHART_MARGIN = { top: 16, right: 8, left: 8, bottom: 4 } as const

// ── Grid ────────────────────────────────────────────────────────────────────

export const gridProps: Partial<CartesianGridProps> = {
  stroke: v('border-hairline'),
  strokeDasharray: '3 3',
}

// ── Axes + ticks ────────────────────────────────────────────────────────────

/** Numeric tick labels: mono, tabular, secondary text. */
export const tickStyle = {
  fill: v('text-secondary'),
  fontFamily: CHART_FONT_MONO,
  fontSize: CHART_TICK_FONT_SIZE,
  fontWeight: CHART_FONT_WEIGHT,
  fontVariantNumeric: 'tabular-nums',
} as const

const axisBase = {
  stroke: v('text-tertiary'),
  tick: tickStyle,
  tickLine: { stroke: v('text-tertiary') },
  axisLine: { stroke: v('text-tertiary') },
  // DO NOT tidy back to Recharts' default of 5. Tick-interval measurement
  // (recharts 3.7.0 cartesian/getTicks.js) passes only fontSize +
  // letterSpacing to its measuring span — never the family — so labels are
  // measured in the <body> face (system-ui) but drawn in Plex Mono, measured
  // at 0.94–1.10× in Chromium (chartFontLoading.browser.test.ts). The extra
  // 5px of gap absorbs the ≈10% under-measurement.
  minTickGap: 10,
} as const

export const xAxisProps: Partial<XAxisProps> = { ...axisBase }

/**
 * Fixed width — Recharts only measures a Y axis when width === 'auto', so a
 * number keeps Y-axis layout independent of the measurement issue above.
 * 60 is Recharts' own DEFAULT_Y_AXIS_WIDTH, made explicit; charts with wider
 * labels pass their own number, never 'auto'.
 */
export const yAxisProps: Partial<YAxisProps> = { ...axisBase, width: 60 }

/** Axis title (e.g. "bp", "%"), when an axis carries one. */
export const axisLabelStyle: CSSProperties = {
  fill: v('text-tertiary'),
  fontFamily: CHART_FONT_SANS,
  fontSize: CHART_LABEL_FONT_SIZE,
  fontWeight: CHART_FONT_WEIGHT,
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
// Rendered as HTML inside the chart wrapper, so var() resolves normally.
// Custom tooltip components keep their own content and spread
// `tooltipSurfaceStyle` (and the row/label styles) on their root.

export const tooltipSurfaceStyle: CSSProperties = {
  background: v('surface-overlay'),
  border: `${v('border-width')} solid ${v('border-emphasis')}`,
  borderRadius: v('radius-md'),
  padding: `${v('space-2')} ${v('space-3')}`,
  color: v('text-primary'),
  fontFamily: v('font-mono'),
  fontSize: v('fs-sm'),
  fontVariantNumeric: 'tabular-nums',
  lineHeight: v('lh-tight'),
}

/** The tooltip's header line (usually the date). */
export const tooltipLabelStyle: CSSProperties = {
  color: v('text-secondary'),
  fontFamily: v('font-mono'),
  fontSize: v('fs-sm'),
  marginBottom: v('space-1'),
}

/** One series row. Its colour stays the series' identity colour (Recharts default). */
export const tooltipItemStyle: CSSProperties = {
  padding: 0,
  fontFamily: v('font-mono'),
  fontSize: v('fs-sm'),
}

export const tooltipProps = {
  contentStyle: tooltipSurfaceStyle,
  labelStyle: tooltipLabelStyle,
  itemStyle: tooltipItemStyle,
  /** Line/area charts: a hairline crosshair. */
  cursor: { stroke: v('border-emphasis'), strokeDasharray: '3 3' },
  isAnimationActive: false,
} as const

/** Bar charts: a soft column highlight instead of the crosshair. */
export const barTooltipCursor = { fill: v('surface-raised'), fillOpacity: 0.6 } as const

// ── Reference lines + bands ─────────────────────────────────────────────────

export const referenceLines = {
  /** y = 0 and other neutral baselines. */
  zero: { stroke: v('text-tertiary'), strokeDasharray: '4 4' },
  /** Primary levels (±1σ, 50/50 breadth line). */
  level: { stroke: v('text-disabled'), strokeDasharray: '4 4' },
  /** Secondary levels (±2σ, ±3σ, 20/80). */
  levelFaint: { stroke: v('border-emphasis'), strokeDasharray: '2 4' },
} satisfies Record<string, Partial<ReferenceLineProps>>

/** Shaded spans that aren't data (recessions). */
export const referenceBand = { fill: v('text-secondary'), fillOpacity: 0.12 } as const

/** Reference-line label text (e.g. "SCARCITY WARNING", "2% target" carry their own colour). */
export const referenceLabelStyle = {
  fill: v('text-tertiary'),
  fontFamily: CHART_FONT_SANS,
  fontSize: CHART_LABEL_FONT_SIZE,
  fontWeight: CHART_FONT_WEIGHT,
} as const

// ── Brush + legend ──────────────────────────────────────────────────────────

export const brushProps: Partial<BrushProps> = {
  stroke: v('text-tertiary'),
  fill: v('surface-raised'),
  travellerWidth: 8,
  height: 18,
}

export const legendProps: Partial<LegendProps> = {
  wrapperStyle: {
    fontFamily: CHART_FONT_SANS,
    fontSize: CHART_LABEL_FONT_SIZE,
    color: v('text-secondary'),
    paddingTop: v('space-1'),
  },
  iconSize: 8,
}

/** Everything above, for a single import. */
export const chartTheme = {
  grid: gridProps,
  xAxis: xAxisProps,
  yAxis: yAxisProps,
  tick: tickStyle,
  axisLabel: axisLabelStyle,
  tooltip: tooltipProps,
  barTooltipCursor,
  referenceLines,
  referenceBand,
  referenceLabel: referenceLabelStyle,
  brush: brushProps,
  legend: legendProps,
} as const
