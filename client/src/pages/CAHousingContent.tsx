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
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada Housing dashboard content — supply (CMHC starts + permits), prices
// (NHPI + CPI shelter components) and credit (residential mortgage credit).
// The hub page provides section tabs; this component renders the panel set for
// one section and fetches lazily (only the codes the active section needs).
//
// There is deliberately NO 'demand' section: Canadian resale transactions
// (CREA) and repeat-sale prices (Teranet–National Bank) are private sources
// with no public StatCan series. Supply and price panels are DIRECT published
// data; the credit panels carry the household_credit proxy badge (borrower-
// side stock, no US H.8-style bank-asset view).

type HousingSection = 'supply' | 'prices' | 'credit'

type AllData = Record<string, StatcanPoint[]>

const SECTION_CODES: Record<HousingSection, readonly string[]> = {
  supply: ['CA_HOUSING_STARTS', 'CA_PERMITS_TOTAL_VAL', 'CA_PERMITS_RES_VAL', 'CA_PERMITS_RES_UNITS'],
  prices: ['CA_NHPI', 'CA_NHPI_HOUSE', 'CA_NHPI_LAND', 'CA_CPI_RENTED', 'CA_CPI_MIC'],
  credit: ['CA_HHCRED_MORT'],
}

// ── Series helpers ───────────────────────────────────────────────────────────

/** First difference (month-on-month level change). */
function diffSeries(data: readonly StatcanPoint[]): NV[] {
  return data.map((d, i) => ({ date: d.date, value: i > 0 ? d.value - data[i - 1].value : null }))
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

const fmtDefault = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

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

// ── Panel series definitions ─────────────────────────────────────────────────

const S_STARTS: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Starts (SAAR, 000s)', color: '#60a5fa', kind: 'line' },
  { key: 'ma', label: '6-mo MA', color: '#f97316', kind: 'line', width: 1.5, dash: '6 3' },
]
const S_MOM: readonly PanelSeriesDef[] = [
  { key: 'chg', label: 'MoM change', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
  { key: 'ma', label: '6-mo MA', color: '#60a5fa', kind: 'line', width: 1.5 },
]
const S_PERMIT_UNITS: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Residential units (SA)', color: '#a78bfa', kind: 'line' },
  { key: 'ma', label: '6-mo MA', color: '#f97316', kind: 'line', width: 1.5, dash: '6 3' },
]
const S_PERMIT_VAL: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Total (res + non-res)', color: '#e2e8f0', kind: 'line', width: 2 },
  { key: 'res', label: 'Residential', color: '#60a5fa', kind: 'line' },
]
const S_NHPI: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Total (house & land)', color: '#e2e8f0', kind: 'line', width: 2 },
  { key: 'house', label: 'House only', color: '#60a5fa', kind: 'line' },
  { key: 'land', label: 'Land only', color: '#f59e0b', kind: 'line' },
]
const S_NHPI_RENT: readonly PanelSeriesDef[] = [
  { key: 'nhpi', label: 'NHPI YoY', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'rent', label: 'CPI rented accommodation YoY', color: '#ec4899', kind: 'line', width: 2 },
]
const S_MIC: readonly PanelSeriesDef[] = [
  { key: 'mic', label: 'Mortgage interest cost YoY', color: '#fdba74', kind: 'line', width: 2 },
]
const S_MORT_LVL: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Mortgage credit outstanding', color: '#60a5fa', kind: 'line', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtStartsK = (v: number) => `${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}k`
const fmtStartsSigned = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}k`
const fmtUnits = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const fmtPermitsBn = (v: number) => `$${(v / 1e6).toFixed(1)}B`   // stored in $ thousands
const fmtIdx = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtCredBn = (v: number) => {                                 // stored in $ millions
  const bn = v / 1000
  return Math.abs(bn) >= 1000
    ? `$${(bn / 1000).toFixed(2)}T`
    : `$${bn.toLocaleString('en-CA', { maximumFractionDigits: 0 })}B`
}
const fmtFlowBn = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(v / 1000).toFixed(1)}B`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

const NHPI_SUBTITLE = 'new construction prices only — resale indices (Teranet-NB, CREA MLS HPI) are private sources'

// ══════════════════════════════════════════════════════════════════════════════

