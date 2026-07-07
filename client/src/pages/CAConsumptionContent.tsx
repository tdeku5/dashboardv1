import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch } from '../lib/statcan'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Canada household consumption by durability — quarterly, from the GDP
// expenditure cube 36-10-0104 (chained 2017$, SAAR, 1961→). These panels are
// the quarterly national-accounts substitute for the US monthly PCE pages
// (no registry caveat exists for a consumption proxy, so the substitution
// note lives in each panel subtitle instead of a badge). Chained-dollar
// categories are NOT additive: no stacked or summed charts, no contribution
// decomposition.

type AllData = Record<string, Array<{ date: string; value: number }>>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = [
  'CA_HHCONS_R', 'CA_CONSGOODS_R', 'CA_CONSSVCS_R',
  'CA_CONSDUR_R', 'CA_CONSSEMI_R', 'CA_CONSNONDUR_R',
  'CA_NPISH_R', 'CA_HHCONS_N',
] as const

const DURABILITY = [
  { key: 'CA_CONSDUR_R',    label: 'Durables',      color: '#60a5fa' },
  { key: 'CA_CONSSEMI_R',   label: 'Semi-Durables', color: '#4ade80' },
  { key: 'CA_CONSNONDUR_R', label: 'Non-Durables',  color: '#f59e0b' },
  { key: 'CA_CONSSVCS_R',   label: 'Services',      color: '#a78bfa' },
] as const

const NOT_ADDITIVE =
  'Chained-dollar categories are not additive; no contribution decomposition is shown.'
const SUBSTITUTION = 'Quarterly national-accounts basis; the US page is monthly.'

const DEFAULT_Q = 80 // ~20 years of quarters

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtCadTick = (v: number) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}T` : `$${(v / 1e3).toFixed(0)}B`
const fmtCadTooltip = (v: number) =>
  `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}M`

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

// ── generic multi-line panel ─────────────────────────────────────────────────

type LineDef = { key: string; label: string; color: string }

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
  const [vis, setVis] = useState<Set<string>>(() => new Set(lines.map(l => l.key)))
  const toggle = (key: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultCount), end: rows.length - 1 })
  }, [rows.length, defaultCount])

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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={tickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.filter(l => vis.has(l.key)).map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                stroke={l.color} strokeWidth={1.8}
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

export function CAConsumptionContent() {
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

  const totalLevelRows = useMemo(
    () => buildRows([{ key: 'CA_HHCONS_R', data: allData['CA_HHCONS_R'] ?? [] }]),
    [allData]
  )
  const totalYoyRows = useMemo(
    () => buildRows([
      { key: 'CA_HHCONS_R', data: computeChangePct(allData['CA_HHCONS_R'] ?? [], 4) },
      { key: 'CA_NPISH_R', data: computeChangePct(allData['CA_NPISH_R'] ?? [], 4) },
    ]),
    [allData]
  )
  const durLevelRows = useMemo(
    () => buildRows(DURABILITY.map(c => ({ key: c.key, data: allData[c.key] ?? [] }))),
    [allData]
  )
  const durYoyRows = useMemo(
    () => buildRows(DURABILITY.map(c => ({ key: c.key, data: computeChangePct(allData[c.key] ?? [], 4) }))),
    [allData]
  )
  const goodsSvcsYoyRows = useMemo(
    () => buildRows([
      { key: 'CA_CONSGOODS_R', data: computeChangePct(allData['CA_CONSGOODS_R'] ?? [], 4) },
      { key: 'CA_CONSSVCS_R', data: computeChangePct(allData['CA_CONSSVCS_R'] ?? [], 4) },
    ]),
    [allData]
  )
  const nomRealRows = useMemo(
    () => buildRows([
      { key: 'CA_HHCONS_N', data: computeChangePct(allData['CA_HHCONS_N'] ?? [], 4) },
      { key: 'CA_HHCONS_R', data: computeChangePct(allData['CA_HHCONS_R'] ?? [], 4) },
    ]),
    [allData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan consumption series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0104) &mdash; quarterly, chained 2017 dollars, SAAR.
        {' '}{NOT_ADDITIVE}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real Household Consumption"
          subtitle={`Household final consumption expenditure, chained 2017 $M SAAR — ${SUBSTITUTION}`}
          lines={[{ key: 'CA_HHCONS_R', label: 'Real Consumption (2017$ M)', color: '#60a5fa' }]}
          rows={totalLevelRows}
          tickFmt={fmtCadTick}
          tooltipFmt={fmtCadTooltip}
        />
        <LinesPanel
          title="Real Household Consumption — YoY %"
          subtitle={`% change vs same quarter a year earlier (NPISH shown separately) — ${SUBSTITUTION}`}
          lines={[
            { key: 'CA_HHCONS_R', label: 'Household Consumption YoY', color: '#ec4899' },
            { key: 'CA_NPISH_R', label: 'NPISH Consumption YoY', color: '#94a3b8' },
          ]}
          rows={totalYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Consumption by Durability — Real Levels"
          subtitle={`Durables / semi-durables / non-durables / services, chained 2017 $M SAAR. ${NOT_ADDITIVE} ${SUBSTITUTION}`}
          lines={DURABILITY}
          rows={durLevelRows}
          tickFmt={fmtCadTick}
          tooltipFmt={fmtCadTooltip}
        />
        <LinesPanel
          title="Consumption by Durability — YoY %"
          subtitle={`Real spending by durability class, % change vs year earlier. ${NOT_ADDITIVE} ${SUBSTITUTION}`}
          lines={DURABILITY}
          rows={durYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Goods vs Services Consumption — YoY"
          subtitle={`Real goods vs services spending, % change vs year earlier — ${SUBSTITUTION}`}
          lines={[
            { key: 'CA_CONSGOODS_R', label: 'Goods YoY', color: '#f59e0b' },
            { key: 'CA_CONSSVCS_R', label: 'Services YoY', color: '#a78bfa' },
          ]}
          rows={goodsSvcsYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Nominal vs Real Consumption — YoY"
          subtitle={`Current-price vs chained-dollar total — the wedge is the implied consumption deflator. ${SUBSTITUTION}`}
          lines={[
            { key: 'CA_HHCONS_N', label: 'Nominal YoY', color: '#f59e0b' },
            { key: 'CA_HHCONS_R', label: 'Real YoY', color: '#60a5fa' },
          ]}
          rows={nomRealRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
