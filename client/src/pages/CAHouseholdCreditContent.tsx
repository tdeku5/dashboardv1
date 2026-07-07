import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeMA, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada Household Credit dashboard — credit liabilities of households from
// StatCan table 36-10-0639 (monthly SA, $M, 1990→): total / mortgage /
// non-mortgage / credit cards, plus a credit-to-GDP ratio against quarterly
// nominal GDP (36-10-0104, SAAR $M, step-interpolated to months).
//
// Every panel is a PROXY of the US H.8 bank-credit view: this is the
// borrower-side household stock — no bank-asset C&I/CRE lending series exists
// for Canada. All panels carry CA_PROXY_CAVEATS.household_credit.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = [
  'CA_HHCRED_TOTAL', 'CA_HHCRED_MORT', 'CA_HHCRED_NONMORT', 'CA_HHCRED_CARDS',
  'CA_GDP_N',
] as const

// ── Series helpers ───────────────────────────────────────────────────────────

/** First difference (month-on-month level change). */
function diffSeries(data: readonly StatcanPoint[]): NV[] {
  return data.map((d, i) => ({ date: d.date, value: i > 0 ? d.value - data[i - 1].value : null }))
}

/** Component share of an aggregate, % (shares of the same aggregate are valid). */
function shareOf(part: readonly StatcanPoint[], total: readonly StatcanPoint[]): NV[] {
  const t = new Map(total.map(p => [p.date, p.value]))
  return part.map(p => {
    const tv = t.get(p.date)
    return { date: p.date, value: tv != null && tv !== 0 ? (p.value / tv) * 100 : null }
  })
}

/**
 * Monthly stock ÷ step-interpolated quarterly SAAR nominal GDP, %.
 * The GDP value applied to each month is the latest quarterly observation with
 * date ≤ that month. GDP is already annualized (SAAR), so stock ÷ GDP is the
 * standard debt-to-GDP ratio directly — no ×4.
 */
function creditToGdp(monthly: readonly StatcanPoint[], quarterly: readonly StatcanPoint[]): NV[] {
  let j = 0
  let cur: number | null = null
  return monthly.map(m => {
    while (j < quarterly.length && quarterly[j].date <= m.date) { cur = quarterly[j].value; j++ }
    return { date: m.date, value: cur != null && cur !== 0 ? (m.value / cur) * 100 : null }
  })
}

// ── Local panel kit (multi-series line/bar panel with brush) ─────────────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  kind: 'line' | 'bar'
  dash?: string
  width?: number
  posNeg?: boolean
}

