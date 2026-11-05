import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CAV_KEYS,
  CAV_COLOR,
  CAV_LABEL,
  type CavKey,
} from '../constants/crossAssetVol'
import {
  useCavLevels,
  useCavZscores,
  type CavRangeKey,
  type CavLookbackKey,
  type CavZscoreCell,
  type CavZscoreRow,
  type CavLevelsRow,
} from '../hooks/useCrossAssetVol'
import { useCavSummary } from '../hooks/useCavSummary'
import { VolSummaryTable } from '../components/VolSummaryTable'
import { AcmChartFrame, AcmPageHeader, fmtSignedFixed, niceAxis, type AcmLegendItem } from '../components/acm'
import { cx } from '../components/acm/acmFormat'
import { chartTheme, referenceLines, tooltipLabelStyle, tooltipSurfaceStyle } from '../components/acm/chartTheme'
import styles from './CrossAssetVolPage.module.css'

// M1 (MACRO): vol index levels and their z-scores are LEVELS — identity colours
// from the registry (VOL_INDEX_COLORS via CAV_COLOR), plain text, no sign
// colour. Reference lines (0, ±1σ, ±2σ, ±3σ) use the theme's reference styles.

const RANGES: ReadonlyArray<{ key: CavRangeKey; label: string }> = [
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: '6m',  label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: '15y', label: '15Y' },
  { key: '20y', label: '20Y' },
  { key: 'all', label: 'ALL' },
]

const LOOKBACKS: ReadonlyArray<{ key: CavLookbackKey; label: string }> = [
  { key: '6m',  label: '6M' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
  { key: '10y', label: '10Y' },
]

const CHART_HEIGHT = 360

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

/** Signed 2dp σ, ASCII '-' (Decision 3); 0.00σ when it rounds to zero (near-zero rule). */
function fmtZ(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, 2, 'σ')
}

interface RangeButtonsProps<T extends string> {
  items: ReadonlyArray<{ key: T; label: string }>
  value: T
  onChange: (v: T) => void
  label: string
}

