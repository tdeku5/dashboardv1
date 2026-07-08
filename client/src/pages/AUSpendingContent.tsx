import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia household spending — the Monthly Household Spending Indicator
// (MHSI), the SUCCESSOR to the Retail Trade survey (discontinued mid-2025).
// Built from bank-transaction and administrative data: monthly CURRENT-PRICE
// level (A$ millions, SA, 2012-07→) with an ABS-PUBLISHED YoY rate, plus a
// QUARTERLY chain-volume REAL spending level (volumes exist only quarterly).
// This is the US retail-sales/monthly-PCE analogue, so EVERY panel carries
// the hsi_consumption proxy badge. Methodology differs before Dec-2018.

type AllData = Record<string, AbsPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['AU_HH_SPENDING', 'AU_HH_SPENDING_YOY', 'AU_HH_SPENDING_RQ'] as const

const DEFAULT_M = 120 // ~10 years of months
const DEFAULT_Q = 40  // ~10 years of quarters

// ── formatters (levels stored in A$ millions) ────────────────────────────────

const fmtAudTick = (v: number) =>
  Math.abs(v) >= 1000 ? `A$${(v / 1000).toFixed(0)}bn` : `A$${v.toFixed(0)}m`
const fmtAudTooltip = (v: number) => `A$${(v / 1000).toFixed(1)}bn`

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
  title, subtitle, badge, lines, rows,
  tickFmt, tooltipFmt, zeroRef = false, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
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
          <div className={kit.sectionTitle}>{title}{badge}</div>
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

// ══════════════════════════════════════════════════════════════════════════════

export function AUSpendingContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ABS household spending data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const badge = <ProxyBadge caveat={AU_PROXY_CAVEATS.hsi_consumption} />

  const spending = useMemo(() => allData['AU_HH_SPENDING'] ?? [], [allData])
  const spendingRQ = useMemo(() => allData['AU_HH_SPENDING_RQ'] ?? [], [allData])

  // [MONTHLY] nominal level + 12-mo MA
  const levelRows = useMemo(
    () => buildRows([
      { key: 'level', data: spending },
      { key: 'ma', data: computeMA(spending, 12) },
    ]),
    [spending]
  )
  // [MONTHLY] ABS-published YoY — served as published, not terminal-computed
  const publishedYoyRows = useMemo(
    () => buildRows([{ key: 'yoy', data: allData['AU_HH_SPENDING_YOY'] ?? [] }]),
    [allData]
  )
  // [QUARTERLY] real (chain volume) level + terminal-computed YoY (4-quarter compare)
  const realLevelRows = useMemo(
    () => buildRows([{ key: 'rq', data: spendingRQ }]),
    [spendingRQ]
  )
  const realYoyRows = useMemo(
    () => buildRows([{ key: 'rqYoy', data: computeChangePct(spendingRQ, 4) }]),
    [spendingRQ]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS household spending series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Monthly Household Spending Indicator &mdash; bank-transaction and administrative data,
        current prices, A$ millions, SA, 2012-07&rarr;. The successor to the retired Retail Trade
        survey (discontinued mid-2025). Methodology differs pre-Dec-2018.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Household Spending — Level [MONTHLY]"
          subtitle="Nominal household spending, A$m current prices, SA, with 12-month moving average"
          badge={badge}
          lines={[
            { key: 'level', label: 'Spending (A$m)', color: '#60a5fa' },
            { key: 'ma', label: '12-mo MA', color: '#f59e0b', width: 2.2 },
          ]}
          rows={levelRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
        <LinesPanel
          title="Household Spending — YoY % [MONTHLY]"
          subtitle="ABS-published year-over-year % change, current prices — not terminal-computed"
          badge={badge}
          lines={[{ key: 'yoy', label: 'Published YoY (nominal)', color: '#4ade80', width: 2 }]}
          rows={publishedYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Real Household Spending — Level [QUARTERLY]"
          subtitle="Chain-volume spending, A$m SA, 2014Q3→ — volumes exist only quarterly"
          badge={badge}
          lines={[{ key: 'rq', label: 'Real spending (A$m, chain volume)', color: '#a78bfa' }]}
          rows={realLevelRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
          defaultCount={DEFAULT_Q}
        />
        <LinesPanel
          title="Real Household Spending — YoY % [QUARTERLY]"
          subtitle="Terminal-computed 4-quarter % change of the chain-volume series — volumes exist only quarterly"
          badge={badge}
          lines={[{ key: 'rqYoy', label: 'Real YoY', color: '#f472b6', width: 2 }]}
          rows={realYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
          defaultCount={DEFAULT_Q}
        />
      </div>
    </>
  )
}
