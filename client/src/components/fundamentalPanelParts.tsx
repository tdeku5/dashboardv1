// Shared building blocks for the per-market FUNDAMENTAL MODEL panels (R5b).
// They render exactly the way R2c's US panel does — AcmPanel + segmented
// toggles + AcmChartFrame charts on chartTheme — so the UK / EU / CAD / JPY /
// AUS panels only keep their own data code. Colours come from the identity
// registry (FUNDAMENTAL_MODEL_COLORS / LABOR_COLORS); every line is a LEVEL or
// a rate of change of a price index, so nothing here takes a sign colour.
import type { ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AcmChartFrame, AcmPanel, niceAxis, type AcmLegendItem } from './acm'
import { chartTheme, referenceLines } from './acm/chartTheme'
import { FUNDAMENTAL_MODEL_COLORS } from '../constants/identityColors'
import styles from '../pages/STIRDashboardPage.module.css'

// ── Toggles ─────────────────────────────────────────────────────────────────

interface ToggleGroupProps<T extends string> {
  options: ReadonlyArray<{ key: T; label: string }>
  value: T
  onChange: (key: T) => void
  className?: string
}

/** Segmented toggle — the same buttons as the US panel's tabs / ranges / measure. */
export function FvmToggleGroup<T extends string>({ options, value, onChange, className }: ToggleGroupProps<T>) {
  return (
    <div className={`${styles.toggleGroup} ${className ?? ''}`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`${styles.toggleButton} ${value === o.key ? styles.toggleButtonActive : ''}`}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Single on/off toggle for the policy-rate overlay (US: FED FUNDS). */
export function FvmOverlayToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.toggleButton} ${on ? styles.toggleButtonActive : ''}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

// ── Panel shell ─────────────────────────────────────────────────────────────

interface PanelProps<T extends string> {
  /** Header controls (HEADLINE / CORE etc.), right-aligned like the US panel. */
  actions?: ReactNode
  /** One-line note under the header (e.g. "Core = ex fresh food"). */
  note?: ReactNode
  tabs: ReadonlyArray<{ key: T; label: string }>
  activeTab: T
  onTab: (key: T) => void
  children: ReactNode
}

export function FvmPanel<T extends string>({ actions, note, tabs, activeTab, onTab, children }: PanelProps<T>) {
  return (
    <AcmPanel title="FUNDAMENTAL MODEL" actions={actions}>
      {note && <div className={styles.fvmNote}>{note}</div>}
      <FvmToggleGroup options={tabs} value={activeTab} onChange={onTab} className={styles.fvmTabs} />
      <div className={styles.fvmBody}>{children}</div>
    </AcmPanel>
  )
}

export function FvmMessage({ children }: { children: ReactNode }) {
  return <div className={styles.comingSoon}>{children}</div>
}

export function FvmStats({ children }: { children: ReactNode }) {
  return <div className={styles.fvmStatsLine}>{children}</div>
}

export function FvmNote({ children }: { children: ReactNode }) {
  return <div className={styles.fvmNote}>{children}</div>
}

// ── Line chart ──────────────────────────────────────────────────────────────

export interface FvmLine {
  key: string
  label: string
  color: string
  /** Dashed projection / average lines. */
  dash?: string
  width?: number
}

interface ChartProps<Row> {
  title: string
  data: ReadonlyArray<Row>
  lines: ReadonlyArray<FvmLine>
  height: number
  /**
   * The panel's existing padded y range ([min − pad, max + pad]) or 'auto'.
   * It is snapped to even 1dp ticks with niceAxis, so labels never read
   * unevenly (R5b) while keeping the panel's own headroom.
   */
  range: readonly [number | string, number | string]
  tickFormatter: (date: string) => string
  /** Extra legend entries for reference marks (2% target, target band). */
  referenceLegend?: ReadonlyArray<AcmLegendItem>
  /** 2% target line (dashed, registry colour) — the US panel's. */
  target?: number
  /** RBA-style target band with a mid line. */
  targetBand?: { from: number; to: number; mid: number; color: string }
  /** A y = 0 baseline (MoM / sequential charts). */
  zeroLine?: boolean
  actions?: ReactNode
  /** Tooltip shows series names (multi-line charts). */
  namedTooltip?: boolean
}

export function FvmLineChart<Row extends { date: string }>({
  title, data, lines, height, range, tickFormatter, referenceLegend, target, targetBand, zeroLine, actions, namedTooltip,
}: ChartProps<Row>) {
  const axis = typeof range[0] === 'number' && typeof range[1] === 'number'
    ? niceAxis([range[0], range[1]], { dp: 1 })
    : null
  const legend: AcmLegendItem[] = [
    ...lines.map((l) => ({ label: l.label, color: l.color, dashed: Boolean(l.dash) })),
    ...(target != null ? [{ label: `${target}% Target`, color: FUNDAMENTAL_MODEL_COLORS.inflationTarget, dashed: true }] : []),
    ...(referenceLegend ?? []),
  ]
  return (
    <AcmChartFrame title={title} legend={legend} actions={actions} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data as Row[]} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid {...chartTheme.grid} vertical={!zeroLine} />
          <XAxis dataKey="date" {...chartTheme.xAxis} tickFormatter={tickFormatter} minTickGap={24} />
          <YAxis
            {...chartTheme.yAxis}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={42}
            {...(axis ? { domain: axis.domain, ticks: axis.ticks } : { domain: ['auto', 'auto'] as [string, string] })}
          />
          <Tooltip
            {...chartTheme.tooltip}
            formatter={(value: unknown, name: unknown) => {
              const v = typeof value === 'number' ? `${value.toFixed(2)}%` : '—'
              return namedTooltip ? [v, String(name ?? '')] : v
            }}
            labelFormatter={(value: unknown) => (typeof value === 'string' ? tickFormatter(value) : '')}
          />
          {targetBand && (
            <>
              <ReferenceArea y1={targetBand.from} y2={targetBand.to} fill={targetBand.color} fillOpacity={0.07} />
              <ReferenceLine y={targetBand.mid} stroke={targetBand.color} strokeDasharray="8 4" strokeOpacity={0.5} />
            </>
          )}
          {target != null && <ReferenceLine y={target} stroke={FUNDAMENTAL_MODEL_COLORS.inflationTarget} strokeDasharray="8 4" />}
          {zeroLine && <ReferenceLine y={0} {...referenceLines.zero} />}
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={l.width ?? (l.dash ? 1.8 : 2)}
              strokeDasharray={l.dash}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </AcmChartFrame>
  )
}
