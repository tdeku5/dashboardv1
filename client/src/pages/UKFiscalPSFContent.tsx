import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart,
  Bar, Line, Cell, LabelList, ReferenceLine, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
  type LabelProps,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV, computeChangePct, computeMA,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { FiscalYearOverlay } from '../components/charts/FiscalYearOverlay'
import kit from '../components/charts/ChartKit.module.css'

// UK Public Sector Finances (ONS PUSF) — the UK analog of the US MTS page.
// All series here are DIRECT equivalents (docs/uk-models-mapping.md): PSNB ex,
// current budget deficit, net investment, net cash requirement, receipts and
// net debt — no proxy badges on this page. UK fiscal years run April–March and
// are labelled by END year (FY2026 = Apr 2025 – Mar 2026).

type AllData = Record<string, WD[]>

const CDIDS = [
  'DZLS', // PS net borrowing ex banks, £m
  'DZLT', // Current budget deficit ex, £m
  'DZLW', // Net investment ex, £m
  'RURQ', // PS net cash requirement, £m
  'RUUW', // CG net cash requirement, £m
  'AHHY', // Total PS taxes & NICs receipts, £m
  'HF6W', // PS net debt ex, £bn
  'HF6X', // PSND ex, % of GDP
  'JNVA', // Net borrowing, % of GDP
] as const

const CURRENT_FY = '2027' // Apr 2026 – Mar 2027
const COMPARISON_FY = '2026'
const FY_KEEP = 11
const UK_FY_MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

// ── FY cumulation (Apr–Mar, labelled by end year) ────────────────────────────

type FyMap = Record<string, Array<{ periodIndex: number; value: number }>>

function buildFyCumulative(data: WD[], scale: number): FyMap {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const out: FyMap = {}
  const running = new Map<string, number>()
  for (const p of sorted) {
    const [y, m] = p.date.split('-').map(Number)
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue
    const fy = String(m >= 4 ? y + 1 : y)
    const periodIndex = m >= 4 ? m - 3 : m + 9
    const cum = (running.get(fy) ?? 0) + p.value * scale
    running.set(fy, cum)
    if (!out[fy]) out[fy] = []
    out[fy].push({ periodIndex, value: cum })
  }
  // drop empty FYs (defensive) and keep the last FY_KEEP fiscal years
  const fys = Object.keys(out).filter(fy => out[fy].length > 0).sort()
  const keep = new Set(fys.slice(-FY_KEEP))
  const trimmed: FyMap = {}
  for (const fy of fys) if (keep.has(fy)) trimmed[fy] = out[fy]
  return trimmed
}

// ── Small local helpers ──────────────────────────────────────────────────────

function rollingSum(data: WD[], window: number): NV[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null }
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += data[j].value
    return { date: d.date, value: sum }
  })
}

function nvToWd(data: NV[]): WD[] {
  const out: WD[] = []
  for (const p of data) if (p.value != null) out.push({ date: p.date, value: p.value })
  return out
}

type Row = { date: string; [key: string]: number | string | null }