export function CAHousingContent({ section }: { section: HousingSection }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loaded, setLoaded] = useState<Record<HousingSection, boolean>>({
    supply: false, prices: false, credit: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded[section]) return
    let cancelled = false
    fetchStatcanBatch(SECTION_CODES[section]).then(map => {
      if (cancelled) return
      setAllData(prev => ({ ...prev, ...map }))
      setLoaded(prev => ({ ...prev, [section]: true }))
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load StatCan housing data')
    })
    return () => { cancelled = true }
  }, [section, loaded])

  // ── Supply ────────────────────────────────────────────────────────────────

  const starts = useMemo(() => allData['CA_HOUSING_STARTS'] ?? [], [allData])

  const startsRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: starts },
    { key: 'ma', data: computeMA(starts, 6) },
  ]), [starts])

  const startsMomRows = useMemo(() => {
    const diff = diffSeries(starts)
    return mergeByDate([
      { key: 'chg', data: diff },
      { key: 'ma', data: computeMA(diff, 6) },
    ])
  }, [starts])

  const permitUnitRows = useMemo(() => {
    const units = allData['CA_PERMITS_RES_UNITS'] ?? []
    return mergeByDate([
      { key: 'lvl', data: units },
      { key: 'ma', data: computeMA(units, 6) },
    ])
  }, [allData])

  const permitValRows = useMemo(() => mergeByDate([
    { key: 'total', data: allData['CA_PERMITS_TOTAL_VAL'] ?? [] },
    { key: 'res', data: allData['CA_PERMITS_RES_VAL'] ?? [] },
  ]), [allData])

  // ── Prices ────────────────────────────────────────────────────────────────

  const nhpiRows = useMemo(() => mergeByDate([
    { key: 'total', data: allData['CA_NHPI'] ?? [] },
    { key: 'house', data: allData['CA_NHPI_HOUSE'] ?? [] },
    { key: 'land', data: allData['CA_NHPI_LAND'] ?? [] },
  ]), [allData])

  const nhpiYoyRows = useMemo(() => mergeByDate([
    { key: 'total', data: computeChangePct(allData['CA_NHPI'] ?? [], 12) },
    { key: 'house', data: computeChangePct(allData['CA_NHPI_HOUSE'] ?? [], 12) },
    { key: 'land', data: computeChangePct(allData['CA_NHPI_LAND'] ?? [], 12) },
  ]), [allData])

  const nhpiRentRows = useMemo(() => mergeByDate([
    { key: 'nhpi', data: computeChangePct(allData['CA_NHPI'] ?? [], 12) },
    { key: 'rent', data: computeChangePct(allData['CA_CPI_RENTED'] ?? [], 12) },
  ]), [allData])

  const micRows = useMemo(() => mergeByDate([
    { key: 'mic', data: computeChangePct(allData['CA_CPI_MIC'] ?? [], 12) },
  ]), [allData])

  // ── Credit ────────────────────────────────────────────────────────────────

  const mortCred = useMemo(() => allData['CA_HHCRED_MORT'] ?? [], [allData])

  const mortLvlRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: mortCred },
  ]), [mortCred])

  const mortFlowRows = useMemo(() => {
    const diff = diffSeries(mortCred)
    return mergeByDate([
      { key: 'chg', data: diff },
      { key: 'ma', data: computeMA(diff, 6) },
    ])
  }, [mortCred])

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>
  if (!loaded[section]) return <div className={kit.statusBlock}>Loading StatCan housing data...</div>

  const creditBadge = <ProxyBadge caveat={CA_PROXY_CAVEATS.household_credit} />

  return (
    <>
      {section === 'supply' && (
        <>
          <div style={SRC_NOTE}>
            CMHC housing starts (34-10-0158) &amp; building permits (34-10-0292) &mdash; monthly, seasonally adjusted
          </div>
          <div style={GRID2}>
            <TSPanel key="s-starts"
              title="Housing Starts (SAAR)"
              subtitle="CMHC — all areas, thousands of units, SAAR, with 6-mo MA"
              data={startsRows} series={S_STARTS} fmtLeft={fmtStartsK} />
            <TSPanel key="s-mom"
              title="Housing Starts — Monthly Change"
              subtitle="Δ starts month-on-month, thousands SAAR, with 6-mo MA"
              data={startsMomRows} series={S_MOM} fmtLeft={fmtStartsSigned} zeroRef />
          </div>
          <div style={GRID2}>
            <TSPanel key="s-units"
              title="Building Permits — Residential Units"
              subtitle="Dwelling units, SA; history begins 2018 — successor table after two retirements"
              data={permitUnitRows} series={S_PERMIT_UNITS} fmtLeft={fmtUnits} />
            <TSPanel key="s-val"
              title="Building Permits — Value"
              subtitle="Total vs residential permit value, $ SA (34-10-0292)"
              data={permitValRows} series={S_PERMIT_VAL} fmtLeft={fmtPermitsBn} />
          </div>
        </>
      )}

      {section === 'prices' && (
        <>
          <div style={SRC_NOTE}>
            New Housing Price Index (18-10-0205, monthly since 1981) &amp; CPI shelter components (18-10-0004)
          </div>
          <div style={GRID2}>
            <TSPanel key="p-nhpi"
              title="New Housing Price Index"
              subtitle={NHPI_SUBTITLE}
              data={nhpiRows} series={S_NHPI} fmtLeft={fmtIdx} />
            <TSPanel key="p-nhpi-yoy"
              title="NHPI — YoY %"
              subtitle={NHPI_SUBTITLE}
              data={nhpiYoyRows} series={S_NHPI} fmtLeft={fmtPct} zeroRef />
          </div>
          <div style={GRID2}>
            <TSPanel key="p-rent"
              title="NHPI vs CPI Rent — YoY"
              subtitle="New-home prices vs CPI rented accommodation, YoY %"
              data={nhpiRentRows} series={S_NHPI_RENT} fmtLeft={fmtPct} zeroRef />
            <TSPanel key="p-mic"
              title="Mortgage Interest Cost — YoY"
              subtitle="CPI mortgage-interest-cost component — BoC rate pass-through"
              data={micRows} series={S_MIC} fmtLeft={fmtPct} zeroRef />
          </div>
        </>
      )}

      {section === 'credit' && (
        <>
          <div style={SRC_NOTE}>
            Residential mortgage credit (36-10-0639) &mdash; monthly, seasonally adjusted, $ millions
          </div>
          <div style={GRID2}>
            <TSPanel key="c-lvl"
              title="Residential Mortgage Credit Outstanding"
              subtitle="Households' mortgage loan liabilities, $M SA"
              badge={creditBadge}
              data={mortLvlRows} series={S_MORT_LVL} fmtLeft={fmtCredBn} />
            <RatesChart key="c-yoy"
              title="Residential Mortgage Credit — YoY"
              subtitle="YoY / annualized growth of the mortgage credit stock"
              badge={creditBadge}
              data={mortCred} />
          </div>
          <TSPanel key="c-flow"
            title="Mortgage Credit — Net Monthly Flow"
            subtitle="Δ outstanding month-on-month, with 6-mo MA"
            badge={creditBadge}
            data={mortFlowRows} series={S_MOM} fmtLeft={fmtFlowBn} zeroRef />
        </>
      )}
    </>
  )
}
