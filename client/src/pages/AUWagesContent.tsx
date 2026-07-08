import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import { computeChangePct, fmtPctTick, fmtPctTooltip, TICK, TOOLTIP_STYLE, BRUSH_STYLE } from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Australia Wages dashboard — the AHE/ECI-analog tab. The Wage Price Index
// (quarterly SA, index from 1997-Q3) IS Australia's wage measure — DIRECT
// published data, so no proxy badges anywhere on this tab. YoY and QoQ rates
// are the ABS-PUBLISHED series (AU_WPI_YOY / AU_WPI_QOQ), not terminal-
// computed — subtitles say so. The real-wage panel is the one terminal
// computation: published WPI YoY minus quarterly CPI YoY (computed at lag 4
// from AU_CPI_Q_HEADLINE), labeled as such.

type AllData = Record<string, AbsPoint[]>

const ALL_CODES = ['AU_WPI', 'AU_WPI_YOY', 'AU_WPI_QOQ', 'AU_CPI_Q_HEADLINE'] as const

const WPI_CAPTION =
  'total hourly rates of pay excluding bonuses — private + public, all industries, quarterly SA'

// ── Quarterly helpers (per-file per house convention) ────────────────────────

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
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

// ── Local panel kit ──────────────────────────────────────────────────────────

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

function Panel({ title, subtitle, legend, children }: {
  title: string
  subtitle?: string
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      {legend != null && <div className={kit.legendRow}><div className={kit.legend}>{legend}</div></div>}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function Leg({ color, label, kind = 'line' }: { color: string; label: string; kind?: 'line' | 'swatch' }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kind === 'line' ? kit.legendLine : kit.legendSwatch} style={{ background: color }} />
      {label}
    </span>
  )
}

// ── Panels ───────────────────────────────────────────────────────────────────

function WpiLevelPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title="Wage Price Index — Level"
      subtitle={`ABS WPI — quarterly SA index (2008-09=100), 1997-Q3→ · ${WPI_CAPTION}`}
      legend={<Leg color="#60a5fa" label="WPI (index)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => v.toFixed(0)} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? v.toFixed(1) : '-', 'WPI (index)'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function WpiYoyPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, yoy: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title="WPI — YoY %"
      subtitle="ABS-PUBLISHED annual growth rate (AU_WPI_YOY) — not terminal-computed"
      legend={<Leg color="#f59e0b" label="WPI YoY % (published)" />}
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
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'WPI YoY (published)'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function WpiQoqPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, qoq: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title="WPI — QoQ %"
      subtitle="ABS-PUBLISHED quarterly growth rate (AU_WPI_QOQ) — not terminal-computed"
      legend={<Leg color="rgba(74,222,128,0.75)" label="WPI QoQ % (published)" kind="swatch" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
            tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'WPI QoQ (published)'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Bar dataKey="qoq" name="qoq" isAnimationActive={false} legendType="none" maxBarSize={16}>
            {rows.map((row, idx) => (
              <Cell key={`qoq-${idx}`}
                fill={row.qoq >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
            ))}
          </Bar>
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function RealWagePanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const wpiYoy = (allData['AU_WPI_YOY'] ?? []).map(p => ({ date: p.date, value: p.value as number | null }))
    const cpiYoy = computeChangePct(allData['AU_CPI_Q_HEADLINE'] ?? [], 4)
    const cpiMap = new Map(cpiYoy.map(p => [p.date, p.value]))
    const real = wpiYoy.map(p => {
      const cpi = cpiMap.get(p.date)
      return { date: p.date, value: p.value != null && cpi != null ? p.value - cpi : null }
    })
    return mergeByDate({ wpi: wpiYoy, cpi: cpiYoy, real })
  }, [allData])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)
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
    { key: 'real', label: 'REAL wage growth (WPI YoY − CPI YoY)', color: '#4ade80', width: 2.2 },
    { key: 'wpi', label: 'WPI YoY (ABS-published)', color: '#f59e0b', width: 1.4 },
    { key: 'cpi', label: 'Quarterly CPI YoY (terminal-computed)', color: '#38bdf8', width: 1.4 },
  ] as const
  const labels: Record<string, string> = Object.fromEntries(LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Real Wage Growth"
      subtitle="WPI YoY − quarterly CPI YoY, terminal-computed (CPI YoY from AU_CPI_Q_HEADLINE at lag 4) — zero line = real wages flat · click legend to toggle"
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
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1}
            label={{ value: 'real wages flat', position: 'insideBottomRight', fill: '#64748B', fontSize: 9 }} />
          {LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={l.width} hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUWagesContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ABS wage data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS wage series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Wage Price Index &mdash; {WPI_CAPTION}, index from 1997-Q3. The WPI is Australia&rsquo;s
        wage measure (DIRECT, no proxy). YoY and QoQ rates are ABS-PUBLISHED series; only the
        real-wage line is terminal-computed.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <WpiLevelPanel data={allData['AU_WPI'] ?? []} />
        <WpiYoyPanel data={allData['AU_WPI_YOY'] ?? []} />
      </div>

      <WpiQoqPanel data={allData['AU_WPI_QOQ'] ?? []} />

      <RealWagePanel allData={allData} />
    </>
  )
}
