import { useMemo, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ReturnsHeatmap } from '../components/ReturnsHeatmap'
import {
  US_INDEX_COLORS,
  US_INDEX_KEYS,
  US_INDEX_LABEL,
  US_INDICES,
  type UsIndexKey,
} from '../constants/usIndices'
import {
  useUsIndexLevels,
  useUsIndexReturns,
  type IndexLevelsRow,
  type IndexLookbackKey,
  type IndexRangeKey,
} from '../hooks/useUsIndices'
import { AcmChartFrame, AcmPageHeader, niceAxis, useBrushWindow, type AcmLegendItem, type NiceAxis } from '../components/acm'
import { chartTheme } from '../components/acm/chartTheme'
import { ButtonRow, EqState, EqTooltip, EqWarning, eqStyles } from './equitiesShared'

// E1: index LEVELS → plain primary text; each line and its own y axis take the
// registry identity colour (US_INDEX_COLORS). The returns heatmap is valence
// (ReturnsHeatmap, a named heatmap: up = heat-positive, down = heat-negative).

const RANGES: ReadonlyArray<{ key: IndexRangeKey; label: string }> = [
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

const CHART_HEIGHT = 420

// Each series gets its own y-axis, colored to match. Recharts stacks multiple
// YAxes outward from the plot area in declaration order — listing inner→outer
// per side. Layout per spec: SPX outer-left, RSP inner-left; NDX inner-right,
// DJI middle-right, RUT outer-right.
const AXIS_LAYOUT: ReadonlyArray<{ key: UsIndexKey; orientation: 'left' | 'right' }> = [
  { key: 'RSP', orientation: 'left'  },
  { key: 'SPX', orientation: 'left'  },
  { key: 'NDX', orientation: 'right' },
  { key: 'DJI', orientation: 'right' },
  { key: 'RUT', orientation: 'right' },
]

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

interface HeatmapRow {
  ticker: string
  name: string
  returns: {
    '5d': number | null
    '1m': number | null
    '3m': number | null
    '6m': number | null
    ytd: number | null
  }
}

function returnsAccessor(row: HeatmapRow, lb: IndexLookbackKey): number | null {
  return row.returns[lb]
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
  const rows = payload
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .sort(
      (a, b) =>
        US_INDEX_KEYS.indexOf(a.dataKey as UsIndexKey) -
        US_INDEX_KEYS.indexOf(b.dataKey as UsIndexKey),
    )
    .map((p) => ({ key: p.dataKey, name: US_INDEX_LABEL[p.dataKey as UsIndexKey] ?? p.dataKey, color: p.color, value: fmtPrice(p.value) }))
  return <EqTooltip label={label} rows={rows} />
}

const fmtLevelTick = (v: number) =>
  v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0)

interface LevelsChartProps {
  range: IndexRangeKey
  setRange: (k: IndexRangeKey) => void
  rangeLabel: string
}

