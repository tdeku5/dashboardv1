import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import {
  type WD, type Frequency, periodsPerYear,
  computeChangePct, computeAnnualized,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_M, QUICK_PERIODS_Q,
} from '../../lib/seriesTransforms'
import { QuickSelectRow } from './QuickSelectRow'
import styles from './ChartKit.module.css'

// Growth-rates section (YoY / 6-period annualized / 3-period annualized with
// toggleable legend), extracted from RetailSalesDashboardPage.tsx. Math and
// styling identical to the original inline block; the input series, title and
// frequency are parameterized. Quarterly frequency uses 2q/1q annualized
// windows in place of 6m/3m.

export function RatesChart({
  title,
  subtitle,
  data,
  frequency = 'monthly',
  badge,
}: {
  title: string
  subtitle?: string
  data: WD[]
  frequency?: Frequency
  badge?: ReactNode
}) {
  const ppy = periodsPerYear(frequency)
  const winLong = frequency === 'quarterly' ? 2 : 6
  const winShort = frequency === 'quarterly' ? 1 : 3
  const unitWord = frequency === 'quarterly' ? 'q' : 'mo'
  const quickPeriods = frequency === 'quarterly' ? QUICK_PERIODS_Q : QUICK_PERIODS_M
  const defaultCount = frequency === 'quarterly' ? 40 : 120

  const lblLong = `${winLong}${unitWord}Δ ann.`
  const lblShort = `${winShort}${unitWord}Δ ann.`

  const rows = useMemo(() => {
    const yoy = computeChangePct(data, ppy)
    const aL = computeAnnualized(data, winLong, ppy)
    const aS = computeAnnualized(data, winShort, ppy)
    return data.map((d, i) => ({
      date: d.date,
      yoy: yoy[i]?.value ?? null,
      annL: aL[i]?.value ?? null,
      annS: aS[i]?.value ?? null,
    }))
  }, [data, ppy, winLong, winShort])

  const [vis, setVis] = useState(() => new Set(['yoy', 'annL', 'annS']))
  const toggle = (id: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '10Y' })

  useEffect(() => {
    if (!data.length) return
    const end = data.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: '10Y' })
  }, [data.length, defaultCount])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={styles.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('yoy') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('yoy')}>
            <span className={styles.legendLine} style={{ background: '#ec4899' }} />
            YoY
          </button>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('annL') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('annL')}>
            <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
            {lblLong}
          </button>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('annS') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('annS')}>
            <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
            {lblShort}
          </button>
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', '']
                const lbl = name === 'yoy' ? 'YoY' : name === 'annL' ? lblLong : lblShort
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {vis.has('annS') && (
              <Line type="monotone" dataKey="annS" name={lblShort}
                stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            )}
            {vis.has('annL') && (
              <Line type="monotone" dataKey="annL" name={lblLong}
                stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            )}
            {vis.has('yoy') && (
              <Line type="monotone" dataKey="yoy" name="YoY"
                stroke="#ec4899" strokeWidth={2.5}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            )}
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = rows.length - 1
          setBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
        }}
        periods={quickPeriods}
      />
    </div>
  )
}
