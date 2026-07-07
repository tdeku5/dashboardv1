import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, buildContribSeries,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK GDP(income approach) dashboard — quarterly, all current prices SA £m.
// PROXY for the US quarterly GDI page (NIPA 1.10): the UK decomposition is
// slimmer (4 income lines) and no real GDI equivalent is published.
// Current-price income components ARE additive, so contribution stacks and
// share-of-GDP panels are valid here (unlike CVM volume splits).

type AllData = Record<string, WD[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CDIDS = ['YBHA', 'DTWM', 'CGBX', 'ROYH', 'CMVL'] as const

const COMPONENTS = [
  { key: 'comp', seriesId: 'DTWM' },   // compensation of employees
  { key: 'gos', seriesId: 'CGBX' },    // gross operating surplus
  { key: 'mixed', seriesId: 'ROYH' },  // mixed income
  { key: 'taxes', seriesId: 'CMVL' },  // taxes less subsidies on production
] as const

const CONTRIB_ITEMS: readonly ContribItem[] = [
  { id: 'comp', label: 'Compensation of Employees', color: '#60a5fa' },
  { id: 'gos', label: 'Gross Operating Surplus', color: '#4ade80' },
  { id: 'mixed', label: 'Mixed Income', color: '#a78bfa' },
  { id: 'taxes', label: 'Taxes less Subsidies', color: '#f59e0b' },
]

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
            Each income component as % of nominal GDP (YBHA) — current-price levels are additive
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

export function UKGDPIncomeContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'ukea')
        .then(d => [cdid, d] as [string, WD[]])
        .catch(() => [cdid, []] as [string, WD[]])
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

  const badge = <ProxyBadge caveat={UK_PROXY_CAVEATS.gdp_income} />

  const contribYoy = useMemo(
    () => Object.keys(allData).length > 0 ? buildContribSeries(allData, 'YBHA', COMPONENTS, 'line', 'yoy') : [],
    [allData]
  )
  // buildContribSeries mode 'mom' computes vs the previous observation = QoQ for quarterly data
  const contribQoq = useMemo(
    () => Object.keys(allData).length > 0 ? buildContribSeries(allData, 'YBHA', COMPONENTS, 'line', 'mom') : [],
    [allData]
  )

  const shareRows = useMemo((): Row[] => {
    const gdp = allData['YBHA'] ?? []
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CDIDS.length} ONS GDP(I) series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (UK Economic Accounts) &mdash; quarterly, current prices, SA, &pound;m
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ContribSection
          title="GDP(I) — YoY Contribution"
          subtitle="Component contribution to nominal GDP YoY %Δ (current prices, additive)"
          badge={badge}
          data={contribYoy}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="Nominal GDP YoY"
          clipPrefix="ukgdpiyoy"
          periods={QUICK_PERIODS_Q}
          defaultCount={40}
        />
        <ContribSection
          title="GDP(I) — QoQ Contribution"
          subtitle="Component contribution to nominal GDP QoQ %Δ (current prices, additive)"
          badge={badge}
          data={contribQoq}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="Nominal GDP QoQ"
          clipPrefix="ukgdpiqoq"
          periods={QUICK_PERIODS_Q}
          defaultCount={40}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <SharesPanel rows={shareRows} />
        <RatesChart
          title="Nominal GDP"
          subtitle="YBHA — YoY / annualized (current prices SA)"
          data={allData['YBHA'] ?? []}
          frequency="quarterly"
        />
      </div>
    </>
  )
}
