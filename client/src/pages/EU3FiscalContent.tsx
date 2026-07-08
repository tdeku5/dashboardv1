import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type NV,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Fiscal dashboard — DE / FR / IT. `balance` section: Eurostat quarterly
// general-government non-financial accounts (gov_10q_ggnfa): net lending B9,
// total revenue and total expenditure in €M NSA plus the published %-of-GDP
// variants. The primary read is the terminal-computed TRAILING-4Q view — the
// raw quarterly flows are NSA with strong within-year seasonality (Italy
// posts Q4 surpluses every year). `debt` section: Maastricht debt
// (gov_10q_ggdebt) in €M and % of GDP (DE 63.5 / FR 116.2 / IT 137.1 at 25Q4).
// EVERY panel carries eu3Caveat('fiscal_quarterly') — these are quarterly ESA
// accrual accounts; no daily/monthly cash-flow analog (DTS/MTS) exists.

type FiscalSection = 'balance' | 'debt'

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country, section: FiscalSection): readonly string[] {
  return section === 'balance'
    ? [
      `${cc}_FISC_B9`, `${cc}_FISC_REV`, `${cc}_FISC_EXP`,
      `${cc}_FISC_B9_PCGDP`, `${cc}_FISC_REV_PCGDP`, `${cc}_FISC_EXP_PCGDP`,
    ]
    : [`${cc}_DEBT`, `${cc}_DEBT_PCGDP`]
}

// Country notes (visible captions, keyed by cc)
const BALANCE_NOTES: Partial<Record<Eu3Country, string>> = {
  IT: 'Italy publishes NSA only — no seasonally adjusted variant exists; the trailing-4Q view is the primary read.',
  DE: 'Germany: recent quarters are provisional (p-flag) — subject to revision.',
}

// ── Series helpers ───────────────────────────────────────────────────────────

/** Rolling `n`-period sum (null until n observations accumulate). */
function rollingSum(data: readonly EurostatPoint[], n: number): NV[] {
  return data.map((p, i) => {
    if (i < n - 1) return { date: p.date, value: null }
    let sum = 0
    for (let j = i - n + 1; j <= i; j++) sum += data[j].value
    return { date: p.date, value: sum }
  })
}

/** Rolling `n`-period average (null until n observations accumulate). */
function rollingAvg(data: readonly EurostatPoint[], n: number): NV[] {
  return rollingSum(data, n).map(p => ({ date: p.date, value: p.value == null ? null : p.value / n }))
}

/** €M → €bn */
function toBn(data: readonly NV[]): NV[] {
  return data.map(p => ({ date: p.date, value: p.value == null ? null : p.value / 1000 }))
}

// ── Local panel kit (line/bar panel, optional right axis, brush) ─────────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  kind: 'line' | 'bar'
  axis?: 'l' | 'r'
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

