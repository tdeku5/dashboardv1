import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_M,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK Earnings dashboard — PAYE RTI payrolled employees & pay levels (PROXY for
// US nonfarm payrolls / establishment earnings) alongside ONS Average Weekly
// Earnings growth rates (DIRECT). AWE growth panels plot the published ONS
// rates directly — 3m-average YoY figures are NOT recomputed from indices.

type AllData = Record<string, WD[]>

const LMS_CDIDS = ['KAC3', 'KAI9', 'KAF5', 'A3WW', 'A2FA'] as const
const EMP_CDIDS = ['K54U', 'K552', 'K553', 'K54X', 'K54W'] as const
const PAYE_METRICS = ['payrolled_employees', 'median_pay', 'mean_pay'] as const

async function fetchPayeRti(metric: string): Promise<WD[]> {
  try {
    const res = await fetch(`/api/paye-rti?metric=${metric}`)
    if (!res.ok) {
      console.error(`[PAYE RTI client] Failed to fetch ${metric}: ${res.status}`)
      return []
    }
    const json = await res.json() as { metric?: string; observations?: Array<{ date: string; value: number }> }
    return (json.observations ?? []).map(o => ({ date: o.date, value: Number(o.value) }))
  } catch (err) {
    console.error(`[PAYE RTI client] Network error fetching ${metric}:`, err)
    return []
  }
}

// ── AWE sector explorer items (data map keys = CDIDs) ────────────────────────

const AWE_EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'K54U', label: 'AWE — Whole Economy' },
  { id: 'K552', label: 'AWE — Manufacturing' },
  { id: 'K553', label: 'AWE — Construction' },
  { id: 'K54X', label: 'AWE — Services' },
  { id: 'K54W', label: 'AWE — Public Sector' },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtEmpTick = (v: number): string => `${(v / 1e6).toFixed(1)}M`
