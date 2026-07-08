import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch } from '../lib/eurostat'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 goods-trade dashboard — one parameterized page serving DE / FR / IT.
// Eurostat ext_st_* short-term external-trade indicators: monthly trade
// balance, exports and imports of GOODS with the WORLD partner, in MILLION
// EUR, seasonally + working-day adjusted, 2002→. Unlike Japan's customs-basis
// proxy page, these are DIRECT harmonized series (no badges) — and SA, so
// sequential months compare cleanly. Rendered as €bn (÷1000).

type AllData = Record<string, { date: string; value: number }[]>
type Row = { date: string; [key: string]: number | string | null }

const HISTORY_NOTE: Record<Eu3Country, string> = {
  DE: 'History from 2002 (all three countries share the same start on this dataset).',
  FR: 'History from 2002 (all three countries share the same start on this dataset).',
  IT: 'History from 2002 (all three countries share the same start on this dataset).',
}

const DEFAULT_M = 120 // ~10 years of months

// ── formatters (values stored in € millions; ÷1000 = €bn) ────────────────────

const fmtEurTick = (v: number) => `€${(v / 1000).toFixed(0)}bn`
const fmtEurTooltip = (v: number) => `€${(v / 1000).toFixed(1)}bn`

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

// ── signed-bars panel (trade balance) ────────────────────────────────────────

function BalanceBarsPanel({
  title, subtitle, barLabel, rows, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  barLabel: string
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
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtEurTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) =>
                [typeof v === 'number' ? fmtEurTooltip(v) : '-', barLabel] as [string, string]} />
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

export function EU3TradeContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allCodes = useMemo(
    () => [`${cc}_TRADE_BAL`, `${cc}_TRADE_EXP`, `${cc}_TRADE_IMP`],
    [cc]
  )

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
      setError(e instanceof Error ? e.message : 'Failed to load Eurostat trade data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  const balance = useMemo(() => allData[`${cc}_TRADE_BAL`] ?? [], [allData, cc])
  const exports_ = useMemo(() => allData[`${cc}_TRADE_EXP`] ?? [], [allData, cc])
  const imports_ = useMemo(() => allData[`${cc}_TRADE_IMP`] ?? [], [allData, cc])

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

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} trade series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat short-term external-trade indicators &mdash; goods only, world partner,
        million EUR, seasonally + working-day adjusted. {HISTORY_NOTE[cc]} Services are
        excluded &mdash; this is not the current account.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <BalanceBarsPanel
          title={`${EU3_COUNTRY_LABEL[cc]} Goods Trade Balance`}
          subtitle="Monthly balance, SA — exports less imports, goods, world"
          barLabel="Balance"
          rows={balanceRows}
        />
        <LinesPanel
          title="Exports &amp; Imports"
          subtitle="Goods exports and imports, world totals, SA, €bn"
          lines={[
            { key: 'exp', label: 'Exports (€bn)', color: '#4ade80' },
            { key: 'imp', label: 'Imports (€bn)', color: '#f87171' },
          ]}
          rows={expImpRows}
          tickFmt={fmtEurTick}
          tooltipFmt={fmtEurTooltip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Exports &amp; Imports — YoY %"
          subtitle="% change vs same month a year earlier"
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
          subtitle="Trailing 12-month sum of the monthly balance — the trend read"
          lines={[{ key: 'roll', label: '12-mo Rolling Balance (€bn)', color: '#f59e0b' }]}
          rows={rolling12Rows}
          tickFmt={fmtEurTick}
          tooltipFmt={fmtEurTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
