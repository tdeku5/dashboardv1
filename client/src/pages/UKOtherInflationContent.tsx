import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import kit from '../components/charts/ChartKit.module.css'

// UK "other inflation" measures — CPI vs CPIH vs RPI cross-measure view, the
// RPI–CPI wedge, and CPI rents (04.1). All series are DIRECT ONS MM23
// equivalents — no proxy badges. The BoE/Ipsos inflation-expectations panel
// (quarterly survey) is deferred until that source is ingested; deliberately
// no placeholder panel is rendered for it.

type AllData = Record<string, WD[]>

const ALL_CDIDS = [
  'D7G7', // CPI all items YoY %
  'L55O', // CPIH all items YoY %
  'CZBH', // RPI all items YoY %
  'D7BT', // CPI all items index
  'L522', // CPIH all items index
  'CHAW', // RPI all items index
  'D7CE', // CPI 04.1 actual rents index
  'D7GQ', // CPI 04.1 actual rents YoY %
] as const

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'D7BT', label: 'CPI — All Items', depth: 0 },
  { id: 'L522', label: 'CPIH — All Items', depth: 0 },
  { id: 'CHAW', label: 'RPI — All Items', depth: 0 },
]

// ── (a) CPI / CPIH / RPI published YoY rates ─────────────────────────────────

type MeasureRow = { date: string; cpi: number | null; cpih: number | null; rpi: number | null }

const MEASURES = [
  { key: 'cpi', cdid: 'D7G7', label: 'CPI YoY', color: '#e2e8f0' },
  { key: 'cpih', cdid: 'L55O', label: 'CPIH YoY', color: '#60a5fa' },
  { key: 'rpi', cdid: 'CZBH', label: 'RPI YoY', color: '#f59e0b' },
] as const

function MeasuresPanel({ allData }: { allData: AllData }) {
  const rows = useMemo((): MeasureRow[] => {
    const maps = MEASURES.map(m => new Map((allData[m.cdid] ?? []).map(p => [p.date, p.value])))
    const dates = [...new Set(MEASURES.flatMap(m => (allData[m.cdid] ?? []).map(p => p.date)))]
      .filter(d => d >= '1990-01-01')
      .sort()
    return dates.map(date => ({
      date,
      cpi: maps[0].get(date) ?? null,
      cpih: maps[1].get(date) ?? null,
      rpi: maps[2].get(date) ?? null,
    }))
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (rows.length === 0) return
    setBrush({ start: Math.max(0, rows.length - 240), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>UK Inflation Measures &mdash; YoY</div>
          <div className={kit.sectionSubtitle}>Published 12-month rates: CPI (D7G7) / CPIH (L55O) / RPI (CZBH), from 1990</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {MEASURES.map(m => (
            <span key={m.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: m.color }} />
              {m.label}
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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                const m = MEASURES.find(x => x.key === name)
                return [fmtPctTooltip(v), m?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <ReferenceLine y={2} stroke="rgba(148,163,184,0.5)" strokeWidth={1} strokeDasharray="4 4" />
            {MEASURES.map(m => (
              <Line key={m.key} type="monotone" dataKey={m.key} name={m.label}
                stroke={m.color} strokeWidth={m.key === 'cpi' ? 2 : 1.6}
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

// ── (b) RPI − CPI wedge ──────────────────────────────────────────────────────

type WedgeRow = { date: string; wedge: number }

function WedgePanel({ allData }: { allData: AllData }) {
  const rows = useMemo((): WedgeRow[] => {
    const cpiMap = new Map((allData['D7G7'] ?? []).map(p => [p.date, p.value]))
    const out: WedgeRow[] = []
    for (const p of allData['CZBH'] ?? []) {
      const cpi = cpiMap.get(p.date)
      if (cpi == null) continue
      out.push({ date: p.date, wedge: p.value - cpi })
    }
    return out
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (rows.length === 0) return
    setBrush({ start: Math.max(0, rows.length - 240), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>RPI&ndash;CPI Wedge</div>
          <div className={kit.sectionSubtitle}>RPI YoY (CZBH) minus CPI YoY (D7G7), percentage points</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            RPI above CPI
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            RPI below CPI
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
              formatter={(v: unknown) => [
                typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)} pp` : '-',
                'RPI − CPI',
              ] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="wedge" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`w-${i}`}
                  fill={r.wedge >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
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

// ── (c) CPI rents (04.1) YoY + 12-mo MA ──────────────────────────────────────

type RentsRow = { date: string; yoy: number | null; ma: number | null }

function RentsPanel({ allData }: { allData: AllData }) {
  const rows = useMemo((): RentsRow[] => {
    const yoy = allData['D7GQ'] ?? []
    const ma = computeMA(yoy, 12)
    return yoy.map((p, i) => ({ date: p.date, yoy: p.value, ma: ma[i]?.value ?? null }))
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (rows.length === 0) return
    setBrush({ start: Math.max(0, rows.length - 240), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>CPI Rents (04.1)</div>
          <div className={kit.sectionSubtitle}>Actual rentals for housing — published YoY (D7GQ) with 12-mo MA</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#a78bfa' }} />
            Rents YoY
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#60a5fa' }} />
            12-mo MA
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
                const lbl = name === 'ma' ? '12-mo MA' : 'Rents YoY'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Line type="monotone" dataKey="yoy" name="Rents YoY"
              stroke="#a78bfa" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Line type="monotone" dataKey="ma" name="12-mo MA"
              stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="6 3"
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

export function UKOtherInflationContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'mm23')
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CDIDS.length} ONS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (MM23) &mdash; monthly, not seasonally adjusted.
        BoE/Ipsos inflation expectations panel deferred (quarterly survey not yet ingested).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MeasuresPanel allData={allData} />
        <WedgePanel allData={allData} />
      </div>

      <RentsPanel allData={allData} />

      <SeriesExplorer
        title="UK Inflation Measures Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={allData}
        defaultId="D7BT"
        unitLabel="Index (CPI/CPIH 2015=100; RPI Jan 1987=100), NSA"
      />
    </>
  )
}
