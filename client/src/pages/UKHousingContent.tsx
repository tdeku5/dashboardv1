import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchBoeSeries, type BoeDataPoint } from '../lib/boe'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV, computeMA, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK Housing dashboard content — demand (mortgage approvals), prices (UK HPI)
// and credit (mortgage rates & secured lending). The hub page provides the
// section tabs; this component renders the panel set for one section and
// fetches lazily (only the data the active section needs).
//
// Demand panels are PROXY (approvals stand in for US new home sales — see
// UK_PROXY_CAVEATS.housing_transactions). UK HPI price panels are DIRECT.

type HousingSection = 'demand' | 'prices' | 'credit'

// ── UK HPI client ────────────────────────────────────────────────────────────

interface HpiObs {
  region: string
  date: string
  average_price: number | null
  average_price_sa: number | null
  index_value: number | null
  index_sa: number | null
  annual_change: number | null
  monthly_change: number | null
  price_detached: number | null
  price_semi: number | null
  price_terraced: number | null
  price_flat: number | null
  sales_volume: number | null
}

interface HpiResponse {
  region: string
  latest: string | null
  observations: HpiObs[]
}

async function fetchHpiRegion(region: string): Promise<HpiObs[]> {
  try {
    const res = await fetch(`/api/uk-hpi?region=${encodeURIComponent(region)}`)
    if (!res.ok) {
      console.error(`[UK HPI client] Failed to fetch ${region}: ${res.status}`)
      return []
    }
    const json = await res.json() as HpiResponse
    return json.observations ?? []
  } catch (err) {
    console.error(`[UK HPI client] Network error fetching ${region}:`, err)
    return []
  }
}

// ── Date / series helpers ────────────────────────────────────────────────────

/** Normalize any ISO date to the first of its month (BoE monthly series stamp month-end). */
function monthKey(d: string): string {
  return `${d.slice(0, 7)}-01`
}

function toNV(data: ReadonlyArray<{ date: string; value: number }>): NV[] {
  return data.map(p => ({ date: monthKey(p.date), value: p.value }))
}

/** Average a daily series into calendar-month buckets, dated first-of-month. */
function monthlyAvg(daily: ReadonlyArray<BoeDataPoint>): WD[] {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const p of daily) {
    const ym = p.date.slice(0, 7)
    const e = acc.get(ym)
    if (e) { e.sum += p.value; e.n += 1 } else acc.set(ym, { sum: p.value, n: 1 })
  }
  return [...acc.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ym, { sum, n }]) => ({ date: `${ym}-01`, value: sum / n }))
}

function hpiField(obs: readonly HpiObs[], field: keyof HpiObs): NV[] {
  return obs.map(o => {
    const v = o[field]
    return { date: monthKey(o.date), value: typeof v === 'number' ? v : null }
  })
}

