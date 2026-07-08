import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import kit from '../components/charts/ChartKit.module.css'

// Japan Indices of Industrial Production dashboard — METI IIP (monthly, SA,
// 2020=100): mining & manufacturing production, manufacturing production,
// shipments, inventories, inventory ratio. All series are DIRECT analogs of
// the US industrial production complex — no proxy badges. HISTORY CAVEAT
// (mandatory, rendered in the source caption): the current 2020-base e-Stat
// tables begin 2018-01 — earlier history exists only in retired-base files
// and is NOT spliced here.

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = [
  'JP_IIP_PROD', 'JP_IIP_PROD_MFG', 'JP_IIP_SHIP', 'JP_IIP_INV', 'JP_IIP_INVRATIO',
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

const fmtDefault = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

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

const S_PROD_LVL: readonly PanelSeriesDef[] = [
  { key: 'prod', label: 'Mining & manufacturing production', color: '#e2e8f0', width: 2 },
  { key: 'mfg', label: 'Manufacturing production', color: '#60a5fa' },
]
const S_SHIP_INV_LVL: readonly PanelSeriesDef[] = [
  { key: 'ship', label: 'Shipments', color: '#4ade80', width: 2 },
  { key: 'inv', label: 'Inventories', color: '#f59e0b' },
]
const S_SHIP_INV_YOY: readonly PanelSeriesDef[] = [
  { key: 'ship', label: 'Shipments YoY', color: '#4ade80', width: 2 },
  { key: 'inv', label: 'Inventories YoY', color: '#f59e0b' },
]
const S_INVRATIO: readonly PanelSeriesDef[] = [
  { key: 'ratio', label: 'Inventory ratio (2020=100)', color: '#a78bfa', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtIdx = (v: number) => v.toFixed(1)
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPIIPContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat IIP data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const prod = useMemo(() => allData['JP_IIP_PROD'] ?? [], [allData])
  const ship = useMemo(() => allData['JP_IIP_SHIP'] ?? [], [allData])
  const inv = useMemo(() => allData['JP_IIP_INV'] ?? [], [allData])

  const prodLvlRows = useMemo(() => mergeByDate([
    { key: 'prod', data: prod },
    { key: 'mfg', data: allData['JP_IIP_PROD_MFG'] ?? [] },
  ]), [prod, allData])

  const shipInvLvlRows = useMemo(() => mergeByDate([
    { key: 'ship', data: ship },
    { key: 'inv', data: inv },
  ]), [ship, inv])

  const shipInvYoyRows = useMemo(() => mergeByDate([
    { key: 'ship', data: computeChangePct(ship, 12) },
    { key: 'inv', data: computeChangePct(inv, 12) },
  ]), [ship, inv])

  const invRatioRows = useMemo(() => mergeByDate([
    { key: 'ratio', data: allData['JP_IIP_INVRATIO'] ?? [] },
  ]), [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} e-Stat IIP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={SRC_NOTE}>
        METI Indices of Industrial Production (e-Stat) &mdash; monthly, seasonally adjusted, 2020=100;
        publishes with a ~3-month lag. HISTORY: current 2020-base tables begin 2018 &mdash;
        earlier history exists only in retired-base files and is not spliced.
      </div>

      <div style={GRID2}>
        <RatesChart
          title="Industrial Production — Growth"
          subtitle="Mining & manufacturing production index, YoY / annualized paces (SA)"
          data={prod} />
        <TSPanel key="iip-prod-lvl"
          title="Production — Level"
          subtitle="Mining & manufacturing vs manufacturing-only production indices, 2020=100 SA"
          data={prodLvlRows} series={S_PROD_LVL} fmtLeft={fmtIdx} />
      </div>

      <div style={GRID2}>
        <TSPanel key="iip-shipinv-lvl"
          title="Shipments vs Inventories — Level"
          subtitle="Mining & manufacturing shipments and producers' inventories, 2020=100 SA"
          data={shipInvLvlRows} series={S_SHIP_INV_LVL} fmtLeft={fmtIdx} />
        <TSPanel key="iip-shipinv-yoy"
          title="Shipments vs Inventories — YoY"
          subtitle="Inventories rising while shipments fall = involuntary stock build (late-cycle)"
          data={shipInvYoyRows} series={S_SHIP_INV_YOY} fmtLeft={fmtPct} zeroRef />
      </div>

      <TSPanel key="iip-invratio"
        title="Inventory Ratio"
        subtitle="Producers' inventory ratio (inventories ÷ shipments basis, 2020=100) — an inverse cycle signal: a rising ratio means shipments are softening relative to stocks, i.e. demand weakening; a falling ratio accompanies recoveries"
        data={invRatioRows} series={S_INVRATIO} fmtLeft={fmtIdx} />
    </>
  )
}
