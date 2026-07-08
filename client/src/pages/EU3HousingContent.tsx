import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, breakDates, estimateCount, type EurostatPoint } from '../lib/eurostat'
import {
  type NV, computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Housing dashboard — DE / FR / IT. `prices` section: Eurostat house price
// index (prc_hpi_q; quarterly, 2015=100, NSA; DE/FR from 2005, IT from 2010)
// plus the Eurostat-PUBLISHED YoY rate. `permits` section: building-permits
// index for residential dwellings (sts_cobp_q; 2021=100, SCA + NSA variants).
// Prices panels are DIRECT; permits panels carry eu3Caveat('permits_index')
// because the dataset is index-form only — no absolute dwelling counts exist.
// Germany's NSA permits series carries 24 Eurostat estimate flags (e), which
// are surfaced as amber triangles on the chart plus a visible caption built
// from estimateCount(); break flags (b) render as vertical reference lines.

type HousingSection = 'prices' | 'permits'

type AllData = Record<string, EurostatPoint[]>

const EST_COLOR = '#f59e0b'

function codesFor(cc: Eu3Country, section: HousingSection): readonly string[] {
  return section === 'prices'
    ? [`${cc}_HPI`, `${cc}_HPI_YOY`]
    : [`${cc}_PERMITS`, `${cc}_PERMITS_NSA`]
}

// Country notes (visible captions, keyed by cc)
const PERMITS_NOTES: Partial<Record<Eu3Country, string>> = {
  IT: 'Italy lags one quarter behind Germany/France.',
}

// ── e-flag marker: amber triangle dot for a stroke-less Line ─────────────────

function renderEstDot(props: { cx?: number; cy?: number; value?: unknown; index?: number }): ReactNode {
  const { cx, cy, index } = props
  if (cx == null || cy == null || typeof props.value !== 'number') return null
  return (
    <path key={`est-${index ?? cx}`}
      d={`M ${cx} ${cy - 5} L ${cx - 4.5} ${cy + 3.5} L ${cx + 4.5} ${cy + 3.5} Z`}
      fill={EST_COLOR} stroke="#0b1118" strokeWidth={0.5} />
  )
}

// ── Local panel kit (line/bar/estimate-dot panel with brush) ─────────────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  kind: 'line' | 'bar' | 'dots'
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
  fmtLeft, zeroRef = false, defaultCount = 60, refDates,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
  refDates?: readonly string[]
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
              {s.kind === 'dots' ? (
                <span style={{ color: s.color, fontSize: 9, lineHeight: 1 }}>&#9650;</span>
              ) : (
                <span className={s.kind === 'bar' ? kit.legendSwatch : kit.legendLine}
                  style={{ background: s.posNeg ? 'rgba(74,222,128,0.75)' : s.color }} />
              )}
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
              {refDates?.map(d => (
                <ReferenceLine key={`brk-${d}`} x={d} stroke={EST_COLOR}
                  strokeDasharray="4 3" strokeOpacity={0.6} strokeWidth={1} />
              ))}
              {series.filter(s => vis.has(s.key)).map(s => {
                if (s.kind === 'bar') return (
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
                )
                if (s.kind === 'dots') return (
                  <Line key={s.key} dataKey={s.key} name={s.key}
                    stroke="transparent" strokeWidth={0} dot={renderEstDot} activeDot={false}
                    isAnimationActive={false} legendType="none" />
                )
                return (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                    stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
                    dot={false} isAnimationActive={false} connectNulls legendType="none" />
                )
              })}
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

const S_HPI: readonly PanelSeriesDef[] = [
  { key: 'hpi', label: 'House price index (2015=100, NSA)', color: '#60a5fa', kind: 'line', width: 2 },
]
const S_HPI_YOY: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'HPI YoY % (Eurostat-published)', color: 'rgba(147,197,253,0.75)', kind: 'bar', posNeg: true },
]
const S_PERMITS: readonly PanelSeriesDef[] = [
  { key: 'sca', label: 'Permits index (SCA)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'nsa', label: 'Permits index (NSA)', color: '#94a3b8', kind: 'line', width: 1.4, dash: '5 3' },
  { key: 'est', label: 'Eurostat estimate (e-flag)', color: EST_COLOR, kind: 'dots' },
]
const S_PERMITS_YOY: readonly PanelSeriesDef[] = [
  { key: 'scaYoy', label: 'Permits YoY % (SCA)', color: '#60a5fa', kind: 'line', width: 2 },
  { key: 'nsaYoy', label: 'Permits YoY % (NSA)', color: '#94a3b8', kind: 'line', width: 1.4, dash: '5 3' },
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
const EST_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: EST_COLOR,
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3HousingContent({ cc, section }: { cc: Eu3Country; section: HousingSection }) {
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
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat housing data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [codes])

  // ── Prices ────────────────────────────────────────────────────────────────

  const hpi = useMemo(() => allData[`${cc}_HPI`] ?? [], [allData, cc])
  const hpiYoy = useMemo(() => allData[`${cc}_HPI_YOY`] ?? [], [allData, cc])

  const hpiRows = useMemo(() => mergeByDate([{ key: 'hpi', data: hpi }]), [hpi])
  const hpiYoyRows = useMemo(() => mergeByDate([{ key: 'yoy', data: hpiYoy }]), [hpiYoy])

  const hpiProvisional = useMemo(
    () => hpi.length > 0 && (hpi[hpi.length - 1].obs_flag ?? '').includes('p'),
    [hpi]
  )

  // ── Permits ───────────────────────────────────────────────────────────────

  const permitsSca = useMemo(() => allData[`${cc}_PERMITS`] ?? [], [allData, cc])
  const permitsNsa = useMemo(() => allData[`${cc}_PERMITS_NSA`] ?? [], [allData, cc])

  const permitEstCount = useMemo(
    () => estimateCount(permitsSca) + estimateCount(permitsNsa),
    [permitsSca, permitsNsa]
  )
  const permitBreaks = useMemo(
    () => [...new Set([...breakDates(permitsSca), ...breakDates(permitsNsa)])].sort(),
    [permitsSca, permitsNsa]
  )

  const permitsRows = useMemo(() => {
    // 'est' = NSA value at e-flagged dates → rendered as amber ▲ markers
    const estPts: NV[] = [...permitsSca, ...permitsNsa]
      .filter(p => (p.obs_flag ?? '').includes('e'))
      .map(p => ({ date: p.date, value: p.value }))
    return mergeByDate([
      { key: 'sca', data: permitsSca },
      { key: 'nsa', data: permitsNsa },
      { key: 'est', data: estPts },
    ])
  }, [permitsSca, permitsNsa])

  const permitsYoyRows = useMemo(() => mergeByDate([
    { key: 'scaYoy', data: computeChangePct(permitsSca, 4) },
    { key: 'nsaYoy', data: computeChangePct(permitsNsa, 4) },
  ]), [permitsSca, permitsNsa])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className={kit.statusBlock}>Loading {codes.length} {cc} housing series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const label = EU3_COUNTRY_LABEL[cc]
  const permitsBadge = <ProxyBadge caveat={eu3Caveat('permits_index', cc)} />

  return (
    <>
      {section === 'prices' && (
        <>
          <div style={SRC_NOTE}>
            Eurostat prc_hpi_q &mdash; house price index, quarterly, 2015=100, NSA.
            {' '}{cc === 'IT' ? 'Italy: history from 2010.' : 'History from 2005.'}
          </div>
          {hpiProvisional && (
            <div style={COUNTRY_NOTE}>Latest quarter is provisional (p-flag) — subject to revision.</div>
          )}
          <div style={GRID2}>
            <TSPanel key={`p-hpi-${cc}`}
              title={`${label} House Price Index`}
              subtitle="Purchases of new + existing dwellings, quarterly, 2015=100, NSA"
              data={hpiRows} series={S_HPI} fmtLeft={fmtIdx} />
            <TSPanel key={`p-yoy-${cc}`}
              title="House Prices — YoY"
              subtitle="Eurostat-published annual rate of change — not terminal-computed"
              data={hpiYoyRows} series={S_HPI_YOY} fmtLeft={fmtPct} zeroRef />
          </div>
        </>
      )}

      {section === 'permits' && (
        <>
          <div style={SRC_NOTE}>
            Eurostat sts_cobp_q &mdash; building permits, residential dwellings, quarterly.
            Index form (2021=100) &mdash; no absolute dwelling counts exist in the dataset.
          </div>
          {PERMITS_NOTES[cc] && <div style={COUNTRY_NOTE}>{PERMITS_NOTES[cc]}</div>}
          {permitEstCount > 0 && (
            <div style={EST_NOTE}>
              {permitEstCount} observations are Eurostat estimates (e-flag), marked &#9650;
            </div>
          )}
          <div style={GRID2}>
            <TSPanel key={`b-idx-${cc}`}
              title={`${label} Building Permits — Index`}
              subtitle="Residential dwellings, 2021=100 — SCA line with NSA overlay; ▲ = Eurostat estimate"
              badge={permitsBadge}
              data={permitsRows} series={S_PERMITS} fmtLeft={fmtIdx}
              refDates={permitBreaks} />
            <TSPanel key={`b-yoy-${cc}`}
              title="Building Permits — YoY"
              subtitle="Terminal-computed YoY % of the SCA and NSA permit indices"
              badge={permitsBadge}
              data={permitsYoyRows} series={S_PERMITS_YOY} fmtLeft={fmtPct} zeroRef />
          </div>
        </>
      )}
    </>
  )
}
