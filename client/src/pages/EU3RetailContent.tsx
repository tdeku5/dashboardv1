import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 retail trade dashboard — one parameterized page serving DE / FR / IT.
// Eurostat sts_trtu_m: deflated turnover (VOLUME) indices for retail trade,
// monthly, seasonally + calendar adjusted (SCA), 2021=100 — headline (G47)
// plus the ex-automotive-fuel cut. All series are DIRECT (harmonized STS
// indices) — no proxy badges. The latest 1-2 prints are provisional/estimated
// (p/e flags) and revise.

type AllData = Record<string, EurostatPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const HISTORY_NOTE: Record<Eu3Country, string> = {
  DE: 'History from 1994 — the longest of the three.',
  FR: 'History from 1999. Recent prints carry Eurostat estimate (e) flags.',
  IT: 'History from 2000.',
}

const DEFAULT_M = 120 // ~10 years of months

// ── formatters (volume index, 2021=100) ──────────────────────────────────────

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
  tickFmt, tooltipFmt, zeroRef = false, defaultCount = DEFAULT_M,
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

// ── MoM bars + moving-average panel ──────────────────────────────────────────

function MomBarsPanel({
  title, subtitle, rows, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  rows: Row[]
  defaultCount?: number
}) {
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
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            MoM +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            MoM &minus;
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            6-mo MA
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
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [fmtPctTooltip(v), name === 'ma' ? '6-mo MA' : 'MoM %'] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`m-${i}`}
                  fill={typeof r.mom === 'number' && r.mom < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma"
              stroke="#e2e8f0" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
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

// ══════════════════════════════════════════════════════════════════════════════

export function EU3RetailContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allCodes = useMemo(() => [`${cc}_RETAIL`, `${cc}_RETAIL_XFUEL`], [cc])

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
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat retail data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  const retail = useMemo(() => allData[`${cc}_RETAIL`] ?? [], [allData, cc])
  const retailXFuel = useMemo(() => allData[`${cc}_RETAIL_XFUEL`] ?? [], [allData, cc])

  const momRows = useMemo((): Row[] => {
    const mom = computeChangePct(retail, 1)
    const nv: NV[] = mom.map(p => ({ date: p.date, value: p.value }))
    const ma = computeMA(nv, 6)
    return mom.map((p, i) => ({ date: p.date, mom: p.value, ma: ma[i]?.value ?? null }))
  }, [retail])

  const levelRows = useMemo(
    () => buildRows([
      { key: 'retail', data: retail },
      { key: 'xfuel', data: retailXFuel },
    ]),
    [retail, retailXFuel]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} retail series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat short-term statistics (sts_trtu_m) &mdash; deflated turnover (volume) indices,
        retail trade, monthly, SCA, 2021=100. Latest 1&ndash;2 prints are provisional/estimated
        (p/e flags) and revise. {HISTORY_NOTE[cc]}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title={`${EU3_COUNTRY_LABEL[cc]} Retail Trade Volume`}
          subtitle="Deflated turnover, total retail trade (2021=100, SCA) — YoY / annualized"
          data={retail}
        />
        <MomBarsPanel
          title="Retail Volume — MoM %"
          subtitle="Month-over-month % change with 6-month moving average"
          rows={momRows}
        />
      </div>

      <LinesPanel
        title="Retail vs Retail ex Automotive Fuel — Level"
        subtitle="Deflated turnover volume indices, 2021=100, SCA — the ex-fuel cut strips pump-price-driven volume swings"
        lines={[
          { key: 'retail', label: 'Retail Trade (2021=100)', color: '#60a5fa', width: 2.2 },
          { key: 'xfuel', label: 'Retail ex Auto Fuel (2021=100)', color: '#4ade80' },
        ]}
        rows={levelRows}
        tickFmt={fmtIdxTick}
        tooltipFmt={fmtIdxTooltip}
      />
    </>
  )
}
