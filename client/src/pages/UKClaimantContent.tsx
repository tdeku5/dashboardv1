import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK Claimant Count dashboard — the UK's closest analogue to US jobless
// claims. Every panel is a PROXY (monthly administrative benefit counts, not
// weekly UI filings) so every panel carries the claimant_count badge.

type AllData = Record<string, WD[]>

const SERIES_LIST: ReadonlyArray<{ cdid: string; dataset: string }> = [
  { cdid: 'BCJD', dataset: 'lms' }, // claimant count, thousands, SA
  { cdid: 'BCJE', dataset: 'lms' }, // claimant count rate, %, SA
]

const fmtK = (v: number): string => v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
const fmtKSigned = (v: number): string => `${v >= 0 ? '+' : ''}${fmtK(v)}k`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

// ── Local panel helpers ──────────────────────────────────────────────────────

type BrushIdx = { start: number; end: number }

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<BrushIdx>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  const onBrush = useCallback(({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  return { brush, onBrush }
}

function Panel({ title, subtitle, legend, children }: {
  title: string
  subtitle?: string
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            {title}
            <ProxyBadge caveat={UK_PROXY_CAVEATS.claimant_count} />
          </div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      {legend != null && <div className={kit.legendRow}><div className={kit.legend}>{legend}</div></div>}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function Leg({ color, label, kind = 'line' }: { color: string; label: string; kind?: 'line' | 'swatch' }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kind === 'line' ? kit.legendLine : kit.legendSwatch} style={{ background: color }} />
      {label}
    </span>
  )
}

// ── Panels ───────────────────────────────────────────────────────────────────

function LevelPanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    return data.map((d, i) => ({ date: d.date, level: d.value, ma3: ma3[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Claimant Count"
      subtitle="BCJD — thousands, SA"
      legend={<>
        <Leg color="#60a5fa" label="Claimant count (000s)" />
        <Leg color="#f97316" label="3-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={58}
            tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'ma3' ? '3-mo MA' : 'Claimant count',
            ] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma3" name="ma3" stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function RatePanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, rate: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Claimant Count Rate"
      subtitle="BCJE — % of workforce, SA"
      legend={<Leg color="#e2e8f0" label="Claimant count rate" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(1)}%` : '-', 'Rate'] as [string, string]} />
          <Line type="monotone" dataKey="rate" name="rate" stroke="#e2e8f0" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function MonthlyChangePanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma6 = computeMA(diff, 6)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma6: ma6[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Claimant Count — Monthly Change"
      subtitle="BCJD — month-over-month change, thousands"
      legend={<>
        <Leg color="rgba(239,68,68,0.75)" label="Increase" kind="swatch" />
        <Leg color="rgba(74,222,128,0.75)" label="Decrease" kind="swatch" />
        <Leg color="#60a5fa" label="6-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={54} tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtKSigned(v) : '-',
              name === 'ma6' ? '6-mo MA' : 'MoM change',
            ] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Bar dataKey="chg" name="chg" isAnimationActive={false} legendType="none" maxBarSize={16}>
            {rows.map((r, idx) => (
              <Cell key={`chg-${idx}`}
                fill={(r.chg ?? 0) >= 0 ? 'rgba(239,68,68,0.75)' : 'rgba(74,222,128,0.75)'} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="ma6" name="ma6" stroke="#60a5fa" strokeWidth={1.5}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function YoYPanel({ data }: { data: WD[] }) {
  const rows = useMemo(
    () => computeChangePct(data, 12).map(d => ({ date: d.date, yoy: d.value })),
    [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Claimant Count — YoY %"
      subtitle="BCJD — 12-month % change"
      legend={<Leg color="#ec4899" label="YoY %" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'YoY'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#ec4899" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// Seasonal-by-year pivot: one line per calendar year (last 10), x = Jan..Dec.
// No brush — the x-axis is categorical months, not a time range.

type SeasonalRow = { month: string; [year: string]: string | number | null }

function buildSeasonal(data: WD[]): { rows: SeasonalRow[]; years: number[] } {
  if (!data.length) return { rows: [], years: [] }
  const lastYear = Number(data[data.length - 1].date.slice(0, 4))
  const years: number[] = []
  for (let y = lastYear - 9; y <= lastYear; y++) years.push(y)
  const byMonth = new Map(data.map(p => [p.date.slice(0, 7), p.value]))
  const rows = MONTHS.map((m, mi) => {
    const row: SeasonalRow = { month: m }
    for (const y of years) {
      row[String(y)] = byMonth.get(`${y}-${String(mi + 1).padStart(2, '0')}`) ?? null
    }
    return row
  })
  return { rows, years }
}

function seasonalStyle(year: number, lastYear: number): { color: string; width: number; opacity: number } {
  if (year === lastYear) return { color: '#ef4444', width: 2.5, opacity: 1 }
  if (year === lastYear - 1) return { color: '#f97316', width: 1.8, opacity: 0.95 }
  return { color: '#64748b', width: 1, opacity: 0.55 }
}

function SeasonalPanel({ data }: { data: WD[] }) {
  const { rows, years } = useMemo(() => buildSeasonal(data), [data])
  const lastYear = years.length ? years[years.length - 1] : 0

  return (
    <Panel
      title="Seasonal Pattern by Year"
      subtitle="BCJD — monthly level by calendar year, last 10 years, thousands"
      legend={years.map(y => {
        const s = seasonalStyle(y, lastYear)
        return <Leg key={y} color={s.color} label={String(y)} />
      })}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={58}
            tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            labelFormatter={(v: unknown) => typeof v === 'string' ? v : ''}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${fmtK(v)}k` : '-', String(name)] as [string, string]} />
          {years.map(y => {
            const s = seasonalStyle(y, lastYear)
            return (
              <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                stroke={s.color} strokeWidth={s.width} strokeOpacity={s.opacity}
                dot={false} isAnimationActive={false} legendType="none" />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKClaimantContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all(SERIES_LIST.map(s =>
      fetchOnsSeries(s.cdid, s.dataset)
        .then(d => [s.cdid, d] as [string, WD[]])
        .catch(() => [s.cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading ONS claimant count series...</div>

  const bcjd = allData['BCJD'] ?? []
  const bcje = allData['BCJE'] ?? []

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ONS/DWP claimant count &mdash; people claiming unemployment-related benefits; affected by Universal Credit policy changes
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LevelPanel data={bcjd} />
        <RatePanel data={bcje} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MonthlyChangePanel data={bcjd} />
        <YoYPanel data={bcjd} />
      </div>

      <SeasonalPanel data={bcjd} />
    </>
  )
}
