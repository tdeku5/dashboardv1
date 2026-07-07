import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada consumer health dashboard — mixed frequency:
//   monthly household credit (36-10-0639, SA, 1990→, $ millions) and
//   quarterly debt-service / balance-sheet ratios (11-10-0065 / 38-10-0235,
//   1990→, %) plus the quarterly saving rate (36-10-0112).
// The DSR / debt-to-income / net-worth panels are DIRECT — Canada publishes
// the full household debt service ratio (interest + obligated principal),
// unlike the UK. Only the credit-card panels carry the household_credit PROXY
// badge (borrower-side stock vs the US Fed H.8 bank-asset view).
// Sentiment / delinquency / gasoline-pump panels are private-source or
// deferred and deliberately omitted.

type AllData = Record<string, StatcanPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = [
  'CA_HHCRED_CARDS',
  'CA_DSR', 'CA_DSR_MORT', 'CA_DSR_NONMORT',
  'CA_DEBT_TO_DI', 'CA_NW_TO_DI',
  'CA_HH_SAVERATE',
] as const

const DEFAULT_M = 120 // ~10 years of months
const DEFAULT_Q = 80  // ~20 years of quarters

// ── formatters ($ millions stored) ───────────────────────────────────────────

const fmtCadTick = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}bn` : `$${v.toFixed(0)}m`
const fmtCadTooltip = (v: number) =>
  `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}m`

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
  title, subtitle, badge, lines, rows, defaultCount,
  tickFmt, tooltipFmt, zeroRef = false,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineDef[]
  rows: Row[]
  defaultCount: number
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  zeroRef?: boolean
}) {
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

// ══════════════════════════════════════════════════════════════════════════════

export function CAConsumerHealthContent() {
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

  const creditBadge = <ProxyBadge caveat={CA_PROXY_CAVEATS.household_credit} />

  const cards = useMemo(() => allData['CA_HHCRED_CARDS'] ?? [], [allData])

  const dsrRows = useMemo(
    () => buildRows([
      { key: 'CA_DSR', data: allData['CA_DSR'] ?? [] },
      { key: 'CA_DSR_MORT', data: allData['CA_DSR_MORT'] ?? [] },
      { key: 'CA_DSR_NONMORT', data: allData['CA_DSR_NONMORT'] ?? [] },
    ]),
    [allData]
  )
  const debtToDiRows = useMemo(
    () => buildRows([{ key: 'CA_DEBT_TO_DI', data: allData['CA_DEBT_TO_DI'] ?? [] }]),
    [allData]
  )
  const nwToDiRows = useMemo(
    () => buildRows([{ key: 'CA_NW_TO_DI', data: allData['CA_NW_TO_DI'] ?? [] }]),
    [allData]
  )
  const cardsLevelRows = useMemo(
    () => buildRows([{ key: 'CA_HHCRED_CARDS', data: cards }]),
    [cards]
  )
  const cardsYoyRows = useMemo(
    () => buildRows([{ key: 'CA_HHCRED_CARDS', data: computeChangePct(cards, 12) }]),
    [cards]
  )
  const savingRows = useMemo(
    () => buildRows([{ key: 'CA_HH_SAVERATE', data: allData['CA_HH_SAVERATE'] ?? [] }]),
    [allData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan consumer health series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (36-10-0639 monthly credit SA / 11-10-0065 &amp; 38-10-0235 quarterly ratios / 36-10-0112 saving rate) &mdash; 1990&rarr;
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Household Debt Service Ratios"
          subtitle="Total / mortgage / non-mortgage debt payments as % of disposable income, quarterly — Canada publishes the full DSR directly (unlike the UK)"
          lines={[
            { key: 'CA_DSR', label: 'Total DSR', color: '#e2e8f0', width: 2.2 },
            { key: 'CA_DSR_MORT', label: 'Mortgage DSR', color: '#60a5fa' },
            { key: 'CA_DSR_NONMORT', label: 'Non-mortgage DSR', color: '#f59e0b' },
          ]}
          rows={dsrRows}
          defaultCount={DEFAULT_Q}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
        />
        <LinesPanel
          title="Credit Market Debt to Disposable Income"
          subtitle="Canada's flagship household-stress metric — credit market debt as % of household disposable income, quarterly"
          lines={[{ key: 'CA_DEBT_TO_DI', label: 'Debt / Disp. Income (%)', color: '#ec4899' }]}
          rows={debtToDiRows}
          defaultCount={DEFAULT_Q}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Net Worth as % of Disposable Income"
          subtitle="Household net worth as % of disposable income, quarterly"
          lines={[{ key: 'CA_NW_TO_DI', label: 'Net Worth / Disp. Income (%)', color: '#4ade80' }]}
          rows={nwToDiRows}
          defaultCount={DEFAULT_Q}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
        />
        <LinesPanel
          title="Household Saving Rate"
          subtitle="Household saving as % of disposable income, quarterly SA (36-10-0112)"
          lines={[{ key: 'CA_HH_SAVERATE', label: 'Saving Rate (%)', color: '#a78bfa' }]}
          rows={savingRows}
          defaultCount={DEFAULT_Q}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Credit Card Balances"
          subtitle="Credit liabilities of households — credit cards, $m SA, monthly"
          badge={creditBadge}
          lines={[{ key: 'CA_HHCRED_CARDS', label: 'Credit Cards ($m)', color: '#60a5fa' }]}
          rows={cardsLevelRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtCadTick}
          tooltipFmt={fmtCadTooltip}
        />
        <LinesPanel
          title="Credit Card Balances — YoY %"
          subtitle="% change vs same month a year earlier"
          badge={creditBadge}
          lines={[{ key: 'CA_HHCRED_CARDS', label: 'Credit Cards YoY', color: '#ec4899' }]}
          rows={cardsYoyRows}
          defaultCount={DEFAULT_M}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
