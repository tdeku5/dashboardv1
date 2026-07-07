import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import kit from '../components/charts/ChartKit.module.css'

// Canada retail dashboard — StatCan table 20-10-0056 (monthly SA, current $,
// 2017→) plus monthly real retail-trade GDP from 36-10-0434 (chained 2017$,
// 1997→) as the volume read. All series are DIRECT — no proxy badges.
// Store-type contribution panels are deferred (sub-industry vectors not yet
// ingested) and deliberately omitted.
//
// Scale note: 20-10-0056 values are stored in $ thousands (latest ≈ 73,030,066
// = $73.0bn); 36-10-0434 values are in $ millions. Formatters below account
// for this — both render as $m / $bn.

type AllData = Record<string, StatcanPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['CA_RETAIL_SALES', 'CA_MGDP_RETAIL'] as const

const DEFAULT_M = 120 // ~10 years of months

// ── formatters ───────────────────────────────────────────────────────────────

// CA_RETAIL_SALES is stored in $ thousands → /1,000 = $m, /1,000,000 = $bn.
const fmtRetailTick = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}bn` : `$${(v / 1000).toFixed(0)}m`
const fmtRetailTooltip = (v: number) =>
  `$${(v / 1000).toLocaleString('en-CA', { maximumFractionDigits: 0 })}m`

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

// ── multi-line panel ─────────────────────────────────────────────────────────

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
            <span key={l.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
            </span>
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
            {lines.map(l => (
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

export function CARetailContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load StatCan data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const retail = useMemo(() => allData['CA_RETAIL_SALES'] ?? [], [allData])
  const retailGdp = useMemo(() => allData['CA_MGDP_RETAIL'] ?? [], [allData])

  const momRows = useMemo((): Row[] => {
    const mom = computeChangePct(retail, 1)
    const nv: NV[] = mom.map(p => ({ date: p.date, value: p.value }))
    const ma = computeMA(nv, 6)
    return mom.map((p, i) => ({ date: p.date, mom: p.value, ma: ma[i]?.value ?? null }))
  }, [retail])

  const yoyCompareRows = useMemo(
    () => buildRows([
      { key: 'nominal', data: computeChangePct(retail, 12) },
      { key: 'real', data: computeChangePct(retailGdp, 12) },
    ]),
    [retail, retailGdp]
  )

  const levelRows = useMemo(
    () => buildRows([{ key: 'CA_RETAIL_SALES', data: retail }]),
    [retail]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan retail series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (20-10-0056 retail sales / 36-10-0434 monthly GDP by industry) &mdash; monthly, seasonally adjusted
      </div>

      {/* Page-level caption (decision e) — required, do not remove. */}
      <div className={kit.sectionSubtitle} style={{ padding: '0 2px' }}>
        Retail sales history begins 2017 &mdash; StatCan retired the predecessor table on a
        different NAICS classification basis; series are not spliced.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Retail Sales"
          subtitle="Total retail sales (v1446859483) — current $, SA — YoY / annualized"
          data={retail}
        />
        <MomBarsPanel
          title="Retail Sales — MoM %"
          subtitle="Month-over-month % change with 6-month moving average"
          rows={momRows}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Nominal Retail Sales vs Real Retail GDP — YoY"
          subtitle="Current-$ retail sales vs real retail-trade GDP (chained 2017$, 1997→) — the volume read; the real series has the longer history"
          lines={[
            { key: 'nominal', label: 'Nominal Retail Sales YoY', color: '#60a5fa' },
            { key: 'real', label: 'Real Retail GDP YoY', color: '#4ade80' },
          ]}
          rows={yoyCompareRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Retail Sales — Level"
          subtitle="Total retail sales, $millions, current dollars, SA"
          lines={[{ key: 'CA_RETAIL_SALES', label: 'Retail Sales ($m)', color: '#60a5fa' }]}
          rows={levelRows}
          tickFmt={fmtRetailTick}
          tooltipFmt={fmtRetailTooltip}
        />
      </div>
    </>
  )
}
