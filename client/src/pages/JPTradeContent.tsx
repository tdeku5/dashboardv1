import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan merchandise trade dashboard — Japan Customs long-series CSV (monthly,
// customs-clearance basis, world totals, NSA, 1979→). Values are stored in
// THOUSAND YEN (May-26 exports 9,499,093,475 ≈ ¥9.50T — so ¥T = value/1e9).
// Goods only on a customs (not BOP) basis, so EVERY panel is a PROXY for the
// US total goods+services trade page and carries the trade_customs badge.
// NSA and strongly seasonal — compare like months.

type AllData = Record<string, EstatPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['JP_TRADE_BAL', 'JP_TRADE_EXP', 'JP_TRADE_IMP'] as const

const DEFAULT_M = 120 // ~10 years of months

// ── formatters (thousand yen stored; /1e9 = ¥T, /1e6 = ¥bn) ──────────────────

const fmtYenTick = (v: number) =>
  Math.abs(v) >= 1e9 ? `¥${(v / 1e9).toFixed(1)}T` : `¥${(v / 1e6).toFixed(0)}bn`
const fmtYenTooltip = (v: number) =>
  Math.abs(v) >= 1e9 ? `¥${(v / 1e9).toFixed(2)}T` : `¥${(v / 1e6).toFixed(0)}bn`

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

/** Trailing sum over `window` observations (null until the window fills). */
function rollingSum(data: readonly WD[], window: number): NV[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null }
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += data[j].value
    return { date: d.date, value: sum }
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

// ── signed-bars panel (trade balance) ────────────────────────────────────────

function BalanceBarsPanel({
  title, subtitle, badge, barLabel, rows, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  barLabel: string
  rows: Row[]
  defaultCount?: number
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
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            {barLabel} +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} &minus;
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtYenTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) =>
                [typeof v === 'number' ? fmtYenTooltip(v) : '-', barLabel] as [string, string]} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="value" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`b-${i}`}
                  fill={typeof r.value === 'number' && r.value < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
              ))}
            </Bar>
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

export function JPTradeContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load Customs trade data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const badge = <ProxyBadge caveat={JP_PROXY_CAVEATS.trade_customs} />

  const balance = useMemo(() => allData['JP_TRADE_BAL'] ?? [], [allData])
  const exports_ = useMemo(() => allData['JP_TRADE_EXP'] ?? [], [allData])
  const imports_ = useMemo(() => allData['JP_TRADE_IMP'] ?? [], [allData])

  const balanceRows = useMemo(
    () => buildRows([{ key: 'value', data: balance }]),
    [balance]
  )
  const expImpRows = useMemo(
    () => buildRows([
      { key: 'exp', data: exports_ },
      { key: 'imp', data: imports_ },
    ]),
    [exports_, imports_]
  )
  const expImpYoyRows = useMemo(
    () => buildRows([
      { key: 'exp', data: computeChangePct(exports_, 12) },
      { key: 'imp', data: computeChangePct(imports_, 12) },
    ]),
    [exports_, imports_]
  )
  const rolling12Rows = useMemo(
    () => buildRows([{ key: 'roll', data: rollingSum(balance, 12) }]),
    [balance]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} Customs trade series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Japan Customs (customs.go.jp long-series CSV) &mdash; customs-clearance basis, goods only, NSA.
        Monthly world totals, thousand yen, 1979&rarr;.
      </div>

      <div className={kit.sectionSubtitle} style={{ padding: '0 2px' }}>
        customs basis &ne; BOP basis; services excluded; strongly seasonal (NSA) &mdash; compare like months
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <BalanceBarsPanel
          title="Merchandise Trade Balance"
          subtitle="Raw monthly balance, NSA — exports less imports, all commodities, world"
          badge={badge}
          barLabel="Balance"
          rows={balanceRows}
        />
        <LinesPanel
          title="Exports &amp; Imports"
          subtitle="Customs-clearance exports and imports, world totals, NSA"
          badge={badge}
          lines={[
            { key: 'exp', label: 'Exports (¥)', color: '#4ade80' },
            { key: 'imp', label: 'Imports (¥)', color: '#f87171' },
          ]}
          rows={expImpRows}
          tickFmt={fmtYenTick}
          tooltipFmt={fmtYenTooltip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Exports &amp; Imports — YoY %"
          subtitle="% change vs same month a year earlier (the clean NSA compare)"
          badge={badge}
          lines={[
            { key: 'exp', label: 'Exports YoY', color: '#4ade80' },
            { key: 'imp', label: 'Imports YoY', color: '#f87171' },
          ]}
          rows={expImpYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Trade Balance — 12-Month Rolling Sum"
          subtitle="Trailing 12-month sum of the monthly balance — strips the seasonality"
          badge={badge}
          lines={[{ key: 'roll', label: '12-mo Rolling Balance', color: '#f59e0b' }]}
          rows={rolling12Rows}
          tickFmt={fmtYenTick}
          tooltipFmt={fmtYenTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
