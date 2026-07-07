import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, LineChart, BarChart,
  Bar, Line, Cell, ReferenceLine, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  type WD, type NV, computeChangePct, computeMA,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { FiscalYearOverlay } from '../components/charts/FiscalYearOverlay'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// HMRC monthly cash receipts by tax head — the monthly analog of the US DTS
// withheld-tax cycle tables. Every panel is a PROXY of the daily US flow data
// (monthly cash-basis vs business-day deposits), so every panel carries the
// hmrc_receipts proxy badge. Data from Apr 2017, £m. UK fiscal years run
// April–March and are labelled by END year (FY2026 = Apr 2025 – Mar 2026).

const TOTAL_HEAD = 'Total HMRC Receipts'

const HEAD_LINES = [
  { head: 'Income Tax', key: 'incomeTax', label: 'Income Tax', color: '#60a5fa' },
  { head: 'National Insurance Contributions', key: 'nics', label: 'NICs', color: '#a78bfa' },
  { head: 'Value Added Tax', key: 'vat', label: 'VAT', color: '#4ade80' },
  { head: 'Corporation Tax', key: 'corpTax', label: 'Corporation Tax', color: '#f59e0b' },
  { head: 'Hydrocarbon Oil (Fuel duties)', key: 'fuel', label: 'Fuel Duties', color: '#f87171' },
  { head: 'Capital Gains Tax', key: 'cgt', label: 'CGT', color: '#2da0a1' },
  { head: 'Stamp Duty Land Tax', key: 'sdlt', label: 'SDLT', color: '#f472b6' },
] as const

const YOY_HEADS = ['incomeTax', 'nics', 'vat', 'corpTax'] as const

const ALL_HEADS = [TOTAL_HEAD, ...HEAD_LINES.map(h => h.head)]

const CURRENT_FY = '2027' // Apr 2026 – Mar 2027
const COMPARISON_FY = '2026'
const UK_FY_MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

type AllData = Record<string, WD[]>

// ── Fetch ────────────────────────────────────────────────────────────────────

interface HmrcResponse {
  taxHead: string | null
  observations: Array<{ tax_head: string; date: string; value: number }>
}

