import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Australia business indicators — ABS Quarterly Business Indicators Survey
// (5676.0): company gross operating profits (quarterly SA, A$ millions,
// 2001→) and inventories book value (quarterly SA, A$ millions, 1985→).
// ALL series are DIRECT (no proxy badges). Sales exists per-industry only
// (no economy-wide total) and is omitted. Quarterly series are stamped at
// quarter-start dates.

type AllData = Record<string, AbsPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['AU_PROFITS', 'AU_INVENTORIES'] as const

const DEFAULT_Q = 40 // ~10 years of quarters

// ── formatters (levels stored in A$ millions) ────────────────────────────────

const fmtAudTick = (v: number) =>
  Math.abs(v) >= 1000 ? `A$${(v / 1000).toFixed(0)}bn` : `A$${v.toFixed(0)}m`
const fmtAudTooltip = (v: number) =>
  `A$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}m`

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Absolute change vs the previous observation (A$m delta; null for the first point). */
function qoqDiff(data: readonly AbsPoint[]): NV[] {
  return data.map((d, i) =>
    i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
}

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  return [brush, setBrush] as const
}

// ── multi-line panel ─────────────────────────────────────────────────────────

type LineDef = { key: string; label: string; color: string; width?: number }

function LinesPanel({
  title, subtitle, lines, rows,
  tickFmt, tooltipFmt, zeroRef = false, defaultCount = DEFAULT_Q,
}: {
  title: string
  subtitle?: string
  lines: readonly LineDef[]
  rows: Row[]
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
}) {
  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(l => (
            <span key={l.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={tickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                stroke={l.color} strokeWidth={l.width ?? 1.8}
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

// ── signed-bars panel (QoQ inventory change) ─────────────────────────────────

function SignedBarsPanel({
  title, subtitle, barLabel, rows,
  tickFmt, tooltipFmt, defaultCount = DEFAULT_Q,
}: {
  title: string
  subtitle?: string
  barLabel: string
  rows: Row[]
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  defaultCount?: number
}) {
  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            {barLabel} +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} &minus;
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={tickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) =>
                [typeof v === 'number' ? tooltipFmt(v) : '-', barLabel] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="value" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`b-${i}`}
                  fill={typeof r.value === 'number' && r.value < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
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

// ══════════════════════════════════════════════════════════════════════════════

export function AUBusinessContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load ABS business indicators data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const profits = useMemo(() => allData['AU_PROFITS'] ?? [], [allData])
  const inventories = useMemo(() => allData['AU_INVENTORIES'] ?? [], [allData])

  const profitsLevelRows = useMemo(
    () => buildRows([{ key: 'level', data: profits }]),
    [profits]
  )
  // Terminal-computed YoY: 4-quarter compare
  const profitsYoyRows = useMemo(
    () => buildRows([{ key: 'yoy', data: computeChangePct(profits, 4) }]),
    [profits]
  )
  const inventoriesLevelRows = useMemo(
    () => buildRows([{ key: 'level', data: inventories }]),
    [inventories]
  )
  const inventoriesQoqRows = useMemo(
    () => buildRows([{ key: 'value', data: qoqDiff(inventories) }]),
    [inventories]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS business indicators series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Quarterly Business Indicators Survey (5676.0) &mdash; quarterly, seasonally adjusted,
        A$ millions, current prices. Sales exists per-industry only (no total) and is omitted.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Company Gross Operating Profits — Level"
          subtitle="All industries, A$m per quarter, current prices, SA, 2001→"
          lines={[{ key: 'level', label: 'Profits (A$m)', color: '#4ade80' }]}
          rows={profitsLevelRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
        <LinesPanel
          title="Company Gross Operating Profits — YoY %"
          subtitle="Terminal-computed 4-quarter % change — commodity-price sensitive (mining dominates swings)"
          lines={[{ key: 'yoy', label: 'Profits YoY', color: '#fbbf24', width: 2 }]}
          rows={profitsYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Inventories — Level"
          subtitle="Book value of inventories, all industries, A$m, current prices, SA, 1985→"
          lines={[{ key: 'level', label: 'Inventories (A$m)', color: '#60a5fa' }]}
          rows={inventoriesLevelRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
        <SignedBarsPanel
          title="Inventories — QoQ Change"
          subtitle="Quarter-over-quarter change in book value, A$m — the inventory-cycle read"
          barLabel="QoQ change"
          rows={inventoriesQoqRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
      </div>
    </>
  )
}
