import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Bar, Cell, Brush,
  XAxis, YAxis, ZAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeMA,
  fmtAxisDate, fmtFullDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Canada Job Vacancies dashboard — the Canadian analogue of JOLTS openings.
// StatCan table 14-10-0432 publishes vacancies AND a vacancy rate directly
// (monthly SA, from 2015; the predecessor table was retired) so both are
// DIRECT series, no proxy badges. No Canadian hires/quits/layoffs flows exist
// — those JOLTS panels are deliberately absent.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = ['CA_JOBVAC', 'CA_JOBVAC_RATE', 'UNRATE_CA', 'CA_UNEMPLOYMENT'] as const

const fmtK = (v: number): string => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const fmtKSigned = (v: number): string => `${v >= 0 ? '+' : ''}${v.toLocaleString('en-CA', { maximumFractionDigits: 1 })}k`

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
          <div className={kit.sectionTitle}>{title}</div>
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

function VacanciesLevelPanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    return data.map((d, i) => ({ date: d.date, level: d.value, ma3: ma3[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Job Vacancies"
      subtitle="v1481212145 — thousands, SA; history begins 2015 (the predecessor table was retired)"
      legend={<>
        <Leg color="#60a5fa" label="Vacancies (000s)" />
        <Leg color="#f97316" label="3-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'ma3' ? '3-mo MA' : 'Vacancies',
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

function VacanciesChangePanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma6 = computeMA(diff, 6)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma6: ma6[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Vacancies — Monthly Change"
      subtitle="v1481212145 — month-over-month change, thousands; history begins 2015 (the predecessor table was retired)"
      legend={<>
        <Leg color="rgba(74,222,128,0.75)" label="Increase" kind="swatch" />
        <Leg color="rgba(239,68,68,0.75)" label="Decrease" kind="swatch" />
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
                fill={(r.chg ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
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

function VacancyRatePanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, rate: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Job Vacancy Rate"
      subtitle="v1481212147 — published rate, %, SA (vacancies as a share of labour demand)"
      legend={<Leg color="#4ade80" label="Vacancy rate" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', 'Vacancy rate'] as [string, string]} />
          <Line type="monotone" dataKey="rate" name="rate" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function VacanciesPerUnemployedPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const unemMap = new Map((allData['CA_UNEMPLOYMENT'] ?? []).map(p => [p.date, p.value]))
    return (allData['CA_JOBVAC'] ?? []).map(p => {
      const u = unemMap.get(p.date)
      return { date: p.date, ratio: u != null && u > 0 ? p.value / u : null }
    })
  }, [allData])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Vacancies per Unemployed Person"
      subtitle="CA_JOBVAC / CA_UNEMPLOYMENT (both thousands) — labour-market tightness (1.0 = one vacancy per unemployed)"
      legend={<>
        <Leg color="#f59e0b" label="Vacancies / unemployed" />
        <Leg color="rgba(255,255,255,0.35)" label="1.0 (balance)" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => v.toFixed(2)} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? v.toFixed(3) : '-', 'V / U'] as [string, string]} />
          <ReferenceLine y={1} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="5 3" />
          <Line type="monotone" dataKey="ratio" name="ratio" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ── Beveridge curve ──────────────────────────────────────────────────────────

type BevPoint = { x: number; y: number; z: number; date: string }

function BeveridgeTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: BevPoint }>
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div style={{
      background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2,
      fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 10px', color: '#CBD5E1',
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>{fmtFullDate(p.date)}</div>
      <div>U-rate: {p.x.toFixed(1)}%</div>
      <div>Vacancy rate: {p.y.toFixed(2)}%</div>
    </div>
  )
}

function BeveridgePanel({ allData }: { allData: AllData }) {
  const { byYear, years, latest } = useMemo(() => {
    const urateMap = new Map((allData['UNRATE_CA'] ?? []).map(p => [p.date, p.value]))
    const pts: BevPoint[] = []
    for (const vr of allData['CA_JOBVAC_RATE'] ?? []) {
      if (vr.date < '2015-01-01') continue
      const u = urateMap.get(vr.date)
      if (u == null) continue
      pts.push({ x: u, y: vr.value, z: 1, date: vr.date })
    }
    const byYear = new Map<number, BevPoint[]>()
    for (const p of pts) {
      const y = Number(p.date.slice(0, 4))
      const arr = byYear.get(y)
      if (arr) arr.push(p); else byYear.set(y, [p])
    }
    const years = [...byYear.keys()].sort((a, b) => a - b)
    const latest = pts.length ? { ...pts[pts.length - 1], z: 8 } : null
    return { byYear, years, latest }
  }, [allData])

  const yearColor = (i: number): string => `hsl(${(i * 47) % 360} 70% 60%)`

  return (
    <Panel
      title="Beveridge Curve"
      subtitle="x = unemployment rate (UNRATE_CA), y = job vacancy rate — monthly, 2015 onward; latest point in white"
      legend={<>
        {years.map((y, i) => <Leg key={y} color={yearColor(i)} label={String(y)} kind="swatch" />)}
        {latest && <Leg color="#ffffff" label="Latest" kind="swatch" />}
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" dataKey="x" name="U-rate" domain={['auto', 'auto']}
            tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtPctTick} />
          <YAxis type="number" dataKey="y" name="Vacancy rate" domain={['auto', 'auto']}
            tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <ZAxis type="number" dataKey="z" range={[28, 220]} domain={[1, 8]} />
          <Tooltip content={<BeveridgeTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
          {years.map((y, i) => (
            <Scatter key={y} name={String(y)} data={byYear.get(y) ?? []}
              fill={yearColor(i)} fillOpacity={0.7} isAnimationActive={false} />
          ))}
          {latest && (
            <Scatter name="Latest" data={[latest]} fill="#ffffff"
              stroke="#0b1118" strokeWidth={1} isAnimationActive={false} />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAVacanciesContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan vacancy series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada job vacancies (14-10-0432) &mdash; monthly, seasonally adjusted; history begins 2015 &mdash; the predecessor table was retired; no Canadian hires/quits/layoffs flows exist
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacanciesLevelPanel data={allData['CA_JOBVAC'] ?? []} />
        <VacanciesChangePanel data={allData['CA_JOBVAC'] ?? []} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacancyRatePanel data={allData['CA_JOBVAC_RATE'] ?? []} />
        <VacanciesPerUnemployedPanel allData={allData} />
      </div>

      <BeveridgePanel allData={allData} />
    </>
  )
}
