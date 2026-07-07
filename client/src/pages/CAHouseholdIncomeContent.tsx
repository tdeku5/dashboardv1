import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Canada household income dashboard — StatCan table 36-10-0112 (quarterly,
// SAAR, current $, 1961→). Disposable income, saving rate and compensation of
// employees. All series are DIRECT — no registry proxy entry exists for these
// panels, so instead of a badge each disposable-income panel carries a visible
// subtitle note: the sector accounts are quarterly, whereas the US Personal
// Income page is monthly. Values are stored in $ millions (SAAR).

type AllData = Record<string, StatcanPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['CA_HH_DISPINC', 'CA_HH_SAVERATE', 'CA_HH_COMP'] as const

const DEFAULT_Q = 80 // ~20 years of quarters

const FREQ_NOTE = 'quarterly household sector accounts; the US Personal Income page is monthly'

// ── formatters ($ millions stored) ───────────────────────────────────────────

const fmtCadTick = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}bn` : `$${v.toFixed(0)}m`
const fmtCadTooltip = (v: number) =>
  `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}m`

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

// ══════════════════════════════════════════════════════════════════════════════

export function CAHouseholdIncomeContent() {
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

  const dispInc = useMemo(() => allData['CA_HH_DISPINC'] ?? [], [allData])
  const saveRate = useMemo(() => allData['CA_HH_SAVERATE'] ?? [], [allData])
  const comp = useMemo(() => allData['CA_HH_COMP'] ?? [], [allData])

  const dispIncLevelRows = useMemo(
    () => buildRows([{ key: 'CA_HH_DISPINC', data: dispInc }]),
    [dispInc]
  )
  const dispIncYoyRows = useMemo(
    () => buildRows([{ key: 'CA_HH_DISPINC', data: computeChangePct(dispInc, 4) }]),
    [dispInc]
  )
  const savingRows = useMemo(
    () => buildRows([{ key: 'CA_HH_SAVERATE', data: saveRate }]),
    [saveRate]
  )
  const compLevelRows = useMemo(
    () => buildRows([{ key: 'CA_HH_COMP', data: comp }]),
    [comp]
  )
  const compYoyRows = useMemo(
    () => buildRows([{ key: 'CA_HH_COMP', data: computeChangePct(comp, 4) }]),
    [comp]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan household income series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0112) &mdash; household sector accounts, quarterly, seasonally adjusted at annual rates, 1961&rarr;
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Household Disposable Income"
          subtitle={`Current $m, SAAR — ${FREQ_NOTE}`}
          lines={[{ key: 'CA_HH_DISPINC', label: 'Disposable Income ($m SAAR)', color: '#60a5fa' }]}
          rows={dispIncLevelRows}
          tickFmt={fmtCadTick}
          tooltipFmt={fmtCadTooltip}
        />
        <LinesPanel
          title="Household Disposable Income — YoY %"
          subtitle={`% change vs same quarter a year earlier — ${FREQ_NOTE}`}
          lines={[{ key: 'CA_HH_DISPINC', label: 'Disposable Income YoY', color: '#ec4899' }]}
          rows={dispIncYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <LinesPanel
        title="Household Saving Rate"
        subtitle="Household saving as % of disposable income, SA — full history from 1961"
        lines={[{ key: 'CA_HH_SAVERATE', label: 'Saving Rate (%)', color: '#a78bfa' }]}
        rows={savingRows}
        tickFmt={fmtPctTick}
        tooltipFmt={fmtPctTooltip}
        zeroRef
        defaultCount={Number.MAX_SAFE_INTEGER}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Compensation of Employees"
          subtitle="Current $m, SAAR"
          lines={[{ key: 'CA_HH_COMP', label: 'Compensation ($m SAAR)', color: '#f59e0b' }]}
          rows={compLevelRows}
          tickFmt={fmtCadTick}
          tooltipFmt={fmtCadTooltip}
        />
        <LinesPanel
          title="Compensation of Employees — YoY %"
          subtitle="% change vs same quarter a year earlier"
          lines={[{ key: 'CA_HH_COMP', label: 'Compensation YoY', color: '#ec4899' }]}
          rows={compYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
