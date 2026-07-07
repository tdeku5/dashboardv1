import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, computeChangePct, computeAnnualized,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import kit from '../components/charts/ChartKit.module.css'

// UK Productivity & Unit Labour Costs dashboard — all quarterly, all DIRECT
// ONS series (no proxy badges). Left column: output per hour (LZVB, prdy);
// right column: unit labour costs (LNNL level from ucst; DMWO/DMWN published
// QoQ/YoY rates from prdy, plotted directly — never recomputed).

type AllData = Record<string, WD[]>

const SERIES = [
  { cdid: 'LZVB', dataset: 'prdy' },   // output per hour worked, SA index, quarterly
  { cdid: 'DMWN', dataset: 'prdy' },   // ULC YoY %, SA, quarterly (published rate)
  { cdid: 'DMWO', dataset: 'prdy' },   // ULC QoQ %, SA, quarterly (published rate)
  { cdid: 'LNNL', dataset: 'ucst' },   // ULC index, SA, quarterly
] as const

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

// ── Local panels ─────────────────────────────────────────────────────────────

type Row = { date: string; [key: string]: number | string | null }

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

export function UKProductivityContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(SERIES.map(s =>
      fetchOnsSeries(s.cdid, s.dataset)
        .then(d => [s.cdid, d] as [string, WD[]])
        .catch(() => [s.cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ONS productivity data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const oph = useMemo(() => allData['LZVB'] ?? [], [allData])

  // Level + OLS trend fitted on 2000Q1–2019Q4, extrapolated to present.
  const ophTrendRows = useMemo((): Row[] => {
    if (!oph.length) return []
    const fitPoints = oph
      .map((d, i) => ({ x: i, y: d.value, date: d.date }))
      .filter(p => p.date >= '2000-01' && p.date < '2020-01')
    if (!fitPoints.length) {
      return oph.map(d => ({ date: d.date, value: d.value, trend: null }))
    }
    const { slope, intercept } = olsRegression(fitPoints.map(p => p.x), fitPoints.map(p => p.y))
    const startIdx = fitPoints[0].x
    return oph.map((d, i) => ({
      date: d.date,
      value: d.value,
      trend: i >= startIdx ? intercept + slope * i : null,
    }))
  }, [oph])

  const ophQoqAnnRows = useMemo((): Row[] =>
    computeAnnualized(oph, 1, 4).map(d => ({ date: d.date, value: d.value })), [oph])

  const ophYoyRows = useMemo((): Row[] =>
    computeChangePct(oph, 4).map(d => ({ date: d.date, value: d.value })), [oph])

  const ulcLevelRows = useMemo((): Row[] =>
    (allData['LNNL'] ?? []).map(d => ({ date: d.date, value: d.value })), [allData])

  const ulcQoqRows = useMemo((): BarRow[] =>
    (allData['DMWO'] ?? []).map(d => ({ date: d.date, bar: d.value })), [allData])

  const ulcYoyRows = useMemo((): Row[] =>
    (allData['DMWN'] ?? []).map(d => ({ date: d.date, value: d.value })), [allData])

  if (loading) return <div className={kit.statusBlock}>Loading ONS productivity &amp; ULC series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (PRDY / UCST) &mdash; quarterly, seasonally adjusted
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
            title="Output per Hour — Level & Pre-COVID Trend"
            subtitle="LZVB output per hour worked, SA index — OLS linear trend fit 2000Q1–2019Q4, extrapolated"
            lines={[
              { key: 'value', label: 'Output per hour (LZVB)', color: '#60a5fa', width: 1.8 },
              { key: 'trend', label: 'Pre-COVID trend (2000–2019 OLS)', color: '#94a3b8', width: 1.4, dash: '6 3' },
            ]}
            rows={ophTrendRows}
            autoDomain
            yTickFmt={fmtIdxTick}
            valueFmt={fmtIdxTip}
          />
          <LinesPanel
            title="Output per Hour — QoQ % Annualized"
            subtitle="(Q/Q)^4 − 1, computed from LZVB"
            lines={[{ key: 'value', label: 'QoQ % annualized', color: '#fdba74', width: 1.8 }]}
            rows={ophQoqAnnRows}
            zeroLine
            yTickFmt={fmtPctTick}
            valueFmt={fmtPctTooltip}
          />
          <LinesPanel
            title="Output per Hour — YoY %"
            subtitle="Year-over-year %, computed from LZVB"
            lines={[{ key: 'value', label: 'YoY %', color: '#e2e8f0', width: 2 }]}
            rows={ophYoyRows}
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
            title="Unit Labour Costs — Level"
            subtitle="LNNL whole-economy ULC, SA index"
            lines={[{ key: 'value', label: 'ULC index (LNNL)', color: '#a78bfa', width: 1.8 }]}
            rows={ulcLevelRows}
            autoDomain
            yTickFmt={fmtIdxTick}
            valueFmt={fmtIdxTip}
          />
          <BarsPanel
            title="Unit Labour Costs — QoQ %"
            subtitle="DMWO — published quarter-on-quarter rate, SA"
            barLabel="ULC QoQ %"
            rows={ulcQoqRows}
          />
          <LinesPanel
            title="Unit Labour Costs — YoY %"
            subtitle="DMWN — published year-on-year rate, SA"
            lines={[{ key: 'value', label: 'ULC YoY % (DMWN)', color: '#f59e0b', width: 1.8 }]}
            rows={ulcYoyRows}
            zeroLine
            yTickFmt={fmtPctTick}
            valueFmt={fmtPctTooltip}
          />
        </div>
      </div>
    </>
  )
}