function ButtonRow<T extends string>({ items, value, onChange, label }: RangeButtonsProps<T>) {
  return (
    <div className={styles.cavRangeRow}>
      <span className={styles.cavRangeLabel}>{label}</span>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          className={cx(styles.cavBtn, value === it.key && styles.cavBtnActive)}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

// ── Levels chart ─────────────────────────────────────────────────────────────

interface LevelsTooltipPayloadItem {
  dataKey: string
  value: number | null
  color: string
}
interface LevelsTooltipProps {
  active?: boolean
  payload?: LevelsTooltipPayloadItem[]
  label?: string
}

function LevelsTooltip({ active, payload, label }: LevelsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  // Sort rows into CAV_KEYS order (VIX, MOVE, GVZ, OVX, BVOL) regardless of
  // payload arrival order — multi-axis charts can shuffle this.
  const rows = payload
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .sort((a, b) =>
      CAV_KEYS.indexOf(a.dataKey as CavKey) -
      CAV_KEYS.indexOf(b.dataKey as CavKey),
    )
  if (rows.length === 0) return null
  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      {rows.map((p) => {
        const k = p.dataKey as CavKey
        return (
          <div key={p.dataKey} className={styles.cavTipRow}>
            <span className={styles.cavTipDot} style={{ background: p.color }} />
            <span className={styles.cavTipName}>{CAV_LABEL[k] ?? p.dataKey}</span>
            <span>{fmtNum(p.value)}</span>
          </div>
        )
      })}
    </div>
  )
}

// Per-series y-axis layout for the levels chart. Each vol index has its own
// dedicated axis colored to match its line so the user can immediately tie a
// line back to its scale. Recharts stacks multiple YAxes on the same side
// outward from the plot area in declaration order, so left axes are listed
// inner→outer and same for right axes.
const LEVELS_AXIS_LAYOUT: ReadonlyArray<{ key: CavKey; orientation: 'left' | 'right' }> = [
  { key: 'gvz',  orientation: 'left'  }, // left inner
  { key: 'vix',  orientation: 'left'  }, // left outer
  { key: 'ovx',  orientation: 'right' }, // right inner
  { key: 'bvol', orientation: 'right' }, // right middle
  { key: 'move', orientation: 'right' }, // right outer
]

interface LevelsChartProps {
  rangeLabel: string
  data: ReturnType<typeof useCavLevels>['data']
  loading: boolean
  error: string | null
}

function LevelsChart({ rangeLabel, data, loading, error }: LevelsChartProps) {
  const [hidden, setHidden] = useState<Set<CavKey>>(new Set())

  const series: CavLevelsRow[] = useMemo(() => data?.series ?? [], [data])
  const missing = data?.missingSeries ?? []
  const allMissing = data != null && missing.length === CAV_KEYS.length
  const hasData = !loading && !error && series.length > 0 && !allMissing

  const toggle = (k: CavKey) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const legend: AcmLegendItem[] = CAV_KEYS.map(k => ({ label: CAV_LABEL[k], color: CAV_COLOR[k], hidden: hidden.has(k), onClick: () => toggle(k) }))
  // One axis per series in its identity colour; even whole-number ticks per axis (niceAxis).
  const axes = useMemo(() => Object.fromEntries(CAV_KEYS.map(k => [k, niceAxis(series.map(r => r[k]).filter((v): v is number => typeof v === 'number'), { dp: 0 })])) as Record<CavKey, ReturnType<typeof niceAxis>>, [series])

  return (
    <AcmChartFrame title="VOL LEVELS" subtitle={`range: ${rangeLabel}`} legend={legend} height={CHART_HEIGHT}>
      {missing.length > 0 && !allMissing && (
        <div className={styles.cavWarning}>Missing data for: {missing.map(k => CAV_LABEL[k]).join(', ')}</div>
      )}
      {loading && <div className={styles.cavState}>Loading…</div>}
      {error && <div className={cx(styles.cavState, styles.cavStateError)}>Failed to load: {error}</div>}
      {!loading && !error && allMissing && <div className={styles.cavState}>Vol levels data unavailable.</div>}
      {!loading && !error && !allMissing && series.length === 0 && <div className={styles.cavState}>No data in selected range.</div>}
      {hasData && (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 28, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} xAxisId={0} />
            {LEVELS_AXIS_LAYOUT.map(({ key, orientation }) => (
              <YAxis
                key={key}
                yAxisId={key}
                orientation={orientation}
                hide={hidden.has(key)}
                {...chartTheme.yAxis}
                stroke={CAV_COLOR[key]}
                strokeOpacity={0.7}
                tick={{ ...chartTheme.tick, fill: CAV_COLOR[key], fillOpacity: 0.85 }}
                tickFormatter={(v: number) => v.toFixed(0)}
                domain={axes[key].domain}
                ticks={axes[key].ticks}
                width={44}
                label={{ ...chartTheme.axisLabel, value: CAV_LABEL[key], position: 'top', offset: 10, fill: CAV_COLOR[key] }}
              />
            ))}
            <Tooltip content={<LevelsTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
            {CAV_KEYS.map((k) => (
              <Line
                key={k}
                type="monotone"
                yAxisId={k}
                dataKey={k}
                stroke={CAV_COLOR[k]}
                strokeWidth={1.6}
                dot={false}
                hide={hidden.has(k)}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </AcmChartFrame>
  )
}

// ── Z-scores chart ───────────────────────────────────────────────────────────

interface ZTooltipPayloadItem {
  dataKey: string
  value: number | null
  color: string
  payload: CavZscoreRow
}
interface ZTooltipProps {
  active?: boolean
  payload?: ZTooltipPayloadItem[]
  label?: string
}

function ZScoreTooltip({ active, payload, label }: ZTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  // Recharts emits one entry per Line; the row is duplicated on `payload`.
  const row = payload[0]?.payload
  if (!row) return null
  const visible = payload.filter((p) => p.value != null && Number.isFinite(p.value))
  if (visible.length === 0) return null
  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      {visible.map((p) => {
        // dataKey is `${cavKey}_z` — recover the underlying CavKey.
        const cavKey = p.dataKey.replace(/_z$/, '') as CavKey
        const cell: CavZscoreCell | null = row[cavKey] ?? null
        return (
          <div key={p.dataKey}>
            <div className={styles.cavTipRow}>
              <span className={styles.cavTipDot} style={{ background: p.color }} />
              <span className={styles.cavTipName}>{CAV_LABEL[cavKey] ?? cavKey}</span>
              <span>{fmtZ(p.value)}</span>
            </div>
            {cell && (
              <div className={styles.cavTipMeta}>
                value {fmtNum(cell.value)} · μ {fmtNum(cell.mean)} · σ {fmtNum(cell.stdev)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface ZScoreChartProps {
  rangeLabel: string
  lookback: CavLookbackKey
  setLookback: (k: CavLookbackKey) => void
  lookbackLabel: string
  data: ReturnType<typeof useCavZscores>['data']
  loading: boolean
  error: string | null
}

function ZScoreChart({ rangeLabel, lookback, setLookback, lookbackLabel, data, loading, error }: ZScoreChartProps) {
  const [hidden, setHidden] = useState<Set<CavKey>>(new Set())

  const rawSeries: CavZscoreRow[] = useMemo(() => data?.series ?? [], [data])
  // Flatten cells into top-level numeric fields so Recharts can read them by
  // dataKey (`vix_z`, `move_z`, …). The original nested cells stay on the row
  // for the tooltip's mean/stdev/value pulls.
  const flatSeries = useMemo(() => {
    return rawSeries.map((r) => {
      const out: Record<string, unknown> = { ...r }
      for (const k of CAV_KEYS) {
        const cell = r[k]
        out[`${k}_z`] = cell?.z ?? null
      }
      return out
    })
  }, [rawSeries])

  const missing = data?.missingSeries ?? []
  const notes = data?.notes ?? []
  const allMissing = data != null && missing.length === CAV_KEYS.length
  const hasData = !loading && !error && rawSeries.length > 0 && !allMissing

  // Compute the actual y-domain. Default [-3, +5] but auto-expand if data
  // exceeds either end so extreme readings (e.g. COVID March 2020) don't clip.
  const yDomain = useMemo(() => {
    let lo = -3
    let hi = 5
    for (const r of rawSeries) {
      for (const k of CAV_KEYS) {
        const z = r[k]?.z
        if (z == null || !Number.isFinite(z)) continue
        if (z < lo) lo = Math.floor(z)
        if (z > hi) hi = Math.ceil(z)
      }
    }
    return [lo, hi] as [number, number]
  }, [rawSeries])

  const toggle = (k: CavKey) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const legend: AcmLegendItem[] = CAV_KEYS.map(k => ({ label: CAV_LABEL[k], color: CAV_COLOR[k], hidden: hidden.has(k), onClick: () => toggle(k) }))

  return (
    <AcmChartFrame
      title="VOL Z-SCORES"
      subtitle={`range: ${rangeLabel} · lookback: ${lookbackLabel}`}
      legend={legend}
      actions={<ButtonRow items={LOOKBACKS} value={lookback} onChange={setLookback} label="Z-SCORE LOOKBACK:" />}
      height={CHART_HEIGHT}
    >
      {(missing.length > 0 || notes.length > 0) && !allMissing && (
        <div className={styles.cavWarning}>
          {missing.length > 0 && <span>Missing data for: {missing.map(k => CAV_LABEL[k]).join(', ')}</span>}
          {notes.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
      {loading && <div className={styles.cavState}>Loading…</div>}
      {error && <div className={cx(styles.cavState, styles.cavStateError)}>Failed to load: {error}</div>}
      {!loading && !error && allMissing && <div className={styles.cavState}>Z-score data unavailable.</div>}
      {!loading && !error && !allMissing && rawSeries.length === 0 && <div className={styles.cavState}>No data in selected range.</div>}
      {hasData && (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={flatSeries} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
            <YAxis
              {...chartTheme.yAxis}
              tickFormatter={(v: number) => fmtSignedFixed(v, 0, 'σ')}
              domain={yDomain}
              ticks={[-3, -2, -1, 0, 1, 2, 3].filter(t => t >= yDomain[0] && t <= yDomain[1])}
            />
            <Tooltip content={<ZScoreTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />

            <ReferenceLine y={0} {...referenceLines.zero} />
            {[-1, 1].map(y => <ReferenceLine key={y} y={y} {...referenceLines.level} />)}
            {[-2, 2, -3, 3].map(y => <ReferenceLine key={y} y={y} {...referenceLines.levelFaint} />)}

            {CAV_KEYS.map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={`${k}_z`}
                stroke={CAV_COLOR[k]}
                strokeWidth={1.6}
                dot={false}
                hide={hidden.has(k)}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </AcmChartFrame>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CrossAssetVolPage() {
  const [range, setRange] = useState<CavRangeKey>('1y')
  const [lookback, setLookback] = useState<CavLookbackKey>('1y')

  const levels = useCavLevels(range)
  const zscores = useCavZscores(range, lookback)
  const summary = useCavSummary()

  const asOf = levels.data?.asOfDate ?? zscores.data?.asOfDate ?? summary.data?.asOfDate ?? '—'

  const rangeLabel = RANGES.find(r => r.key === range)?.label ?? range.toUpperCase()
  const lookbackLabel = LOOKBACKS.find(l => l.key === lookback)?.label ?? lookback.toUpperCase()

  return (
    <div className={styles.cavShell}>
      <AcmPageHeader title="CROSS ASSET VOL" asOf={asOf} />
      <ButtonRow items={RANGES} value={range} onChange={setRange} label="RANGE:" />
      <LevelsChart rangeLabel={rangeLabel} data={levels.data} loading={levels.loading} error={levels.error} />
      <ZScoreChart
        rangeLabel={rangeLabel}
        lookback={lookback}
        setLookback={setLookback}
        lookbackLabel={lookbackLabel}
        data={zscores.data}
        loading={zscores.loading}
        error={zscores.error}
      />
      <VolSummaryTable asOfDate={summary.data?.asOfDate ?? null} data={summary.data} loading={summary.loading} error={summary.error} />
    </div>
  )
}