const fmtDefault = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, fmtRight, zeroRef = false, defaultCount = 60, refLines,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  fmtRight?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
  refLines?: ReadonlyArray<{ y: number; label: string }>
}) {
  const fmtL = fmtLeft ?? fmtDefault
  const fmtR = fmtRight ?? fmtL
  const hasRight = series.some(s => s.axis === 'r')
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
              <YAxis yAxisId="l" tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={hasBar
                  ? [(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]
                  : ['auto', 'auto']}
                tickFormatter={fmtL} />
              {hasRight && (
                <YAxis yAxisId="r" orientation="right" tick={TICK} tickLine={false} axisLine={false}
                  width={58} domain={['auto', 'auto']} tickFormatter={fmtR} />
              )}
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const s = series.find(x => x.key === name)
                  const label = s?.label ?? String(name)
                  if (typeof v !== 'number') return ['-', label] as [string, string]
                  return [(s?.axis === 'r' ? fmtR : fmtL)(v), label] as [string, string]
                }} />
              {zeroRef && <ReferenceLine yAxisId="l" y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
              {refLines?.map(r => (
                <ReferenceLine key={`ref-${r.y}`} yAxisId="l" y={r.y}
                  stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: r.label, position: 'insideTopRight', fill: '#64748B', fontSize: 10 }} />
              ))}
              {series.filter(s => vis.has(s.key)).map(s => s.kind === 'bar' ? (
                <Bar key={s.key} yAxisId={s.axis === 'r' ? 'r' : 'l'} dataKey={s.key} name={s.key}
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
                <Line key={s.key} yAxisId={s.axis === 'r' ? 'r' : 'l'} type="monotone"
                  dataKey={s.key} name={s.key}
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

const S_T4Q_BALANCE: readonly PanelSeriesDef[] = [
  { key: 'bal', label: 'Trailing-4Q net lending (€bn, left)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'pct', label: 'Trailing-4Q avg, % of GDP (right)', color: '#f59e0b', kind: 'line', width: 1.5, dash: '6 3', axis: 'r' },
]
const S_QTR_BALANCE: readonly PanelSeriesDef[] = [
  { key: 'bal', label: 'Quarterly net lending (B9)', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
]
const S_REV_EXP: readonly PanelSeriesDef[] = [
  { key: 'rev', label: 'Revenue (trailing-4Q)', color: '#4ade80', kind: 'line', width: 2 },
  { key: 'exp', label: 'Expenditure (trailing-4Q)', color: '#ef4444', kind: 'line', width: 2 },
]
const S_DEBT_PCT: readonly PanelSeriesDef[] = [
  { key: 'pct', label: 'Maastricht debt, % of GDP', color: '#60a5fa', kind: 'line', width: 2 },
]
const S_DEBT_LVL: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Maastricht debt, €bn', color: '#a78bfa', kind: 'line', width: 2 },
]

// ── Formatters & layout ──────────────────────────────────────────────────────

const fmtEurBn = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  return abs >= 1000
    ? `${sign}€${(abs / 1000).toFixed(2)}T`
    : `${sign}€${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}B`
}
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}
const COUNTRY_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#8a9bb0',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3FiscalContent({ cc, section }: { cc: Eu3Country; section: FiscalSection }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc, section), [cc, section])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchEu3Batch(codes).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat fiscal data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [codes])

  // ── Balance ───────────────────────────────────────────────────────────────

  const t4qBalanceRows = useMemo(() => mergeByDate([
    { key: 'bal', data: toBn(rollingSum(allData[`${cc}_FISC_B9`] ?? [], 4)) },
    { key: 'pct', data: rollingAvg(allData[`${cc}_FISC_B9_PCGDP`] ?? [], 4) },
  ]), [allData, cc])

  const qtrBalanceRows = useMemo(() => mergeByDate([
    { key: 'bal', data: toBn(allData[`${cc}_FISC_B9`] ?? []) },
  ]), [allData, cc])

  const revExpRows = useMemo(() => mergeByDate([
    { key: 'rev', data: toBn(rollingSum(allData[`${cc}_FISC_REV`] ?? [], 4)) },
    { key: 'exp', data: toBn(rollingSum(allData[`${cc}_FISC_EXP`] ?? [], 4)) },
  ]), [allData, cc])

  // ── Debt ──────────────────────────────────────────────────────────────────

  const debtPctRows = useMemo(() => mergeByDate([
    { key: 'pct', data: allData[`${cc}_DEBT_PCGDP`] ?? [] },
  ]), [allData, cc])

  const debtLvlRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: toBn(allData[`${cc}_DEBT`] ?? []) },
  ]), [allData, cc])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className={kit.statusBlock}>Loading {codes.length} {cc} fiscal series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const label = EU3_COUNTRY_LABEL[cc]
  const badge = <ProxyBadge caveat={eu3Caveat('fiscal_quarterly', cc)} />

  return (
    <>
      <div style={SRC_NOTE}>
        Eurostat quarterly general-government accounts (gov_10q_ggnfa / gov_10q_ggdebt) &mdash;
        ESA accrual basis. No daily/monthly cash-flow analog (DTS/MTS) exists for the EU3.
      </div>

      {section === 'balance' && (
        <>
          {BALANCE_NOTES[cc] && <div style={COUNTRY_NOTE}>{BALANCE_NOTES[cc]}</div>}
          <TSPanel key={`f-t4q-${cc}`}
            title={`${label} Net Lending — Trailing 4Q`}
            subtitle="Terminal-computed: rolling 4-quarter sum of quarterly B9 (€bn, left) and 4-quarter average of the published %-of-GDP ratio (right)"
            badge={badge}
            data={t4qBalanceRows} series={S_T4Q_BALANCE}
            fmtLeft={fmtEurBn} fmtRight={fmtPct} zeroRef />
          <div style={GRID2}>
            <TSPanel key={`f-qtr-${cc}`}
              title="Quarterly Net Lending (B9) — Raw"
              subtitle="€bn per quarter, NSA — strong within-year seasonality (e.g. Italy posts Q4 surpluses); read the trailing-4Q panel for trend"
              badge={badge}
              data={qtrBalanceRows} series={S_QTR_BALANCE} fmtLeft={fmtEurBn} zeroRef />
            <TSPanel key={`f-revexp-${cc}`}
              title="Revenue vs Expenditure — Trailing 4Q"
              subtitle="Terminal-computed rolling 4-quarter sums of total revenue and total expenditure, €bn"
              badge={badge}
              data={revExpRows} series={S_REV_EXP} fmtLeft={fmtEurBn} />
          </div>
        </>
      )}

      {section === 'debt' && (
        <>
          <TSPanel key={`d-pct-${cc}`}
            title={`${label} General-Government Debt — % of GDP`}
            subtitle="Maastricht (EDP) consolidated gross debt as a share of GDP, quarterly since 2000"
            badge={badge}
            data={debtPctRows} series={S_DEBT_PCT} fmtLeft={fmtPct} defaultCount={104}
            refLines={[{ y: 60, label: 'Maastricht 60%' }]} />
          <TSPanel key={`d-lvl-${cc}`}
            title="General-Government Debt — Level"
            subtitle="Maastricht (EDP) consolidated gross debt, €bn, quarterly"
            badge={badge}
            data={debtLvlRows} series={S_DEBT_LVL} fmtLeft={fmtEurBn} defaultCount={104} />
        </>
      )}
    </>
  )
}
