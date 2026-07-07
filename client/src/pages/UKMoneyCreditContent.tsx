import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchBoeSeries, type BoeDataPoint } from '../lib/boe'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV, computeMA,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK Money & Credit dashboard — the UK analog of the US H.8 bank-credit page,
// built on BoE Money & Credit / Bankstats monthly aggregates (M4, lending to
// individuals, secured & consumer lending) plus ONS quarterly nominal GDP for
// the lending-to-GDP ratio. All BoE aggregate panels are PROXY vs H.8
// (monthly not weekly, no bank-size cohorts) — see UK_PROXY_CAVEATS.bank_credit.
//
// Deferred (no verified series codes): credit-card vs other-consumer-credit
// split, PNFC lending, household deposits.

// ── Date / series helpers ────────────────────────────────────────────────────

/** Normalize any ISO date to the first of its month (BoE monthly series stamp month-end). */
function monthKey(d: string): string {
  return `${d.slice(0, 7)}-01`
}

function toNV(data: ReadonlyArray<{ date: string; value: number }>): NV[] {
  return data.map(p => ({ date: monthKey(p.date), value: p.value }))
}

// ── Local panel kit (multi-series line/bar panel with brush) ─────────────────

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

const fmtDefault = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, fmtRight, zeroRef = false, defaultCount = 120,
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

// ── Series & panel definitions ───────────────────────────────────────────────

const BOE_CODES = ['LPMAUYN', 'LPMVQJW', 'LPMVTXY', 'LPMBI2O', 'LPMB3PS', 'LPMB4TC', 'LPMVTXK']

const S_M4: readonly PanelSeriesDef[] = [
  { key: 'm4', label: 'M4 outstanding (SA)', color: '#60a5fa', kind: 'line', width: 2 },
]
const S_M4_GROWTH: readonly PanelSeriesDef[] = [
  { key: 'g', label: 'M4 12-mo growth %', color: '#ec4899', kind: 'line', width: 2 },
]
const S_LEND_GROWTH: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Net lending to individuals 12-mo % (NSA)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'cons', label: 'Consumer credit 12-mo %', color: '#a78bfa', kind: 'line', width: 2 },
]
const S_STOCK: readonly PanelSeriesDef[] = [
  { key: 'sec', label: 'Secured lending outstanding (left)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'cc', label: 'Consumer credit outstanding (right)', color: '#f59e0b', kind: 'line', width: 2, axis: 'r' },
]
const S_FLOW: readonly PanelSeriesDef[] = [
  { key: 'flow', label: 'Net monthly flow', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
  { key: 'ma', label: '6-mo MA', color: '#60a5fa', kind: 'line', width: 1.5 },
]
const S_RATIO: readonly PanelSeriesDef[] = [
  { key: 'ratio', label: 'Secured lending % of nominal GDP', color: '#fdba74', kind: 'line', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtBn = (v: number) => `£${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })}bn`
const fmtFlowBn = (v: number) => `£${(v / 1000).toFixed(1)}bn`
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKMoneyCreditContent() {
  const [boe, setBoe] = useState<Record<string, BoeDataPoint[]>>({})
  const [ons, setOns] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchBoeSeries(BOE_CODES),
      fetchOnsSeries('YBHA', 'ukea'),
    ]).then(([boeRes, ybha]) => {
      if (cancelled) return
      setBoe(boeRes)
      setOns({ YBHA: ybha })
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load money & credit data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const m4Rows = useMemo(() => mergeByDate([
    { key: 'm4', data: toNV(boe['LPMAUYN'] ?? []) },
  ]), [boe])

  const m4GrowthRows = useMemo(() => mergeByDate([
    { key: 'g', data: toNV(boe['LPMVQJW'] ?? []) },
  ]), [boe])

  const lendGrowthRows = useMemo(() => mergeByDate([
    { key: 'total', data: toNV(boe['LPMVTXY'] ?? []) },
    { key: 'cons', data: toNV(boe['LPMB4TC'] ?? []) },
  ]), [boe])

  const stockRows = useMemo(() => mergeByDate([
    { key: 'sec', data: toNV(boe['LPMVTXK'] ?? []) },
    { key: 'cc', data: toNV(boe['LPMBI2O'] ?? []) },
  ]), [boe])

  const flowRows = useMemo(() => {
    const flow = toNV(boe['LPMB3PS'] ?? [])
    return mergeByDate([
      { key: 'flow', data: flow },
      { key: 'ma', data: computeMA(flow, 6) },
    ])
  }, [boe])

  // Lending as % of nominal GDP: monthly secured-lending stock over the latest
  // quarterly nominal GDP ≤ that month (step interpolation), annualized ×4.
  const ratioRows = useMemo(() => {
    const gdp = (ons['YBHA'] ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : 1))
    const ratio: NV[] = []
    for (const p of toNV(boe['LPMVTXK'] ?? [])) {
      let g: number | null = null
      for (const q of gdp) {
        if (monthKey(q.date) > p.date) break
        g = q.value
      }
      if (p.value != null && g != null && g > 0) {
        ratio.push({ date: p.date, value: (p.value / (g * 4)) * 100 })
      }
    }
    return mergeByDate([{ key: 'ratio', data: ratio }])
  }, [boe, ons])

  if (loading) return <div className={kit.statusBlock}>Loading BoE money &amp; credit series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const bankCreditBadge = <ProxyBadge caveat={UK_PROXY_CAVEATS.bank_credit} />

  return (
    <>
      <div style={SRC_NOTE}>
        Bank of England Money &amp; Credit / Bankstats &mdash; monthly, &pound;m &mdash; UK analog of the
        US H.8 bank-credit dashboard. Credit-card split, PNFC lending and household deposits deferred.
      </div>

      <div style={GRID2}>
        <TSPanel
          title="M4 Money Supply"
          subtitle="LPMAUYN — M4 outstanding, £m, SA"
          badge={bankCreditBadge}
          data={m4Rows} series={S_M4} fmtLeft={fmtBn} />
        <TSPanel
          title="M4 — 12-Month Growth"
          subtitle="LPMVQJW — 12-month growth rate, %, SA"
          badge={bankCreditBadge}
          data={m4GrowthRows} series={S_M4_GROWTH} fmtLeft={fmtPct} zeroRef />
      </div>

      <div style={GRID2}>
        <TSPanel
          title="Lending to Individuals — 12-Month Growth"
          subtitle="LPMVTXY (total net lending, NSA) + LPMB4TC (consumer credit), %"
          data={lendGrowthRows} series={S_LEND_GROWTH} fmtLeft={fmtPct} zeroRef />
        <TSPanel
          title="Secured & Consumer Lending Outstanding"
          subtitle="LPMVTXK secured (left) + LPMBI2O consumer credit (right), £m SA"
          badge={bankCreditBadge}
          data={stockRows} series={S_STOCK} fmtLeft={fmtBn} fmtRight={fmtBn} />
      </div>

      <div style={GRID2}>
        <TSPanel
          title="Consumer Credit — Net Monthly Flow"
          subtitle="LPMB3PS — net flow, £m SA, with 6-mo MA"
          badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.consumer_credit} />}
          data={flowRows} series={S_FLOW} fmtLeft={fmtFlowBn} zeroRef />
        <TSPanel
          title="Lending as % of Nominal GDP"
          subtitle="LPMVTXK ÷ (YBHA × 4) — stock ÷ annualized quarterly nominal GDP, step-interpolated"
          badge={bankCreditBadge}
          data={ratioRows} series={S_RATIO} fmtLeft={fmtPct} />
      </div>
    </>
  )
}
