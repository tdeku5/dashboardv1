import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Australia goods trade — ABS International Trade in Goods (5368.0), monthly,
// SA, A$ millions, 1971-07→. ALL series are DIRECT (no proxy badges).
// SIGN CONVENTION: the ABS publishes IMPORTS (and hence feeds the balance)
// on a DEBITS basis — imports are stored NEGATIVE as published. Import levels
// and YoY rates here are computed on Math.abs(imports); the BALANCE keeps its
// true published sign (positive = surplus). Goods only: services trade is
// quarterly (BoP basis) and deliberately unpaneled.

type AllData = Record<string, AbsPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['AU_TRADE_EXP', 'AU_TRADE_IMP', 'AU_TRADE_BAL'] as const

const DEFAULT_M = 120 // ~10 years of months

// ── formatters (A$ millions stored) ──────────────────────────────────────────

const fmtAudTick = (v: number) =>
  Math.abs(v) >= 1000 ? `A$${(v / 1000).toFixed(0)}bn` : `A$${v.toFixed(0)}m`
const fmtAudTooltip = (v: number) =>
  `A$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}m`

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
            {barLabel} + (surplus)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} &minus; (deficit)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtAudTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) =>
                [typeof v === 'number' ? fmtAudTooltip(v) : '-', barLabel] as [string, string]} />
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

export function AUTradeContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load ABS trade data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const balance = useMemo(() => allData['AU_TRADE_BAL'] ?? [], [allData])
  const exports_ = useMemo(() => allData['AU_TRADE_EXP'] ?? [], [allData])
  // Imports are published NEGATIVE (debits convention) — display as absolute
  // values; YoY is computed on the abs series so signs read intuitively.
  const importsAbs = useMemo(
    (): WD[] => (allData['AU_TRADE_IMP'] ?? []).map(p => ({ date: p.date, value: Math.abs(p.value) })),
    [allData]
  )

  const balanceRows = useMemo(
    () => buildRows([{ key: 'value', data: balance }]),
    [balance]
  )
  const expImpRows = useMemo(
    () => buildRows([
      { key: 'exp', data: exports_ },
      { key: 'imp', data: importsAbs },
    ]),
    [exports_, importsAbs]
  )
  const expImpYoyRows = useMemo(
    () => buildRows([
      { key: 'exp', data: computeChangePct(exports_, 12) },
      { key: 'imp', data: computeChangePct(importsAbs, 12) },
    ]),
    [exports_, importsAbs]
  )
  const rolling12Rows = useMemo(
    () => buildRows([{ key: 'roll', data: rollingSum(balance, 12) }]),
    [balance]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS trade series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS International Trade in Goods (5368.0) &mdash; monthly, seasonally adjusted, A$ millions,
        1971-07&rarr;. Goods only; services trade is quarterly (BoP basis) and unpaneled.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <BalanceBarsPanel
          title="Goods Trade Balance"
          subtitle="Monthly balance as published, A$m SA — true sign kept: positive = surplus"
          barLabel="Balance"
          rows={balanceRows}
        />
        <LinesPanel
          title="Exports &amp; Imports"
          subtitle="Goods credits and debits, A$m SA — ABS publishes imports NEGATIVE (debits convention); shown here as absolute values"
          lines={[
            { key: 'exp', label: 'Exports (A$m)', color: '#4ade80' },
            { key: 'imp', label: '|Imports| (A$m)', color: '#f87171' },
          ]}
          rows={expImpRows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Exports &amp; Imports — YoY %"
          subtitle="% change vs same month a year earlier — computed on absolute import values"
          lines={[
            { key: 'exp', label: 'Exports YoY', color: '#4ade80' },
            { key: 'imp', label: 'Imports YoY (abs)', color: '#f87171' },
          ]}
          rows={expImpYoyRows}
          tickFmt={fmtPctTick}
          tooltipFmt={fmtPctTooltip}
          zeroRef
        />
        <LinesPanel
          title="Trade Balance — 12-Month Rolling Sum"
          subtitle="Trailing 12-month sum of the monthly goods balance, A$m"
          lines={[{ key: 'roll', label: '12-mo Rolling Balance (A$m)', color: '#f59e0b' }]}
          rows={rolling12Rows}
          tickFmt={fmtAudTick}
          tooltipFmt={fmtAudTooltip}
          zeroRef
        />
      </div>
    </>
  )
}
