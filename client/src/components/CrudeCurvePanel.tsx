import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CrudeCurveData } from '../hooks/useCrudeCurves'
import { AcmChartFrame, fmtSignedFixed, niceAxis, roundForDisplay, type AcmLegendItem } from './acm'
import { cx } from './acm/acmFormat'
import { chartTheme, tooltipLabelStyle, tooltipSurfaceStyle } from './acm/chartTheme'
import { CURVE_OFFSET_COLORS } from '../constants/identityColors'
import styles from './CrudeCurvePanel.module.css'

// E1 (shared: Equities VOL's VIX futures curve; COMMODITIES crude + metals).
// Curves are LEVELS: current / offset lines take the registry's
// CURVE_OFFSET_COLORS. The Δ bars keep their offset identity colour, not a
// sign colour — for VIX futures they are vol point changes (plain, M1 ruling
// 1); crude / metals price changes are left as they were for the COMMODITIES
// batch to classify. Frame + chartTheme give the panel its own acm-root, so it
// renders the same on the not-yet-converted commodity pages. Props unchanged.

export const OFFSET1_COLOR = CURVE_OFFSET_COLORS.offset1
export const OFFSET2_COLOR = CURVE_OFFSET_COLORS.offset2
export const CURRENT_COLOR = CURVE_OFFSET_COLORS.current

interface Props {
  title: string
  data: CrudeCurveData | null
  loading: boolean
  error: string | null
  showOffset1: boolean
  showOffset2: boolean
  deltaUnit: '$' | '%'
  // Per-unit suffix for the price axes (e.g. 'bbl' for crude, 'oz' for metals).
  // Defaults to 'bbl' so existing crude usage is unchanged.
  priceUnit?: string

  // ── Optional formatter / label overrides (backward-compatible) ─────────────
  // Reusing this panel for non-dollar instruments (VIX futures = vol points,
  // not $/bbl). When unset, the existing $-prefixed crude/metals formatting
  // applies. When set, these override the y-axis tick formatter, the tooltip
  // value rendering, and the y-axis label on the relevant panel.
  valueFormat?: (v: number) => string       // curve y-axis ticks + curve tooltip
  deltaFormat?: (v: number) => string       // delta y-axis ticks + delta tooltip
  valueAxisLabel?: string                   // curve y-axis label (default `$/${priceUnit}`)
  deltaAxisLabel?: string                   // delta y-axis label (default `$/${priceUnit}` for $, '%' for %)

  // Per-chart heights for callers that need to fit the panel in a constrained
  // cell (e.g. the VIX futures panel stacked beneath VIX3M−VIX in the Vol-tab
  // top-right). Defaults match the original crude/metals dimensions.
  curveHeight?: number   // default 480
  deltaHeight?: number   // default 240
}

interface DeltaRow {
  code: string
  d1: number | null
  d2: number | null
}

function buildDeltaRows(
  data: CrudeCurveData | null,
  unit: '$' | '%',
  showOffset1: boolean,
  showOffset2: boolean,
): DeltaRow[] {
  if (!data) return []
  return data.contracts.map((c) => {
    const calc = (off: number | null): number | null => {
      if (c.current == null || off == null) return null
      if (unit === '$') return c.current - off
      if (off === 0) return null
      return ((c.current - off) / off) * 100
    }
    return {
      code: c.code,
      d1: showOffset1 ? calc(c.offset1) : null,
      d2: showOffset2 ? calc(c.offset2) : null,
    }
  })
}

interface CurveTooltipPayloadEntry {
  dataKey?: string | number
  name?: string
  value?: number | null
  color?: string
}