async function fetchHmrcHead(head: string): Promise<WD[]> {
  try {
    const res = await fetch(`/api/hmrc-receipts?tax_head=${encodeURIComponent(head)}`)
    if (!res.ok) {
      console.error(`[HMRC client] Failed to fetch "${head}": ${res.status}`)
      return []
    }
    const json = await res.json() as HmrcResponse
    return (json.observations ?? [])
      .map(o => ({ date: o.date, value: Number(o.value) }))
      .filter(p => Number.isFinite(p.value))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (err) {
    console.error(`[HMRC client] Network error fetching "${head}":`, err)
    return []
  }
}

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
  for (const fy of Object.keys(out)) if (out[fy].length === 0) delete out[fy]
  return out
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

/** 12-mo rolling sum of a monthly £m series, in £bn, nulls dropped. */
function roll12Bn(data: WD[]): WD[] {
  return nvToWd(rollingSum(data, 12)).map(p => ({ date: p.date, value: p.value / 1000 }))
}

const fmtBn = (v: number) => `£${v.toFixed(0)}bn`
const fmtBnExact = (v: number) => `£${v.toFixed(1)}bn`
const fmtYoy = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const badge = () => <ProxyBadge caveat={UK_PROXY_CAVEATS.hmrc_receipts} />

// ── Panel shell + brush state ────────────────────────────────────────────────

function PanelShell({ title, subtitle, legend, children }: {
  title: string
  subtitle: string
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge()}</div>
          <div className={kit.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      {legend}
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

// ── Total receipts rolling-sum line ──────────────────────────────────────────

function TotalRollingPanel({ rows }: { rows: Row[] }) {
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Total Receipts — 12-Month Rolling Sum"
      subtitle="Total HMRC cash receipts · £bn"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
            tickFormatter={fmtBn} domain={['auto', 'auto']} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtBnExact(v) : '-', 'Total receipts, 12-mo sum'] as [string, string]} />
          <Line type="monotone" dataKey="roll" name="Total receipts, 12-mo sum"
            stroke="#4ade80" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ── Total receipts YoY bars (3-mo avg) ───────────────────────────────────────

function TotalYoyPanel({ rows }: { rows: Array<{ date: string; yoy: number }> }) {
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Total Receipts — YoY % (3-mo avg)"
      subtitle="YoY % of monthly receipts, 3-month moving average"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtYoy(v) : '-', 'YoY % (3-mo avg)'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="yoy" name="YoY % (3-mo avg)" isAnimationActive={false}>
            {rows.map(r => (
              <Cell key={r.date} fill={r.yoy >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.75} />
            ))}
          </Bar>
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </BarChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ── Tax-head multi-line panel with toggleable legend ─────────────────────────

function TaxHeadRollingPanel({ rows }: { rows: Row[] }) {
  const [visible, setVisible] = useState<Set<string>>(new Set(HEAD_LINES.map(h => h.key)))
  const { brush, onChange } = useBrushRange(rows.length)

  const toggle = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <PanelShell
      title="Receipts by Tax Head — 12-Month Rolling Sums"
      subtitle="£bn · click a tax head to toggle"
      legend={
        <div className={kit.legendRow}>
          <div className={kit.legend}>
            {HEAD_LINES.map(h => {
              const off = !visible.has(h.key)
              return (
                <button key={h.key} type="button"
                  className={`${kit.legendItem} ${off ? kit.legendItemOff : ''}`}
                  onClick={() => toggle(h.key)}>
                  <span className={kit.legendSwatch} style={{ background: h.color }} />
                  {h.label}
                </button>
              )
            })}
          </div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtBn} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtBnExact(v) : '-', String(name)] as [string, string]} />
          {HEAD_LINES.map(h => visible.has(h.key) && (
            <Line key={h.key} type="monotone" dataKey={h.key} name={h.label}
              stroke={h.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ── Tax-head YoY growth (4 lines) ────────────────────────────────────────────

function TaxHeadYoyPanel({ rows }: { rows: Row[] }) {
  const lines = HEAD_LINES.filter(h => (YOY_HEADS as readonly string[]).includes(h.key))
  const { brush, onChange } = useBrushRange(rows.length)
  return (
    <PanelShell
      title="Tax Head YoY Growth"
      subtitle="YoY % of 12-mo rolling sum · Income Tax / NICs / VAT / Corporation Tax"
      legend={
        <div className={kit.legendRow}>
          <div className={kit.legend}>
            {lines.map(h => (
              <span key={h.key} className={kit.legendItem} style={{ cursor: 'default' }}>
                <span className={kit.legendSwatch} style={{ background: h.color }} />
                {h.label}
              </span>
            ))}
          </div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtYoy(v) : '-', String(name)] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          {lines.map(h => (
            <Line key={h.key} type="monotone" dataKey={h.key} name={h.label}
              stroke={h.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onChange} {...BRUSH_STYLE} />
        </LineChart>
      </ResponsiveContainer>
    </PanelShell>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKHMRCReceiptsContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_HEADS.map(head =>
      fetchHmrcHead(head).then(d => [head, d] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load HMRC receipts')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const total = useMemo(() => allData[TOTAL_HEAD] ?? [], [allData])

  // Cumulative total receipts by UK fiscal year, £m → £bn
  const receiptsFYs = useMemo(() => buildFyCumulative(total, 1 / 1000), [total])

  const totalRollRows = useMemo(
    () => mergeSeries([{ key: 'roll', data: roll12Bn(total) }]),
    [total]
  )

  const totalYoyRows = useMemo(() => {
    const yoy = computeMA(computeChangePct(total, 12), 3)
    return nvToWd(yoy).map(p => ({ date: p.date, yoy: p.value }))
  }, [total])

  const headRollRows = useMemo(
    () => mergeSeries(HEAD_LINES.map(h => ({ key: h.key, data: roll12Bn(allData[h.head] ?? []) }))),
    [allData]
  )

  const headYoyRows = useMemo(
    () => mergeSeries(
      HEAD_LINES
        .filter(h => (YOY_HEADS as readonly string[]).includes(h.key))
        .map(h => ({ key: h.key, data: computeChangePct(roll12Bn(allData[h.head] ?? []), 12) }))
    ),
    [allData]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_HEADS.length} HMRC tax-head series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        HMRC monthly cash receipts by tax head &mdash; monthly analog of the US DTS withheld-tax cycle tables
      </div>

      <FiscalYearOverlay
        title="CUMULATIVE HMRC RECEIPTS"
        subtitle="£ billions · total cash receipts · UK FY (Apr–Mar)"
        badge={badge()}
        fiscalYears={receiptsFYs}
        currentFY={CURRENT_FY}
        comparisonFY={COMPARISON_FY}
        monthLabels={[...UK_FY_MONTH_LABELS]}
        valueFormatter={fmtBn}
        exactFormatter={fmtBnExact}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <TotalRollingPanel rows={totalRollRows} />
        <TotalYoyPanel rows={totalYoyRows} />
      </div>

      <TaxHeadRollingPanel rows={headRollRows} />

      <TaxHeadYoyPanel rows={headYoyRows} />
    </>
  )
}
