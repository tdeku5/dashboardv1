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
import styles from './CrossAssetVolPage.module.css'

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

function fmtZ(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v).toFixed(2)}σ`
}

interface RangeButtonsProps<T extends string> {
  items: ReadonlyArray<{ key: T; label: string }>
  value: T
  onChange: (v: T) => void
  label: string
}

function ButtonRow<T extends string>({ items, value, onChange, label }: RangeButtonsProps<T>) {
  return (
    <div className={styles.rangeRow}>
      <span className={styles.rangeLabel}>{label}</span>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`${styles.btn} ${value === it.key ? styles.btnActive : ''}`}
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
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {rows.map((p) => {
        const k = p.dataKey as CavKey
        return (
          <div key={p.dataKey} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: p.color }} />
            <span className={styles.tooltipName}>{CAV_LABEL[k] ?? p.dataKey}</span>
            <span className={styles.tooltipVal}>{fmtNum(p.value)}</span>
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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>VOL LEVELS</div>
        <div className={styles.panelSubtitle}>range: {rangeLabel}</div>
      </div>

      {missing.length > 0 && !allMissing && (
        <div className={styles.warning}>
          Missing data for: {missing.map(k => CAV_LABEL[k]).join(', ')}
        </div>
      )}

      <div className={styles.chartWrap}>
        {loading && <div className={styles.placeholder}>Loading…</div>}
        {error && <div className={styles.placeholder}>Failed to load: {error}</div>}
        {!loading && !error && allMissing && (
          <div className={styles.placeholder}>Vol levels data unavailable.</div>
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
                xAxisId={0}
              />
              {LEVELS_AXIS_LAYOUT.map(({ key, orientation }) => (
                <YAxis
                  key={key}
                  yAxisId={key}
                  orientation={orientation}
                  hide={hidden.has(key)}
                  stroke={CAV_COLOR[key]}
                  strokeOpacity={0.7}
                  tick={{
                    fill: CAV_COLOR[key],
                    fillOpacity: 0.85,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                  }}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  domain={['auto', 'auto']}
                  width={44}
                  label={{
                    value: CAV_LABEL[key],
                    position: 'top',
                    offset: 10,
                    fill: CAV_COLOR[key],
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                />
              ))}
              <Tooltip content={<LevelsTooltip />} />
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
      </div>

      <div className={styles.legendRow}>
        {CAV_KEYS.map((k) => {
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
                style={{ background: CAV_COLOR[k] }}
              />
              <span>{CAV_LABEL[k]}</span>
            </button>
          )
        })}
      </div>
    </div>
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
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {visible.map((p) => {
        // dataKey is `${cavKey}_z` — recover the underlying CavKey.
        const cavKey = p.dataKey.replace(/_z$/, '') as CavKey
        const cell: CavZscoreCell | null = row[cavKey] ?? null
        return (
          <div key={p.dataKey}>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipDot} style={{ background: p.color }} />
              <span className={styles.tooltipName}>{CAV_LABEL[cavKey] ?? cavKey}</span>
              <span className={styles.tooltipVal}>{fmtZ(p.value)}</span>
            </div>
            {cell && (
              <div className={styles.tooltipMeta}>
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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>VOL Z-SCORES</div>
        <div className={styles.panelSubtitle}>
          range: {rangeLabel} · lookback: {lookbackLabel}
        </div>
      </div>

      <ButtonRow
        items={LOOKBACKS}
        value={lookback}
        onChange={setLookback}
        label="Z-SCORE LOOKBACK:"
      />

      {(missing.length > 0 || notes.length > 0) && !allMissing && (
        <div className={styles.warning}>
          {missing.length > 0 && (
            <span>Missing data for: {missing.map(k => CAV_LABEL[k]).join(', ')}</span>
          )}
          {notes.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}

      <div className={styles.chartWrap}>
        {loading && <div className={styles.placeholder}>Loading…</div>}
        {error && <div className={styles.placeholder}>Failed to load: {error}</div>}
        {!loading && !error && allMissing && (
          <div className={styles.placeholder}>Z-score data unavailable.</div>
        )}
        {!loading && !error && !allMissing && rawSeries.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {hasData && (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={flatSeries} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
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
                tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}σ`}
                domain={yDomain}
                ticks={[-3, -2, -1, 0, 1, 2, 3].filter(t => t >= yDomain[0] && t <= yDomain[1])}
              />
              <Tooltip content={<ZScoreTooltip />} />

              <ReferenceLine y={0} stroke="#5a6b7e" />
              {[-1, 1].map(y => (
                <ReferenceLine key={y} y={y} stroke="#3a4555" strokeDasharray="2 4" />
              ))}
              {[-2, 2].map(y => (
                <ReferenceLine key={y} y={y} stroke="#4a5568" strokeDasharray="3 3" />
              ))}
              {[-3, 3].map(y => (
                <ReferenceLine key={y} y={y} stroke="#3a4555" strokeDasharray="2 6" />
              ))}

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
      </div>

      <div className={styles.legendRow}>
        {CAV_KEYS.map((k) => {
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
                style={{ background: CAV_COLOR[k] }}
              />
              <span>{CAV_LABEL[k]}</span>
            </button>
          )
        })}
      </div>
    </div>
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
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>CROSS ASSET VOL</div>
        <div className={styles.pageSubtitle}>as of {asOf}</div>
      </div>

      <ButtonRow items={RANGES} value={range} onChange={setRange} label="RANGE:" />

      <LevelsChart
        rangeLabel={rangeLabel}
        data={levels.data}
        loading={levels.loading}
        error={levels.error}
      />
      <ZScoreChart
        rangeLabel={rangeLabel}
        lookback={lookback}
        setLookback={setLookback}
        lookbackLabel={lookbackLabel}
        data={zscores.data}
        loading={zscores.loading}
        error={zscores.error}
      />
      <VolSummaryTable
        asOfDate={summary.data?.asOfDate ?? null}
        data={summary.data}
        loading={summary.loading}
        error={summary.error}
      />
    </div>
  )
}
