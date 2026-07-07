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
import { FiscalYearOverlay } from '../components/charts/FiscalYearOverlay'
import kit from '../components/charts/ChartKit.module.css'

// Canada Government Finance Statistics (StatCan 10-10-0015) — the Canadian
// analog of the US MTS / UK PSF pages. Quarterly accrual-basis GFS flows for
// the federal general government plus the consolidated aggregate. All series
// are DIRECT (no proxy badges). Canada's federal fiscal year runs April–March
// and is labelled by END year (FY2026 = Apr 2025 – Mar 2026); quarterly dates
// are first-of-quarter (01/04/07/10) so Jan–Mar of year Y is FY Y Q4.

type AllData = Record<string, StatcanPoint[]>

const CODES = [
  'CA_GFS_FED_REV',  // Federal revenue, $M quarterly
  'CA_GFS_FED_EXP',  // Federal expense, $M quarterly
  'CA_GFS_FED_NOB',  // Federal net operating balance, $M quarterly
  'CA_GFS_FED_NLB',  // Federal net lending/borrowing, $M quarterly
  'CA_GFS_CONS_NOB', // Consolidated net operating balance, $M quarterly
] as const

const FY_KEEP = 11
const CA_FY_QUARTER_LABELS = ['Q1 (Apr–Jun)', 'Q2 (Jul–Sep)', 'Q3 (Oct–Dec)', 'Q4 (Jan–Mar)']

const fmtB = (v: number) => `$${v.toFixed(0)}B`
const fmtBExact = (v: number) => `$${v.toFixed(1)}B`

// ── FY mapping & cumulation (Apr–Mar, labelled by end year, quarterly) ────────

/** Canada FY end-year for a first-of-quarter date (Apr–Dec → y+1, Jan–Mar → y). */
function caFyEndYear(y: number, m: number): number {
  return m >= 4 ? y + 1 : y
}

/** Fiscal-quarter index 1..4 for first-of-quarter months 4/7/10/1. */
function caFyQuarterIndex(m: number): number {
  return m === 4 ? 1 : m === 7 ? 2 : m === 10 ? 3 : 4
}

type FyMap = Record<string, Array<{ periodIndex: number; value: number }>>

function buildFyCumulativeQuarterly(data: StatcanPoint[], scale: number): FyMap {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const out: FyMap = {}
  const running = new Map<string, number>()
  for (const p of sorted) {
    const [y, m] = p.date.split('-').map(Number)
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue
    const fy = String(caFyEndYear(y, m))
    const periodIndex = caFyQuarterIndex(m)
    const cum = (running.get(fy) ?? 0) + p.value * scale
    running.set(fy, cum)
    if (!out[fy]) out[fy] = []
    out[fy].push({ periodIndex, value: cum })
  }
  const fys = Object.keys(out).filter(fy => out[fy].length > 0).sort()
  const keep = new Set(fys.slice(-FY_KEEP))
  const trimmed: FyMap = {}
  for (const fy of fys) if (keep.has(fy)) trimmed[fy] = out[fy]
  return trimmed
}

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

function useBrushRange(length: number, span = 80) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!length) return
    setBrush({ start: Math.max(0, length - span), end: length - 1 })
  }, [length, span])
  const onChange = ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) =>
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  return { brush, onChange }
}

const tooltipB = (v: unknown, name: unknown) =>
  [typeof v === 'number' ? fmtBExact(v) : '-', String(name)] as [string, string]

// ── Quarterly net operating balance (surplus/deficit bars) ──────────────────

