import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, breakDates, type EurostatPoint } from '../lib/eurostat'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Labour Costs dashboard — the wages (AHE-analog) tab for DE / FR / IT.
// Series: Eurostat Labour Cost Index (lc_lci_r2_q, NACE B-S, quarterly SCA,
// 2020=100) plus the Eurostat-PUBLISHED calendar-adjusted YoY — panels flag
// that the YoY is published, not terminal-computed. The real-wage panel
// overlays the terminal-computed HICP YoY (from the ECB-hosted index). Every
// panel carries eu3Caveat('lci_wages', cc). Germany's LCI has a 2022-Q1
// break-in-series — markers derive from breakDates() at runtime, never
// hardcoded.

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  return {
    lci: `${cc}_LCI`,          // Eurostat lc_lci_r2_q, quarterly SCA index, 2020=100
    lciYoy: `${cc}_LCI_YOY`,   // Eurostat-published YoY, calendar-adjusted
    hicp: `${cc}_HICP`,        // ECB-hosted HICP index (monthly, NSA) — YoY terminal-computed
  }
}

// Per-country history starts for the LCI.
const HISTORY_NOTE: Record<Eu3Country, string> = {
  DE: 'history from 1996',
  FR: 'history from 2008',
  IT: 'history from 2000',
}

const BREAK_CAPTION = 'vertical dashes mark Eurostat break-in-series flags'

const fmtIdxTick = (v: number): string => v.toFixed(0)
const fmtIdxTip = (v: number): string => v.toFixed(1)

// ── Quarterly axis/tooltip formatters ────────────────────────────────────────

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
}

// ── Local panel helpers (duplicated per-file per house convention) ───────────

type BrushIdx = { start: number; end: number }

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<BrushIdx>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  const onBrush = useCallback(({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  return { brush, onBrush }
}

function Panel({ title, subtitle, badge, legend, children }: {
  title: string
  subtitle?: string
  badge?: ReactNode
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      {legend != null && <div className={kit.legendRow}><div className={kit.legend}>{legend}</div></div>}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function Leg({ color, label }: { color: string; label: string }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kit.legendLine} style={{ background: color }} />
      {label}
    </span>
  )
}

/** Vertical dashed markers at Eurostat break-in-series dates (obs_flag 'b'). */
function BreakLines({ dates }: { dates: readonly string[] }) {
  return (
    <>
      {dates.map(d => (
        <ReferenceLine key={`brk-${d}`} x={d}
          stroke="rgba(251,191,36,0.45)" strokeDasharray="4 3" strokeWidth={1}
          label={{ value: 'series break', position: 'insideTop', fill: '#94A3B8', fontSize: 9 }} />
      ))}
    </>
  )
}

/** Date-union merge of several {date,value} series into keyed rows. */
function mergeByDate(series: Record<string, ReadonlyArray<{ date: string; value: number | null }>>) {
  const dates = new Set<string>()
  for (const arr of Object.values(series)) for (const p of arr) dates.add(p.date)
  const maps = Object.entries(series).map(([k, arr]) =>
    [k, new Map(arr.map(p => [p.date, p.value]))] as const)
  return [...dates].sort().map(date => {
    const row: Record<string, string | number | null> = { date }
    for (const [k, m] of maps) row[k] = m.get(date) ?? null
    return row
  })
}

// ── Panels ───────────────────────────────────────────────────────────────────

function LciLevelPanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const breaks = useMemo(() => breakDates(data), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title={`${EU3_COUNTRY_LABEL[cc]} Labour Cost Index — Level`}
      subtitle={`Eurostat lc_lci_r2_q — quarterly SCA index (2020=100), NACE B-S, ${HISTORY_NOTE[cc]}${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('lci_wages', cc)} />}
      legend={<Leg color="#60a5fa" label="LCI (2020=100)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtIdxTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtIdxTip(v) : '-', 'LCI (2020=100)'] as [string, string]} />
          <BreakLines dates={breaks} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function LciYoyPanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, yoy: d.value })), [data])
  const breaks = useMemo(() => breakDates(data), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title="Labour Cost Index — YoY %"
      subtitle={`Eurostat-PUBLISHED annual growth rate (calendar-adjusted) — not terminal-computed${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('lci_wages', cc)} />}
      legend={<Leg color="#f59e0b" label="LCI YoY % (published)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'LCI YoY (published)'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <BreakLines dates={breaks} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function RealWagePanel({ allData, cc }: { allData: AllData; cc: Eu3Country }) {
  const codes = codesFor(cc)
  const lciYoy = allData[codes.lciYoy] ?? []
  const hicp = allData[codes.hicp] ?? []
  const rows = useMemo(() => mergeByDate({
    lci: lciYoy,
    hicp: computeChangePct(hicp, 12),
  }), [lciYoy, hicp])
  const breaks = useMemo(() => breakDates(lciYoy), [lciYoy])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const LINES = [
    { key: 'lci', label: 'LCI YoY (Eurostat-published, quarterly)', color: '#f59e0b' },
    { key: 'hicp', label: 'HICP YoY (terminal-computed, monthly)', color: '#38bdf8' },
  ] as const
  const labels: Record<string, string> = Object.fromEntries(LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Wages vs Inflation — the Real-Wage Squeeze"
      subtitle={`LCI YoY (Eurostat-published) vs HICP YoY (terminal-computed from the ECB-hosted index, NSA) — labour costs below inflation = falling real wages · click legend to toggle${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('lci_wages', cc)} />}
      legend={LINES.map(l => (
        <span key={l.key} className={kit.legendItem}
          style={{ cursor: 'pointer', opacity: hidden.has(l.key) ? 0.35 : 1 }}
          onClick={() => toggle(l.key)}>
          <span className={kit.legendLine} style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <BreakLines dates={breaks} />
          {LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={1.8} hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3LabourCostsContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [codes.lci, codes.lciYoy, codes.hicp], [codes])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchEu3Batch(allCodes).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load labour-cost data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} labour-cost series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat Labour Cost Index (lc_lci_r2_q, NACE B-S) &mdash; quarterly SCA index, 2020=100,
        with Eurostat-published calendar-adjusted YoY. {EU3_COUNTRY_LABEL[cc]}: {HISTORY_NOTE[cc]}.
        Includes taxes minus subsidies on labour &mdash; not pure wages.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LciLevelPanel data={allData[codes.lci] ?? []} cc={cc} />
        <LciYoyPanel data={allData[codes.lciYoy] ?? []} cc={cc} />
      </div>

      <RealWagePanel allData={allData} cc={cc} />
    </>
  )
}
