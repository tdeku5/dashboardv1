import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type WD, type ContribRow,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import kit from '../components/charts/ChartKit.module.css'

// Canada quarterly GDP, expenditure-based — StatCan table 36-10-0104 (SAAR,
// 1961→). Unlike the US/UK pages, StatCan publishes official percentage-point
// contributions to annualized QoQ growth AND the official real QoQ % itself,
// so the contribution panel is fed with PUBLISHED figures (DIRECT — no client
// decomposition, no proxy badge). Chained-dollar real components are NOT
// additive and are never summed here.

type AllData = Record<string, StatcanPoint[]>

// ── Published contributions (36-10-0104) ─────────────────────────────────────
// Imports are already sign-correct as published — passed through unmodified.

const CTB_BUCKETS = [
  { key: 'hh',      code: 'CA_CTB_HHCONS',  label: 'Household Consumption', color: '#60a5fa' },
  { key: 'gov',     code: 'CA_CTB_GOV',     label: 'Government',            color: '#a78bfa' },
  { key: 'gfcf',    code: 'CA_CTB_GFCF',    label: 'Fixed Investment',      color: '#4ade80' },
  { key: 'invent',  code: 'CA_CTB_INVENT',  label: 'Inventories',           color: '#94a3b8' },
  { key: 'exports', code: 'CA_CTB_EXPORTS', label: 'Exports',               color: '#fbbf24' },
  { key: 'imports', code: 'CA_CTB_IMPORTS', label: 'Imports',               color: '#f87171' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] =
  CTB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// ── Explorer items (real components, chained 2017$) ─────────────────────────

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CA_GDP_R',     label: 'Real GDP at Market Prices', depth: 0 },
  { id: 'CA_HHCONS_R',  label: 'Household Consumption', depth: 1 },
  { id: 'CA_GOV_R',     label: 'Government Consumption', depth: 1 },
  { id: 'CA_GFCF_R',    label: 'Gross Fixed Capital Formation', depth: 1 },
  { id: 'CA_BUSGFCF_R', label: 'Business Gross Fixed Capital Formation', depth: 1 },
  { id: 'CA_RESID_R',   label: 'Residential Structures', depth: 1 },
  { id: 'CA_INVENT_R',  label: 'Investment in Inventories', depth: 1 },
  { id: 'CA_EXPORTS_R', label: 'Exports of Goods & Services', depth: 1 },
  { id: 'CA_IMPORTS_R', label: 'Imports of Goods & Services', depth: 1 },
]

const ALL_CODES = [
  // Real (chained 2017$)
  ...EXPLORER_ITEMS.map(i => i.id),
  // Nominal (current prices)
  'CA_GDP_N', 'CA_HHCONS_N', 'CA_GOV_N', 'CA_GFCF_N', 'CA_EXPORTS_N', 'CA_IMPORTS_N',
  // Published rates + contributions
  'CA_GDP_QOQ',
  ...CTB_BUCKETS.map(b => b.code),
] as const

const fmtCadLevel = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}T` : `$${(v / 1e3).toFixed(0)}B`

// ── Date-union of the six published contribution series + published QoQ ─────

function buildPublishedContrib(allData: AllData): ContribRow[] {
  const dates = new Set<string>()
  for (const b of CTB_BUCKETS) for (const p of allData[b.code] ?? []) dates.add(p.date)
  const maps = CTB_BUCKETS.map(b => ({
    key: b.key,
    m: new Map((allData[b.code] ?? []).map(p => [p.date, p.value])),
  }))
  const lineMap = new Map((allData['CA_GDP_QOQ'] ?? []).map(p => [p.date, p.value]))
  return [...dates].sort().map(date => {
    const row: ContribRow = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    row.line = lineMap.get(date) ?? null
    return row
  })
}

// ── Published QoQ (annualized) bar panel ─────────────────────────────────────

function QoqBarsPanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, value: d.value })), [data])

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>(
    { start: 0, end: 0, period: '10Y' })
  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - 39), end, period: '10Y' })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Real GDP Growth &mdash; published QoQ annualized</div>
          <div className={kit.sectionSubtitle}>
            StatCan-published quarter-over-quarter % change at annual rates (36-10-0104)
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            Expansion
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(248,113,113,0.75)' }} />
            Contraction
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
                [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'Real GDP QoQ (ann.)'] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="value" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, idx) => (
                <Cell key={`q-${idx}`}
                  fill={r.value >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'} />
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

export function CAGDPContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load StatCan data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const contribRows = useMemo(
    () => Object.keys(allData).length > 0 ? buildPublishedContrib(allData) : [],
    [allData]
  )

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan GDP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0104) &mdash; quarterly, seasonally adjusted at annual rates,
        chained 2017 dollars / current prices. Chained-dollar components are not additive.
      </div>

      <ContribSection
        title="Contributions to Real GDP Growth (annualized)"
        subtitle="StatCan-published contributions (36-10-0104) — not client-computed"
        data={contribRows}
        items={CONTRIB_ITEMS}
        lineKey="line"
        lineLabel="Real GDP QoQ (ann.)"
        clipPrefix="cagdpctb"
        periods={QUICK_PERIODS_Q}
        defaultCount={40}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Real GDP"
          subtitle="Chained 2017$ SAAR (v62305752) — YoY / annualized"
          data={allData['CA_GDP_R'] ?? []}
          frequency="quarterly"
        />
        <RatesChart
          title="Nominal GDP"
          subtitle="Current prices SAAR (v62305783) — YoY / annualized"
          data={allData['CA_GDP_N'] ?? []}
          frequency="quarterly"
        />
      </div>

      <QoqBarsPanel data={allData['CA_GDP_QOQ'] ?? []} />

      <SeriesExplorer
        title="Canada GDP Explorer"
        selectorLabel="Component"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CA_GDP_R"
        frequency="quarterly"
        unitLabel="Chained 2017 $millions, SAAR"
        levelFormatter={fmtCadLevel}
      />
    </>
  )
}