function QuarterlyBalancePanel({ rows }: { rows: Array<{ date: string; value: number }> }) {
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Quarterly Net Operating Balance"
      subtitle="CA_GFS_FED_NOB · federal general government · $B per quarter · positive = surplus"
      legend={[
        { label: 'Surplus', color: '#22c55e' },
        { label: 'Deficit', color: '#ef4444' },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtB} />
          <Tooltip {...TOOLTIP_STYLE} formatter={tooltipB} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="value" name="Net operating balance" isAnimationActive={false}>
            {rows.map(r => (
              <Cell key={r.date} fill={r.value >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.75} />
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

function LinesPanel({ title, subtitle, rows, lines, yFormatter, exactFormatter, brushSpan = 80, zeroLine = false }: {
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
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={yFormatter} />
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

export function CAFiscalGFSContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load StatCan GFS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // Cumulative federal NOB by Canada fiscal year, $M → $B
  const balanceFYs = useMemo(
    () => buildFyCumulativeQuarterly(allData['CA_GFS_FED_NOB'] ?? [], 1 / 1000),
    [allData]
  )

  // Current FY = max FY present in the data; comparison = prior FY
  const { currentFY, comparisonFY } = useMemo(() => {
    const fys = Object.keys(balanceFYs).sort()
    const cur = fys[fys.length - 1] ?? ''
    return { currentFY: cur, comparisonFY: cur ? String(Number(cur) - 1) : undefined }
  }, [balanceFYs])

  const quarterlyBalance = useMemo(
    () => toBillions(allData['CA_GFS_FED_NOB'] ?? []),
    [allData]
  )

  const revExpRows = useMemo(() => mergeSeries([
    { key: 'rev', data: toBillions(allData['CA_GFS_FED_REV'] ?? []) },
    { key: 'exp', data: toBillions(allData['CA_GFS_FED_EXP'] ?? []) },
  ]), [allData])

  // YoY % of quarterly revenue / expense (quarterly data → lag 4)
  const revExpYoyRows = useMemo(() => mergeSeries([
    { key: 'revYoy', data: computeChangePct(allData['CA_GFS_FED_REV'] ?? [], 4) },
    { key: 'expYoy', data: computeChangePct(allData['CA_GFS_FED_EXP'] ?? [], 4) },
  ]), [allData])

  const nobNlbRows = useMemo(() => mergeSeries([
    { key: 'nob', data: toBillions(allData['CA_GFS_FED_NOB'] ?? []) },
    { key: 'nlb', data: toBillions(allData['CA_GFS_FED_NLB'] ?? []) },
  ]), [allData])

  const consFedRows = useMemo(() => mergeSeries([
    { key: 'cons', data: toBillions(allData['CA_GFS_CONS_NOB'] ?? []) },
    { key: 'fed', data: toBillions(allData['CA_GFS_FED_NOB'] ?? []) },
  ]), [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} StatCan GFS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        StatCan Government Finance Statistics (10-10-0015), quarterly accrual basis &mdash;
        the monthly Fiscal Monitor (Dept. of Finance) is a deferred follow-up source.
      </div>

      {currentFY && (
        <FiscalYearOverlay
          title="CUMULATIVE FEDERAL NET OPERATING BALANCE"
          subtitle="$ billions · GFS quarterly · Canada FY (Apr–Mar)"
          fiscalYears={balanceFYs}
          currentFY={currentFY}
          comparisonFY={comparisonFY}
          monthLabels={[...CA_FY_QUARTER_LABELS]}
          valueFormatter={fmtB}
          exactFormatter={fmtBExact}
        />
      )}

      <QuarterlyBalancePanel rows={quarterlyBalance} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Federal Revenue & Expense"
          subtitle="CA_GFS_FED_REV · CA_GFS_FED_EXP · $B per quarter, accrual basis"
          rows={revExpRows}
          lines={[
            { key: 'rev', label: 'Revenue', color: '#4ade80' },
            { key: 'exp', label: 'Expense', color: '#ef4444' },
          ]}
          yFormatter={fmtB}
          exactFormatter={fmtBExact}
        />
        <LinesPanel
          title="Revenue & Expense — YoY %"
          subtitle="Quarterly revenue / expense vs same fiscal quarter a year earlier"
          rows={revExpYoyRows}
          lines={[
            { key: 'revYoy', label: 'Revenue YoY %', color: '#4ade80' },
            { key: 'expYoy', label: 'Expense YoY %', color: '#ef4444' },
          ]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          exactFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          zeroLine
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Net Operating Balance vs Net Lending/Borrowing"
          subtitle="CA_GFS_FED_NOB (rev − expense) · CA_GFS_FED_NLB (after net investment in non-financial assets) · $B"
          rows={nobNlbRows}
          lines={[
            { key: 'nob', label: 'Net operating balance', color: '#60a5fa' },
            { key: 'nlb', label: 'Net lending/borrowing', color: '#f59e0b' },
          ]}
          yFormatter={fmtB}
          exactFormatter={fmtBExact}
          zeroLine
        />
        <LinesPanel
          title="Consolidated vs Federal Net Operating Balance"
          subtitle="CA_GFS_CONS_NOB (all levels of government, consolidated) · CA_GFS_FED_NOB · $B"
          rows={consFedRows}
          lines={[
            { key: 'cons', label: 'Consolidated NOB', color: '#a78bfa' },
            { key: 'fed', label: 'Federal NOB', color: '#60a5fa' },
          ]}
          yFormatter={fmtB}
          exactFormatter={fmtBExact}
          zeroLine
        />
      </div>
    </>
  )
}
