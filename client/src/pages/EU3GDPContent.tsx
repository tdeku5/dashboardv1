import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type WD, type ContribRow, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_Q,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 quarterly national accounts (GDP, expenditure approach) — one
// parameterized page serving DE / FR / IT. Eurostat namq_10_gdp: chain-linked
// 2020 volumes in MILLION EUR PER QUARTER (SCA — not annualized; rendered as
// €bn/quarter, ÷1000), plus Eurostat-PUBLISHED growth rates (QoQ / YoY /
// QoQ-annualized) and PUBLISHED QoQ percentage-point contributions — no client
// decomposition. All series are DIRECT (no proxy badges). Chained-volume
// components are not additive and are never summed here. Quarterly series are
// stamped at quarter-start dates.

type AllData = Record<string, EurostatPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const HISTORY_NOTE: Record<Eu3Country, string> = {
  DE: 'History from 1991Q1 (reunified Germany). Recent quarters are provisional (p-flag) — subject to revision.',
  FR: 'History from 1980Q1 — the longest of the three.',
  IT: 'History from 1996Q1 (nominal levels and compensation from 1995Q1).',
}

// ── Published QoQ contributions (Eurostat) — imports sign-correct as published ─

const CTB_BUCKETS = [
  { key: 'cons',    stem: 'CTB_CONS',    label: 'Household Consumption', color: '#60a5fa' },
  { key: 'gfcf',    stem: 'CTB_GFCF',    label: 'Fixed Investment',      color: '#4ade80' },
  { key: 'gov',     stem: 'CTB_GOV',     label: 'Govt Consumption',      color: '#a78bfa' },
  { key: 'exports', stem: 'CTB_EXPORTS', label: 'Exports',               color: '#fbbf24' },
  { key: 'imports', stem: 'CTB_IMPORTS', label: 'Imports',               color: '#f87171' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] =
  CTB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// Real chained-volume levels + nominal aggregates for the explorer.
const EXPLORER_STEMS = [
  { stem: 'GDP_R',      label: 'Real GDP', depth: 0 },
  { stem: 'CONS_R',     label: 'Household Consumption', depth: 1 },
  { stem: 'GFCF_R',     label: 'Gross Fixed Capital Formation', depth: 1 },
  { stem: 'GOV_R',      label: 'Government Consumption', depth: 1 },
  { stem: 'EXPORTS_R',  label: 'Exports of Goods & Services', depth: 1 },
  { stem: 'IMPORTS_R',  label: 'Imports of Goods & Services', depth: 1 },
  { stem: 'GDP_N',      label: 'Nominal GDP', depth: 0 },
  { stem: 'COMP',       label: 'Compensation of Employees (nominal)', depth: 0 },
  { stem: 'GDP_DEFLATOR', label: 'GDP Deflator (2020=100)', depth: 0 },
] as const

const RATE_STEMS = ['GDP_QOQ', 'GDP_YOY', 'GDP_QOQA'] as const

const DEFAULT_Q = 40 // ~10 years of quarters

// ── formatters (levels stored in € millions PER QUARTER — not annualized) ────

const fmtEurTick = (v: number) =>
  Math.abs(v) >= 5000 ? `€${(v / 1000).toFixed(0)}bn` : v.toFixed(0)
const fmtEurTooltip = (v: number) =>
  Math.abs(v) >= 5000 ? `€${(v / 1000).toFixed(1)}bn/q` : v.toFixed(1)
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

/** Date-union of the five published contribution series + the published QoQ line. */
function buildPublishedContrib(allData: AllData, cc: Eu3Country): ContribRow[] {
  const dates = new Set<string>()
  for (const b of CTB_BUCKETS) for (const p of allData[`${cc}_${b.stem}`] ?? []) dates.add(p.date)
  const maps = CTB_BUCKETS.map(b => ({
    key: b.key,
    m: new Map((allData[`${cc}_${b.stem}`] ?? []).map(p => [p.date, p.value])),
  }))
  const lineMap = new Map((allData[`${cc}_GDP_QOQ`] ?? []).map(p => [p.date, p.value]))
  return [...dates].sort().map(date => {
    const row: ContribRow = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    row.line = lineMap.get(date) ?? null
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

// ── Published rate bars panel (QoQ / QoQ-annualized) ─────────────────────────

function QoqBarsPanel({
  title, subtitle, barLabel, data,
}: {
  title: string
  subtitle?: string
  barLabel: string
  data: EurostatPoint[]
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

export function EU3GDPContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allCodes = useMemo(() => [
    ...EXPLORER_STEMS.map(s => `${cc}_${s.stem}`),
    ...RATE_STEMS.map(s => `${cc}_${s}`),
    ...CTB_BUCKETS.map(b => `${cc}_${b.stem}`),
  ], [cc])

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
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat GDP data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  const contribRows = useMemo(
    () => Object.keys(allData).length > 0 ? buildPublishedContrib(allData, cc) : [],
    [allData, cc]
  )

  const gdpLevelRows = useMemo(
    () => buildRows([{ key: 'gdp', data: allData[`${cc}_GDP_R`] ?? [] }]),
    [allData, cc]
  )
  // Real YoY is Eurostat-published; nominal YoY is terminal-computed via
  // 4-quarter compare (quarterly series → lag 4).
  const realNomYoyRows = useMemo(
    () => buildRows([
      { key: 'real', data: allData[`${cc}_GDP_YOY`] ?? [] },
      { key: 'nominal', data: computeChangePct(allData[`${cc}_GDP_N`] ?? [], 4) },
    ]),
    [allData, cc]
  )
  const deflatorLevelRows = useMemo(
    () => buildRows([{ key: 'defl', data: allData[`${cc}_GDP_DEFLATOR`] ?? [] }]),
    [allData, cc]
  )

  const explorerItems: ExplorerItem[] = useMemo(
    () => EXPLORER_STEMS.map(s => ({ id: `${cc}_${s.stem}`, label: s.label, depth: s.depth })),
    [cc]
  )
  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of explorerItems) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData, explorerItems])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} national-accounts series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat quarterly national accounts (namq_10_gdp) &mdash; chain-linked 2020 volumes,
        million EUR per quarter (not annualized), SCA. Rates and contributions are
        Eurostat-published; chained-volume components are not additive. {HISTORY_NOTE[cc]}
      </div>

      <ContribSection
        title={`${EU3_COUNTRY_LABEL[cc]} — Contributions to Real GDP Growth`}
        subtitle="Eurostat-published QoQ contributions, percentage points"
        data={contribRows}
        items={CONTRIB_ITEMS}
        lineKey="line"
        lineLabel="Real GDP QoQ"
        clipPrefix={`eu3${cc.toLowerCase()}gdpctb`}
        periods={QUICK_PERIODS_Q}
        defaultCount={DEFAULT_Q}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real GDP — Level"
          subtitle="Chain-linked 2020 volumes, €bn per quarter, SCA"
          lines={[{ key: 'gdp', label: 'Real GDP (€bn/q)', color: '#60a5fa' }]}
          rows={gdpLevelRows}
          tickFmt={fmtEurTick}
          tooltipFmt={fmtEurTooltip}
        />
        <QoqBarsPanel
          title="Real GDP Growth — published QoQ"
          subtitle="Eurostat-published quarter-over-quarter % change (not annualized)"
          barLabel="Real GDP QoQ"
          data={allData[`${cc}_GDP_QOQ`] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real vs Nominal GDP — YoY %"
          subtitle="Real YoY is Eurostat-published; nominal YoY terminal-computed (4-quarter compare) — the wedge is the deflator"
          lines={[
            { key: 'real', label: 'Real GDP YoY (published)', color: '#60a5fa', width: 2.2 },
            { key: 'nominal', label: 'Nominal GDP YoY (computed)', color: '#f59e0b' },
          ]}
          rows={realNomYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <QoqBarsPanel
          title="Real GDP Growth — published QoQ annualized"
          subtitle="Eurostat-published quarter-over-quarter % change at annual rates"
          barLabel="Real GDP QoQ (ann.)"
          data={allData[`${cc}_GDP_QOQA`] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="GDP Deflator — Level"
          subtitle="Implied deflator, index 2020=100, SCA"
          lines={[{ key: 'defl', label: 'GDP Deflator (2020=100)', color: '#a78bfa' }]}
          rows={deflatorLevelRows}
          tickFmt={fmtIdxTick}
          tooltipFmt={fmtIdxTooltip}
        />
        <RatesChart
          title="GDP Deflator"
          subtitle="Index 2020=100, SCA — YoY / annualized"
          data={allData[`${cc}_GDP_DEFLATOR`] ?? []}
          frequency="quarterly"
        />
      </div>

      <SeriesExplorer
        title={`${EU3_COUNTRY_LABEL[cc]} GDP Explorer`}
        selectorLabel="Component"
        items={explorerItems}
        data={explorerData}
        defaultId={`${cc}_GDP_R`}
        frequency="quarterly"
        unitLabel="Million EUR per quarter, SCA (real = chain-linked 2020; nominal = current prices; deflator = index 2020=100)"
        levelFormatter={fmtEurTooltip}
      />
    </>
  )
}