function mergeByDate(
  inputs: ReadonlyArray<{ key: string; data: ReadonlyArray<NV> }>,
): PanelRow[] {
  const dates = new Set<string>()
  for (const s of inputs) for (const p of s.data) dates.add(p.date)
  const maps = inputs.map(s => ({ key: s.key, map: new Map(s.data.map(p => [p.date, p.value])) }))
  return [...dates].sort().map(date => {
    const row: PanelRow = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

const fmtDefault = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, zeroRef = false, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
}) {
  const fmtL = fmtLeft ?? fmtDefault
  const hasBar = series.some(s => s.kind === 'bar')

  const [vis, setVis] = useState<Set<string>>(() => new Set(series.map(s => s.key)))
  const toggle = (k: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!data.length) return
    setBrush({ start: Math.max(0, data.length - defaultCount), end: data.length - 1 })
  }, [data.length, defaultCount])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {series.map(s => (
            <button key={s.key} type="button"
              className={`${kit.legendItem} ${vis.has(s.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(s.key)}>
              <span className={s.kind === 'bar' ? kit.legendSwatch : kit.legendLine}
                style={{ background: s.posNeg ? 'rgba(74,222,128,0.75)' : s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div className={kit.statusBlock}>No data</div>
      ) : (
        <div className={kit.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                tickFormatter={fmtAxisDate} minTickGap={60} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={hasBar
                  ? [(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]
                  : ['auto', 'auto']}
                tickFormatter={fmtL} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const s = series.find(x => x.key === name)
                  const label = s?.label ?? String(name)
                  if (typeof v !== 'number') return ['-', label] as [string, string]
                  return [fmtL(v), label] as [string, string]
                }} />
              {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
              {series.filter(s => vis.has(s.key)).map(s => s.kind === 'bar' ? (
                <Bar key={s.key} dataKey={s.key} name={s.key}
                  fill={s.color} isAnimationActive={false} legendType="none" maxBarSize={16}>
                  {s.posNeg ? data.map((row, idx) => {
                    const v = row[s.key]
                    return (
                      <Cell key={`${s.key}-${idx}`}
                        fill={typeof v === 'number' && v >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
                    )
                  }) : null}
                </Bar>
              ) : (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                  stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
                  dot={false} isAnimationActive={false} connectNulls legendType="none" />
              ))}
              <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
                onChange={({ startIndex, endIndex }) =>
                  setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                {...BRUSH_STYLE} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Panel series definitions ─────────────────────────────────────────────────

const S_LEVELS: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Total credit liabilities', color: '#e2e8f0', kind: 'line', width: 2 },
  { key: 'mort', label: 'Mortgage loans', color: '#60a5fa', kind: 'line' },
  { key: 'nonmort', label: 'Non-mortgage loans', color: '#a78bfa', kind: 'line' },
]
const S_GROWTH: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Total YoY', color: '#e2e8f0', kind: 'line', width: 2 },
  { key: 'mort', label: 'Mortgage YoY', color: '#60a5fa', kind: 'line' },
  { key: 'nonmort', label: 'Non-mortgage YoY', color: '#a78bfa', kind: 'line' },
]
const S_COMP: readonly PanelSeriesDef[] = [
  { key: 'mort', label: 'Mortgage % of total', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'nonmort', label: 'Non-mortgage % of total', color: '#a78bfa', kind: 'line' },
  { key: 'cards', label: 'Credit cards % of total', color: '#f59e0b', kind: 'line' },
]
const S_GDP_RATIO: readonly PanelSeriesDef[] = [
  { key: 'ratio', label: 'Household credit / nominal GDP', color: '#4ade80', kind: 'line', width: 2 },
]
const S_FLOWS: readonly PanelSeriesDef[] = [
  { key: 'chg', label: 'Net monthly flow', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
  { key: 'ma', label: '6-mo MA', color: '#60a5fa', kind: 'line', width: 1.5 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtCredBn = (v: number) => {                                 // stored in $ millions
  const bn = v / 1000
  return Math.abs(bn) >= 1000
    ? `$${(bn / 1000).toFixed(2)}T`
    : `$${bn.toLocaleString('en-CA', { maximumFractionDigits: 0 })}B`
}
const fmtFlowBn = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(v / 1000).toFixed(1)}B`
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAHouseholdCreditContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load StatCan credit data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const total = useMemo(() => allData['CA_HHCRED_TOTAL'] ?? [], [allData])
  const mort = useMemo(() => allData['CA_HHCRED_MORT'] ?? [], [allData])
  const nonmort = useMemo(() => allData['CA_HHCRED_NONMORT'] ?? [], [allData])
  const cards = useMemo(() => allData['CA_HHCRED_CARDS'] ?? [], [allData])

  const levelRows = useMemo(() => mergeByDate([
    { key: 'total', data: total },
    { key: 'mort', data: mort },
    { key: 'nonmort', data: nonmort },
  ]), [total, mort, nonmort])

  const growthRows = useMemo(() => mergeByDate([
    { key: 'total', data: computeChangePct(total, 12) },
    { key: 'mort', data: computeChangePct(mort, 12) },
    { key: 'nonmort', data: computeChangePct(nonmort, 12) },
  ]), [total, mort, nonmort])

  const compRows = useMemo(() => mergeByDate([
    { key: 'mort', data: shareOf(mort, total) },
    { key: 'nonmort', data: shareOf(nonmort, total) },
    { key: 'cards', data: shareOf(cards, total) },
  ]), [total, mort, nonmort, cards])

  const gdpRatioRows = useMemo(() => mergeByDate([
    { key: 'ratio', data: creditToGdp(total, allData['CA_GDP_N'] ?? []) },
  ]), [total, allData])

  const flowRows = useMemo(() => {
    const diff = diffSeries(total)
    return mergeByDate([
      { key: 'chg', data: diff },
      { key: 'ma', data: computeMA(diff, 6) },
    ])
  }, [total])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan credit series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const badge = <ProxyBadge caveat={CA_PROXY_CAVEATS.household_credit} />

  return (
    <>
      <div style={SRC_NOTE}>
        Statistics Canada (36-10-0639) &mdash; monthly, seasonally adjusted, $ millions;
        borrower-side household credit &mdash; no bank-asset C&amp;I/CRE view exists (US H.8 analog limitation); PNFC credit deferred
      </div>

      <div style={GRID2}>
        <TSPanel key="hc-levels"
          title="Household Credit Outstanding"
          subtitle="Total / mortgage / non-mortgage credit liabilities of households, $M SA"
          badge={badge}
          data={levelRows} series={S_LEVELS} fmtLeft={fmtCredBn} />
        <TSPanel key="hc-growth"
          title="Household Credit — 12-Month Growth"
          subtitle="YoY % of total, mortgage and non-mortgage stocks"
          badge={badge}
          data={growthRows} series={S_GROWTH} fmtLeft={fmtPct} zeroRef />
      </div>

      <div style={GRID2}>
        <TSPanel key="hc-comp"
          title="Credit Composition"
          subtitle="Mortgage / non-mortgage / credit cards as % of total credit liabilities"
          badge={badge}
          data={compRows} series={S_COMP} fmtLeft={fmtPct} />
        <TSPanel key="hc-gdp"
          title="Household Credit as % of Nominal GDP"
          subtitle="Stock ÷ SAAR nominal GDP (36-10-0104, latest quarter ≤ month, step-interpolated)"
          badge={badge}
          data={gdpRatioRows} series={S_GDP_RATIO} fmtLeft={fmtPct} />
      </div>

      <TSPanel key="hc-flows"
        title="Net Monthly Flows"
        subtitle="Δ total credit liabilities month-on-month, with 6-mo MA"
        badge={badge}
        data={flowRows} series={S_FLOWS} fmtLeft={fmtFlowBn} zeroRef />
    </>
  )
}
