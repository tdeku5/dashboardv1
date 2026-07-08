import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  type WD, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../../lib/seriesTransforms'
import styles from './ChartKit.module.css'

// Inflation distribution panel: share of sub-indices whose YoY falls in each
// bucket, rendered as a 100%-stacked area. Extracted from UKCPIContent.tsx
// (2026-07, Canada Phase 3) when Canada needed the identical panel — rendering
// and math unchanged; the sub-index set and bucket edges are parameterized.

export interface DistBucket {
  key: string
  label: string
  lo: number
  hi: number
  color: string
}

export const DIST_BUCKETS_WIDE: readonly DistBucket[] = [
  { key: 'lt-10', label: '< −10%', lo: -Infinity, hi: -10, color: '#1d4ed8' },
  { key: '-10--5', label: '−10 to −5%', lo: -10, hi: -5, color: '#3b82f6' },
  { key: '-5-0', label: '−5 to 0%', lo: -5, hi: 0, color: '#93c5fd' },
  { key: '0-5', label: '0 to 5%', lo: 0, hi: 5, color: '#fbbf24' },
  { key: '5-10', label: '5 to 10%', lo: 5, hi: 10, color: '#f97316' },
  { key: 'gt10', label: '> 10%', lo: 10, hi: Infinity, color: '#ef4444' },
]

export const DIST_BUCKETS_NARROW: readonly DistBucket[] = [
  { key: 'lt-2', label: '< −2%', lo: -Infinity, hi: -2, color: '#1d4ed8' },
  { key: '-2-0', label: '−2 to 0%', lo: -2, hi: 0, color: '#93c5fd' },
  { key: '0-2', label: '0 to 2%', lo: 0, hi: 2, color: '#4ade80' },
  { key: '2-4', label: '2 to 4%', lo: 2, hi: 4, color: '#fbbf24' },
  { key: '4-6', label: '4 to 6%', lo: 4, hi: 6, color: '#f97316' },
  { key: 'gt6', label: '> 6%', lo: 6, hi: Infinity, color: '#ef4444' },
]

export function buildDistribution(
  allData: Record<string, WD[]>,
  codes: readonly string[],
  buckets: readonly DistBucket[],
  /** YoY lag in periods — 12 for monthly series (default), 4 for quarterly (AU CPI). */
  lag = 12,
): Array<Record<string, number | string>> {
  const yoyBySeries = codes
    .map(c => computeChangePct(allData[c] ?? [], lag))
    .filter(s => s.length > 0)
  const dates = new Set<string>()
  for (const s of yoyBySeries) for (const p of s) if (p.value != null) dates.add(p.date)
  const maps = yoyBySeries.map(s => new Map(s.map(p => [p.date, p.value])))

  return [...dates].sort().map(date => {
    const row: Record<string, number | string> = { date }
    let total = 0
    const counts = buckets.map(() => 0)
    for (const m of maps) {
      const v = m.get(date)
      if (v == null) continue
      total++
      const bi = buckets.findIndex(b => v >= b.lo && v < b.hi)
      if (bi >= 0) counts[bi]++
    }
    buckets.forEach((b, i) => { row[b.key] = total > 0 ? (counts[i] / total) * 100 : 0 })
    return row
  })
}

export function DistributionSection({
  title, subtitle, badge, data, buckets, defaultCount = 240,
}: {
  title: string
  subtitle: string
  badge?: ReactNode
  data: Array<Record<string, number | string>>
  buckets: readonly DistBucket[]
  defaultCount?: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!data.length) return
    setBrush({ start: Math.max(0, data.length - defaultCount), end: data.length - 1 })
  }, [data.length, defaultCount])

  const bucketList = useMemo(() => buckets, [buckets])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}{badge}</div>
          <div className={styles.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {bucketList.map(b => (
            <span key={b.key} className={styles.legendItem} style={{ cursor: 'default' }}>
              <span className={styles.legendSwatch} style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} stackOffset="expand">
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const b = bucketList.find(x => x.key === name)
                return [typeof v === 'number' ? `${v.toFixed(1)}%` : '-', b?.label ?? String(name)] as [string, string]
              }} />
            {bucketList.map(b => (
              <Area key={b.key} type="monotone" dataKey={b.key} stackId="1"
                stroke="none" fill={b.color} fillOpacity={0.85} isAnimationActive={false} />
            ))}
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