function LevelsChart({ range, setRange, rangeLabel }: LevelsChartProps) {
  const { data, loading, error } = useUsIndexLevels(range)
  const [hidden, setHidden] = useState<Set<UsIndexKey>>(new Set())
  // brushKey resets the Brush component on range change, snapping it back to
  // the full window of the new series.
  const [brushKey, setBrushKey] = useState(0)

  const series: IndexLevelsRow[] = useMemo(() => data?.series ?? [], [data])
  const missing = data?.missingTickers ?? []
  const allMissing = data != null && missing.length === US_INDEX_KEYS.length
  const hasData = !loading && !error && series.length > 0 && !allMissing

  const onRangeClick = (k: IndexRangeKey) => {
    setRange(k)
    setBrushKey((n) => n + 1)
  }

  const toggle = (k: UsIndexKey) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // Even whole-number ticks per axis over the brushed window (niceAxis).
  const brush = useBrushWindow(series.length)
  const axes = useMemo(() => {
    const win = series.slice(brush.start, brush.end + 1)
    return Object.fromEntries(US_INDEX_KEYS.map((k) => [k, niceAxis(win.map((r) => r[k]).filter((v): v is number => typeof v === 'number'), { dp: 0 })])) as Record<UsIndexKey, NiceAxis>
  }, [series, brush.start, brush.end])

  const legend: AcmLegendItem[] = US_INDEX_KEYS.map((k) => ({
    label: US_INDICES.find((i) => i.key === k)?.displayName ?? k,
    color: US_INDEX_COLORS[k],
    hidden: hidden.has(k),
    onClick: () => toggle(k),
  }))

  return (
    <AcmChartFrame
      title="INDEX LEVELS"
      subtitle={`range: ${rangeLabel}`}
      legend={legend}
      actions={<ButtonRow items={RANGES} value={range} onChange={onRangeClick} label="RANGE:" />}
      height={CHART_HEIGHT}
    >
      {missing.length > 0 && !allMissing && (
        <EqWarning>Missing data for: {missing.map((k) => US_INDEX_LABEL[k]).join(', ')}</EqWarning>
      )}
      {loading && <EqState>Loading…</EqState>}
      {error && <EqState error>Failed to load: {error}</EqState>}
      {!loading && !error && allMissing && <EqState>Index data unavailable.</EqState>}
      {!loading && !error && !allMissing && series.length === 0 && <EqState>No data in selected range.</EqState>}
      {hasData && (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 28, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
            {AXIS_LAYOUT.map(({ key, orientation }) => (
              <YAxis
                key={key}
                yAxisId={key}
                orientation={orientation}
                hide={hidden.has(key)}
                {...chartTheme.yAxis}
                stroke={US_INDEX_COLORS[key]}
                strokeOpacity={0.7}
                tick={{ ...chartTheme.tick, fill: US_INDEX_COLORS[key], fillOpacity: 0.85 }}
                tickFormatter={fmtLevelTick}
                domain={axes[key].domain}
                ticks={axes[key].ticks}
                allowDataOverflow
                width={56}
                label={{ ...chartTheme.axisLabel, value: US_INDEX_LABEL[key], position: 'top', offset: 10, fill: US_INDEX_COLORS[key] }}
              />
            ))}
            <Tooltip content={<LevelsTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
            {US_INDEX_KEYS.map((k) => (
              <Line
                key={k}
                type="monotone"
                yAxisId={k}
                dataKey={k}
                stroke={US_INDEX_COLORS[k]}
                strokeWidth={1.6}
                dot={false}
                hide={hidden.has(k)}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            <Brush key={brushKey} dataKey="date" {...chartTheme.brush} onChange={brush.onChange} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </AcmChartFrame>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function IndexComparisonPage() {
  const returns = useUsIndexReturns()
  const [range, setRange] = useState<IndexRangeKey>('1y')

  const heatmapRows: HeatmapRow[] = useMemo(() => {
    return (returns.data?.indices ?? []).map((row) => ({
      ticker: row.ticker,
      name: row.displayName,
      returns: row.returns,
    }))
  }, [returns.data])

  const asOf = returns.data?.asOfDate ?? '—'
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? range.toUpperCase()

  return (
    <div className={eqStyles.eqShell}>
      <AcmPageHeader title="INDEX COMPARISON" asOf={asOf} />

      {returns.loading ? (
        <EqState>Loading index returns…</EqState>
      ) : returns.error ? (
        <EqState error>Failed to load: {returns.error}</EqState>
      ) : heatmapRows.length === 0 ? (
        <EqState>
          Index returns unavailable
          {returns.data?.missingTickers?.length
            ? ` — missing: ${returns.data.missingTickers.join(', ')}`
            : '.'}
        </EqState>
      ) : (
        <ReturnsHeatmap
          title="INDEX RETURNS"
          subtitle={`as of ${asOf}`}
          rows={heatmapRows}
          valueAccessor={returnsAccessor}
          missingTickers={returns.data?.missingTickers}
          rowHeaderLabel="Index"
          gradientMode="column"
        />
      )}

      <LevelsChart range={range} setRange={setRange} rangeLabel={rangeLabel} />
    </div>
  )
}
