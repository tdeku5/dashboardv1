import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK household income dashboard — quarterly national-accounts measures.
// RHDI panels are a PROXY for the US monthly Personal Income & Outlays page
// (quarterly only — no UK monthly personal-income release exists) and carry
// the household_income badge. Saving ratio and compensation are DIRECT/ADD.

type AllData = Record<string, WD[]>
type Row = { date: string; [key: string]: number | string | null }

const SERIES: ReadonlyArray<{ cdid: string; dataset: string }> = [
  { cdid: 'NRJR', dataset: 'qna' },   // real household disposable income, CVM SA £m
  { cdid: 'KHI9', dataset: 'qna' },   // RHDI annual growth % SA (published)
  { cdid: 'IHXY', dataset: 'ukea' },  // RHDI per head, NSA
  { cdid: 'DGD8', dataset: 'ukea' },  // households' saving ratio % SA
  { cdid: 'DTWM', dataset: 'ukea' },  // compensation of employees, CP SA £m
]

const DEFAULT_Q = 80 // ~20 years of quarters

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtGbpTick = (v: number) =>
  Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(0)}bn` : `£${v.toFixed(0)}m`
const fmtGbpTooltip = (v: number) =>
  `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}m`
const fmtGbpUnitTick = (v: number) =>
  `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
const fmtGbpUnitTooltip = fmtGbpUnitTick

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

// ── multi-line panel ─────────────────────────────────────────────────────────

type LineDef = { key: string; label: string; color: string }

function LinesPanel({
  title, subtitle, badge, lines, rows,
  tickFmt, tooltipFmt, zeroRef = false, defaultCount = DEFAULT_Q,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineDef[]
  rows: Row[]
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={tickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
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

// ── signed-bars panel (published growth series) ──────────────────────────────

function GrowthBarsPanel({
  title, subtitle, badge, barLabel, rows, defaultCount = DEFAULT_Q,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  barLabel: string
  rows: Row[]
  defaultCount?: number
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
            {barLabel} +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} &minus;
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
            <Bar dataKey="value" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`g-${i}`}
                  fill={typeof r.value === 'number' && r.value < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
              ))}
            </Bar>
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

export function UKHouseholdIncomeContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load ONS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const badge = <ProxyBadge caveat={UK_PROXY_CAVEATS.household_income} />

  const rhdiLevelRows = useMemo(
    () => buildRows([{ key: 'NRJR', data: allData['NRJR'] ?? [] }]),
    [allData]
  )
  const rhdiGrowthRows = useMemo(
    () => buildRows([{ key: 'value', data: allData['KHI9'] ?? [] }]),
    [allData]
  )
  const perHeadLevelRows = useMemo(
    () => buildRows([{ key: 'IHXY', data: allData['IHXY'] ?? [] }]),
    [allData]
  )
  const perHeadYoyRows = useMemo(
    () => buildRows([{ key: 'IHXY', data: computeChangePct(allData['IHXY'] ?? [], 4) }]),
    [allData]
  )
  const savingRows = useMemo(
    () => buildRows([{ key: 'DGD8', data: allData['DGD8'] ?? [] }]),
    [allData]
  )
  const coeLevelRows = useMemo(
    () => buildRows([{ key: 'DTWM', data: allData['DTWM'] ?? [] }]),
    [allData]
  )
  const coeYoyRows = useMemo(
    () => buildRows([{ key: 'DTWM', data: computeChangePct(allData['DTWM'] ?? [], 4) }]),
    [allData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {SERIES.length} ONS household income series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (Quarterly National Accounts / UK Economic Accounts) &mdash; quarterly
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real Household Disposable Income"
          subtitle="NRJR — real households' disposable income, CVM SA £m"
          badge={badge}
          lines={[{ key: 'NRJR', label: 'RHDI (CVM £m)', color: '#60a5fa' }]}
          rows={rhdiLevelRows}
          tickFmt={fmtGbpTick}
          tooltipFmt={fmtGbpTooltip}
        />
        <GrowthBarsPanel
          title="RHDI — Published Annual Growth"
          subtitle="KHI9 — real households' disposable income growth, % vs year earlier, SA"
          badge={badge}
          barLabel="RHDI YoY"
          rows={rhdiGrowthRows}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="RHDI per Head"
          subtitle="IHXY — real household disposable income per head, NSA (carries seasonal variation)"
          badge={badge}
          lines={[{ key: 'IHXY', label: 'RHDI per Head', color: '#4ade80' }]}
          rows={perHeadLevelRows}
          tickFmt={fmtGbpUnitTick}
          tooltipFmt={fmtGbpUnitTooltip}
        />
        <LinesPanel
          title="RHDI per Head — YoY %"
          subtitle="IHXY — % change vs same quarter a year earlier (NSA)"
          badge={badge}
          lines={[{ key: 'IHXY', label: 'RHDI per Head YoY', color: '#ec4899' }]}
          rows={perHeadYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <LinesPanel
        title="Households' Saving Ratio"
        subtitle="DGD8 — saving as % of total available household resources, SA. No direct US-page analog (the US personal saving rate is monthly)"
        lines={[{ key: 'DGD8', label: 'Saving Ratio (%)', color: '#a78bfa' }]}
        rows={savingRows}
        tickFmt={fmtPctTick}
        tooltipFmt={fmtPctTooltip}
        zeroRef
        defaultCount={Number.MAX_SAFE_INTEGER}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Compensation of Employees"
          subtitle="DTWM — current prices, SA £m"
          lines={[{ key: 'DTWM', label: 'Compensation (CP £m)', color: '#f59e0b' }]}
          rows={coeLevelRows}
          tickFmt={fmtGbpTick}
          tooltipFmt={fmtGbpTooltip}
        />
        <LinesPanel
          title="Compensation of Employees — YoY %"
          subtitle="DTWM — % change vs same quarter a year earlier"
          lines={[{ key: 'DTWM', label: 'Compensation YoY', color: '#ec4899' }]}
          rows={coeYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
