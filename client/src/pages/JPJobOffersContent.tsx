import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan job offers dashboard — MHLW Employment Referrals (職業安定業務統計)
// via the Cabinet Office composite-indicator table, monthly SA from 1975.
// Japan's JOLTS proxy: the active job-offers-to-applicants ratio (有効求人倍率)
// is THE market-moving labor-demand gauge here — a monthly headline print
// alongside the unemployment rate. Everything is Hello-Work (public employment
// office) basis: new graduates and much white-collar hiring are excluded, and
// no hires/quits/layoffs flows exist.

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = [
  'JP_JOBOFFER_RATIO', // active job-offers-to-applicants ratio, SA, 1975→
  'JP_NEWOFFERS',      // new job offers, persons, SA, 1975→
] as const

const fmtRatioTick = (v: number): string => v.toFixed(2)
const fmtRatioTip = (v: number): string => `${v.toFixed(2)}×`
const fmtOffersTick = (v: number): string => `${(v / 1000).toFixed(0)}k`
const fmtOffersTip = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

// ── Local panel helpers (duplicated per-file per house convention) ───────────

type BrushIdx = { start: number; end: number }

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<BrushIdx>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  const onBrush = useCallback(({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  return { brush, onBrush }
}

function Panel({ title, subtitle, badge, legend, children }: {
  title: string
  subtitle?: string
  badge?: ReactNode
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      {legend != null && <div className={kit.legendRow}><div className={kit.legend}>{legend}</div></div>}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function Leg({ color, label }: { color: string; label: string }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kit.legendLine} style={{ background: color }} />
      {label}
    </span>
  )
}

// ── Panels ───────────────────────────────────────────────────────────────────

function OfferRatioPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, ratio: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Active Job-Offers-to-Applicants Ratio (有効求人倍率)"
      subtitle="Japan's market-moving labor-demand gauge — a monthly headline print alongside the u-rate. SA, 1975→. Above 1.0 = more openings than applicants (labor shortage); below = slack."
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.job_offers} />}
      legend={<Leg color="#e2e8f0" label="Offers-to-applicants ratio (SA)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtRatioTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtRatioTip(v) : '-', 'Offers/applicants'] as [string, string]} />
          <ReferenceLine y={1} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1}
            label={{ value: 'offers = applicants', position: 'insideTopRight', fill: '#64748B', fontSize: 10 }} />
          <Line type="monotone" dataKey="ratio" name="ratio" stroke="#e2e8f0" strokeWidth={2}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function NewOffersLevelPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="New Job Offers — Level"
      subtitle="Newly registered Hello-Work postings, persons, SA — the flow feeding the active ratio"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.job_offers} />}
      legend={<Leg color="#60a5fa" label="New job offers (persons, SA)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtOffersTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtOffersTip(v) : '-', 'New job offers'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function NewOffersYoyPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(
    () => computeChangePct(data, 12).map(d => ({ date: d.date, yoy: d.value })),
    [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="New Job Offers — YoY %"
      subtitle="Year-over-year % of new Hello-Work postings — the labor-demand momentum read"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.job_offers} />}
      legend={<Leg color="#f59e0b" label="New job offers YoY %" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'YoY %'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPJobOffersContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading e-Stat job-offers series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        MHLW Employment Referrals for General Workers &mdash; monthly, SA, 1975&rarr;. Hello-Work
        (public employment office) basis: EXCLUDES new graduates and much white-collar hiring;
        no hires/quits/layoffs flows exist (this is Japan&rsquo;s JOLTS proxy).
      </div>

      <OfferRatioPanel data={allData['JP_JOBOFFER_RATIO'] ?? []} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <NewOffersLevelPanel data={allData['JP_NEWOFFERS'] ?? []} />
        <NewOffersYoyPanel data={allData['JP_NEWOFFERS'] ?? []} />
      </div>
    </>
  )
}
