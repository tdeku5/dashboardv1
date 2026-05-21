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
import styles from './BreadthChart.module.css'

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

// Light-to-dark blue gradient: short timeframe = lighter, long = darker.
// The eye picks up the ordering immediately.
const SERIES_COLOR: Record<BreadthSeriesKey, string> = {
  d20:  '#06b6d4',  // cyan
  d50:  '#3b82f6',  // blue
  d200: '#1e40af',  // indigo
}

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
  const rows = payload.filter((p) => p.value != null && Number.isFinite(p.value))
  if (rows.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {rows.map((p) => {
        const k = p.dataKey as BreadthSeriesKey
        return (
          <div key={p.dataKey} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: p.color }} />
            <span className={styles.tooltipName}>{SERIES_LABEL[k] ?? p.dataKey}</span>
            <span className={styles.tooltipVal}>{fmtPct(p.value)}</span>
          </div>
        )
      })}
    </div>
  )
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

  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.title}>BREADTH</div>
        <div className={styles.subtitle}>
          {indexLabel} % of constituents above MA · as of {asOf}
        </div>
      </div>

      {missing.length > 0 && !allMissing && (
        <div className={styles.warning}>
          Missing data for: {missingLabels}
        </div>
      )}

      <div className={styles.rangeRow}>
        <span className={styles.rangeLabel}>RANGE:</span>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`${styles.rangeBtn} ${range === r.key ? styles.rangeBtnActive : ''}`}
            onClick={() => onRangeClick(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className={styles.chartWrap}>
        {loading && <div className={styles.placeholder}>Loading…</div>}
        {error && <div className={styles.placeholder}>Failed to load: {error}</div>}
        {!loading && !error && allMissing && (
          <div className={styles.placeholder}>
            Breadth data not yet ingested — check TradingView CSV pipeline for breadth series.
          </div>
        )}
        {!loading && !error && !allMissing && series.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {hasData && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT} key={chartKey}>
            <LineChart data={series} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke="#728197"
                tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                stroke="#728197"
                tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                domain={[0, 100]}
                ticks={[0, 20, 50, 80, 100]}
              />
              <Tooltip content={<ChartTooltip />} />

              {/* Reference lines: 50% midline, 20/80 capitulation/euphoria thresholds. */}
              <ReferenceLine y={50} stroke="#4a5568" strokeDasharray="2 2" />
              <ReferenceLine y={20} stroke="#3a4555" strokeDasharray="3 5" />
              <ReferenceLine y={80} stroke="#3a4555" strokeDasharray="3 5" />

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

              <Brush
                dataKey="date"
                height={26}
                stroke="#728197"
                fill="#0d1520"
                travellerWidth={8}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles.legendRow}>
        {SERIES_KEYS.map((k) => {
          const isHidden = hidden.has(k)
          return (
            <button
              key={k}
              type="button"
              className={`${styles.legendChip} ${isHidden ? styles.legendChipHidden : ''}`}
              onClick={() => toggle(k)}
            >
              <span
                className={`${styles.legendDot} ${isHidden ? styles.legendDotHidden : ''}`}
                style={{ background: SERIES_COLOR[k] }}
              />
              <span>{SERIES_LABEL[k]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
