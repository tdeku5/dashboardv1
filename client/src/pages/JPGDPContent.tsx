import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
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

// Japan quarterly SNA GDP, expenditure approach — Cabinet Office quarterly
// estimates (SA, 1994Q1→, quarter-start dates). ALL series are DIRECT (no
// proxy badges). Like Canada (CAGDPContent), the Cabinet Office publishes the
// official QoQ / QoQ-annualized rates AND the percentage-point contributions
// to annualized growth, so the contribution panel is fed PUBLISHED figures —
// no client decomposition. Levels are billions of yen at annual rates
// (2026Q1 real = 593,218.8 = ¥593.2T); chained-volume components are NOT
// additive and are never summed here.

type AllData = Record<string, EstatPoint[]>
type Row = { date: string; [key: string]: number | string | null }

// ── Published annualized contributions (Cabinet Office) ──────────────────────
// Imports are already sign-correct as published — passed through unmodified.

const CTB_BUCKETS = [
  { key: 'cons',    code: 'JP_CTB_CONS',    label: 'Private Consumption', color: '#60a5fa' },
  { key: 'resinv',  code: 'JP_CTB_RESINV',  label: 'Residential Inv.',    color: '#f472b6' },
  { key: 'capex',   code: 'JP_CTB_CAPEX',   label: 'Business Capex',      color: '#4ade80' },
  { key: 'invent',  code: 'JP_CTB_INVENT',  label: 'Inventories',         color: '#94a3b8' },
  { key: 'gov',     code: 'JP_CTB_GOV',     label: 'Govt Consumption',    color: '#a78bfa' },
  { key: 'pubinv',  code: 'JP_CTB_PUBINV',  label: 'Public Investment',   color: '#2dd4bf' },
  { key: 'exports', code: 'JP_CTB_EXPORTS', label: 'Exports',             color: '#fbbf24' },
  { key: 'imports', code: 'JP_CTB_IMPORTS', label: 'Imports',             color: '#f87171' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] =
  CTB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// ── Explorer items (real chained-volume + nominal current-price levels) ─────

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'JP_GDP_R',     label: 'Real GDP', depth: 0 },
  { id: 'JP_CONS_R',    label: 'Private Consumption', depth: 1 },
  { id: 'JP_RESINV_R',  label: 'Residential Investment', depth: 1 },
  { id: 'JP_CAPEX_R',   label: 'Private Non-Resi Capex', depth: 1 },
  { id: 'JP_INVENT_R',  label: 'Private Inventories', depth: 1 },
  { id: 'JP_GOV_R',     label: 'Government Consumption', depth: 1 },
  { id: 'JP_PUBINV_R',  label: 'Public Investment', depth: 1 },
  { id: 'JP_EXPORTS_R', label: 'Exports of Goods & Services', depth: 1 },
  { id: 'JP_IMPORTS_R', label: 'Imports of Goods & Services', depth: 1 },
  { id: 'JP_GDP_N',     label: 'Nominal GDP', depth: 0 },
  { id: 'JP_CONS_N',    label: 'Nominal Private Consumption', depth: 1 },
  { id: 'JP_CAPEX_N',   label: 'Nominal Private Non-Resi Capex', depth: 1 },
  { id: 'JP_GOV_N',     label: 'Nominal Government Consumption', depth: 1 },
  { id: 'JP_EXPORTS_N', label: 'Nominal Exports', depth: 1 },
  { id: 'JP_IMPORTS_N', label: 'Nominal Imports', depth: 1 },
]

const ALL_CODES = [
  ...EXPLORER_ITEMS.map(i => i.id),
  // Published rates + annualized contributions
  'JP_GDP_QOQ', 'JP_GDP_QOQA',
  ...CTB_BUCKETS.map(b => b.code),
  // Deflator (index 2020=100, SA)
  'JP_GDP_DEFLATOR',
] as const

const DEFAULT_Q = 40 // ~10 years of quarters

// ── formatters (levels stored in billions of yen, annualized) ────────────────

const fmtYenTick = (v: number) => `¥${(v / 1000).toFixed(0)}T`
const fmtYenTooltip = (v: number) => `¥${(v / 1000).toFixed(1)}T`
const fmtIdxTick = (v: number) => v.toFixed(0)
const fmtIdxTooltip = (v: number) => v.toFixed(1)

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

