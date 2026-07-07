import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type WD, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_M,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import kit from '../components/charts/ChartKit.module.css'

// Canada MONTHLY real GDP by industry — StatCan table 36-10-0434 (chained
// 2017$, value-added at basic prices, SA, 1997→). All series are DIRECT reads
// of the published monthly GDP cube (no proxy badges). Chained-dollar industry
// splits are not additive and are never summed.

type AllData = Record<string, StatcanPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CA_MGDP_ALL',    label: 'All Industries', depth: 0 },
  { id: 'CA_MGDP_GOODS',  label: 'Goods-producing Industries', depth: 1 },
  { id: 'CA_MGDP_SVCS',   label: 'Services-producing Industries', depth: 1 },
  { id: 'CA_MGDP_MFG',    label: 'Manufacturing', depth: 1 },
  { id: 'CA_MGDP_CONSTR', label: 'Construction', depth: 1 },
  { id: 'CA_MGDP_MINING', label: 'Mining, Quarrying & Oil and Gas', depth: 1 },
  { id: 'CA_MGDP_RETAIL', label: 'Retail Trade', depth: 1 },
]

const ALL_CODES = EXPLORER_ITEMS.map(i => i.id)

const GOODS_SVCS = [
  { key: 'CA_MGDP_GOODS', label: 'Goods-producing YoY', color: '#f59e0b' },
  { key: 'CA_MGDP_SVCS',  label: 'Services-producing YoY', color: '#60a5fa' },
] as const

const DEFAULT_M = 120 // ~10 years of months

const fmtCadLevel = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}T` : `$${(v / 1e3).toFixed(0)}B`

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

// ── Goods vs Services YoY panel ──────────────────────────────────────────────

function GoodsSvcsPanel({ rows }: { rows: Row[] }) {
  const [vis, setVis] = useState<Set<string>>(() => new Set(GOODS_SVCS.map(l => l.key)))
  const toggle = (key: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>(
    { start: 0, end: 0, period: '10Y' })
  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (DEFAULT_M - 1)), end, period: '10Y' })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Goods vs Services GDP &mdash; YoY</div>
          <div className={kit.sectionSubtitle}>
            Goods-producing vs services-producing industries — % change vs year earlier (chained 2017$)
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {GOODS_SVCS.map(l => (
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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = GOODS_SVCS.find(x => x.key === name)
                return [typeof v === 'number' ? fmtPctTooltip(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {GOODS_SVCS.filter(l => vis.has(l.key)).map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                stroke={l.color} strokeWidth={1.8}
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

// ── MoM % bars + 6-mo MA panel ───────────────────────────────────────────────

function MomPanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const mom = computeChangePct(data, 1)
    const ma = computeMA(mom, 6)
    return mom.map((d, i) => ({ date: d.date, mom: d.value, ma: ma[i]?.value ?? null }))
  }, [data])

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>(
    { start: 0, end: 0, period: '10Y' })
  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (DEFAULT_M - 1)), end, period: '10Y' })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Monthly GDP &mdash; MoM %</div>
          <div className={kit.sectionSubtitle}>
            All-industries month-over-month % change with 6-month moving average
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            MoM % (+)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(248,113,113,0.75)' }} />
            MoM % (&minus;)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            6-mo MA
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
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [fmtPctTooltip(v), name === 'ma' ? '6-mo MA' : 'MoM'] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, idx) => (
                <Cell key={`m-${idx}`}
                  fill={(r.mom ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma" name="6-mo MA"
              stroke="#e2e8f0" strokeWidth={1.5}
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

export function CAMonthlyGDPContent() {
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

  const goodsSvcsRows = useMemo(
    () => buildRows(GOODS_SVCS.map(l => ({
      key: l.key,
      data: computeChangePct(allData[l.key] ?? [], 12),
    }))),
    [allData]
  )

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan monthly GDP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0434) &mdash; monthly real GDP by industry at basic prices,
        chained 2017 dollars, seasonally adjusted. Industry splits are not additive.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Monthly Real GDP — All Industries"
          subtitle="Chained 2017$ (v65201210) — YoY / annualized"
          data={allData['CA_MGDP_ALL'] ?? []}
        />
        <GoodsSvcsPanel rows={goodsSvcsRows} />
      </div>

      <MomPanel data={allData['CA_MGDP_ALL'] ?? []} />

      <SeriesExplorer
        title="Canada Monthly GDP Explorer"
        selectorLabel="Industry"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CA_MGDP_ALL"
        unitLabel="Chained 2017 $millions, monthly"
        levelFormatter={fmtCadLevel}
      />
    </>
  )
}
