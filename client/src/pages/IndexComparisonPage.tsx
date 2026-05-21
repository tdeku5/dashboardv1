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
import styles from './IndexComparisonPage.module.css'

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
  if (rows.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {rows.map((p) => {
        const k = p.dataKey as UsIndexKey
        return (
          <div key={p.dataKey} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: p.color }} />
            <span className={styles.tooltipName}>{US_INDEX_LABEL[k] ?? p.dataKey}</span>
            <span className={styles.tooltipVal}>{fmtPrice(p.value)}</span>
          </div>
        )
      })}
    </div>
  )
}

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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>INDEX LEVELS</div>
        <div className={styles.panelSubtitle}>range: {rangeLabel}</div>
      </div>

      <div className={styles.rangeRow}>
        <span className={styles.rangeLabel}>RANGE:</span>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`${styles.btn} ${range === r.key ? styles.btnActive : ''}`}
            onClick={() => onRangeClick(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {missing.length > 0 && !allMissing && (
        <div className={styles.warning}>
          Missing data for: {missing.map((k) => US_INDEX_LABEL[k]).join(', ')}
        </div>
      )}

      <div className={styles.chartWrap}>
        {loading && <div className={styles.placeholder}>Loading…</div>}
        {error && <div className={styles.placeholder}>Failed to load: {error}</div>}
        {!loading && !error && allMissing && (
          <div className={styles.placeholder}>Index data unavailable.</div>
        )}
        {!loading && !error && !allMissing && series.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {hasData && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={series} margin={{ top: 28, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke="#728197"
                tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              {AXIS_LAYOUT.map(({ key, orientation }) => (
                <YAxis
                  key={key}
                  yAxisId={key}
                  orientation={orientation}
                  hide={hidden.has(key)}
                  stroke={US_INDEX_COLORS[key]}
                  strokeOpacity={0.7}
                  tick={{
                    fill: US_INDEX_COLORS[key],
                    fillOpacity: 0.85,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                  }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0)
                  }
                  domain={['auto', 'auto']}
                  width={56}
                  label={{
                    value: US_INDEX_LABEL[key],
                    position: 'top',
                    offset: 10,
                    fill: US_INDEX_COLORS[key],
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                />
              ))}
              <Tooltip content={<LevelsTooltip />} />
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
              <Brush
                key={brushKey}
                dataKey="date"
                height={22}
                stroke="#728197"
                fill="#0d1520"
                travellerWidth={8}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className={styles.legendRow}>
        {US_INDEX_KEYS.map((k) => {
          const isHidden = hidden.has(k)
          const idx = US_INDICES.find((i) => i.key === k)
          return (
            <button
              key={k}
              type="button"
              className={`${styles.legendChip} ${isHidden ? styles.legendChipHidden : ''}`}
              onClick={() => toggle(k)}
            >
              <span
                className={`${styles.legendDot} ${isHidden ? styles.legendDotHidden : ''}`}
                style={{ background: US_INDEX_COLORS[k] }}
              />
              <span>{idx?.displayName ?? k}</span>
            </button>
          )
        })}
      </div>
    </div>
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
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>Index Comparison</div>
        <div className={styles.pageSubtitle}>as of {asOf}</div>
      </div>

      {returns.loading ? (
        <div className={styles.placeholder}>Loading index returns…</div>
      ) : returns.error ? (
        <div className={styles.placeholder}>Failed to load: {returns.error}</div>
      ) : heatmapRows.length === 0 ? (
        <div className={styles.placeholder}>
          Index returns unavailable
          {returns.data?.missingTickers?.length
            ? ` — missing: ${returns.data.missingTickers.join(', ')}`
            : '.'}
        </div>
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
