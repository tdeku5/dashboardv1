import { useState } from 'react'
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
import { AssetSubRibbon } from './AssetSubRibbon'
import { CURRENT_COLOR } from './CrudeCurvePanel'
import { useCrudeSpread, type SpreadLookback } from '../hooks/useCrudeSpread'
import styles from '../pages/CrudeOilPage.module.css'

const LOOKBACK_OPTIONS: ReadonlyArray<{ key: SpreadLookback; label: string }> = [
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: '6m',  label: '6M' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
  { key: 'max', label: 'MAX' },
]

const LOOKBACK_LABEL: Record<SpreadLookback, string> = {
  '1m': 'last 1m', '3m': 'last 3m', '6m': 'last 6m',
  '1y': 'last 1y', '2y': 'last 2y', '5y': 'last 5y',
  'max': 'all available',
}

const STATS_LABEL: Record<SpreadLookback, string> = {
  '1m': '1M', '3m': '3M', '6m': '6M',
  '1y': '1Y', '2y': '2Y', '5y': '5Y', 'max': 'MAX',
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '−'
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtUsdBare(v: number): string {
  return `$${v.toFixed(2)}`
}

function fmtZ(v: number): string {
  const sign = v >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v).toFixed(2)}σ`
}

// Choose a tick formatter that matches the lookback granularity.
function makeXTickFormatter(lookback: SpreadLookback): (raw: string) => string {
  const monthShort = (m: number) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m] ?? ''
  return (raw: string) => {
    if (!raw) return ''
    const [y, m, d] = raw.split('-').map(n => parseInt(n, 10))
    if (lookback === '1m' || lookback === '3m') return `${monthShort(m - 1)} ${d}`
    if (lookback === '5y' || lookback === 'max') return `${monthShort(m - 1)} '${String(y).slice(-2)}`
    return `${monthShort(m - 1)} '${String(y).slice(-2)}`
  }
}

interface SpreadTooltipPayload {
  payload?: { date: string; brent: number; wti: number; spread: number }
}

function SpreadTooltip({ active, payload }: {
  active?: boolean
  payload?: SpreadTooltipPayload[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{p.date}</div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipName}>Brent</span>
        <span className={styles.tooltipVal}>{fmtUsdBare(p.brent)}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipName}>WTI</span>
        <span className={styles.tooltipVal}>{fmtUsdBare(p.wti)}</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipName}>Spread</span>
        <span className={styles.tooltipVal}>{fmtUsd(p.spread)}</span>
      </div>
    </div>
  )
}

export function CrudeSpreadChart() {
  const [lookback, setLookback] = useState<SpreadLookback>('1y')
  const { data, loading, error } = useCrudeSpread(lookback)

  const stats = data?.stats ?? null
  const series = data?.series ?? []
  const apiError = data?.error ?? null
  const showErrorState = error || apiError || (!loading && data && series.length === 0)

  const zClass = !stats
    ? ''
    : Math.abs(stats.zscore) > 3
      ? styles.zExtreme
      : Math.abs(stats.zscore) > 2
        ? styles.zHigh
        : ''

  const subtitleRange = data && data.startDate && data.endDate
    ? `${data.startDate} to ${data.endDate}`
    : LOOKBACK_LABEL[lookback]

  return (
    <div className={styles.spreadPanel}>
      <div className={styles.spreadHeader}>
        <div>
          <div className={styles.panelTitle}>Brent–WTI Front Month Spread</div>
          <div className={styles.panelSubtitle}>BRN − CL · {subtitleRange}</div>
        </div>
        <AssetSubRibbon
          items={LOOKBACK_OPTIONS}
          value={lookback}
          onChange={setLookback}
        />
      </div>

      <div className={styles.spreadBody}>
        <div className={styles.spreadChartWrap}>
          {showErrorState ? (
            <div className={styles.panelEmpty}>
              {error || apiError || 'No spread data available'}
            </div>
          ) : loading && !data ? (
            <div className={styles.panelEmpty}>Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={series} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#728197"
                  tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  tickFormatter={makeXTickFormatter(lookback)}
                  minTickGap={40}
                />
                <YAxis
                  stroke="#728197"
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  label={{
                    value: '$/bbl',
                    position: 'top',
                    offset: 10,
                    style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' },
                  }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Tooltip content={<SpreadTooltip />} />
                <Line
                  type="monotone"
                  dataKey="spread"
                  stroke={CURRENT_COLOR}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {stats && (
          <aside className={styles.statsPanel}>
            <div className={styles.statsPanelTitle}>Stats</div>
            <div className={`${styles.statsRow} ${styles.statsRowLg}`}>
              <span className={styles.statsLabelLg}>Current</span>
              <span className={styles.statsValueLg}>{fmtUsd(stats.current)}</span>
            </div>
            <div className={`${styles.statsRow} ${styles.statsRowLg}`}>
              <span className={styles.statsLabelLg}>{STATS_LABEL[lookback]} Z-Score</span>
              <span className={`${styles.statsValueLg} ${zClass}`}>{fmtZ(stats.zscore)}</span>
            </div>
            <div className={styles.statsDivider} />
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Min</span>
              <span className={styles.statsValue}>{fmtUsd(stats.min)}</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Max</span>
              <span className={styles.statsValue}>{fmtUsd(stats.max)}</span>
            </div>
            <div className={styles.statsDivider} />
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Mean</span>
              <span className={styles.statsValue}>{fmtUsd(stats.mean)}</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Median</span>
              <span className={styles.statsValue}>{fmtUsd(stats.median)}</span>
            </div>
            <div className={styles.statsRow}>
              <span className={styles.statsLabel}>Stdev</span>
              <span className={styles.statsValue}>${stats.stdev.toFixed(2)}</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
