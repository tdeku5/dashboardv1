import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type WD, type ContribRow, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import kit from '../components/charts/ChartKit.module.css'

// Australia quarterly National Accounts GDP, expenditure approach — ABS
// (5206.0, SA, chain volumes / current prices, A$ millions per quarter,
// 1959Q3→, quarter-start dates). ALL series are DIRECT (no proxy badges).
// Like Japan (JPGDPContent) and Canada, the ABS publishes the official QoQ
// growth rate AND the percentage-point contributions to growth, so the
// contribution panel is fed PUBLISHED figures (guarded by a permanent sum
// assertion server-side) — no client decomposition. Chain-volume components
// are NOT additive and are never summed here. Latest real GDP level
// A$695,900m ≈ A$695.9bn per quarter.

type AllData = Record<string, AbsPoint[]>
type Row = { date: string; [key: string]: number | string | null }

// ── Published contributions to QoQ growth (ABS, ppt) ─────────────────────────
// Imports are already sign-correct as published — passed through unmodified.
// Dwelling investment gets its own bucket: Australia's housing-cycle read.

const CTB_BUCKETS = [
  { key: 'cons',    code: 'AU_CTB_CONS',    label: 'Household Consumption', color: '#60a5fa' },
  { key: 'dwell',   code: 'AU_CTB_DWELL',   label: 'Dwelling Investment',   color: '#f472b6' },
  { key: 'businv',  code: 'AU_CTB_BUSINV',  label: 'Business Investment',   color: '#4ade80' },
  { key: 'invent',  code: 'AU_CTB_INVENT',  label: 'Inventories',           color: '#94a3b8' },
  { key: 'gov',     code: 'AU_CTB_GOV',     label: 'Govt Consumption',      color: '#a78bfa' },
  { key: 'pubinv',  code: 'AU_CTB_PUBINV',  label: 'Public Investment',     color: '#2dd4bf' },
  { key: 'exports', code: 'AU_CTB_EXPORTS', label: 'Exports',               color: '#fbbf24' },
  { key: 'imports', code: 'AU_CTB_IMPORTS', label: 'Imports',               color: '#f87171' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] =
  CTB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// ── Explorer items (real chain-volume + nominal levels; ~11 series) ──────────

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'AU_GDP_R',       label: 'Real GDP (A$m, chain volume)', depth: 0 },
  { id: 'AU_CONS_R',      label: 'Household Consumption (A$m)', depth: 1 },
  { id: 'AU_GOV_R',       label: 'Government Consumption (A$m)', depth: 1 },
  { id: 'AU_DWELLINV_R',  label: 'Dwelling Investment (A$m)', depth: 1 },
  { id: 'AU_BUSINV_R',    label: 'Private Business Investment (A$m, 1985→)', depth: 1 },
  { id: 'AU_EXPORTS_R',   label: 'Exports of Goods & Services (A$m)', depth: 1 },
  { id: 'AU_IMPORTS_R',   label: 'Imports of Goods & Services (A$m)', depth: 1 },
  { id: 'AU_GDP_N',       label: 'Nominal GDP (A$m, current prices)', depth: 0 },
  { id: 'AU_COE',         label: 'Compensation of Employees (A$m, nominal)', depth: 0 },
  { id: 'AU_GDP_DEFLATOR', label: 'GDP Implicit Price Deflator (index)', depth: 0 },
  { id: 'AU_SAVING_RATE', label: 'Household Saving Ratio (%)', depth: 0 },
]

const ALL_CODES = [
  ...EXPLORER_ITEMS.map(i => i.id),
  // Published QoQ rate + published ppt contributions (incl. the GDP line)
  'AU_GDP_QOQ', 'AU_CTB_GDP',
  ...CTB_BUCKETS.map(b => b.code),
] as const

const DEFAULT_Q = 40 // ~10 years of quarters

// ── formatters (levels stored in A$ millions per quarter) ────────────────────

const fmtAudTick = (v: number) =>
  Math.abs(v) >= 1000 ? `A$${(v / 1000).toFixed(0)}bn` : `A$${v.toFixed(0)}m`
const fmtAudTooltip = (v: number) => `A$${(v / 1000).toFixed(1)}bn`
const fmtRatioTooltip = (v: number) => `${v.toFixed(1)}%`

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

/** Date-union of the eight published contribution series + the published GDP-growth line. */
function buildPublishedContrib(allData: AllData): ContribRow[] {
  const dates = new Set<string>()
  for (const b of CTB_BUCKETS) for (const p of allData[b.code] ?? []) dates.add(p.date)
  const maps = CTB_BUCKETS.map(b => ({
    key: b.key,
    m: new Map((allData[b.code] ?? []).map(p => [p.date, p.value])),
  }))
  const lineMap = new Map((allData['AU_CTB_GDP'] ?? []).map(p => [p.date, p.value]))
  return [...dates].sort().map(date => {
    const row: ContribRow = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    row.line = lineMap.get(date) ?? null
    return row
  })
}