function PanelTooltip({ active, payload, label, format }: {
  active?: boolean
  payload?: CurveTooltipPayloadEntry[]
  label?: string
  format: (v: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      {payload.map((entry) => {
        if (entry.value == null) return null
        return (
          <div key={String(entry.dataKey ?? entry.name)} className={styles.ccpTipRow}>
            <span className={styles.ccpTipDot} style={{ background: entry.color }} />
            <span className={styles.ccpTipName}>{entry.name}</span>
            <span>{format(entry.value as number)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** '+$1.23' / '-$0.40' / '$0.00' — sign before the unit, ASCII '-', unsigned at zero. */
function fmtSignedDollar(v: number): string {
  const r = roundForDisplay(v, 2)
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}$${Math.abs(r).toFixed(2)}`
}

function buildSubtitle(data: CrudeCurveData, showOffset1: boolean, showOffset2: boolean): string {
  const segs = [`as of ${data.asOf || '—'}`]
  if (showOffset1 && data.offset1Date) segs.push(`vs ${data.offset1Date} (${data.offset1Days}d)`)
  if (showOffset2 && data.offset2Date) segs.push(`vs ${data.offset2Date} (${data.offset2Days}d)`)
  return segs.join(' · ')
}

/** The values the curve chart draws (current + shown offsets). */
function curveValues(data: CrudeCurveData, showOffset1: boolean, showOffset2: boolean): number[] {
  const vals: number[] = []
  for (const c of data.contracts) {
    if (c.current != null) vals.push(c.current)
    if (showOffset1 && c.offset1 != null) vals.push(c.offset1)
    if (showOffset2 && c.offset2 != null) vals.push(c.offset2)
  }
  return vals
}

export function CrudeCurvePanel({
  title,
  data,
  loading,
  error,
  showOffset1,
  showOffset2,
  deltaUnit,
  priceUnit = 'bbl',
  valueFormat,
  deltaFormat,
  valueAxisLabel,
  deltaAxisLabel,
  curveHeight = 480,
  deltaHeight = 240,
}: Props) {
  // Defaults preserve the crude/metals `$X.XX` rendering. Callers (VIX
  // futures: "vol pts") may pass their own formatters.
  const fmtValue = valueFormat ?? ((v: number) => `$${v.toFixed(2)}`)
  const fmtDelta = deltaFormat ?? ((v: number) => (deltaUnit === '$' ? fmtSignedDollar(v) : fmtSignedFixed(v, 2, '%')))
  const fmtDeltaTick = (v: number) => deltaFormat ? fmtDelta(v) : (deltaUnit === '$' ? v.toFixed(2) : `${v.toFixed(1)}%`)
  const deltaDp = !deltaFormat && deltaUnit === '%' ? 1 : 2

  const state = (msg: string, isError = false) => (
    <AcmChartFrame title={title} height={curveHeight + deltaHeight}>
      <div className={cx(styles.ccpState, isError && styles.ccpStateError)}>{msg}</div>
    </AcmChartFrame>
  )
  if (error) return state(`Error: ${error}`, true)
  if (loading && !data) return state('Loading…')
  if (!data || data.contracts.length === 0) return state('No data available — check ingestion')

  const deltaRows = buildDeltaRows(data, deltaUnit, showOffset1, showOffset2)
  const priceAxisLabelResolved = valueAxisLabel ?? `$/${priceUnit}`
  const deltaAxisLabelResolved = deltaAxisLabel ?? (deltaUnit === '$' ? `$/${priceUnit}` : '%')
  // Even ticks on both axes (niceAxis); the Δ axis keeps zero in range.
  const curveAxis = niceAxis(curveValues(data, showOffset1, showOffset2), { dp: 2 })
  const deltaAxis = niceAxis(deltaRows.flatMap((r) => [r.d1, r.d2]).filter((v): v is number => v != null && Number.isFinite(v)), { dp: deltaDp, includeZero: true })

  const legend: AcmLegendItem[] = [
    { label: 'Current', color: CURRENT_COLOR },
    ...(showOffset1 ? [{ label: `Offset 1 (${data.offset1Days}d)`, color: OFFSET1_COLOR, dashed: true }] : []),
    ...(showOffset2 ? [{ label: `Offset 2 (${data.offset2Days}d)`, color: OFFSET2_COLOR, dashed: true }] : []),
  ]

  return (
    <AcmChartFrame title={title} subtitle={buildSubtitle(data, showOffset1, showOffset2)} legend={legend} height={curveHeight + deltaHeight}>
      <div className={styles.ccpStack}>
        <ResponsiveContainer width="100%" height={curveHeight}>
          <LineChart data={data.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="code" {...chartTheme.xAxis} />
            <YAxis
              {...chartTheme.yAxis}
              tickFormatter={fmtValue}
              domain={curveAxis.domain}
              ticks={curveAxis.ticks}
              allowDataOverflow
              label={{ ...chartTheme.axisLabel, value: priceAxisLabelResolved, position: 'top', offset: 10 }}
            />
            <Tooltip content={<PanelTooltip format={fmtValue} />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="current"
              name="Current"
              stroke={CURRENT_COLOR}
              strokeWidth={2.5}
              dot={{ r: 2.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {showOffset1 && (
              <Line
                type="monotone"
                dataKey="offset1"
                name={`Offset 1 (${data.offset1Days}d)`}
                stroke={OFFSET1_COLOR}
                strokeWidth={1.8}
                strokeDasharray="6 3"
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {showOffset2 && (
              <Line
                type="monotone"
                dataKey="offset2"
                name={`Offset 2 (${data.offset2Days}d)`}
                stroke={OFFSET2_COLOR}
                strokeWidth={1.8}
                strokeDasharray="2 3"
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>

        <ResponsiveContainer width="100%" height={deltaHeight}>
          <BarChart data={deltaRows} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
            <CartesianGrid {...chartTheme.grid} vertical={false} />
            <XAxis dataKey="code" {...chartTheme.xAxis} />
            <YAxis
              {...chartTheme.yAxis}
              tickFormatter={fmtDeltaTick}
              domain={deltaAxis.domain}
              ticks={deltaAxis.ticks}
              allowDataOverflow
              label={{ ...chartTheme.axisLabel, value: deltaAxisLabelResolved, position: 'top', offset: 10 }}
            />
            <ReferenceLine y={0} {...chartTheme.referenceLines.zero} />
            <Tooltip content={<PanelTooltip format={fmtDelta} />} cursor={chartTheme.barTooltipCursor} isAnimationActive={false} />
            {showOffset1 && (
              <Bar dataKey="d1" name={`vs Offset 1 (${data.offset1Days}d)`} radius={[2, 2, 0, 0]}>
                {deltaRows.map((r) => (
                  <Cell key={`d1-${r.code}`} fill={OFFSET1_COLOR} />
                ))}
              </Bar>
            )}
            {showOffset2 && (
              <Bar dataKey="d2" name={`vs Offset 2 (${data.offset2Days}d)`} radius={[2, 2, 0, 0]}>
                {deltaRows.map((r) => (
                  <Cell key={`d2-${r.code}`} fill={OFFSET2_COLOR} />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </AcmChartFrame>
  )
}
