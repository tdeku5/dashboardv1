import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart,
  Bar, Line, Cell, ReferenceLine, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Canada federal debt — StatCan 10-10-0002 (central government debt, monthly,
// $M, from April 2009). Federal debt (accumulated deficit) is the headline
// stock; market debt payable in CAD is the tradable-borrowing subset. The
// debt/GDP ratio divides the monthly stock by step-interpolated quarterly
// nominal GDP (SAAR, table 36-10-0104). All series are DIRECT — no proxy
// badges.

type AllData = Record<string, StatcanPoint[]>

const CODES = [
  'CA_FED_DEBT',    // Federal debt (accumulated deficit), $M monthly
  'CA_FED_MKTDEBT', // Market debt payable in CAD, $M monthly
  'CA_GDP_N',       // Nominal GDP at market prices, SAAR $M quarterly
] as const

const fmtB = (v: number) => `$${v.toFixed(0)}B`
const fmtBExact = (v: number) => `$${v.toFixed(1)}B`

// ── Small local helpers ──────────────────────────────────────────────────────

type Row = { date: string; [key: string]: number | string | null }

function mergeSeries(series: Array<{ key: string; data: Array<{ date: string; value: number | null }> }>): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({ key: s.key, map: new Map(s.data.map(p => [p.date, p.value])) }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

/** $M → $B */
function toBillions(data: StatcanPoint[]): StatcanPoint[] {
  return data.map(p => ({ date: p.date, value: p.value / 1000 }))
}

// ── Panel shell + brush state ────────────────────────────────────────────────

function PanelShell({ title, subtitle, legend, children }: {
  title: string
  subtitle: string
  legend?: ReadonlyArray<{ label: string; color: string }>
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}</div>
          <div className={kit.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      {legend && (
        <div className={kit.legendRow}>
          <div className={kit.legend}>
            {legend.map(item => (
              <span key={item.label} className={kit.legendItem} style={{ cursor: 'default' }}>
                <span className={kit.legendSwatch} style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function useBrushRange(length: number, span = 240) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!length) return
    setBrush({ start: Math.max(0, length - span), end: length - 1 })
  }, [length, span])
  const onChange = ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) =>
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  return { brush, onChange }
}

// ── 12-month change bars (green = decrease, red = increase) ──────────────────

function DebtChangePanel({ rows }: { rows: Array<{ date: string; value: number }> }) {
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Federal Debt — 12-Month Change"
      subtitle="Change in accumulated deficit vs 12 months earlier · $B"
      legend={[
        { label: 'Debt decrease', color: '#22c55e' },
        { label: 'Debt increase', color: '#ef4444' },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtB} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtBExact(v) : '-', '12-mo change'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="value" name="12-mo change" isAnimationActive={false}>
            {rows.map(r => (
              <Cell key={r.date} fill={r.value <= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.75} />
            ))}
          </Bar>
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ── Generic multi-line time-series panel with brush ──────────────────────────

function LinesPanel({ title, subtitle, rows, lines, yFormatter, exactFormatter, brushSpan = 240, zeroLine = false }: {
  title: string
  subtitle: string
  rows: Row[]
  lines: ReadonlyArray<{ key: string; label: string; color: string }>
  yFormatter: (v: number) => string
  exactFormatter: (v: number) => string
  brushSpan?: number
  zeroLine?: boolean
}) {
  const { brush, onChange } = useBrushRange(rows.length, brushSpan)
  return (
    <PanelShell title={title} subtitle={subtitle}
      legend={lines.map(l => ({ label: l.label, color: l.color }))}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={yFormatter}
            domain={['auto', 'auto']} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? exactFormatter(v) : '-', String(name)] as [string, string]} />
          {zeroLine && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />}
          {lines.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label}
              stroke={l.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAFiscalDebtContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load StatCan debt data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const debtSorted = useMemo(
    () => [...(allData['CA_FED_DEBT'] ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [allData]
  )

  const debtLevelRows = useMemo(
    () => mergeSeries([{ key: 'debt', data: toBillions(debtSorted) }]),
    [debtSorted]
  )

  // 12-month change in the debt stock, $M → $B
  const debtChangeRows = useMemo(() => {
    const out: Array<{ date: string; value: number }> = []
    for (let i = 12; i < debtSorted.length; i++) {
      out.push({ date: debtSorted[i].date, value: (debtSorted[i].value - debtSorted[i - 12].value) / 1000 })
    }
    return out
  }, [debtSorted])

  const mktDebtRows = useMemo(
    () => mergeSeries([{ key: 'mkt', data: toBillions(allData['CA_FED_MKTDEBT'] ?? []) }]),
    [allData]
  )

  const mktDebtYoyRows = useMemo(
    () => mergeSeries([{ key: 'yoy', data: computeChangePct(allData['CA_FED_MKTDEBT'] ?? [], 12) }]),
    [allData]
  )

  // Debt / nominal GDP: for each monthly debt observation use the latest
  // quarterly SAAR GDP value dated ≤ that month (step interpolation). Both in
  // $M so the ratio needs no unit scaling.
  const debtGdpRows = useMemo(() => {
    const gdp = [...(allData['CA_GDP_N'] ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    if (!gdp.length || !debtSorted.length) return [] as Row[]
    const out: Row[] = []
    let gi = 0
    for (const d of debtSorted) {
      while (gi + 1 < gdp.length && gdp[gi + 1].date <= d.date) gi++
      if (gdp[gi].date > d.date) continue // debt observation predates first GDP quarter
      const g = gdp[gi].value
      if (g === 0) continue
      out.push({ date: d.date, ratio: (d.value / g) * 100 })
    }
    return out
  }, [allData, debtSorted])

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} StatCan debt series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Central government debt, monthly (10-10-0002), from April 2009.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Federal Debt (Accumulated Deficit)"
          subtitle="CA_FED_DEBT · liabilities less financial & non-financial assets · $B monthly"
          rows={debtLevelRows}
          lines={[{ key: 'debt', label: 'Federal debt', color: '#60a5fa' }]}
          yFormatter={fmtB}
          exactFormatter={fmtBExact}
        />
        <DebtChangePanel rows={debtChangeRows} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Market Debt Payable in CAD"
          subtitle="CA_FED_MKTDEBT · tradable federal debt (bills, bonds, RRBs) · $B monthly"
          rows={mktDebtRows}
          lines={[{ key: 'mkt', label: 'Market debt (CAD)', color: '#a78bfa' }]}
          yFormatter={fmtB}
          exactFormatter={fmtBExact}
        />
        <LinesPanel
          title="Market Debt — YoY %"
          subtitle="Market debt payable in CAD vs 12 months earlier"
          rows={mktDebtYoyRows}
          lines={[{ key: 'yoy', label: 'Market debt YoY %', color: '#f59e0b' }]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          exactFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          zeroLine
        />
      </div>

      <LinesPanel
        title="Federal Debt as % of Nominal GDP"
        subtitle="debt stock ÷ SAAR nominal GDP · latest quarterly GDP value ≤ month (step interpolation)"
        rows={debtGdpRows}
        lines={[{ key: 'ratio', label: 'Federal debt / NGDP', color: '#38bdf8' }]}
        yFormatter={(v) => `${v.toFixed(0)}%`}
        exactFormatter={(v) => `${v.toFixed(1)}%`}
      />
    </>
  )
}