const fmtEmpTip = (v: number): string => v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
const fmtKTick = (v: number): string => `${v.toFixed(0)}k`
const fmtKTip = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}k`
const fmtGbp = (v: number): string => `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`

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

// ── Local panels (ChartKit classes, exemplar-pattern) ────────────────────────

type LineSpec = { key: string; label: string; color: string; width?: number; dash?: string }

function LinesPanel({
  title, subtitle, badge, lines, rows,
  zeroLine = false, autoDomain = false,
  yTickFmt, valueFmt, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineSpec[]
  rows: Row[]
  zeroLine?: boolean
  autoDomain?: boolean
  yTickFmt: (v: number) => string
  valueFmt: (v: number) => string
  defaultCount?: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '10Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: '10Y' })
  }, [rows.length, defaultCount])

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
        periods={QUICK_PERIODS_M}
      />
    </div>
  )
}

type BarMaRow = { date: string; bar: number | null; ma: number | null }

function BarMaPanel({
  title, subtitle, badge, rows, barLabel, maLabel, yTickFmt, valueFmt, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  rows: BarMaRow[]
  barLabel: string
  maLabel: string
  yTickFmt: (v: number) => string
  valueFmt: (v: number) => string
  defaultCount?: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '10Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: '10Y' })
  }, [rows.length, defaultCount])

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
            {barLabel} (+)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} (&minus;)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#60a5fa' }} />
            {maLabel}
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={yTickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [valueFmt(v), name === 'ma' ? maLabel : barLabel] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="bar" name={barLabel} isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((entry, idx) => (
                <Cell key={`b-${idx}`}
                  fill={(entry.bar ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma" name={maLabel}
              stroke="#60a5fa" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
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
        periods={QUICK_PERIODS_M}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKEarningsContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetches: Array<Promise<[string, WD[]]>> = [
      ...LMS_CDIDS.map(c =>
        fetchOnsSeries(c, 'lms')
          .then(d => [c, d] as [string, WD[]])
          .catch(() => [c, []] as [string, WD[]])),
      ...EMP_CDIDS.map(c =>
        fetchOnsSeries(c, 'emp')
          .then(d => [c, d] as [string, WD[]])
          .catch(() => [c, []] as [string, WD[]])),
      ...PAYE_METRICS.map(m =>
        fetchPayeRti(m).then(d => [m, d] as [string, WD[]])),
    ]
    Promise.all(fetches).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load earnings data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const paye = useMemo(() => allData['payrolled_employees'] ?? [], [allData])

  const payeLevelRows = useMemo((): Row[] =>
    paye.map(d => ({ date: d.date, value: d.value })), [paye])

  const payeChangeRows = useMemo((): BarMaRow[] => {
    const diffs: NV[] = paye.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: (d.value - paye[i - 1].value) / 1000 })
    const ma = computeMA(diffs, 3)
    return diffs.map((d, i) => ({ date: d.date, bar: d.value, ma: ma[i]?.value ?? null }))
  }, [paye])

  const payeYoyRows = useMemo((): Row[] =>
    computeChangePct(paye, 12).map(d => ({ date: d.date, value: d.value })), [paye])

  const aweGrowthRows = useMemo((): Row[] => alignByDate([
    { key: 'total3m', data: allData['KAC3'] ?? [] },
    { key: 'regular3m', data: allData['KAI9'] ?? [] },
    { key: 'total1m', data: allData['KAF5'] ?? [] },
  ]), [allData])

  const realAweRows = useMemo((): Row[] => alignByDate([
    { key: 'realTotal', data: allData['A3WW'] ?? [] },
    { key: 'realRegular', data: allData['A2FA'] ?? [] },
  ]), [allData])

  const payRows = useMemo((): Row[] => alignByDate([
    { key: 'median', data: allData['median_pay'] ?? [] },
    { key: 'mean', data: allData['mean_pay'] ?? [] },
  ]), [allData])

  if (loading) return <div className={kit.statusBlock}>Loading PAYE RTI + ONS AWE series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        HMRC PAYE Real Time Information (payrolls &amp; pay) + ONS Average Weekly Earnings (EARN01/EMP) &mdash; monthly, SA
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Payrolled Employees"
          subtitle="PAYE RTI payrolled employees, level — latest month provisional"
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.payrolled_employees} />}
          lines={[{ key: 'value', label: 'Payrolled Employees', color: '#60a5fa', width: 1.8 }]}
          rows={payeLevelRows}
          autoDomain
          yTickFmt={fmtEmpTick}
          valueFmt={fmtEmpTip}
        />
        <BarMaPanel
          title="Payrolled Employees — Monthly Change"
          subtitle="MoM change, thousands — latest month provisional"
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.payrolled_employees} />}
          rows={payeChangeRows}
          barLabel="MoM change"
          maLabel="3-mo MA"
          yTickFmt={fmtKTick}
          valueFmt={fmtKTip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Payrolled Employees — YoY %"
          subtitle="PAYE RTI payrolled employees, year-over-year % — latest month provisional"
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.payrolled_employees} />}
          lines={[{ key: 'value', label: 'YoY %', color: '#4ade80', width: 1.8 }]}
          rows={payeYoyRows}
          zeroLine
          yTickFmt={fmtPctTick}
          valueFmt={fmtPctTooltip}
        />
        <LinesPanel
          title="Average Weekly Earnings — Growth"
          subtitle="KAC3 total pay 3m avg YoY / KAI9 regular pay 3m avg YoY / KAF5 total pay single-month YoY — published rates, SA"
          lines={[
            { key: 'total3m', label: 'Total pay 3m YoY (KAC3)', color: '#e2e8f0', width: 2.2 },
            { key: 'regular3m', label: 'Regular pay 3m YoY (KAI9)', color: '#60a5fa', width: 1.8 },
            { key: 'total1m', label: 'Total pay 1m YoY (KAF5)', color: '#94a3b8', width: 1.2, dash: '4 3' },
          ]}
          rows={aweGrowthRows}
          zeroLine
          yTickFmt={fmtPctTick}
          valueFmt={fmtPctTooltip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real Average Weekly Earnings — Growth"
          subtitle="A3WW real total pay / A2FA real regular pay — 3m avg YoY %, published rates, SA"
          lines={[
            { key: 'realTotal', label: 'Real total pay 3m YoY (A3WW)', color: '#e2e8f0', width: 2 },
            { key: 'realRegular', label: 'Real regular pay 3m YoY (A2FA)', color: '#60a5fa', width: 1.8 },
          ]}
          rows={realAweRows}
          zeroLine
          yTickFmt={fmtPctTick}
          valueFmt={fmtPctTooltip}
        />
        <LinesPanel
          title="PAYE Median & Mean Pay"
          subtitle="PAYE RTI monthly pay, £ per month — latest month provisional"
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.payrolled_employees} />}
          lines={[
            { key: 'median', label: 'Median pay', color: '#60a5fa', width: 1.8 },
            { key: 'mean', label: 'Mean pay', color: '#a78bfa', width: 1.8 },
          ]}
          rows={payRows}
          autoDomain
          yTickFmt={fmtGbp}
          valueFmt={fmtGbp}
        />
      </div>

      <SeriesExplorer
        title="AWE Sector Explorer"
        selectorLabel="Sector"
        items={AWE_EXPLORER_ITEMS}
        data={allData}
        defaultId="K54U"
        unitLabel="AWE index, SA, total pay ex arrears"
      />
    </>
  )
}