/** Date-union of the eight published contribution series + the published QoQA line. */
function buildPublishedContrib(allData: AllData): ContribRow[] {
  const dates = new Set<string>()
  for (const b of CTB_BUCKETS) for (const p of allData[b.code] ?? []) dates.add(p.date)
  const maps = CTB_BUCKETS.map(b => ({
    key: b.key,
    m: new Map((allData[b.code] ?? []).map(p => [p.date, p.value])),
  }))
  const lineMap = new Map((allData['JP_GDP_QOQA'] ?? []).map(p => [p.date, p.value]))
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

// ── Published QoQ bars panel (used for both QoQ and QoQ-annualized) ──────────

function QoqBarsPanel({
  title, subtitle, barLabel, data,
}: {
  title: string
  subtitle?: string
  barLabel: string
  data: EstatPoint[]
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

export function JPGDPContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load Cabinet Office SNA data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const contribRows = useMemo(
    () => Object.keys(allData).length > 0 ? buildPublishedContrib(allData) : [],
    [allData]
  )

  const gdpLevelRows = useMemo(
    () => buildRows([{ key: 'JP_GDP_R', data: allData['JP_GDP_R'] ?? [] }]),
    [allData]
  )
  // Real vs nominal YoY — computed via 4-quarter compare (quarterly series)
  const realNomYoyRows = useMemo(
    () => buildRows([
      { key: 'JP_GDP_R', data: computeChangePct(allData['JP_GDP_R'] ?? [], 4) },
      { key: 'JP_GDP_N', data: computeChangePct(allData['JP_GDP_N'] ?? [], 4) },
    ]),
    [allData]
  )
  const deflatorLevelRows = useMemo(
    () => buildRows([{ key: 'JP_GDP_DEFLATOR', data: allData['JP_GDP_DEFLATOR'] ?? [] }]),
    [allData]
  )

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} Cabinet Office SNA series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Cabinet Office SNA quarterly estimates &mdash; seasonally adjusted, billions of yen at
        annualized rates, chained volumes / current prices, 1994Q1&rarr;. Rates and contributions
        are Cabinet Office-published. Chained-volume components are not additive.
      </div>

      <ContribSection
        title="Contributions to Real GDP Growth (annualized)"
        subtitle="Cabinet Office published contributions — annualized"
        data={contribRows}
        items={CONTRIB_ITEMS}
        lineKey="line"
        lineLabel="Real GDP QoQ (ann.)"
        clipPrefix="jpgdpctb"
        periods={QUICK_PERIODS_Q}
        defaultCount={40}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real GDP — Level"
          subtitle="Chained volumes, billions of yen annualized, SA (2026Q1 = ¥593.2T)"
          lines={[{ key: 'JP_GDP_R', label: 'Real GDP (¥T ann.)', color: '#60a5fa' }]}
          rows={gdpLevelRows}
          tickFmt={fmtYenTick}
          tooltipFmt={fmtYenTooltip}
        />
        <QoqBarsPanel
          title="Real GDP Growth — published QoQ annualized"
          subtitle="Cabinet Office-published quarter-over-quarter % change at annual rates"
          barLabel="Real GDP QoQ (ann.)"
          data={allData['JP_GDP_QOQA'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real vs Nominal GDP — YoY %"
          subtitle="% change vs same quarter a year earlier — the wedge is the deflator"
          lines={[
            { key: 'JP_GDP_R', label: 'Real GDP YoY', color: '#60a5fa', width: 2.2 },
            { key: 'JP_GDP_N', label: 'Nominal GDP YoY', color: '#f59e0b' },
          ]}
          rows={realNomYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <QoqBarsPanel
          title="Real GDP Growth — published QoQ"
          subtitle="Cabinet Office-published quarter-over-quarter % change (not annualized)"
          barLabel="Real GDP QoQ"
          data={allData['JP_GDP_QOQ'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="GDP Deflator — Level"
          subtitle="Implied deflator, index 2020=100, SA"
          lines={[{ key: 'JP_GDP_DEFLATOR', label: 'GDP Deflator (2020=100)', color: '#a78bfa' }]}
          rows={deflatorLevelRows}
          tickFmt={fmtIdxTick}
          tooltipFmt={fmtIdxTooltip}
        />
        <RatesChart
          title="GDP Deflator"
          subtitle="Index 2020=100, SA — YoY / annualized"
          data={allData['JP_GDP_DEFLATOR'] ?? []}
          frequency="quarterly"
        />
      </div>

      <SeriesExplorer
        title="Japan GDP Explorer"
        selectorLabel="Component"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="JP_GDP_R"
        frequency="quarterly"
        unitLabel="Billions of yen, annualized, SA (real = chained volumes; nominal = current prices)"
        levelFormatter={fmtYenTooltip}
      />
    </>
  )
}