function mergeSeries(series: Array<{ key: string; data: NV[] }>): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({ key: s.key, map: new Map(s.data.map(p => [p.date, p.value])) }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

const fmtBn = (v: number) => `£${v.toFixed(0)}bn`
const fmtBnExact = (v: number) => `£${v.toFixed(1)}bn`
const fmtPct = (v: number) => `${v.toFixed(0)}%`

// ── Typed bar value label (LabelList content, no `any`) ──────────────────────
// LabelProps is recharts' full Label content props (SVG text props + label
// fields); value arrives as RenderableText so it is narrowed before use.

function renderBarValueLabel(format: (value: number) => string) {
  return function BarValueLabel(props: LabelProps) {
    if (typeof props.value !== 'number' && typeof props.value !== 'string') return null
    const x = Number(props.x ?? 0)
    const y = Number(props.y ?? 0)
    const width = Number(props.width ?? 0)
    const height = Number(props.height ?? 0)
    const v = Number(props.value)
    if (!Number.isFinite(v)) return null
    return (
      <text
        x={x + width / 2}
        y={v < 0 ? y + height - 8 : y + 16}
        textAnchor="middle"
        fill="#94A3B8"
        fontSize={11}
        fontWeight={700}
        fontFamily="var(--font-mono)"
      >
        {format(v)}
      </text>
    )
  }
}

// ── Panel shell + brush state ────────────────────────────────────────────────

function PanelShell({ title, subtitle, badge, legend, children }: {
  title: string
  subtitle: string
  badge?: ReactNode
  legend?: ReadonlyArray<{ label: string; color: string }>
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
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

const tooltipBn = (v: unknown, name: unknown) =>
  [typeof v === 'number' ? fmtBnExact(v) : '-', String(name)] as [string, string]

// ── Monthly net borrowing (bars + 12-mo MA) ──────────────────────────────────

function MonthlyBorrowingPanel({ rows }: { rows: Array<{ date: string; value: number; ma: number | null }> }) {
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Monthly Net Borrowing"
      subtitle="DZLS · £bn NSA · positive = borrowing (deficit), negative = surplus · 12-mo MA"
      legend={[
        { label: 'Borrowing (deficit)', color: '#ef4444' },
        { label: 'Surplus', color: '#22c55e' },
        { label: '12-mo MA', color: '#60a5fa' },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtBn} />
          <Tooltip {...TOOLTIP_STYLE} formatter={tooltipBn} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="value" name="PSNB ex" isAnimationActive={false}>
            {rows.map(r => (
              <Cell key={r.date} fill={r.value >= 0 ? '#ef4444' : '#22c55e'} fillOpacity={0.75} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="ma" name="12-mo MA" stroke="#60a5fa"
            strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ── FYTD borrowing by fiscal year (bars, no brush) ───────────────────────────

function FytdBarsPanel({ bars }: { bars: Array<{ fy: string; valueB: number }> }) {
  return (
    <PanelShell
      title="FYTD Borrowing by Fiscal Year"
      subtitle="£bn · cumulative PSNB ex at latest available month of each UK FY"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 28, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="fy" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtBn} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) => [typeof v === 'number' ? fmtBnExact(v) : '-', 'FYTD PSNB ex'] as [string, string]}
            labelFormatter={(label: unknown) => `FY${String(label)} (Apr–Mar)`} />
          <Bar dataKey="valueB" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {bars.map(row => (
              <Cell key={row.fy}
                fill={row.fy === CURRENT_FY ? '#60a5fa' : '#3b82f6'}
                fillOpacity={row.fy === CURRENT_FY ? 1 : 0.82} />
            ))}
            <LabelList content={renderBarValueLabel(v => `£${v.toFixed(0)}bn`)} />
          </Bar>
        </BarChart>
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

// ── Net debt (dual axis: £bn level + % of GDP) ───────────────────────────────

function NetDebtPanel({ rows }: { rows: Row[] }) {
  const { brush, onChange } = useBrushRange(rows.length, 360)
  return (
    <PanelShell
      title="Public Sector Net Debt"
      subtitle="HF6W (£bn, left) · HF6X (% of GDP, right) · ex public sector banks"
      legend={[
        { label: 'PSND ex (£bn)', color: '#60a5fa' },
        { label: 'PSND ex (% of GDP)', color: '#f59e0b' },
      ]}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtBn} />
          <YAxis yAxisId="right" orientation="right" tick={TICK} tickLine={false} axisLine={false}
            width={44} tickFormatter={fmtPct} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number'
                ? (name === 'PSND ex (% of GDP)' ? `${v.toFixed(1)}%` : fmtBnExact(v))
                : '-',
              String(name),
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="debtBn" name="PSND ex (£bn)"
            stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Line yAxisId="right" type="monotone" dataKey="debtPct" name="PSND ex (% of GDP)"
            stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKFiscalPSFContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'pusf')
        .then(d => [cdid, d.filter(p => Number.isFinite(p.value))] as [string, WD[]])
        .catch(() => [cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ONS PUSF data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // Cumulative PSNB ex by UK fiscal year, £m → £bn
  const borrowingFYs = useMemo(
    () => buildFyCumulative(allData['DZLS'] ?? [], 1 / 1000),
    [allData]
  )

  const fytdBars = useMemo(() => {
    return Object.keys(borrowingFYs).sort()
      .map(fy => {
        const rows = borrowingFYs[fy]
        const last = rows[rows.length - 1]
        return last ? { fy, valueB: last.value } : null
      })
      .filter((r): r is { fy: string; valueB: number } => r != null)
  }, [borrowingFYs])

  const monthlyBorrowing = useMemo(() => {
    const bn: WD[] = (allData['DZLS'] ?? []).map(p => ({ date: p.date, value: p.value / 1000 }))
    const ma = computeMA(bn, 12)
    return bn.map((p, i) => ({ date: p.date, value: p.value, ma: ma[i]?.value ?? null }))
  }, [allData])

  const netDebtRows = useMemo(() => mergeSeries([
    { key: 'debtBn', data: allData['HF6W'] ?? [] },
    { key: 'debtPct', data: allData['HF6X'] ?? [] },
  ]), [allData])

  const cashReqRows = useMemo(() => mergeSeries([
    { key: 'psncr', data: (allData['RURQ'] ?? []).map(p => ({ date: p.date, value: p.value / 1000 })) },
    { key: 'cgncr', data: (allData['RUUW'] ?? []).map(p => ({ date: p.date, value: p.value / 1000 })) },
  ]), [allData])

  // Receipts: 12-mo rolling sum (£bn) and YoY % of the rolling sum
  const receiptsRoll = useMemo(() => {
    const roll = nvToWd(rollingSum(allData['AHHY'] ?? [], 12))
    return roll.map(p => ({ date: p.date, value: p.value / 1000 }))
  }, [allData])

  const receiptsRollRows = useMemo(
    () => mergeSeries([{ key: 'roll', data: receiptsRoll }]),
    [receiptsRoll]
  )

  const receiptsYoyRows = useMemo(
    () => mergeSeries([{ key: 'yoy', data: computeChangePct(receiptsRoll, 12) }]),
    [receiptsRoll]
  )

  const budgetRows = useMemo(() => {
    const dzlt = nvToWd(rollingSum(allData['DZLT'] ?? [], 12)).map(p => ({ date: p.date, value: p.value / 1000 }))
    const dzlw = nvToWd(rollingSum(allData['DZLW'] ?? [], 12)).map(p => ({ date: p.date, value: p.value / 1000 }))
    return mergeSeries([
      { key: 'currentBudget', data: dzlt },
      { key: 'netInvestment', data: dzlw },
    ])
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {CDIDS.length} ONS PUSF series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ONS Public Sector Finances (PUSF) &mdash; monthly, &pound;m, not seasonally adjusted.
        Cumulative overlays use UK fiscal years (April&ndash;March).
        No daily flows exist for the UK (no DTS equivalent).
      </div>

      <FiscalYearOverlay
        title="CUMULATIVE PUBLIC SECTOR NET BORROWING"
        subtitle="£ billions · PSNB ex public sector banks · UK FY (Apr–Mar)"
        fiscalYears={borrowingFYs}
        currentFY={CURRENT_FY}
        comparisonFY={COMPARISON_FY}
        monthLabels={[...UK_FY_MONTH_LABELS]}
        valueFormatter={fmtBn}
        exactFormatter={fmtBnExact}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MonthlyBorrowingPanel rows={monthlyBorrowing} />
        <FytdBarsPanel bars={fytdBars} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <NetDebtPanel rows={netDebtRows} />
        <LinesPanel
          title="Net Cash Requirement"
          subtitle="RURQ (public sector) · RUUW (central government) · £bn NSA monthly"
          rows={cashReqRows}
          lines={[
            { key: 'psncr', label: 'PS net cash requirement', color: '#60a5fa' },
            { key: 'cgncr', label: 'CG net cash requirement', color: '#a78bfa' },
          ]}
          yFormatter={fmtBn}
          exactFormatter={fmtBnExact}
          zeroLine
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Receipts — Taxes & NICs"
          subtitle="AHHY · 12-month rolling sum, £bn"
          rows={receiptsRollRows}
          lines={[{ key: 'roll', label: 'Taxes & NICs, 12-mo sum', color: '#4ade80' }]}
          yFormatter={fmtBn}
          exactFormatter={fmtBnExact}
        />
        <LinesPanel
          title="Receipts — Taxes & NICs YoY"
          subtitle="YoY % of the 12-month rolling sum"
          rows={receiptsYoyRows}
          lines={[{ key: 'yoy', label: 'Rolling-sum YoY %', color: '#f59e0b' }]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          exactFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
          zeroLine
        />
      </div>

      <LinesPanel
        title="Current Budget & Investment"
        subtitle="DZLT current budget deficit ex · DZLW net investment ex · 12-mo rolling sums, £bn"
        rows={budgetRows}
        lines={[
          { key: 'currentBudget', label: 'Current budget deficit (12-mo sum)', color: '#ef4444' },
          { key: 'netInvestment', label: 'Net investment (12-mo sum)', color: '#60a5fa' },
        ]}
        yFormatter={fmtBn}
        exactFormatter={fmtBnExact}
        zeroLine
      />
    </>
  )
}
