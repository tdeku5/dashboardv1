import { useMemo, useState } from 'react'
import {
  Brush,
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
  useBreadth,
  type BreadthRangeKey,
  type BreadthSeriesKey,
  type BreadthSeriesRow,
} from '../hooks/useBreadth'
import { AcmChartFrame, AcmPageHeader, type AcmLegendItem } from './acm'
import { chartTheme } from './acm/chartTheme'
import { BREADTH_MA_COLORS } from '../constants/identityColors'
import { ButtonRow, EqState, EqTooltip, EqWarning, eqStyles } from '../pages/equitiesShared'

const RANGES: ReadonlyArray<{ key: BreadthRangeKey; label: string }> = [
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

// E1: breadth % is a LEVEL → plain primary text. Lines take the registry's
// ordinal MA colours (BREADTH_MA_COLORS: light → dark for short → long; d200
// was lifted in Phase 1 and stays darker than d50).
const SERIES_COLOR: Record<BreadthSeriesKey, string> = BREADTH_MA_COLORS

const SERIES_LABEL: Record<BreadthSeriesKey, string> = {
  d20:  '% above 20-day MA',
  d50:  '% above 50-day MA',
  d200: '% above 200-day MA',
}

const SERIES_KEYS: BreadthSeriesKey[] = ['d20', 'd50', 'd200']

const CHART_HEIGHT = 480

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(2)}%`
}

/** Even ticks over the fixed 0–100 domain; includes the 20 / 50 / 80 reference levels. */
const Y_TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

interface TooltipPayloadItem {
  dataKey: string
  value: number | null
  color: string
}
interface RechartsTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function ChartTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload
    .filter((p) => p.value != null && Number.isFinite(p.value))
    .map((p) => ({ key: p.dataKey, name: SERIES_LABEL[p.dataKey as BreadthSeriesKey] ?? p.dataKey, color: p.color, value: fmtPct(p.value) }))
  return <EqTooltip label={label} rows={rows} />
}

export function BreadthChart() {
  const [range, setRange] = useState<BreadthRangeKey>('1y')
  const [hidden, setHidden] = useState<Set<BreadthSeriesKey>>(new Set())
  const { data, loading, error } = useBreadth(range)

  const series: BreadthSeriesRow[] = useMemo(() => data?.series ?? [], [data])

  const onRangeClick = (k: BreadthRangeKey) => {
    setRange(k)
  }

  const toggle = (k: BreadthSeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const indexLabel = data?.indexLabel ?? 'S&P 500'
  const asOf = data?.asOfDate ?? '—'
  const missing = data?.missingSeries ?? []
  const missingLabels = missing.map((k) => SERIES_LABEL[k]).join(', ')

  const allMissing = data != null && missing.length === SERIES_KEYS.length
  const hasData = !loading && !error && series.length > 0 && !allMissing

  // Re-key the chart on range change so the Brush remounts to its full
  // window — pure visual reset, no refetch.
  const chartKey = `${range}-${series.length}`

  const legend: AcmLegendItem[] = SERIES_KEYS.map((k) => ({ label: SERIES_LABEL[k], color: SERIES_COLOR[k], hidden: hidden.has(k), onClick: () => toggle(k) }))

  return (
    <div className={eqStyles.eqShell}>
      <AcmPageHeader title="BREADTH" subtitle={`${indexLabel} % of constituents above MA`} asOf={asOf} />
      <ButtonRow items={RANGES} value={range} onChange={onRangeClick} label="RANGE:" />
      <AcmChartFrame title="% ABOVE MOVING AVERAGE" subtitle={`range: ${RANGES.find((r) => r.key === range)?.label ?? range}`} legend={legend} height={CHART_HEIGHT}>
        {missing.length > 0 && !allMissing && <EqWarning>Missing data for: {missingLabels}</EqWarning>}
        {loading && <EqState>Loading…</EqState>}
        {error && <EqState error>Failed to load: {error}</EqState>}
        {!loading && !error && allMissing && (
          <EqState>Breadth data not yet ingested — check TradingView CSV pipeline for breadth series.</EqState>
        )}
        {!loading && !error && !allMissing && series.length === 0 && <EqState>No data in selected range.</EqState>}
        {hasData && (
          <ResponsiveContainer width="100%" height="100%" key={chartKey}>
            <LineChart data={series} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
              <YAxis
                {...chartTheme.yAxis}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                domain={[0, 100]}
                ticks={Y_TICKS}
                width={44}
              />
              <Tooltip content={<ChartTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />

              {/* Reference lines: 50% midline, 20/80 capitulation/euphoria thresholds. */}
              <ReferenceLine y={50} {...chartTheme.referenceLines.level} />
              <ReferenceLine y={20} {...chartTheme.referenceLines.levelFaint} />
              <ReferenceLine y={80} {...chartTheme.referenceLines.levelFaint} />

              {SERIES_KEYS.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={SERIES_COLOR[k]}
                  strokeWidth={1.6}
                  dot={false}
                  hide={hidden.has(k)}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}

              <Brush dataKey="date" {...chartTheme.brush} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </AcmChartFrame>
    </div>
  )
}
