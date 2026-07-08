import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchBojTsBatch, type EstatPoint } from '../lib/estat'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import kit from '../components/charts/ChartKit.module.css'

// Japan Producer Price Index dashboard — BoJ PPI (formerly the Corporate
// Goods Price Index, CGPI; renamed 2022), monthly index CY2020=100, history
// back to 1960 via the BoJ Time-Series Data Search API (PR01). DIRECT analog
// of the US PPI — no proxy badge. The page-level source caption MUST carry
// the BoJ attribution line ("content not guaranteed by the Bank of Japan").

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = ['JP_PPI'] as const

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

const S_LEVEL: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'PPI, all commodities (CY2020=100)', color: '#e2e8f0', width: 2 },
]
const S_YOY: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'PPI YoY %', color: '#ec4899', width: 2 },
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

export function JPPPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBojTsBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load BoJ PPI data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const ppi = useMemo(() => allData['JP_PPI'] ?? [], [allData])

  const levelRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: ppi },
  ]), [ppi])

  const yoyRows = useMemo(() => mergeByDate([
    { key: 'yoy', data: computeChangePct(ppi, 12) },
  ]), [ppi])

  if (loading) return <div className={kit.statusBlock}>Loading BoJ PPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={SRC_NOTE}>
        Source: Bank of Japan Time-Series Data Search API (PR01) &mdash; content not guaranteed by the Bank of Japan.
        Producer Price Index (formerly Corporate Goods Price Index, renamed 2022) &mdash; monthly, CY2020=100, history 1960&rarr;.
      </div>

      <div style={GRID2}>
        <RatesChart
          title="Producer Price Index — Growth"
          subtitle="PPI vs CPI divergence is the wholesale-to-consumer pass-through story: PPI leads when import/commodity costs move"
          data={ppi} />
        <TSPanel key="ppi-lvl"
          title="PPI — Level (1960→)"
          subtitle="All commodities, CY2020=100 — full BoJ long history"
          data={levelRows} series={S_LEVEL} fmtLeft={fmtIdx} defaultCount={Infinity} />
      </div>

      <TSPanel key="ppi-yoy-long"
        title="PPI — YoY, Long History"
        subtitle="Terminal-computed 12-month rate over the full 1960→ sample: captures the 1973–74 oil-shock spikes, the 1990s–2010s deflation era, and the 2021–23 import-cost surge"
        data={yoyRows} series={S_YOY} fmtLeft={fmtPct} zeroRef defaultCount={Infinity} />
    </>
  )
}
