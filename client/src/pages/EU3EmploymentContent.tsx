import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, breakDates, type EurostatPoint } from '../lib/eurostat'
import {
  type NV, computeChangePct, computeMA,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Employment dashboard — the payrolls-proxy tab (decision d) for
// DE / FR / IT. There is no European NFP: the closest analog is the
// national-accounts employees series (Eurostat namq_10_a10_e, SAL_DC) —
// quarterly, domestic concept, thousand persons. Shown against total
// employment (EMP_DC; the wedge is self-employment) and hours worked.
// Every employees/employment panel carries eu3Caveat('employment_proxy', cc)
// — the registry override covers France's SA-only adjustment (DE/IT are SCA).

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  return {
    employees: `${cc}_EMPLOYEES`,     // SAL_DC — employees, thousand persons, THE payrolls analog
    employment: `${cc}_EMPLOYMENT`,   // EMP_DC — total employment incl. self-employed
    hours: `${cc}_HOURS`,             // thousand hours worked per quarter
  }
}

// Per-country source notes: adjustment + history start (FR is SA-only — no
// calendar adjustment — where Germany/Italy are SCA).
const SRC_NOTE: Record<Eu3Country, string> = {
  DE: 'seasonally & calendar adjusted (SCA) · history from 1991',
  FR: 'seasonally adjusted only — no calendar adjustment · history from 1980',
  IT: 'seasonally & calendar adjusted (SCA) · history from 1995',
}

const BREAK_CAPTION = 'vertical dashes mark Eurostat break-in-series flags'