// ── multi-line panel (toggleable legend) ─────────────────────────────────────

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

// ── Published QoQ bars panel ─────────────────────────────────────────────────

function QoqBarsPanel({
  title, subtitle, barLabel, data,
}: {
  title: string
  subtitle?: string
  barLabel: string
  data: AbsPoint[]
}) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, value: d.value })), [data])

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>(
    { start: 0, end: 0, period: '10Y' })
  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (DEFAULT_Q - 1)), end, period: '10Y' })
  }, [rows.length])

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
            Expansion
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(248,113,113,0.75)' }} />
            Contraction
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
              formatter={(v: unknown) =>
                [typeof v === 'number' ? fmtPctTooltip(v) : '-', barLabel] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="value" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, idx) => (
                <Cell key={`q-${idx}`}
                  fill={r.value >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'} />
              ))}
            </Bar>
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
        periods={QUICK_PERIODS_Q}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUGDPContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load ABS National Accounts data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const contribRows = useMemo(
    () => Object.keys(allData).length > 0 ? buildPublishedContrib(allData) : [],
    [allData]
  )

  const gdpLevelRows = useMemo(
    () => buildRows([{ key: 'AU_GDP_R', data: allData['AU_GDP_R'] ?? [] }]),
    [allData]
  )
  // Real vs nominal YoY — TERMINAL-COMPUTED via 4-quarter compare (the ABS
  // publishes QoQ, not YoY, on the API).
  const realNomYoyRows = useMemo(
    () => buildRows([
      { key: 'AU_GDP_R', data: computeChangePct(allData['AU_GDP_R'] ?? [], 4) },
      { key: 'AU_GDP_N', data: computeChangePct(allData['AU_GDP_N'] ?? [], 4) },
    ]),
    [allData]
  )
  const coeYoyRows = useMemo(
    () => buildRows([{ key: 'AU_COE', data: computeChangePct(allData['AU_COE'] ?? [], 4) }]),
    [allData]
  )
  const savingRateRows = useMemo(
    () => buildRows([{ key: 'AU_SAVING_RATE', data: allData['AU_SAVING_RATE'] ?? [] }]),
    [allData]
  )

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS National Accounts series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Australian National Accounts (5206.0) &mdash; quarterly, seasonally adjusted, A$ millions
        per quarter, chain volumes / current prices, 1959Q3&rarr;. QoQ rate and ppt contributions are
        ABS-published. Chain-volume components are not additive.
      </div>

      <ContribSection
        title="Contributions to Real GDP Growth (QoQ)"
        subtitle="ABS-published contributions to GDP growth, ppt — incl. dwelling investment, Australia's housing-cycle read"
        data={contribRows}
        items={CONTRIB_ITEMS}
        lineKey="line"
        lineLabel="Real GDP QoQ (published)"
        clipPrefix="augdpctb"
        periods={QUICK_PERIODS_Q}
        defaultCount={40}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real GDP — Level"
          subtitle="Chain volumes, A$ millions per quarter, SA (latest ≈ A$695.9bn)"
          lines={[{ key: 'AU_GDP_R', label: 'Real GDP (A$bn/qtr)', color: '#60a5fa' }]}
          rows={gdpLevelRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
        <QoqBarsPanel
          title="Real GDP Growth — published QoQ"
          subtitle="ABS-published quarter-over-quarter % change, SA (not annualized)"
          barLabel="Real GDP QoQ"
          data={allData['AU_GDP_QOQ'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real vs Nominal GDP — YoY %"
          subtitle="Terminal-computed 4-quarter % change — the wedge is the deflator (terms-of-trade sensitive in Australia)"
          lines={[
            { key: 'AU_GDP_R', label: 'Real GDP YoY', color: '#60a5fa', width: 2.2 },
            { key: 'AU_GDP_N', label: 'Nominal GDP YoY', color: '#f59e0b' },
          ]}
          rows={realNomYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Compensation of Employees — YoY %"
          subtitle="Nominal economy-wide wage bill, terminal-computed 4-quarter % change"
          lines={[{ key: 'AU_COE', label: 'COE YoY (nominal)', color: '#4ade80' }]}
          rows={coeYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="GDP Deflator"
          subtitle="Implicit price deflator, index, SA — YoY / annualized"
          data={allData['AU_GDP_DEFLATOR'] ?? []}
          frequency="quarterly"
        />
        <LinesPanel
          title="Household Saving Ratio"
          subtitle="Net saving as % of net disposable income, SA — a headline Australian release"
          lines={[{ key: 'AU_SAVING_RATE', label: 'Saving ratio (%)', color: '#a78bfa', width: 2 }]}
          rows={savingRateRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtRatioTooltip}
          zeroRef
        />
      </div>

      <SeriesExplorer
        title="Australia GDP Explorer"
        selectorLabel="Component"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="AU_GDP_R"
        frequency="quarterly"
        unitLabel="Units per series label — A$m/quarter SA (real = chain volumes; nominal = current prices), deflator index, saving ratio %"
      />
    </>
  )
}
