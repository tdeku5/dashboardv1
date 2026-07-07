import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct, computeAnnualized,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import kit from '../components/charts/ChartKit.module.css'

// Canada Productivity & Unit Labour Costs dashboard — all quarterly, all
// DIRECT StatCan series from table 36-10-0206 (business sector, index
// 2017=100, SA, 1981→); no proxy badges. Left column: labour productivity
// (level + pre-COVID OLS trend, QoQ annualized, YoY); right column: unit
// labour costs (level, QoQ bars, YoY). Rates are computed from the indices.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = ['CA_PRODUCTIVITY', 'CA_ULC', 'CA_COMP_HOUR'] as const

const DEFAULT_QUARTERS = 80

const fmtIdxTick = (v: number): string => v.toFixed(0)
const fmtIdxTip = (v: number): string => v.toFixed(1)

// ── OLS linear trend (x = quarter sequence number) ───────────────────────────

function olsRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length
  if (n === 0) return { slope: 0, intercept: 0 }
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) * (xs[i] - mx)
  }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: my - slope * mx }
}

// ── Date-union alignment ─────────────────────────────────────────────────────

type Row = { date: string; [key: string]: number | string | null }

function alignByDate(series: ReadonlyArray<{ key: string; data: ReadonlyArray<{ date: string; value: number | null }> }>): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({
    key: s.key,
    map: new Map(s.data.map(p => [p.date, p.value])),
  }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

// ── Local panels ─────────────────────────────────────────────────────────────

type LineSpec = { key: string; label: string; color: string; width?: number; dash?: string }

function LinesPanel({
  title, subtitle, lines, rows, zeroLine = false, autoDomain = false, yTickFmt, valueFmt,
}: {
  title: string
  subtitle?: string
  lines: readonly LineSpec[]
  rows: Row[]
  zeroLine?: boolean
  autoDomain?: boolean
  yTickFmt: (v: number) => string
  valueFmt: (v: number) => string
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '20Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (DEFAULT_QUARTERS - 1)), end, period: '20Y' })
  }, [rows.length])

  const yDomain = useMemo((): [number, number] | undefined => {
    if (!autoDomain || !rows.length || brush.end < brush.start) return undefined
    const visible = rows.slice(Math.max(0, brush.start), Math.min(rows.length, brush.end + 1))
    const vals: number[] = []
    for (const r of visible) {
      for (const l of lines) {
        const v = r[l.key]
        if (typeof v === 'number') vals.push(v)
      }
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.02 || 1
    return [min - pad, max + pad]
  }, [autoDomain, rows, brush, lines])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(l => (
            <span key={l.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis domain={yDomain} tick={TICK} tickLine={false} axisLine={false} width={58}
              tickFormatter={yTickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const spec = lines.find(l => l.key === name)
                return [typeof v === 'number' ? valueFmt(v) : '-', spec?.label ?? String(name)] as [string, string]
              }} />
            {zeroLine && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.label}
                stroke={l.color} strokeWidth={l.width ?? 1.8} strokeDasharray={l.dash}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            ))}
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
        periods={QUICK_PERIODS_Q}
      />
    </div>
  )
}

type BarRow = { date: string; bar: number | null }