// Levels publish in thousand persons — display in millions.
const fmtMTick = (v: number): string => `${(v / 1000).toFixed(1)}M`
const fmtMTip = (v: number): string => `${(v / 1000).toFixed(2)}M`
const fmtKTick = (v: number): string => `${v.toFixed(0)}k`
const fmtKSigned = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)}k`
// Hours publish in thousand hours per quarter — display in billions.
const fmtHrsTick = (v: number): string => `${(v / 1e6).toFixed(1)}B`
const fmtHrsTip = (v: number): string => `${(v / 1e6).toFixed(2)}B hrs`
const fmtPct1 = (v: number): string => `${v.toFixed(1)}%`
const fmtPctSigned = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

// ── Quarterly axis/tooltip formatters ────────────────────────────────────────

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
}

// ── Local panel helpers (duplicated per-file per house convention) ───────────

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

function Panel({ title, subtitle, badge, legend, children }: {
  title: string
  subtitle?: string
  badge?: ReactNode
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
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

/** Vertical dashed markers at Eurostat break-in-series dates (obs_flag 'b'). */
function BreakLines({ dates }: { dates: readonly string[] }) {
  return (
    <>
      {dates.map(d => (
        <ReferenceLine key={`brk-${d}`} x={d}
          stroke="rgba(251,191,36,0.45)" strokeDasharray="4 3" strokeWidth={1}
          label={{ value: 'series break', position: 'insideTop', fill: '#94A3B8', fontSize: 9 }} />
      ))}
    </>
  )
}

/** Date-union merge of several {date,value} series into keyed rows. */
function mergeByDate(series: Record<string, ReadonlyArray<{ date: string; value: number | null }>>) {
  const dates = new Set<string>()
  for (const arr of Object.values(series)) for (const p of arr) dates.add(p.date)
  const maps = Object.entries(series).map(([k, arr]) =>
    [k, new Map(arr.map(p => [p.date, p.value]))] as const)
  return [...dates].sort().map(date => {
    const row: Record<string, string | number | null> = { date }
    for (const [k, m] of maps) row[k] = m.get(date) ?? null
    return row
  })
}

// ── Panels ───────────────────────────────────────────────────────────────────

function EmployeesLevelPanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const breaks = useMemo(() => breakDates(data), [data])
  const { brush, onBrush } = useBrush(rows.length, 100)

  return (
    <Panel
      title="Employees — Level"
      subtitle={`National-accounts employees (SAL_DC), quarterly, ${SRC_NOTE[cc]}${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('employment_proxy', cc)} />}
      legend={<Leg color="#60a5fa" label="Employees (millions)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtMTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtMTip(v) : '-', 'Employees'] as [string, string]} />
          <BreakLines dates={breaks} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function EmployeesQoQPanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma4 = computeMA(diff, 4)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma4: ma4[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 100)

  return (
    <Panel
      title="Employees — QoQ Change"
      subtitle={`Quarter-over-quarter change in thousand persons (terminal-computed from the SAL_DC level) — the closest thing to a payrolls print, at quarterly cadence`}
      badge={<ProxyBadge caveat={eu3Caveat('employment_proxy', cc)} />}
      legend={<>
        <Leg color="rgba(74,222,128,0.75)" label="Increase" kind="swatch" />
        <Leg color="rgba(239,68,68,0.75)" label="Decrease" kind="swatch" />
        <Leg color="#60a5fa" label="4-qtr MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={54} tickFormatter={fmtKTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtKSigned(v) : '-',
              name === 'ma4' ? '4-qtr MA' : 'QoQ change',
            ] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Bar dataKey="chg" name="chg" isAnimationActive={false} legendType="none" maxBarSize={16}>
            {rows.map((r, idx) => (
              <Cell key={`chg-${idx}`}
                fill={(r.chg ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="ma4" name="ma4" stroke="#60a5fa" strokeWidth={1.5}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function EmployeesVsEmploymentPanel({ allData, cc }: { allData: AllData; cc: Eu3Country }) {
  const codes = codesFor(cc)
  const employees = allData[codes.employees] ?? []
  const employment = allData[codes.employment] ?? []
  const rows = useMemo(() => mergeByDate({ employees, employment }), [employees, employment])
  const breaks = useMemo(
    () => [...new Set([...breakDates(employees), ...breakDates(employment)])].sort(),
    [employees, employment]
  )
  const { brush, onBrush } = useBrush(rows.length, 100)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const LINES = [
    { key: 'employment', label: 'Total employment (EMP_DC)', color: '#4ade80' },
    { key: 'employees', label: 'Employees (SAL_DC)', color: '#60a5fa' },
  ] as const
  const labels: Record<string, string> = Object.fromEntries(LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Employees vs Total Employment"
      subtitle={`The wedge between the lines is self-employment — quarterly, ${SRC_NOTE[cc]} — click legend to toggle${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('employment_proxy', cc)} />}
      legend={LINES.map(l => (
        <span key={l.key} className={kit.legendItem}
          style={{ cursor: 'pointer', opacity: hidden.has(l.key) ? 0.35 : 1 }}
          onClick={() => toggle(l.key)}>
          <span className={kit.legendLine} style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtMTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtMTip(v) : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <BreakLines dates={breaks} />
          {LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={1.8} hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HoursLevelPanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 100)

  return (
    <Panel
      title="Hours Worked — Level"
      subtitle={`Total hours worked per quarter (published in thousands, shown in billions), ${SRC_NOTE[cc]}`}
      legend={<Leg color="#a78bfa" label="Hours worked (bn/quarter)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtHrsTick} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtHrsTip(v) : '-', 'Hours worked'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#a78bfa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HoursYoYPanel({ data }: { data: EurostatPoint[] }) {
  const rows = useMemo(() =>
    computeChangePct(data, 4).map(d => ({ date: d.date, yoy: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 100)

  return (
    <Panel
      title="Hours Worked — YoY %"
      subtitle="Year-over-year % (terminal-computed, 4-quarter lag on the quarterly level)"
      legend={<Leg color="#f59e0b" label="Hours worked YoY %" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPct1} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctSigned(v) : '-', 'YoY %'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3EmploymentContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [codes.employees, codes.employment, codes.hours], [codes])

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
      setError(e instanceof Error ? e.message : 'Failed to load employment data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} employment series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat national accounts (namq_10_a10_e) &mdash; quarterly, {EU3_COUNTRY_LABEL[cc]}: {SRC_NOTE[cc]}.
        No European NFP exists &mdash; employees (SAL_DC) is the payrolls analog, at quarterly cadence.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <EmployeesLevelPanel data={allData[codes.employees] ?? []} cc={cc} />
        <EmployeesQoQPanel data={allData[codes.employees] ?? []} cc={cc} />
      </div>

      <EmployeesVsEmploymentPanel allData={allData} cc={cc} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <HoursLevelPanel data={allData[codes.hours] ?? []} cc={cc} />
        <HoursYoYPanel data={allData[codes.hours] ?? []} />
      </div>
    </>
  )
}
