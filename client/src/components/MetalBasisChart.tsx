import { useState } from 'react'
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
import { AssetSubRibbon } from './AssetSubRibbon'
import { CURRENT_COLOR } from './CrudeCurvePanel'
import { useMetalBasis, type BasisLookback, type BasisMetal } from '../hooks/useMetalBasis'
import styles from '../pages/CrudeOilPage.module.css'

const LOOKBACK_OPTIONS: ReadonlyArray<{ key: BasisLookback; label: string }> = [
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: '6m',  label: '6M' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
  { key: 'max', label: 'MAX' },
]

const LOOKBACK_LABEL: Record<BasisLookback, string> = {
  '1m': 'last 1m', '3m': 'last 3m', '6m': 'last 6m',
  '1y': 'last 1y', '2y': 'last 2y', '5y': 'last 5y', 'max': 'all available',
}

const TITLES: Record<BasisMetal, string> = {
  gold: 'Gold Spot − Front Month Basis',
  silver: 'Silver Spot − Front Month Basis',
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '−'
  return `${sign}$${Math.abs(v).toFixed(3)}`
}
function fmtUsdBare(v: number): string {
  return `$${v.toFixed(3)}`
}

function makeXTickFormatter(lookback: BasisLookback): (raw: string) => string {
  const monthShort = (m: number) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m] ?? ''
  return (raw: string) => {
    if (!raw) return ''
    const [y, m, d] = raw.split('-').map(n => parseInt(n, 10))
    if (lookback === '1m' || lookback === '3m') return `${monthShort(m - 1)} ${d}`
    return `${monthShort(m - 1)} '${String(y).slice(-2)}`
  }
}

interface BasisTooltipPayload {
  payload?: { date: string; front: number; spot: number; basis: number }
}

function makeBasisTooltip(frontSym: string, spotSym: string) {
  return function BasisTooltip({ active, payload }: { active?: boolean; payload?: BasisTooltipPayload[] }) {
    if (!active || !payload || payload.length === 0) return null
    const p = payload[0]?.payload
    if (!p) return null
    return (
      <div className={styles.tooltip}>
        <div className={styles.tooltipTitle}>{p.date}</div>
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipName}>{frontSym}</span>
          <span className={styles.tooltipVal}>{fmtUsdBare(p.front)}</span>
        </div>
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipName}>{spotSym}</span>
          <span className={styles.tooltipVal}>{fmtUsdBare(p.spot)}</span>
        </div>
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipName}>Basis</span>
          <span className={styles.tooltipVal}>{fmtUsd(p.basis)}</span>
        </div>
      </div>
    )
  }
}

export function MetalBasisChart({ metal }: { metal: BasisMetal }) {
  const [lookback, setLookback] = useState<BasisLookback>('1y')
  const { data, loading, error } = useMetalBasis(metal, lookback)

  const series = data?.series ?? []
  const apiError = data?.error ?? null
  const showErrorState = error || apiError || (!loading && data && series.length === 0)

  const front = data?.symbols.front ?? (metal === 'gold' ? 'GC' : 'SI')
  const spot = data?.symbols.spot ?? (metal === 'gold' ? 'GOLD' : 'SILVER')
  const BasisTooltip = makeBasisTooltip(front, spot)

  const subtitleRange = data && data.startDate && data.endDate
    ? `${data.startDate} to ${data.endDate}`
    : LOOKBACK_LABEL[lookback]

  return (
    <div className={styles.spreadPanel}>
      <div className={styles.spreadHeader}>
        <div>
          <div className={styles.panelTitle}>{TITLES[metal]}</div>
          <div className={styles.panelSubtitle}>{front} − {spot} · {subtitleRange}</div>
        </div>
        <AssetSubRibbon items={LOOKBACK_OPTIONS} value={lookback} onChange={setLookback} />
      </div>

      <div className={styles.spreadChartWrap}>
        {showErrorState ? (
          <div className={styles.panelEmpty}>
            {error || apiError || 'No basis data available'}
          </div>
        ) : loading && !data ? (
          <div className={styles.panelEmpty}>Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={series} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
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
                domain={['auto', 'auto']}
                label={{
                  value: '$/oz',
                  position: 'top',
                  offset: 10,
                  style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' },
                }}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
              <Tooltip content={<BasisTooltip />} />
              <Line
                type="monotone"
                dataKey="basis"
                name={`${front} − ${spot}`}
                stroke={CURRENT_COLOR}
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Brush
                key={lookback}
                dataKey="date"
                height={22}
                stroke="#728197"
                fill="#0d1520"
                travellerWidth={8}
                tickFormatter={makeXTickFormatter(lookback)}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
