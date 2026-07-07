import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
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

// UK household consumption dashboard — quarterly Consumer Trends (CVM SA £m).
// Every panel is a PROXY for the US monthly PCE-by-category page (quarterly,
// national-accounts basis) and carries the consumption_quarterly badge.
// CVM chained-volume categories are NOT additive: no contribution/stacked
// decomposition is built here and categories are never summed.

type AllData = Record<string, WD[]>
type Row = { date: string; [key: string]: number | string | null }

const SERIES: ReadonlyArray<{ cdid: string; dataset: string }> = [
  { cdid: 'ABJR', dataset: 'ukea' },  // total real household consumption, CVM SA £m
  { cdid: 'UTID', dataset: 'qna' },   // durables
  { cdid: 'UTIT', dataset: 'ct' },    // semi-durables
  { cdid: 'UTIL', dataset: 'qna' },   // non-durables
  { cdid: 'UTIP', dataset: 'qna' },   // services
  { cdid: 'ABJQ', dataset: 'ukea' },  // nominal total household consumption, CP SA £m
]

const CATEGORIES = [
  { key: 'UTID', label: 'Durables', color: '#60a5fa' },
  { key: 'UTIT', label: 'Semi-Durables', color: '#4ade80' },
  { key: 'UTIL', label: 'Non-Durables', color: '#f59e0b' },
  { key: 'UTIP', label: 'Services', color: '#a78bfa' },
] as const

const DEFAULT_Q = 80 // ~20 years of quarters

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

// ── generic multi-line panel ─────────────────────────────────────────────────

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
  const [vis, setVis] = useState<Set<string>>(() => new Set(lines.map(l => l.key)))
  const toggle = (key: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultCount), end: rows.length - 1 })
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
          {lines.map(l => (
            <button key={l.key} type="button"
              className={`${kit.legendItem} ${vis.has(l.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(l.key)}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
            </button>
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
            {lines.filter(l => vis.has(l.key)).map(l => (
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

// ══════════════════════════════════════════════════════════════════════════════

export function UKConsumptionContent() {
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

  const badge = <ProxyBadge caveat={UK_PROXY_CAVEATS.consumption_quarterly} />

  const totalLevelRows = useMemo(
    () => buildRows([{ key: 'ABJR', data: allData['ABJR'] ?? [] }]),
    [allData]
  )
  const totalYoyRows = useMemo(
    () => buildRows([{ key: 'ABJR', data: computeChangePct(allData['ABJR'] ?? [], 4) }]),
    [allData]
  )
  const catLevelRows = useMemo(
    () => buildRows(CATEGORIES.map(c => ({ key: c.key, data: allData[c.key] ?? [] }))),
    [allData]
  )
  const catYoyRows = useMemo(
    () => buildRows(CATEGORIES.map(c => ({ key: c.key, data: computeChangePct(allData[c.key] ?? [], 4) }))),
    [allData]
  )
  const nomRealRows = useMemo(
    () => buildRows([
      { key: 'ABJQ', data: computeChangePct(allData['ABJQ'] ?? [], 4) },
      { key: 'ABJR', data: computeChangePct(allData['ABJR'] ?? [], 4) },
    ]),
    [allData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {SERIES.length} ONS Consumer Trends series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (Consumer Trends) &mdash; quarterly, chained volume measure, SA, &pound;m.
        CVM categories are chain-linked and not additive; no contribution decomposition is shown.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real Household Consumption"
          subtitle="ABJR — total household final consumption expenditure, CVM SA £m"
          badge={badge}
          lines={[{ key: 'ABJR', label: 'Real Consumption (CVM £m)', color: '#60a5fa' }]}
          rows={totalLevelRows}
          tickFmt={fmtGbpTick}
          tooltipFmt={fmtGbpTooltip}
        />
        <LinesPanel
          title="Real Household Consumption — YoY %"
          subtitle="ABJR — % change vs same quarter a year earlier"
          badge={badge}
          lines={[{ key: 'ABJR', label: 'Real Consumption YoY', color: '#ec4899' }]}
          rows={totalYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Consumption by Durability — Real Levels"
          subtitle="UTID / UTIT / UTIL / UTIP — CVM SA £m (chain-linked; not additive)"
          badge={badge}
          lines={CATEGORIES}
          rows={catLevelRows}
          tickFmt={fmtGbpTick}
          tooltipFmt={fmtGbpTooltip}
        />
        <LinesPanel
          title="Consumption by Durability — YoY %"
          subtitle="Real spending by durability class — % change vs year earlier"
          badge={badge}
          lines={CATEGORIES}
          rows={catYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Durables vs Services — YoY"
          subtitle="UTID vs UTIP — real spending, % change vs year earlier"
          badge={badge}
          lines={[
            { key: 'UTID', label: 'Durables', color: '#60a5fa' },
            { key: 'UTIP', label: 'Services', color: '#a78bfa' },
          ]}
          rows={catYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Nominal vs Real Consumption — YoY"
          subtitle="ABJQ (current prices) vs ABJR (CVM) — the wedge is the implied consumption deflator"
          badge={badge}
          lines={[
            { key: 'ABJQ', label: 'Nominal YoY', color: '#f59e0b' },
            { key: 'ABJR', label: 'Real YoY', color: '#60a5fa' },
          ]}
          rows={nomRealRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
