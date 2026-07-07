import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada EI dashboard — the closest Canadian analogue to US jobless claims.
// StatCan table 14-10-0011 (v64549353): monthly SA stock of regular-benefit
// recipients (from 1997), not weekly claim flows, published with a ~2-month
// lag — so every panel carries the ei_beneficiaries proxy badge.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = ['CA_EI_BENEFICIARIES'] as const

const fmtN = (v: number): string => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const fmtNSigned = (v: number): string => `${v >= 0 ? '+' : ''}${fmtN(v)}`

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
            <ProxyBadge caveat={CA_PROXY_CAVEATS.ei_beneficiaries} />
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

function LevelPanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    return data.map((d, i) => ({ date: d.date, level: d.value, ma3: ma3[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="EI Regular Beneficiaries"
      subtitle="v64549353 — beneficiaries, SA"
      legend={<>
        <Leg color="#60a5fa" label="Beneficiaries" />
        <Leg color="#f97316" label="3-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={62}
            tickFormatter={fmtN} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtN(v) : '-',
              name === 'ma3' ? '3-mo MA' : 'Beneficiaries',
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

function MonthlyChangePanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma6 = computeMA(diff, 6)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma6: ma6[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="EI Beneficiaries — Monthly Change"
      subtitle="v64549353 — month-over-month change (rising beneficiary counts = labour-market deterioration)"
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
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={62} tickFormatter={fmtN} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtNSigned(v) : '-',
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

function YoYPanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(
    () => computeChangePct(data, 12).map(d => ({ date: d.date, yoy: d.value })),
    [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="EI Beneficiaries — YoY %"
      subtitle="v64549353 — 12-month % change"
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

function buildSeasonal(data: StatcanPoint[]): { rows: SeasonalRow[]; years: number[] } {
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

function SeasonalPanel({ data }: { data: StatcanPoint[] }) {
  const { rows, years } = useMemo(() => buildSeasonal(data), [data])
  const lastYear = years.length ? years[years.length - 1] : 0

  return (
    <Panel
      title="Seasonal Pattern by Year"
      subtitle="v64549353 — monthly beneficiary level by calendar year, last 10 years"
      legend={years.map(y => {
        const s = seasonalStyle(y, lastYear)
        return <Leg key={y} color={s.color} label={String(y)} />
      })}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="month" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={62}
            tickFormatter={fmtN} />
          <Tooltip {...TOOLTIP_STYLE}
            labelFormatter={(v: unknown) => typeof v === 'string' ? v : ''}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtN(v) : '-', String(name)] as [string, string]} />
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

export function CAEIContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading StatCan EI beneficiaries series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const ei = allData['CA_EI_BENEFICIARIES'] ?? []

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada Employment Insurance (14-10-0011) &mdash; monthly stock of regular-benefit recipients &mdash; not weekly claim flows; ~2-month publication lag
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LevelPanel data={ei} />
        <MonthlyChangePanel data={ei} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <YoYPanel data={ei} />
        <SeasonalPanel data={ei} />
      </div>
    </>
  )
}
