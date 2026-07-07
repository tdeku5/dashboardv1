import { useState, useEffect, useMemo } from 'react'
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
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK producer prices (ONS PPI / MM22 dataset, all NSA, monthly). Output PPI
// (factory-gate) and Core Output PPI stand in for US PPI Final Demand /
// PPI ex food & energy — both are PROXY substitutes (manufacturing scope
// only, no services or final-demand concept) and carry badges. Input PPI has
// no US-page analog and is shown unbadged.

type AllData = Record<string, WD[]>

const ALL_CDIDS = [
  'JVZ7', // output: net sector output, manufactured products — headline output
  'JVZ8', // output: all manufacturing ex duty
  'GBBV', // core output: ex food, beverages, tobacco & petroleum
  'GD6Y', // output: total ex duty
  'K646', // input: all manufacturing incl CCL — headline input
  'K645', // input: fuel
  'FSQ6', // input: other materials
  'FSQ7', // input: chemicals
  'G6SN', // division sample: textiles, domestic
  'G8ZD', // division sample: textiles, total
  'G75I', // division sample: furniture, domestic
  'G942', // division sample: furniture, total
] as const

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'JVZ7', label: 'Output PPI — Net Sector Output, Manufactured Products', depth: 0 },
  { id: 'JVZ8', label: 'Output PPI — All Manufacturing ex Duty', depth: 1 },
  { id: 'GD6Y', label: 'Output PPI — Total ex Duty', depth: 1 },
  { id: 'GBBV', label: 'Core Output PPI — ex Food, Beverages, Tobacco & Petroleum', depth: 1 },
  { id: 'K646', label: 'Input PPI — All Manufacturing incl CCL', depth: 0 },
  { id: 'K645', label: 'Input PPI — Fuel', depth: 1 },
  { id: 'FSQ6', label: 'Input PPI — Other Materials', depth: 1 },
  { id: 'FSQ7', label: 'Input PPI — Chemicals', depth: 1 },
  { id: 'G6SN', label: 'Output PPI — Textiles (domestic)', depth: 1 },
  { id: 'G8ZD', label: 'Output PPI — Textiles (total)', depth: 1 },
  { id: 'G75I', label: 'Output PPI — Furniture (domestic)', depth: 1 },
  { id: 'G942', label: 'Output PPI — Furniture (total)', depth: 1 },
]

// ── Output vs Input YoY panel ────────────────────────────────────────────────

type OutInRow = { date: string; output: number | null; input: number | null }

function OutputInputPanel({ output, input }: { output: WD[]; input: WD[] }) {
  const rows = useMemo((): OutInRow[] => {
    const oy = computeChangePct(output, 12)
    const iy = computeChangePct(input, 12)
    const oMap = new Map(oy.map(p => [p.date, p.value]))
    const iMap = new Map(iy.map(p => [p.date, p.value]))
    const dates = [...new Set([...oy.map(p => p.date), ...iy.map(p => p.date)])].sort()
    return dates.map(date => ({
      date,
      output: oMap.get(date) ?? null,
      input: iMap.get(date) ?? null,
    }))
  }, [output, input])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (rows.length === 0) return
    setBrush({ start: Math.max(0, rows.length - 240), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Output vs Input PPI &mdash; YoY</div>
          <div className={kit.sectionSubtitle}>JVZ7 (output) vs K646 (input) &mdash; YoY %&Delta;, NSA</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#60a5fa' }} />
            Output PPI (JVZ7)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#f59e0b' }} />
            Input PPI (K646)
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
                const lbl = name === 'output' ? 'Output PPI' : 'Input PPI'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Line type="monotone" dataKey="output" name="Output PPI"
              stroke="#60a5fa" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Line type="monotone" dataKey="input" name="Input PPI"
              stroke="#f59e0b" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
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

export function UKPPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'ppi')
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CDIDS.length} ONS PPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (PPI/MM22) &mdash; monthly, 2015=100, not seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Output PPI"
          subtitle="JVZ7 — net sector output, manufactured products — YoY / annualized (NSA)"
          data={allData['JVZ7'] ?? []}
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.ppi_headline} />}
        />
        <RatesChart
          title="Core Output PPI"
          subtitle="GBBV — ex food, beverages, tobacco & petroleum — YoY / annualized (NSA)"
          data={allData['GBBV'] ?? []}
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.ppi_core} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Input PPI"
          subtitle="Materials & fuels purchased by manufacturing (no US-page analog)"
          data={allData['K646'] ?? []}
        />
        <OutputInputPanel output={allData['JVZ7'] ?? []} input={allData['K646'] ?? []} />
      </div>

      <SeriesExplorer
        title="UK PPI Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={allData}
        defaultId="JVZ7"
        unitLabel="Index, 2015=100, NSA"
      />
    </>
  )
}
