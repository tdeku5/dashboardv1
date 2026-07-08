import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
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

// EU3 Bank Lending dashboard — DE / FR / IT via the ECB BSI (Balance Sheet
// Items) dataflow, MFI sector, monthly. Outstanding loan stocks to households
// and to non-financial corporations arrive in € MILLIONS (formatted €bn / €T
// by dividing by 1000); the growth panels plot the ECB's PUBLISHED adjusted
// (flows-based) annual growth rates — NOT terminal-computed stock YoY, which
// would be distorted by securitisation and reclassifications. Every panel is
// a PROXY of the US H.8 weekly bank-credit view (two borrower sectors only,
// NSA stocks) and carries eu3Caveat('bsi_lending').

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country): readonly string[] {
  return [`${cc}_LOANS_HH`, `${cc}_LOANS_NFC`, `${cc}_LOANS_HH_YOY`, `${cc}_LOANS_NFC_YOY`]
}

// ── Local panel kit (multi-line panel with brush + toggleable legend) ────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  dash?: string
  width?: number
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
              <span className={kit.legendLine} style={{ background: s.color }} />
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
                domain={['auto', 'auto']} tickFormatter={fmtL} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const s = series.find(x => x.key === name)
                  const label = s?.label ?? String(name)
                  if (typeof v !== 'number') return ['-', label] as [string, string]
                  return [fmtL(v), label] as [string, string]
                }} />
              {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
              {series.filter(s => vis.has(s.key)).map(s => (
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

const S_HH_VS_NFC: readonly PanelSeriesDef[] = [
  { key: 'hh', label: 'Loans to households', color: '#60a5fa', width: 2 },
  { key: 'nfc', label: 'Loans to non-financial corporations', color: '#f59e0b', width: 2 },
]
const S_GROWTH: readonly PanelSeriesDef[] = [
  { key: 'hh', label: 'HH lending growth % (ECB published)', color: '#60a5fa', width: 2 },
  { key: 'nfc', label: 'NFC lending growth % (ECB published)', color: '#f59e0b', width: 2 },
]
const S_HH_LVL: readonly PanelSeriesDef[] = [
  { key: 'hh', label: 'Households — outstanding', color: '#60a5fa', width: 2 },
]
const S_NFC_LVL: readonly PanelSeriesDef[] = [
  { key: 'nfc', label: 'Non-financial corporations — outstanding', color: '#f59e0b', width: 2 },
]

// ── Formatters & layout ──────────────────────────────────────────────────────

// BSI stocks arrive in € MILLIONS → €bn = v / 1000, €T where apt.
const fmtEurBn = (v: number) => {
  const bn = v / 1000
  return Math.abs(bn) >= 1000
    ? `€${(bn / 1000).toFixed(2)}T`
    : `€${bn.toLocaleString('en-US', { maximumFractionDigits: 0 })}B`
}
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3LendingContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])

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
      setError(e instanceof Error ? e.message : 'Failed to load ECB BSI lending data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [codes])

  const hh = useMemo(() => allData[`${cc}_LOANS_HH`] ?? [], [allData, cc])
  const nfc = useMemo(() => allData[`${cc}_LOANS_NFC`] ?? [], [allData, cc])

  const outstandingRows = useMemo(() => mergeByDate([
    { key: 'hh', data: hh },
    { key: 'nfc', data: nfc },
  ]), [hh, nfc])

  const growthRows = useMemo(() => mergeByDate([
    { key: 'hh', data: allData[`${cc}_LOANS_HH_YOY`] ?? [] },
    { key: 'nfc', data: allData[`${cc}_LOANS_NFC_YOY`] ?? [] },
  ]), [allData, cc])

  const hhRows = useMemo(() => mergeByDate([{ key: 'hh', data: hh }]), [hh])
  const nfcRows = useMemo(() => mergeByDate([{ key: 'nfc', data: nfc }]), [nfc])

  if (loading) return <div className={kit.statusBlock}>Loading {codes.length} {cc} BSI lending series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const label = EU3_COUNTRY_LABEL[cc]
  const badge = <ProxyBadge caveat={eu3Caveat('bsi_lending', cc)} />

  return (
    <>
      <div style={SRC_NOTE}>
        ECB BSI (Balance Sheet Items), MFI sector &mdash; loans outstanding to households and
        non-financial corporations, monthly, € millions, NSA stocks; growth rates are the
        ECB&apos;s adjusted (flows-based) annual measures.
      </div>

      <div style={GRID2}>
        <TSPanel key={`l-both-${cc}`}
          title={`${label} MFI Loans Outstanding — HH vs NFC`}
          subtitle="Loans to households and to non-financial corporations, monthly stocks (€M units, shown as €bn)"
          badge={badge}
          data={outstandingRows} series={S_HH_VS_NFC} fmtLeft={fmtEurBn} />
        <TSPanel key={`l-growth-${cc}`}
          title="Lending Growth — ECB Published"
          subtitle="ECB-published adjusted (flows-based) annual growth rates — not terminal-computed stock YoY"
          badge={badge}
          data={growthRows} series={S_GROWTH} fmtLeft={fmtPct} zeroRef />
      </div>

      <div style={GRID2}>
        <TSPanel key={`l-hh-${cc}`}
          title="Loans to Households — Level"
          subtitle="Outstanding amounts, all maturities, monthly (€M units, shown as €bn)"
          badge={badge}
          data={hhRows} series={S_HH_LVL} fmtLeft={fmtEurBn} />
        <TSPanel key={`l-nfc-${cc}`}
          title="Loans to Non-Financial Corporations — Level"
          subtitle="Outstanding amounts, all maturities, monthly (€M units, shown as €bn)"
          badge={badge}
          data={nfcRows} series={S_NFC_LVL} fmtLeft={fmtEurBn} />
      </div>
    </>
  )
}