/** First difference (month-on-month level change). */
function diffSeries(data: readonly NV[]): NV[] {
  return data.map((d, i) => {
    const prev = i > 0 ? data[i - 1].value : null
    return { date: d.date, value: d.value != null && prev != null ? d.value - prev : null }
  })
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

// ── Series to fetch per section ──────────────────────────────────────────────

const DEMAND_BOE = ['LPMVTVX', 'LPMVTVF', 'LPMVTVR']
const CREDIT_BOE = [
  'IUDBEDR', 'IUMBV34', 'IUMBV37', 'IUMBV42', 'IUMBV45', 'IUM2WTL',
  'CFMHSDE', 'IUMBX67', 'IUMTLMV', 'LPMVTXK', 'LPMVTXN',
]
const HPI_REGIONS = ['United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'London'] as const

// ── Panel series definitions ─────────────────────────────────────────────────

const S_APPROVALS: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Approvals (SA)', color: '#60a5fa', kind: 'line' },
  { key: 'ma', label: '6-mo MA', color: '#f97316', kind: 'line', width: 1.5, dash: '6 3' },
]
const S_MOM: readonly PanelSeriesDef[] = [
  { key: 'chg', label: 'MoM change', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
  { key: 'ma', label: '6-mo MA', color: '#60a5fa', kind: 'line', width: 1.5 },
]
const S_REMO: readonly PanelSeriesDef[] = [
  { key: 'remo', label: 'Remortgaging approvals (000s)', color: '#a78bfa', kind: 'line' },
]
const S_DUAL: readonly PanelSeriesDef[] = [
  { key: 'hp', label: 'House purchase (000s)', color: '#60a5fa', kind: 'line' },
  { key: 'remo', label: 'Remortgage (000s)', color: '#a78bfa', kind: 'line' },
]

const REGION_DEFS = [
  { region: 'United Kingdom', key: 'uk', color: '#e2e8f0', width: 1.6 },
  { region: 'England', key: 'eng', color: '#60a5fa', width: 1.4 },
  { region: 'Scotland', key: 'sco', color: '#4ade80', width: 1.4 },
  { region: 'Wales', key: 'wal', color: '#a78bfa', width: 1.4 },
  { region: 'Northern Ireland', key: 'ni', color: '#f59e0b', width: 1.4 },
  { region: 'London', key: 'lon', color: '#ef4444', width: 2.6 },
] as const

const S_REGIONS: readonly PanelSeriesDef[] = REGION_DEFS.map((r): PanelSeriesDef => ({
  key: r.key, label: r.region, color: r.color, kind: 'line', width: r.width,
}))

const S_AVG_PRICE: readonly PanelSeriesDef[] = [
  { key: 'nsa', label: 'Average price', color: '#60a5fa', kind: 'line' },
  { key: 'sa', label: 'Average price (SA)', color: '#f97316', kind: 'line', width: 1.5, dash: '6 3' },
]
const S_ANNUAL: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'Annual change %', color: 'rgba(74,222,128,0.75)', kind: 'bar', posNeg: true },
]
const S_TYPES: readonly PanelSeriesDef[] = [
  { key: 'det', label: 'Detached', color: '#60a5fa', kind: 'line' },
  { key: 'semi', label: 'Semi-detached', color: '#4ade80', kind: 'line' },
  { key: 'terr', label: 'Terraced', color: '#f59e0b', kind: 'line' },
  { key: 'flat', label: 'Flat / maisonette', color: '#a78bfa', kind: 'line' },
]
const S_RENTS: readonly PanelSeriesDef[] = [
  { key: 'hpi', label: 'House prices YoY (UK HPI)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'rent', label: 'CPI rents YoY (D7GQ)', color: '#ec4899', kind: 'line', width: 2 },
]
const S_PTE: readonly PanelSeriesDef[] = [
  { key: 'ratio', label: 'Price / annualized weekly earnings', color: '#fdba74', kind: 'line', width: 2 },
]

const S_QUOTED: readonly PanelSeriesDef[] = [
  { key: 'br', label: 'Bank Rate (monthly avg)', color: '#e2e8f0', kind: 'line', width: 2 },
  { key: 'y2', label: '2y fix 75% LTV', color: '#60a5fa', kind: 'line' },
  { key: 'y3', label: '3y fix 75% LTV', color: '#4ade80', kind: 'line' },
  { key: 'y5', label: '5y fix 75% LTV', color: '#f59e0b', kind: 'line' },
  { key: 'y10', label: '10y fix 75% LTV', color: '#a78bfa', kind: 'line' },
  { key: 'svr', label: 'SVR', color: '#ef4444', kind: 'line', width: 1.4, dash: '4 3' },
]
const S_EFFECTIVE: readonly PanelSeriesDef[] = [
  { key: 'stock', label: 'Effective secured stock rate (CFMHSDE)', color: '#60a5fa', kind: 'line' },
  { key: 'out', label: 'Effective rate, outstanding mortgages (IUMBX67)', color: '#4ade80', kind: 'line' },
  { key: 'revert', label: 'Revert-to rate (IUMTLMV)', color: '#f59e0b', kind: 'line' },
]
const S_SECURED: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Secured lending outstanding (SA)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'bs', label: 'Building societies (LPMVTXN)', color: '#a78bfa', kind: 'line', width: 1.4 },
  { key: 'yoy', label: 'YoY % (right)', color: '#4ade80', kind: 'line', axis: 'r', width: 1.5, dash: '6 3' },
]
const S_SPREAD: readonly PanelSeriesDef[] = [
  { key: 'spread', label: '2y fix − Bank Rate (pp)', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtCount = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
const fmtThousands = (v: number) => `${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}k`
const fmtPct = (v: number) => `${v.toFixed(2)}%`
const fmtPrice = (v: number) => `£${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })}k`
const fmtBn = (v: number) => `£${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })}bn`
const fmtRatio = (v: number) => `${v.toFixed(2)}×`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKHousingContent({ section }: { section: HousingSection }) {
  const [boe, setBoe] = useState<Record<string, BoeDataPoint[]>>({})
  const [hpi, setHpi] = useState<Record<string, HpiObs[]>>({})
  const [ons, setOns] = useState<Record<string, WD[]>>({})
  const [loaded, setLoaded] = useState<Record<HousingSection, boolean>>({
    demand: false, prices: false, credit: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded[section]) return
    let cancelled = false
    const markLoaded = () => {
      if (!cancelled) setLoaded(prev => ({ ...prev, [section]: true }))
    }
    const fail = (e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load housing data')
    }

    if (section === 'demand') {
      fetchBoeSeries(DEMAND_BOE)
        .then(res => { if (!cancelled) setBoe(prev => ({ ...prev, ...res })) })
        .then(markLoaded, fail)
    } else if (section === 'prices') {
      Promise.all([
        Promise.all(HPI_REGIONS.map(r =>
          fetchHpiRegion(r).then(obs => [r, obs] as [string, HpiObs[]])
        )),
        fetchOnsSeries('KAB9', 'lms'),
        fetchOnsSeries('D7GQ', 'mm23'),
      ]).then(([regions, kab9, d7gq]) => {
        if (cancelled) return
        setHpi(prev => ({ ...prev, ...Object.fromEntries(regions) }))
        setOns(prev => ({ ...prev, KAB9: kab9, D7GQ: d7gq }))
      }).then(markLoaded, fail)
    } else {
      fetchBoeSeries(CREDIT_BOE)
        .then(res => { if (!cancelled) setBoe(prev => ({ ...prev, ...res })) })
        .then(markLoaded, fail)
    }

    return () => { cancelled = true }
  }, [section, loaded])

  // ── Demand ────────────────────────────────────────────────────────────────

  const approvalsNV = useMemo(() => toNV(boe['LPMVTVX'] ?? []), [boe])
  const approvalsRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: approvalsNV },
    { key: 'ma', data: computeMA(approvalsNV, 6) },
  ]), [approvalsNV])

  const momNV = useMemo(() => diffSeries(approvalsNV), [approvalsNV])
  const momRows = useMemo(() => mergeByDate([
    { key: 'chg', data: momNV },
    { key: 'ma', data: computeMA(momNV, 6) },
  ]), [momNV])

  const remoRows = useMemo(() => mergeByDate([
    { key: 'remo', data: toNV(boe['LPMVTVR'] ?? []) },
  ]), [boe])

  const dualRows = useMemo(() => mergeByDate([
    { key: 'hp', data: toNV(boe['LPMVTVF'] ?? []) },
    { key: 'remo', data: toNV(boe['LPMVTVR'] ?? []) },
  ]), [boe])

  // ── Prices ────────────────────────────────────────────────────────────────

  const ukHpi = useMemo(() => hpi['United Kingdom'] ?? [], [hpi])

  const avgPriceRows = useMemo(() => mergeByDate([
    { key: 'nsa', data: hpiField(ukHpi, 'average_price') },
    { key: 'sa', data: hpiField(ukHpi, 'average_price_sa') },
  ]), [ukHpi])

  const annualRows = useMemo(() => mergeByDate([
    { key: 'yoy', data: hpiField(ukHpi, 'annual_change') },
  ]), [ukHpi])

  const regionRows = useMemo(() => mergeByDate(
    REGION_DEFS.map(r => ({ key: r.key, data: hpiField(hpi[r.region] ?? [], 'annual_change') }))
  ), [hpi])

  const typeRows = useMemo(() => mergeByDate([
    { key: 'det', data: hpiField(ukHpi, 'price_detached') },
    { key: 'semi', data: hpiField(ukHpi, 'price_semi') },
    { key: 'terr', data: hpiField(ukHpi, 'price_terraced') },
    { key: 'flat', data: hpiField(ukHpi, 'price_flat') },
  ]), [ukHpi])

  const rentRows = useMemo(() => mergeByDate([
    { key: 'hpi', data: hpiField(ukHpi, 'annual_change') },
    { key: 'rent', data: toNV(ons['D7GQ'] ?? []) },
  ]), [ukHpi, ons])

  const pteRows = useMemo(() => {
    const awe = new Map(toNV(ons['KAB9'] ?? []).map(p => [p.date, p.value]))
    const ratio: NV[] = []
    for (const o of ukHpi) {
      const date = monthKey(o.date)
      const w = awe.get(date)
      if (o.average_price != null && w != null && w > 0) {
        ratio.push({ date, value: o.average_price / (w * 52) })
      }
    }
    return mergeByDate([{ key: 'ratio', data: ratio }])
  }, [ukHpi, ons])

  // ── Credit ────────────────────────────────────────────────────────────────

  const bankRateM = useMemo(() => monthlyAvg(boe['IUDBEDR'] ?? []), [boe])

  const quotedRows = useMemo(() => mergeByDate([
    { key: 'br', data: toNV(bankRateM) },
    { key: 'y2', data: toNV(boe['IUMBV34'] ?? []) },
    { key: 'y3', data: toNV(boe['IUMBV37'] ?? []) },
    { key: 'y5', data: toNV(boe['IUMBV42'] ?? []) },
    { key: 'y10', data: toNV(boe['IUMBV45'] ?? []) },
    { key: 'svr', data: toNV(boe['IUM2WTL'] ?? []) },
  ]), [bankRateM, boe])

  const effRows = useMemo(() => mergeByDate([
    { key: 'stock', data: toNV(boe['CFMHSDE'] ?? []) },
    { key: 'out', data: toNV(boe['IUMBX67'] ?? []) },
    { key: 'revert', data: toNV(boe['IUMTLMV'] ?? []) },
  ]), [boe])

  const securedRows = useMemo(() => {
    const lvl = boe['LPMVTXK'] ?? []
    return mergeByDate([
      { key: 'lvl', data: toNV(lvl) },
      { key: 'bs', data: toNV(boe['LPMVTXN'] ?? []) },
      { key: 'yoy', data: computeChangePct(lvl, 12).map(p => ({ date: monthKey(p.date), value: p.value })) },
    ])
  }, [boe])

  const spreadRows = useMemo(() => {
    const br = new Map(bankRateM.map(p => [p.date, p.value]))
    const spread: NV[] = toNV(boe['IUMBV34'] ?? []).map(p => {
      const b = br.get(p.date)
      return { date: p.date, value: p.value != null && b != null ? p.value - b : null }
    })
    return mergeByDate([{ key: 'spread', data: spread }])
  }, [bankRateM, boe])

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>
  if (!loaded[section]) return <div className={kit.statusBlock}>Loading UK housing data...</div>

  const demandBadge = <ProxyBadge caveat={UK_PROXY_CAVEATS.housing_transactions} />

  return (
    <>
      {section === 'demand' && (
        <>
          <div style={SRC_NOTE}>
            Bank of England (Bankstats) &mdash; monthly mortgage approvals, seasonally adjusted
          </div>
          <div style={GRID2}>
            <TSPanel key="d-approvals"
              title="Mortgage Approvals for House Purchase"
              subtitle="LPMVTVX — number per month, SA, with 6-mo MA"
              badge={demandBadge}
              data={approvalsRows} series={S_APPROVALS} fmtLeft={fmtCount} />
            <TSPanel key="d-mom"
              title="Approvals — Monthly Change"
              subtitle="Δ LPMVTVX month-on-month, number, with 6-mo MA"
              badge={demandBadge}
              data={momRows} series={S_MOM} fmtLeft={fmtCount} zeroRef />
          </div>
          <div style={GRID2}>
            <TSPanel key="d-remo"
              title="Remortgaging Approvals"
              subtitle="LPMVTVR — thousands per month, SA"
              badge={demandBadge}
              data={remoRows} series={S_REMO} fmtLeft={fmtThousands} />
            <TSPanel key="d-dual"
              title="House-Purchase vs Remortgage"
              subtitle="LPMVTVF vs LPMVTVR — thousands per month, SA"
              badge={demandBadge}
              data={dualRows} series={S_DUAL} fmtLeft={fmtThousands} />
          </div>
        </>
      )}

      {section === 'prices' && (
        <>
          <div style={SRC_NOTE}>
            HM Land Registry / ONS UK House Price Index &mdash; monthly; rents &amp; earnings from ONS
          </div>
          <div style={GRID2}>
            <TSPanel key="p-avg"
              title="UK Average House Price"
              subtitle="UK HPI — average price, NSA and SA, United Kingdom"
              data={avgPriceRows} series={S_AVG_PRICE} fmtLeft={fmtPrice} />
            <TSPanel key="p-annual"
              title="House Price Annual Change"
              subtitle="UK HPI — annual % change, United Kingdom"
              data={annualRows} series={S_ANNUAL} fmtLeft={fmtPct} zeroRef />
          </div>
          <div style={GRID2}>
            <TSPanel key="p-regions"
              title="Annual Change by Region"
              subtitle="UK HPI — annual % change; London highlighted"
              data={regionRows} series={S_REGIONS} fmtLeft={fmtPct} zeroRef />
            <TSPanel key="p-types"
              title="Average Price by Property Type"
              subtitle="UK HPI — detached / semi / terraced / flat, United Kingdom"
              data={typeRows} series={S_TYPES} fmtLeft={fmtPrice} />
          </div>
          <div style={GRID2}>
            <TSPanel key="p-rents"
              title="House Prices vs Rents — YoY"
              subtitle="UK HPI annual change vs CPI actual rents (D7GQ, mm23)"
              data={rentRows} series={S_RENTS} fmtLeft={fmtPct} zeroRef />
            <TSPanel key="p-pte"
              title="House Price to Earnings"
              subtitle="Ratio of average price to annualized average weekly earnings (UK HPI ÷ KAB9 × 52)"
              data={pteRows} series={S_PTE} fmtLeft={fmtRatio} />
          </div>
        </>
      )}

      {section === 'credit' && (
        <>
          <div style={SRC_NOTE}>
            Bank of England &mdash; Bank Rate, quoted &amp; effective mortgage rates, secured lending
          </div>
          <div style={GRID2}>
            <TSPanel key="c-quoted"
              title="Bank Rate & Quoted Mortgage Rates"
              subtitle="IUDBEDR (monthly-averaged) + quoted fixed 2y/3y/5y/10y 75% LTV + SVR, %"
              data={quotedRows} series={S_QUOTED} fmtLeft={fmtPct} />
            <TSPanel key="c-effective"
              title="Effective Mortgage Rates"
              subtitle="CFMHSDE + IUMBX67 + IUMTLMV, %"
              badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.effective_mortgage_rate} />}
              data={effRows} series={S_EFFECTIVE} fmtLeft={fmtPct} />
          </div>
          <div style={GRID2}>
            <TSPanel key="c-secured"
              title="Secured Lending Outstanding"
              subtitle="LPMVTXK (£m SA) + LPMVTXN building societies, with 12-mo % change (right)"
              data={securedRows} series={S_SECURED} fmtLeft={fmtBn} fmtRight={fmtPct} />
            <TSPanel key="c-spread"
              title="Quoted 2y Fix vs Bank Rate Spread"
              subtitle="IUMBV34 − monthly-averaged IUDBEDR, percentage points"
              data={spreadRows} series={S_SPREAD} fmtLeft={fmtPct} zeroRef />
          </div>
        </>
      )}
    </>
  )
}
