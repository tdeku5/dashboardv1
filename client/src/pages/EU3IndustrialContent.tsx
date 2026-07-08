import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Industrial dashboard — Eurostat short-term business statistics for
// DE / FR / IT. `ip` section: industrial production (sts_inpr_m; B–D headline,
// manufacturing, and the three Main Industrial Groupings), monthly SCA,
// 2021=100 (DE from 1991, FR/IT from 1990). `construction` section:
// construction production (sts_copr_m), monthly SCA. All panels are DIRECT
// (harmonized production indices) — no proxy badges. German factory orders are
// intentionally absent: Eurostat discontinued the industrial-orders datasets
// in 2012 and Destatis new-orders data is registration-gated (decision f).

type IndustrialSection = 'ip' | 'construction'

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country, section: IndustrialSection): readonly string[] {
  return section === 'ip'
    ? [`${cc}_IP`, `${cc}_IP_MFG`, `${cc}_IP_INTERMED`, `${cc}_IP_CAPITAL`, `${cc}_IP_CONSUMER`]
    : [`${cc}_CONSTRUCTION`]
}

// Country notes (visible captions, keyed by cc)
const IP_NOTES: Partial<Record<Eu3Country, string>> = {
  IT: 'Italy publishes one month behind Germany/France.',
}
const CONSTRUCTION_NOTES: Partial<Record<Eu3Country, string>> = {
  IT: 'Superbonus-era level (~140 on the 2021=100 base) reflects real fiscal-incentive-driven activity — not a data artifact. Italy also lags one month behind Germany/France.',
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

const S_IP_LEVEL: readonly PanelSeriesDef[] = [
  { key: 'total', label: 'Total industry B–D', color: '#e2e8f0', width: 2 },
  { key: 'mfg', label: 'Manufacturing', color: '#60a5fa' },
]
const S_MIGS_YOY: readonly PanelSeriesDef[] = [
  { key: 'intermed', label: 'Intermediate goods YoY', color: '#f59e0b' },
  { key: 'capital', label: 'Capital goods YoY', color: '#60a5fa' },
  { key: 'consumer', label: 'Consumer goods YoY', color: '#4ade80' },
  { key: 'total', label: 'Total industry YoY', color: '#94a3b8', width: 1.4, dash: '5 3' },
]
const S_CONSTR_LEVEL: readonly PanelSeriesDef[] = [
  { key: 'lvl', label: 'Construction production (SCA)', color: '#60a5fa', width: 2 },
]

// ── Formatters & layout ──────────────────────────────────────────────────────

const fmtIdx = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })
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

export function EU3IndustrialContent({ cc, section }: { cc: Eu3Country; section: IndustrialSection }) {
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
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat industrial data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [codes])

  // ── ip ────────────────────────────────────────────────────────────────────

  const ip = useMemo(() => allData[`${cc}_IP`] ?? [], [allData, cc])

  const ipLevelRows = useMemo(() => mergeByDate([
    { key: 'total', data: ip },
    { key: 'mfg', data: allData[`${cc}_IP_MFG`] ?? [] },
  ]), [allData, cc, ip])

  const migsYoyRows = useMemo(() => mergeByDate([
    { key: 'intermed', data: computeChangePct(allData[`${cc}_IP_INTERMED`] ?? [], 12) },
    { key: 'capital', data: computeChangePct(allData[`${cc}_IP_CAPITAL`] ?? [], 12) },
    { key: 'consumer', data: computeChangePct(allData[`${cc}_IP_CONSUMER`] ?? [], 12) },
    { key: 'total', data: computeChangePct(ip, 12) },
  ]), [allData, cc, ip])

  // ── construction ─────────────────────────────────────────────────────────

  const construction = useMemo(() => allData[`${cc}_CONSTRUCTION`] ?? [], [allData, cc])

  const constructionRows = useMemo(() => mergeByDate([
    { key: 'lvl', data: construction },
  ]), [construction])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className={kit.statusBlock}>Loading {codes.length} {cc} industrial series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const label = EU3_COUNTRY_LABEL[cc]
  const note = section === 'ip' ? IP_NOTES[cc] : CONSTRUCTION_NOTES[cc]

  return (
    <>
      {section === 'ip' && (
        <>
          <div style={SRC_NOTE}>
            Eurostat sts_inpr_m &mdash; industrial production, monthly, seasonally &amp; calendar
            adjusted (SCA), 2021=100. History from {cc === 'DE' ? '1991' : '1990'}.
            {cc === 'DE' && ' Germany: no factory-orders series — see mapping doc.'}
          </div>
          {note && <div style={COUNTRY_NOTE}>{note}</div>}
          <div style={GRID2}>
            <RatesChart
              title={`${label} Industrial Production — Growth`}
              subtitle="Total industry B–D (ex construction), SCA, 2021=100"
              data={ip} />
            <TSPanel key={`ip-lvl-${cc}`}
              title="Industrial Production — Level"
              subtitle="Total industry B–D headline with manufacturing overlay, SCA, 2021=100"
              data={ipLevelRows} series={S_IP_LEVEL} fmtLeft={fmtIdx} />
          </div>
          <TSPanel key={`ip-migs-${cc}`}
            title="Main Industrial Groupings — YoY"
            subtitle="Intermediate / capital / consumer goods production, YoY % (terminal-computed from SCA indices)"
            data={migsYoyRows} series={S_MIGS_YOY} fmtLeft={fmtPct} zeroRef />
        </>
      )}

      {section === 'construction' && (
        <>
          <div style={SRC_NOTE}>
            Eurostat sts_copr_m &mdash; production in construction, monthly, seasonally &amp; calendar
            adjusted (SCA), 2021=100.
          </div>
          {note && <div style={COUNTRY_NOTE}>{note}</div>}
          <div style={GRID2}>
            <TSPanel key={`co-lvl-${cc}`}
              title={`${label} Construction Production — Level`}
              subtitle="Production in construction, SCA, 2021=100"
              data={constructionRows} series={S_CONSTR_LEVEL} fmtLeft={fmtIdx} />
            <RatesChart
              title="Construction Production — Growth"
              subtitle="YoY / annualized growth of the construction production index"
              data={construction} />
          </div>
        </>
      )}
    </>
  )
}
