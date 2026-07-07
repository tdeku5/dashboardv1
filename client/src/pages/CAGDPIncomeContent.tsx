import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  buildContribSeries,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import kit from '../components/charts/ChartKit.module.css'

// Canada GDP, income-based — StatCan table 36-10-0103 (quarterly, current
// prices, SAAR, 1961→). Nominal income components ARE additive, so the
// client-computed contribution stacks and share-of-GDP panel are valid
// (unlike chained-dollar volume splits). No gdp_income entry exists in
// CA_PROXY_CAVEATS (checked) — no badge; the slimmer-than-US-GDI framing is
// stated in panel subtitles instead. buildContribSeries 'yoy' subtracts 12
// calendar months (works for first-of-quarter dates); 'mom' = previous
// observation = QoQ.

type AllData = Record<string, StatcanPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = [
  'CA_GDI_COMP', 'CA_GDI_GOS', 'CA_GDI_GMI',
  'CA_GDI_TAXPROD', 'CA_GDI_TAXPRODUCTS', 'CA_GDI_GDP',
] as const

const COMPONENTS = [
  { key: 'comp',        seriesId: 'CA_GDI_COMP' },        // compensation of employees
  { key: 'gos',         seriesId: 'CA_GDI_GOS' },         // gross operating surplus
  { key: 'gmi',         seriesId: 'CA_GDI_GMI' },         // gross mixed income
  { key: 'taxprod',     seriesId: 'CA_GDI_TAXPROD' },     // taxes less subsidies on production
  { key: 'taxproducts', seriesId: 'CA_GDI_TAXPRODUCTS' }, // taxes less subsidies on products & imports
] as const

const CONTRIB_ITEMS: readonly ContribItem[] = [
  { id: 'comp',        label: 'Compensation of Employees',              color: '#60a5fa' },
  { id: 'gos',         label: 'Gross Operating Surplus',                color: '#4ade80' },
  { id: 'gmi',         label: 'Gross Mixed Income',                     color: '#a78bfa' },
  { id: 'taxprod',     label: 'Taxes less subsidies (production)',      color: '#f59e0b' },
  { id: 'taxproducts', label: 'Taxes less subsidies (products & imports)', color: '#94a3b8' },
]

const SUBTITLE_NOTE = 'GDP by income approach — slimmer decomposition than the US GDI page'

const DEFAULT_Q = 80 // ~20 years of quarters

// ── income shares stacked-area panel ─────────────────────────────────────────

function SharesPanel({ rows }: { rows: Row[] }) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - DEFAULT_Q), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Income Shares of GDP</div>
          <div className={kit.sectionSubtitle}>
            Each income component as % of nominal GDP (36-10-0103) — current-price levels are additive
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {CONTRIB_ITEMS.map(item => (
            <span key={item.id} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendSwatch} style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const item = CONTRIB_ITEMS.find(x => x.id === name)
                return [typeof v === 'number' ? `${v.toFixed(1)}%` : '-', item?.label ?? String(name)] as [string, string]
              }} />
            {CONTRIB_ITEMS.map(item => (
              <Area key={item.id} type="monotone" dataKey={item.id} stackId="1"
                stroke="none" fill={item.color} fillOpacity={0.85} isAnimationActive={false} />
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

// ══════════════════════════════════════════════════════════════════════════════

export function CAGDPIncomeContent() {
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

  const contribYoy = useMemo(
    () => Object.keys(allData).length > 0
      ? buildContribSeries(allData, 'CA_GDI_GDP', COMPONENTS, 'line', 'yoy')
      : [],
    [allData]
  )
  // buildContribSeries mode 'mom' computes vs the previous observation = QoQ for quarterly data
  const contribQoq = useMemo(
    () => Object.keys(allData).length > 0
      ? buildContribSeries(allData, 'CA_GDI_GDP', COMPONENTS, 'line', 'mom')
      : [],
    [allData]
  )

  const shareRows = useMemo((): Row[] => {
    const gdp = allData['CA_GDI_GDP'] ?? []
    const maps = COMPONENTS.map(c => ({
      key: c.key,
      m: new Map((allData[c.seriesId] ?? []).map(p => [p.date, p.value])),
    }))
    return gdp.map(p => {
      const row: Row = { date: p.date }
      for (const { key, m } of maps) {
        const v = m.get(p.date)
        row[key] = v != null && p.value !== 0 ? (v / p.value) * 100 : null
      }
      return row
    })
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan GDP(I) series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0103) &mdash; quarterly, current prices, seasonally adjusted at annual rates
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ContribSection
          title="GDP(I) — YoY Contribution"
          subtitle={`Component contribution to nominal GDP YoY %Δ (current prices, additive). ${SUBTITLE_NOTE}`}
          data={contribYoy}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="Nominal GDP YoY"
          clipPrefix="cagdpiyoy"
          periods={QUICK_PERIODS_Q}
          defaultCount={40}
        />
        <ContribSection
          title="GDP(I) — QoQ Contribution"
          subtitle={`Component contribution to nominal GDP QoQ %Δ (current prices, additive). ${SUBTITLE_NOTE}`}
          data={contribQoq}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="Nominal GDP QoQ"
          clipPrefix="cagdpiqoq"
          periods={QUICK_PERIODS_Q}
          defaultCount={40}
        />
      </div>

      <SharesPanel rows={shareRows} />
    </>
  )
}
