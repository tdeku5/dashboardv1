import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import { fetchBoeSeries } from '../lib/boe'
import {
  type WD, type NV, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK consumer health dashboard — BoE Money & Credit (monthly) + ONS national
// accounts / labour market (quarterly saving ratio, monthly real AWE).
// Consumer-credit panels PROXY the US revolving-credit page (all unsecured
// credit, not cards alone); effective-rate panel PROXIES the US 30y mortgage
// rate. No UK public sources exist for sentiment / delinquency / net worth,
// so those US panels have no analog here.

type Row = { date: string; [key: string]: number | string | null }

const BOE_CODES = ['LPMBI2O', 'LPMB3PS', 'LPMB4TC', 'CFMHSDE', 'IUMCCTL'] as const

const DEFAULT_M = 240 // ~20 years of months
const DEFAULT_Q = 80  // ~20 years of quarters

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtGbpTick = (v: number) =>
  Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(0)}bn` : `£${v.toFixed(0)}m`
const fmtGbpTooltip = (v: number) =>
  `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}m`

/** Align multiple series on the union of their dates (missing values → null). */
function buildRows(
  series: ReadonlyArray<{ key: string; data: ReadonlyArray<{ date: string; value: number | null }> }>,
): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({
    key: s.key,
    m: new Map(s.data.map(p => [p.date, p.value])),
  }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    return row
  })
}

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  return [brush, setBrush] as const
}

// ── multi-line panel (optional dual axis) ────────────────────────────────────

type LineDef = { key: string; label: string; color: string; axis?: 'left' | 'right' }

function LinesPanel({
  title, subtitle, badge, lines, rows, defaultCount,
  tickFmt, tooltipFmt, zeroRef = false, dualAxis = false,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineDef[]
  rows: Row[]
  defaultCount: number
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  zeroRef?: boolean
  dualAxis?: boolean
}) {
  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
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
            <YAxis yAxisId="left" tick={TICK} tickLine={false} axisLine={false} width={58}
              tickFormatter={tickFmt} />
            {dualAxis && (
              <YAxis yAxisId="right" orientation="right" tick={TICK} tickLine={false} axisLine={false}
                width={58} tickFormatter={tickFmt} />
            )}
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {zeroRef && <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                yAxisId={dualAxis && l.axis === 'right' ? 'right' : 'left'}
                stroke={l.color} strokeWidth={1.8}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            ))}
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── signed-bars + MA panel (net monthly flow) ────────────────────────────────

function FlowBarsPanel({
  title, subtitle, badge, rows, defaultCount,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  rows: Row[]
  defaultCount: number
}) {
  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            Net Flow +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            Net Flow &minus;
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            6-mo MA
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtGbpTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [fmtGbpTooltip(v), name === 'ma' ? '6-mo MA' : 'Net Flow'] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="flow" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`f-${i}`}
                  fill={typeof r.flow === 'number' && r.flow < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma"
              stroke="#e2e8f0" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKConsumerHealthContent() {
  const [boeData, setBoeData] = useState<Record<string, WD[]>>({})
  const [onsData, setOnsData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchBoeSeries([...BOE_CODES]),
      fetchOnsSeries('DGD8', 'ukea'),
      fetchOnsSeries('A3WW', 'lms'),
      fetchOnsSeries('A2FA', 'lms'),
    ]).then(([boe, dgd8, a3ww, a2fa]) => {
      if (cancelled) return
      setBoeData(boe)
      setOnsData({ DGD8: dgd8, A3WW: a3ww, A2FA: a2fa })
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load BoE/ONS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const creditBadge = <ProxyBadge caveat={UK_PROXY_CAVEATS.consumer_credit} />
  const rateBadge = <ProxyBadge caveat={UK_PROXY_CAVEATS.effective_mortgage_rate} />

  const outstandingRows = useMemo(
    () => buildRows([{ key: 'LPMBI2O', data: boeData['LPMBI2O'] ?? [] }]),
    [boeData]
  )
  const flowRows = useMemo((): Row[] => {
    const flow = boeData['LPMB3PS'] ?? []
    const nv: NV[] = flow.map(p => ({ date: p.date, value: p.value }))
    const ma = computeMA(nv, 6)
    return flow.map((p, i) => ({ date: p.date, flow: p.value, ma: ma[i]?.value ?? null }))
  }, [boeData])
  const growthRows = useMemo(
    () => buildRows([{ key: 'LPMB4TC', data: boeData['LPMB4TC'] ?? [] }]),
    [boeData]
  )
  const rateRows = useMemo(
    () => buildRows([
      { key: 'CFMHSDE', data: boeData['CFMHSDE'] ?? [] },
      { key: 'IUMCCTL', data: boeData['IUMCCTL'] ?? [] },
    ]),
    [boeData]
  )
  const savingRows = useMemo(
    () => buildRows([{ key: 'DGD8', data: onsData['DGD8'] ?? [] }]),
    [onsData]
  )
  const wageRows = useMemo(
    () => buildRows([
      { key: 'A3WW', data: onsData['A3WW'] ?? [] },
      { key: 'A2FA', data: onsData['A2FA'] ?? [] },
    ]),
    [onsData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading BoE Money &amp; Credit + ONS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Bank of England (Money &amp; Credit, monthly SA) + Office for National Statistics (quarterly saving ratio, monthly real AWE)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Consumer Credit Outstanding"
          subtitle="LPMBI2O — sterling consumer credit to individuals ex SLC, amounts outstanding, £m SA"
          badge={creditBadge}
          lines={[{ key: 'LPMBI2O', label: 'Outstanding (£m)', color: '#60a5fa' }]}
          rows={outstandingRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtGbpTick}
          tooltipFmt={fmtGbpTooltip}
        />
        <FlowBarsPanel
          title="Consumer Credit — Net Monthly Flow"
          subtitle="LPMB3PS — net consumer credit flow, £m SA, with 6-month moving average"
          badge={creditBadge}
          rows={flowRows}
          defaultCount={DEFAULT_M}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Consumer Credit — Annual Growth"
          subtitle="LPMB4TC — 12-month growth rate of consumer credit, % SA"
          badge={creditBadge}
          lines={[{ key: 'LPMB4TC', label: '12-mo Growth (%)', color: '#ec4899' }]}
          rows={growthRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Effective Interest Rates"
          subtitle="CFMHSDE (secured lending stock, left) vs IUMCCTL (credit card, right) — % p.a."
          badge={rateBadge}
          lines={[
            { key: 'CFMHSDE', label: 'Secured Stock Effective Rate (L)', color: '#4ade80', axis: 'left' },
            { key: 'IUMCCTL', label: 'Credit Card Effective Rate (R)', color: '#f59e0b', axis: 'right' },
          ]}
          rows={rateRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          dualAxis
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Households' Saving Ratio"
          subtitle="DGD8 — saving as % of total available household resources, quarterly SA"
          lines={[{ key: 'DGD8', label: 'Saving Ratio (%)', color: '#a78bfa' }]}
          rows={savingRows}
          defaultCount={DEFAULT_Q}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Real Wage Growth"
          subtitle="A3WW (total pay) / A2FA (regular pay) — real AWE, 3-month average YoY %, CPIH-deflated"
          lines={[
            { key: 'A3WW', label: 'Real Total Pay YoY', color: '#60a5fa' },
            { key: 'A2FA', label: 'Real Regular Pay YoY', color: '#4ade80' },
          ]}
          rows={wageRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
