import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, latestIsPreliminary, type AbsPoint } from '../lib/abs'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia Housing dashboard content — approvals (building approvals, the
// permits-analog) and prices-lending (TVD mean dwelling price + stock value,
// new loan commitments). The hub page provides section tabs; this component
// renders the panel set for one section and fetches lazily.
//
// approvals: ABS building approvals publish ORIGINAL (NSA) ONLY on the API —
// every panel carries the approvals_nsa badge and the 12-MONTH ROLLING SUM is
// the primary trend read (raw monthly compares same months via lag-12 YoY).
//
// prices-lending: the ABS mean dwelling price is a LEVEL from Total Value of
// Dwellings, NOT a constant-quality index (tvd_prices badge; the official
// RPPI was discontinued 2022, frozen at 2021-Q4; CoreLogic indices are
// private). TVD's latest quarter is often preliminary (obs_status 'p') — the
// caption renders dynamically via latestIsPreliminary().

type HousingSection = 'approvals' | 'prices-lending'

type AllData = Record<string, AbsPoint[]>

const SECTION_CODES: Record<HousingSection, readonly string[]> = {
  'approvals': ['AU_APPROVALS', 'AU_APPROVALS_HOUSES', 'AU_APPROVALS_OTHER'],
  'prices-lending': ['AU_MEAN_PRICE', 'AU_DWELL_STOCK_VALUE', 'AU_LEND_OO', 'AU_LEND_INV'],
}

const NSA_CAPTION = 'published original-only on the API — 12-month sums are the trend read'
const TVD_CAPTION = 'mean price LEVEL, not a constant-quality index — the official RPPI was discontinued 2022 (frozen at 2021-Q4); CoreLogic indices are private'

// ── Series helpers ───────────────────────────────────────────────────────────

/** Trailing 12-month rolling sum (null until 12 observations accrue). */
function rolling12Sum(data: readonly AbsPoint[]): NV[] {
  return data.map((d, i) => {
    if (i < 11) return { date: d.date, value: null }
    let sum = 0
    for (let j = i - 11; j <= i; j++) sum += data[j].value
    return { date: d.date, value: sum }
  })
}

// ── Quarterly formatters ─────────────────────────────────────────────────────

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
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

const fmtDefault = (v: number) => v.toLocaleString('en-AU', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, zeroRef = false, defaultCount = 120, quarterly = false,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
  quarterly?: boolean
}) {
  const fmtL = fmtLeft ?? fmtDefault
  const hasBar = series.some(s => s.kind === 'bar')
  const fmtAxis = quarterly ? fmtQAxis : fmtAxisDate

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
                tickFormatter={fmtAxis} minTickGap={60} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={hasBar
                  ? [(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]
                  : ['auto', 'auto']}
                tickFormatter={fmtL} />
              <Tooltip {...TOOLTIP_STYLE}
                labelFormatter={quarterly ? fmtQFull : TOOLTIP_STYLE.labelFormatter}
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
                {...BRUSH_STYLE} tickFormatter={fmtAxis} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Panel series definitions ─────────────────────────────────────────────────

const S_SUM12: readonly PanelSeriesDef[] = [
  { key: 'sum', label: 'Total dwellings, 12-mo rolling sum', color: '#60a5fa', kind: 'line', width: 2 },
]
const S_RAW: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Total dwellings/month (NSA)', color: '#94a3b8', kind: 'line', width: 1.4 },
]
const S_YOY_BARS: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'Same-month YoY %', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
]
const S_SPLIT: readonly PanelSeriesDef[] = [
  { key: 'houses', label: 'Private houses (12-mo sum)', color: '#4ade80', kind: 'line', width: 2 },
  { key: 'other', label: 'Other dwellings (12-mo sum)', color: '#f59e0b', kind: 'line', width: 2 },
]
const S_PRICE: readonly PanelSeriesDef[] = [
  { key: 'price', label: 'Mean dwelling price (A$k)', color: '#60a5fa', kind: 'line', width: 2 },
]
const S_PRICE_YOY: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'Mean price YoY % (lag-4, terminal-computed)', color: '#f59e0b', kind: 'line', width: 2 },
]
const S_STOCK: readonly PanelSeriesDef[] = [
  { key: 'stock', label: 'Total dwelling stock value', color: '#a78bfa', kind: 'line', width: 2 },
]
const S_LEND: readonly PanelSeriesDef[] = [
  { key: 'oo', label: 'Owner-occupier', color: '#4ade80', kind: 'line', width: 2 },
  { key: 'inv', label: 'Investor', color: '#ef4444', kind: 'line', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtCount = (v: number) => v.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const fmtCountK = (v: number) => `${(v / 1000).toFixed(0)}k`
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtPriceK = (v: number) => `$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}k`
const fmtStockT = (v: number) => `A$${(v / 1e6).toFixed(2)}T`     // stored in A$ millions
const fmtLendB = (v: number) => `A$${(v / 1000).toFixed(1)}B`     // stored in A$ millions

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUHousingContent({ section }: { section: HousingSection }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loaded, setLoaded] = useState<Record<HousingSection, boolean>>({
    'approvals': false, 'prices-lending': false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded[section]) return
    let cancelled = false
    fetchAbsBatch(SECTION_CODES[section]).then(map => {
      if (cancelled) return
      setAllData(prev => ({ ...prev, ...map }))
      setLoaded(prev => ({ ...prev, [section]: true }))
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ABS housing data')
    })
    return () => { cancelled = true }
  }, [section, loaded])

  // ── Approvals ─────────────────────────────────────────────────────────────

  const approvals = useMemo(() => allData['AU_APPROVALS'] ?? [], [allData])

  const sum12Rows = useMemo(() => mergeByDate([
    { key: 'sum', data: rolling12Sum(approvals) },
  ]), [approvals])

  const rawRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: approvals },
  ]), [approvals])

  const yoyRows = useMemo(() => mergeByDate([
    { key: 'yoy', data: computeChangePct(approvals, 12) },
  ]), [approvals])

  const splitRows = useMemo(() => mergeByDate([
    { key: 'houses', data: rolling12Sum(allData['AU_APPROVALS_HOUSES'] ?? []) },
    { key: 'other', data: rolling12Sum(allData['AU_APPROVALS_OTHER'] ?? []) },
  ]), [allData])

  // ── Prices & lending ──────────────────────────────────────────────────────

  const meanPrice = useMemo(() => allData['AU_MEAN_PRICE'] ?? [], [allData])
  const pricePrelim = useMemo(() => latestIsPreliminary(meanPrice), [meanPrice])
  const prelimNote = pricePrelim ? ' · latest quarter preliminary (p)' : ''

  const priceRows = useMemo(() => mergeByDate([
    { key: 'price', data: meanPrice },
  ]), [meanPrice])

  const priceYoyRows = useMemo(() => mergeByDate([
    { key: 'yoy', data: computeChangePct(meanPrice, 4) },
  ]), [meanPrice])

  const stockRows = useMemo(() => mergeByDate([
    { key: 'stock', data: allData['AU_DWELL_STOCK_VALUE'] ?? [] },
  ]), [allData])

  const lendRows = useMemo(() => mergeByDate([
    { key: 'oo', data: allData['AU_LEND_OO'] ?? [] },
    { key: 'inv', data: allData['AU_LEND_INV'] ?? [] },
  ]), [allData])

  const lendYoyRows = useMemo(() => mergeByDate([
    { key: 'oo', data: computeChangePct(allData['AU_LEND_OO'] ?? [], 4) },
    { key: 'inv', data: computeChangePct(allData['AU_LEND_INV'] ?? [], 4) },
  ]), [allData])

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>
  if (!loaded[section]) return <div className={kit.statusBlock}>Loading ABS housing data...</div>

  const nsaBadge = <ProxyBadge caveat={AU_PROXY_CAVEATS.approvals_nsa} />
  const tvdBadge = <ProxyBadge caveat={AU_PROXY_CAVEATS.tvd_prices} />

  return (
    <>
      {section === 'approvals' && (
        <>
          <div style={SRC_NOTE}>
            ABS Building Approvals &mdash; total dwelling units/month, NSA(!), total from 1986,
            private houses vs other split from 1983. {NSA_CAPTION}.
          </div>
          <TSPanel key="a-sum12"
            title="Dwelling Approvals — 12-Month Rolling Sum"
            subtitle={`Trailing 12-month sum of total dwelling units approved — the primary trend read for NSA data · ${NSA_CAPTION}`}
            badge={nsaBadge}
            data={sum12Rows} series={S_SUM12} fmtLeft={fmtCountK} defaultCount={240} />
          <div style={GRID2}>
            <TSPanel key="a-raw"
              title="Dwelling Approvals — Raw Monthly (NSA)"
              subtitle={`Total dwelling units/month, no seasonal adjustment — compare same months only · ${NSA_CAPTION}`}
              badge={nsaBadge}
              data={rawRows} series={S_RAW} fmtLeft={fmtCount} defaultCount={240} />
            <TSPanel key="a-yoy"
              title="Dwelling Approvals — Same-Month YoY"
              subtitle={`Lag-12 % change (same calendar month a year earlier — the valid NSA comparison) · ${NSA_CAPTION}`}
              badge={nsaBadge}
              data={yoyRows} series={S_YOY_BARS} fmtLeft={fmtPct} zeroRef defaultCount={240} />
          </div>
          <TSPanel key="a-split"
            title="Private Houses vs Other Dwellings — 12-Month Rolling Sums"
            subtitle={`Detached houses vs higher-density ('other' — units, townhouses, apartments), trailing 12-month sums, 1983→ · ${NSA_CAPTION}`}
            badge={nsaBadge}
            data={splitRows} series={S_SPLIT} fmtLeft={fmtCountK} defaultCount={240} />
        </>
      )}

      {section === 'prices-lending' && (
        <>
          <div style={SRC_NOTE}>
            ABS Total Value of Dwellings (quarterly, 2011&rarr;) &amp; new loan commitments
            (quarterly SA, A$M, 2002-Q3&rarr;). {TVD_CAPTION}.{pricePrelim && ' Latest TVD quarter is PRELIMINARY (p).'}
          </div>
          <div style={GRID2}>
            <TSPanel key="p-price"
              title="Mean Dwelling Price"
              subtitle={`A$ thousands, quarterly, all residential dwellings — ${TVD_CAPTION}${prelimNote}`}
              badge={tvdBadge}
              data={priceRows} series={S_PRICE} fmtLeft={fmtPriceK} quarterly defaultCount={80} />
            <TSPanel key="p-price-yoy"
              title="Mean Dwelling Price — YoY"
              subtitle={`Lag-4 % change, terminal-computed — ${TVD_CAPTION}${prelimNote}`}
              badge={tvdBadge}
              data={priceYoyRows} series={S_PRICE_YOY} fmtLeft={fmtPct} zeroRef quarterly defaultCount={80} />
          </div>
          <div style={GRID2}>
            <TSPanel key="p-stock"
              title="Total Dwelling Stock Value"
              subtitle={`Total value of Australia's residential dwelling stock (TVD), quarterly${prelimNote}`}
              data={stockRows} series={S_STOCK} fmtLeft={fmtStockT} quarterly defaultCount={80} />
            <TSPanel key="p-lend"
              title="New Loan Commitments — Owner-Occupier vs Investor"
              subtitle="New housing loan commitments, quarterly SA, A$M, 2002-Q3→"
              data={lendRows} series={S_LEND} fmtLeft={fmtLendB} quarterly defaultCount={95} />
          </div>
          <TSPanel key="p-lend-yoy"
            title="New Loan Commitments — YoY"
            subtitle="Lag-4 % change, terminal-computed — investor lending swings are the housing-cycle tell"
            data={lendYoyRows} series={S_LEND} fmtLeft={fmtPct} zeroRef quarterly defaultCount={95} />
        </>
      )}
    </>
  )
}
