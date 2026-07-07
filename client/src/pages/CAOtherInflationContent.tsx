import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import kit from '../components/charts/ChartKit.module.css'

// Canada "Other Inflation" dashboard — Canada-specific inflation drivers off
// StatCan table 18-10-0004 (monthly, 2002=100, NSA except CA_CPI_SA from
// 18-10-0006). Mortgage interest cost, rent, shelter and gasoline are the
// idiosyncratic Canadian CPI mechanics worth watching separately from the
// headline page. All series are DIRECT StatCan indices — no proxy badges.
// No inflation-expectations panels: no Canadian expectations source is
// ingested, so that block is deliberately omitted rather than proxied.

const CODES = [
  'CPI_HEADLINE', 'CA_CPI_SA', 'CA_CPI_MIC',
  'CA_CPI_RENTED', 'CA_CPI_GASOLINE', 'CA_CPI_SHELTER',
] as const

type AllData = Record<string, StatcanPoint[]>

interface LineDef {
  code: string
  key: string
  label: string
  color: string
  width?: number
}

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CPI_HEADLINE', label: 'CPI — All-items (NSA)', depth: 0 },
  { id: 'CA_CPI_SA', label: 'CPI — All-items (Seasonally Adjusted)', depth: 0 },
  { id: 'CA_CPI_SHELTER', label: 'CPI — Shelter', depth: 0 },
  { id: 'CA_CPI_MIC', label: 'CPI — Mortgage Interest Cost', depth: 1 },
  { id: 'CA_CPI_RENTED', label: 'CPI — Rented Accommodation', depth: 1 },
  { id: 'CA_CPI_GASOLINE', label: 'CPI — Gasoline', depth: 0 },
]

// ── Generic multi-line YoY panel (date-union alignment) ──────────────────────

function MultiLineYoyPanel({
  title, subtitle, lines, allData, defaultMonths = 120,
}: {
  title: string
  subtitle: string
  lines: readonly LineDef[]
  allData: AllData
  defaultMonths?: number
}) {
  const rows = useMemo(() => {
    const maps = lines.map(s => {
      const yoy = computeChangePct(allData[s.code] ?? [], 12)
      return new Map(yoy.map(p => [p.date, p.value]))
    })
    const dates = new Set<string>()
    for (const s of lines) for (const p of allData[s.code] ?? []) dates.add(p.date)
    return [...dates].sort().map(date => {
      const row: Record<string, number | string | null> = { date }
      lines.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData, lines])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultMonths), end: rows.length - 1 })
  }, [rows.length, defaultMonths])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          <div className={kit.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(s => (
            <span key={s.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
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
                const s = lines.find(x => x.key === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {lines.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={s.width ?? 1.8}
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

// ── Gasoline YoY panel (signed bars + 12-mo MA) ──────────────────────────────

function GasolineYoyPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const yoy = computeChangePct(allData['CA_CPI_GASOLINE'] ?? [], 12)
    const ma = computeMA(yoy, 12)
    return yoy.map((p, i) => ({
      date: p.date,
      yoy: p.value,
      ma: ma[i]?.value ?? null,
    }))
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 120), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>Gasoline — YoY</div>
          <div className={kit.sectionSubtitle}>
            CPI gasoline year-over-year %Δ (NSA) — the most volatile headline input; 12-mo MA overlaid
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            YoY + / &minus;
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
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
                const lbl = name === 'ma' ? '12-mo MA' : 'YoY'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="yoy" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((entry, idx) => (
                <Cell key={`g-${idx}`}
                  fill={(entry.yoy ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma" name="ma"
              stroke="#e2e8f0" strokeWidth={1.6}
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

export function CAOtherInflationContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(CODES).then(map => {
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

  const explorerData = useMemo(() => {
    const out: Record<string, StatcanPoint[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} StatCan CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (18-10-0004 / 18-10-0006) &mdash; monthly, 2002=100, Canada-specific inflation drivers.
        No inflation-expectations panels: no Canadian expectations source is ingested.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="NSA vs SA All-items — YoY"
          subtitle="All-items CPI year-over-year %Δ — NSA (18-10-0004) vs seasonally adjusted (18-10-0006)"
          lines={[
            { code: 'CPI_HEADLINE', key: 'nsa', label: 'All-items (NSA)', color: '#e2e8f0', width: 2.2 },
            { code: 'CA_CPI_SA', key: 'sa', label: 'All-items (SA)', color: '#60a5fa', width: 1.6 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title="Mortgage Interest Cost — YoY"
          subtitle="A headline Canadian inflation driver: BoC policy-rate changes pass through directly to mortgage renewals (NSA)"
          lines={[
            { code: 'CA_CPI_MIC', key: 'mic', label: 'Mortgage Interest Cost', color: '#f59e0b', width: 2.2 },
          ]}
          allData={allData}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="Shelter Components — YoY"
          subtitle="Shelter aggregate vs rented accommodation vs mortgage interest cost (NSA)"
          lines={[
            { code: 'CA_CPI_SHELTER', key: 'shelter', label: 'Shelter', color: '#e2e8f0', width: 2.2 },
            { code: 'CA_CPI_RENTED', key: 'rented', label: 'Rented Accommodation', color: '#38bdf8', width: 1.6 },
            { code: 'CA_CPI_MIC', key: 'mic', label: 'Mortgage Interest Cost', color: '#f59e0b', width: 1.6 },
          ]}
          allData={allData}
        />
        <GasolineYoyPanel allData={allData} />
      </div>

      <SeriesExplorer
        title="Canada Other-Inflation Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CPI_HEADLINE"
        unitLabel="Index, 2002=100, NSA"
      />
    </>
  )
}
