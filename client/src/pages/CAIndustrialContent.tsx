import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada Industrial dashboard — monthly real GDP by industry (36-10-0434,
// chained 2017$, value-added) standing in for the US industrial production
// index, plus real manufacturing sales (16-10-0013, 2017$, direct survey
// data). GDP-by-industry panels carry the monthly_gdp_ip proxy badge (value-
// added GDP concept, not a gross-output production index); the manufacturing-
// sales panels are DIRECT — no badge.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = [
  'CA_MGDP_GOODS', 'CA_MGDP_MFG', 'CA_MGDP_MINING', 'CA_MGDP_CONSTR',
  'CA_MFG_SALES_R',
] as const

// ── Local panel kit (multi-line panel with brush) ────────────────────────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  dash?: string
  width?: number
}

function mergeByDate(
  inputs: ReadonlyArray<{ key: string; data: ReadonlyArray<NV> }>,
): PanelRow[] {
  const dates = new Set<string>()
  for (const s of inputs) for (const p of s.data) dates.add(p.date)
  const maps = inputs.map(s => ({ key: s.key, map: new Map(s.data.map(p => [p.date, p.value])) }))
  return [...dates].sort().map(date => {
    const row: PanelRow = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

const fmtDefault = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, zeroRef = false, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
}) {
  const fmtL = fmtLeft ?? fmtDefault

  const [vis, setVis] = useState<Set<string>>(() => new Set(series.map(s => s.key)))
  const toggle = (k: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!data.length) return
    setBrush({ start: Math.max(0, data.length - defaultCount), end: data.length - 1 })
  }, [data.length, defaultCount])

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
          {series.map(s => (
            <button key={s.key} type="button"
              className={`${kit.legendItem} ${vis.has(s.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(s.key)}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div className={kit.statusBlock}>No data</div>
      ) : (
        <div className={kit.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                tickFormatter={fmtAxisDate} minTickGap={60} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={['auto', 'auto']} tickFormatter={fmtL} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const s = series.find(x => x.key === name)
                  const label = s?.label ?? String(name)
                  if (typeof v !== 'number') return ['-', label] as [string, string]
                  return [fmtL(v), label] as [string, string]
                }} />
              {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
              {series.filter(s => vis.has(s.key)).map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                  stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
                  dot={false} isAnimationActive={false} connectNulls legendType="none" />
              ))}
              <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
                onChange={({ startIndex, endIndex }) =>
                  setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                {...BRUSH_STYLE} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Panel series definitions ─────────────────────────────────────────────────

const S_SECTORS: readonly PanelSeriesDef[] = [
  { key: 'mfg', label: 'Manufacturing YoY', color: '#60a5fa', width: 2 },
  { key: 'mining', label: 'Mining, quarrying, oil & gas YoY', color: '#f59e0b' },
  { key: 'constr', label: 'Construction YoY', color: '#4ade80' },
]
const S_MFG_SALES: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Real manufacturing sales (2017$)', color: '#60a5fa', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtBn = (v: number) => `$${(v / 1000).toLocaleString('en-CA', { maximumFractionDigits: 1 })}B` // stored in $ millions
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAIndustrialContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load StatCan industrial data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const sectorRows = useMemo(() => mergeByDate([
    { key: 'mfg', data: computeChangePct(allData['CA_MGDP_MFG'] ?? [], 12) },
    { key: 'mining', data: computeChangePct(allData['CA_MGDP_MINING'] ?? [], 12) },
    { key: 'constr', data: computeChangePct(allData['CA_MGDP_CONSTR'] ?? [], 12) },
  ]), [allData])

  const mfgSales = useMemo(() => allData['CA_MFG_SALES_R'] ?? [], [allData])

  const mfgSalesRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: mfgSales },
  ]), [mfgSales])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan industrial series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const gdpBadge = <ProxyBadge caveat={CA_PROXY_CAVEATS.monthly_gdp_ip} />

  return (
    <>
      <div style={SRC_NOTE}>
        Canada publishes no industrial production index &mdash; monthly GDP by industry
        (value-added, chained dollars) is the standard substitute. StatCan 36-10-0434 / 16-10-0013, monthly SA.
      </div>

      <div style={GRID2}>
        <RatesChart
          title="Goods-Producing GDP"
          subtitle="Monthly real GDP, goods-producing industries — chained 2017$ (36-10-0434)"
          badge={gdpBadge}
          data={allData['CA_MGDP_GOODS'] ?? []} />
        <RatesChart
          title="Manufacturing GDP"
          subtitle="Monthly real GDP, manufacturing — chained 2017$ (36-10-0434)"
          badge={gdpBadge}
          data={allData['CA_MGDP_MFG'] ?? []} />
      </div>

      <TSPanel key="i-sectors"
        title="Industrial Sectors — YoY"
        subtitle="Manufacturing / mining, quarrying, oil & gas / construction — monthly real GDP, YoY %"
        badge={gdpBadge}
        data={sectorRows} series={S_SECTORS} fmtLeft={fmtPct} zeroRef />

      <div style={GRID2}>
        <TSPanel key="i-mfg-lvl"
          title="Real Manufacturing Sales"
          subtitle="Sales of goods manufactured, 2017 constant dollars, SA (16-10-0013)"
          data={mfgSalesRows} series={S_MFG_SALES} fmtLeft={fmtBn} />
        <RatesChart
          title="Real Manufacturing Sales — Growth"
          subtitle="YoY / annualized growth of real manufacturing sales"
          data={mfgSales} />
      </div>
    </>
  )
}