function BarsPanel({
  title, subtitle, barLabel, rows,
}: {
  title: string
  subtitle?: string
  barLabel: string
  rows: BarRow[]
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '20Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (DEFAULT_QUARTERS - 1)), end, period: '20Y' })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            {barLabel} (+)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} (&minus;)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) =>
                [typeof v === 'number' ? fmtPctTooltip(v) : '-', barLabel] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="bar" name={barLabel} isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((entry, idx) => (
                <Cell key={`b-${idx}`}
                  fill={(entry.bar ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
              ))}
            </Bar>
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
        periods={QUICK_PERIODS_Q}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAProductivityContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load StatCan productivity data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const prod = useMemo(() => allData['CA_PRODUCTIVITY'] ?? [], [allData])
  const ulc = useMemo(() => allData['CA_ULC'] ?? [], [allData])
  const comp = useMemo(() => allData['CA_COMP_HOUR'] ?? [], [allData])

  // Level + OLS trend fitted on 2000Q1–2019Q4, extrapolated to present.
  const prodTrendRows = useMemo((): Row[] => {
    if (!prod.length) return []
    const fitPoints = prod
      .map((d, i) => ({ x: i, y: d.value, date: d.date }))
      .filter(p => p.date >= '2000-01' && p.date < '2020-01')
    if (!fitPoints.length) {
      return prod.map(d => ({ date: d.date, value: d.value, trend: null }))
    }
    const { slope, intercept } = olsRegression(fitPoints.map(p => p.x), fitPoints.map(p => p.y))
    const startIdx = fitPoints[0].x
    return prod.map((d, i) => ({
      date: d.date,
      value: d.value,
      trend: i >= startIdx ? intercept + slope * i : null,
    }))
  }, [prod])

  const prodQoqAnnRows = useMemo((): Row[] =>
    computeAnnualized(prod, 1, 4).map(d => ({ date: d.date, value: d.value })), [prod])

  const prodYoyRows = useMemo((): Row[] =>
    computeChangePct(prod, 4).map(d => ({ date: d.date, value: d.value })), [prod])

  const ulcLevelRows = useMemo((): Row[] =>
    ulc.map(d => ({ date: d.date, value: d.value })), [ulc])

  const ulcQoqRows = useMemo((): BarRow[] =>
    computeChangePct(ulc, 1).map(d => ({ date: d.date, bar: d.value })), [ulc])

  const ulcYoyRows = useMemo((): Row[] =>
    computeChangePct(ulc, 4).map(d => ({ date: d.date, value: d.value })), [ulc])

  const compVsUlcRows = useMemo((): Row[] => alignByDate([
    { key: 'comp', data: computeChangePct(comp, 4) },
    { key: 'ulc', data: computeChangePct(ulc, 4) },
  ]), [comp, ulc])

  if (loading) return <div className={kit.statusBlock}>Loading StatCan productivity &amp; ULC series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0206) &mdash; business sector, quarterly, seasonally adjusted, index 2017=100
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#94A3B8',
            textTransform: 'uppercase', padding: '0 2px',
          }}>
            Productivity
          </div>
          <LinesPanel
            title="Labour Productivity — Level & Pre-COVID Trend"
            subtitle="Business-sector output per hour, index 2017=100 — OLS linear trend fit 2000Q1–2019Q4, extrapolated"
            lines={[
              { key: 'value', label: 'Labour productivity', color: '#60a5fa', width: 1.8 },
              { key: 'trend', label: 'Pre-COVID trend (2000–2019 OLS)', color: '#94a3b8', width: 1.4, dash: '6 3' },
            ]}
            rows={prodTrendRows}
            autoDomain
            yTickFmt={fmtIdxTick}
            valueFmt={fmtIdxTip}
          />
          <LinesPanel
            title="Productivity — QoQ % Annualized"
            subtitle="(Q/Q)^4 − 1, computed from the index"
            lines={[{ key: 'value', label: 'QoQ % annualized', color: '#fdba74', width: 1.8 }]}
            rows={prodQoqAnnRows}
            zeroLine
            yTickFmt={fmtPctTick}
            valueFmt={fmtPctTooltip}
          />
          <LinesPanel
            title="Productivity — YoY %"
            subtitle="Year-over-year %, computed from the index"
            lines={[{ key: 'value', label: 'YoY %', color: '#e2e8f0', width: 2 }]}
            rows={prodYoyRows}
            zeroLine
            yTickFmt={fmtPctTick}
            valueFmt={fmtPctTooltip}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#94A3B8',
            textTransform: 'uppercase', padding: '0 2px',
          }}>
            Unit Labour Costs
          </div>
          <LinesPanel
            title="Unit Labour Cost — Level"
            subtitle="Business-sector ULC, index 2017=100, SA"
            lines={[{ key: 'value', label: 'ULC index', color: '#a78bfa', width: 1.8 }]}
            rows={ulcLevelRows}
            autoDomain
            yTickFmt={fmtIdxTick}
            valueFmt={fmtIdxTip}
          />
          <BarsPanel
            title="Unit Labour Cost — QoQ %"
            subtitle="Quarter-over-quarter %, computed from the index"
            barLabel="ULC QoQ %"
            rows={ulcQoqRows}
          />
          <LinesPanel
            title="Unit Labour Cost — YoY %"
            subtitle="Year-over-year %, computed from the index"
            lines={[{ key: 'value', label: 'ULC YoY %', color: '#f59e0b', width: 1.8 }]}
            rows={ulcYoyRows}
            zeroLine
            yTickFmt={fmtPctTick}
            valueFmt={fmtPctTooltip}
          />
        </div>
      </div>

      <LinesPanel
        title="Compensation per Hour vs ULC — YoY"
        subtitle="Business-sector hourly compensation YoY vs unit labour cost YoY — the gap is productivity growth"
        lines={[
          { key: 'comp', label: 'Compensation per hour YoY', color: '#4ade80', width: 1.8 },
          { key: 'ulc', label: 'Unit labour cost YoY', color: '#f59e0b', width: 1.8 },
        ]}
        rows={compVsUlcRows}
        zeroLine
        yTickFmt={fmtPctTick}
        valueFmt={fmtPctTooltip}
      />
    </>
  )
}
