// RATES helpers shared by STIRDashboardPage (US) and the per-market pages
// (CountryCurvePage, GLOBAL …). Moved out of STIRDashboardPage at R5a so the
// country pages can reuse them without a circular import (STIR imports them).
import type { ReactElement } from 'react'
import type { LabelProps } from 'recharts'
import { fmtSignedFixed, roundForDisplay, type AcmLegendItem, type SignTone } from '../components/acm'
import { CHART_FONT_MONO, CHART_LABEL_FONT_SIZE } from '../components/acm/chartTheme'
import { toneClass } from '../components/acm/tones'
import { CURVE_REGIME_COLORS, REGIME_OVERLAY_LINE, type RegimeKey } from '../constants/identityColors'
import styles from './STIRDashboardPage.module.css'

export const UST_CHART_RANGES = ['3m', '6m', '1y', '5y', '10y', 'all'] as const
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Yield / rate / spread level-vs-reference or Δ: up = negative (red), down =
 * positive (green). Decided on the value as displayed at `dp` decimals (bp
 * displays use 1dp), so anything that prints as zero is untoned.
 */
export function rateChangeTone(v: number | null, dp = 1): SignTone | undefined {
  if (v == null) return undefined
  const shown = roundForDisplay(v, dp)
  if (shown === 0) return undefined
  return shown > 0 ? 'negative' : 'positive'
}

/** A priced policy move: hike = negative (red: a rate increase), cut = positive (green). */
export function policyMoveTone(move: 'hike' | 'cut'): 'negative' | 'positive' {
  return move === 'hike' ? 'negative' : 'positive'
}

export function rateChangeClass(v: number | null, dp = 1): string | undefined {
  return toneClass(rateChangeTone(v, dp))
}

/** "Mar '24" — the rates history charts' X tick. */
export function fmtMonthYearTick(date: string): string {
  const d = new Date(date)
  return `${MONTHS_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
}

/**
 * A yield / spread / butterfly CHANGE in bp: rule 6 (increase = red, decrease =
 * green); a change that prints as 0.0 (1dp) or is missing is muted.
 */
export function ustChangeClass(v: number | null | undefined): string | undefined {
  if (v == null) return styles.muted
  return rateChangeClass(v) ?? styles.muted
}

/**
 * A spread / butterfly / breakeven LEVEL (e.g. 2s10s at +31bp). Rule 6: levels
 * get no colour — plain primary text; only a missing value is muted.
 */
export function ustLevelClass(v: number | null | undefined): string | undefined {
  return v == null ? styles.muted : undefined
}

/** Regime bar colour from the identity registry; unknown / missing → Neutral. */
export function regimeColor(regime: string | null | undefined): string {
  return (regime && CURVE_REGIME_COLORS[regime as RegimeKey]) || CURVE_REGIME_COLORS.Neutral
}

/** Regime-chart legend: the seven regimes, plus the overlaid line when it's keyed. */
export function regimeLegend(lineLabel?: string): AcmLegendItem[] {
  return [
    ...(Object.entries(CURVE_REGIME_COLORS) as Array<[RegimeKey, string]>).map(([label, color]) => ({ label, color })),
    ...(lineLabel ? [{ label: lineLabel, color: REGIME_OVERLAY_LINE }] : []),
  ]
}

export function rangeToggle(value: string, onChange: (r: string) => void, ranges: readonly string[] = UST_CHART_RANGES) {
  return (
    <div className={styles.toggleGroup}>
      {ranges.map((range) => (
        <button
          key={range}
          type="button"
          className={`${styles.toggleButton} ${value === range ? styles.toggleButtonActive : ''}`}
          onClick={() => onChange(range)}
        >
          {range.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

interface UstTileProps {
  /** Identity family colour: colours the label (and the value when `valueIsFamily`). */
  family: string
  label: string
  value: string
  valueIsFamily?: boolean
  valueClass?: string
  change: string
  changeClass?: string
  selected: boolean
  onSelect: () => void
}

/** Selectable yield / spread / butterfly tile. */
export function UstTile({ family, label, value, valueIsFamily, valueClass, change, changeClass, selected, onSelect }: UstTileProps) {
  return (
    <button
      type="button"
      className={`${styles.ustTile} ${selected ? styles.ustTileActive : ''}`}
      style={{ ['--ust-family' as string]: family }}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.ustTileLabel}>{label}</span>
      <span className={`${styles.ustTileValue} ${valueIsFamily ? styles.ustTileValueFamily : ''} ${valueClass ?? ''}`}>{value}</span>
      <span className={`${styles.ustTileChange} ${changeClass ?? ''}`}>{change}</span>
    </button>
  )
}

/** Signed 1dp bp label beyond a change bar's end (above a positive bar, below a negative one). */
export function renderDeltaLabel(props: LabelProps): ReactElement | null {
  const { value } = props
  if (value == null || typeof value === 'boolean' || value === '') return null
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0), width = Number(props.width ?? 0), height = Number(props.height ?? 0)
  const numeric = Number(value)
  // Recharts may hand a negative bar a negative height, so take the extent.
  const top = Math.min(y, y + height)
  const bottom = Math.max(y, y + height)
  return (
    <text
      x={x + width / 2}
      y={numeric >= 0 ? top - 8 : bottom + 14}
      textAnchor="middle"
      fill="var(--acm-text-secondary)"
      fontSize={CHART_LABEL_FONT_SIZE}
      fontFamily={CHART_FONT_MONO}
    >
      {fmtSignedFixed(numeric, 1)}
    </text>
  )
}
