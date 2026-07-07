import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK LFS dashboard — Labour Force Survey headline aggregates (mirrors the US
// CPS page). All LFS series are rolling 3-month averages published monthly, so
// the headline panels carry the lfs_rolling proxy badge where the US analogue
// is a single-month CPS estimate.

type AllData = Record<string, WD[]>

const SERIES_LIST: ReadonlyArray<{ cdid: string; dataset: string }> = [
  { cdid: 'MGSX', dataset: 'lms' },  // unemployment rate 16+ SA %
  { cdid: 'MGSC', dataset: 'unem' }, // unemployment level, 000s
  { cdid: 'MGRZ', dataset: 'lms' },  // employment level, 000s
  { cdid: 'LF24', dataset: 'lms' },  // employment rate 16-64 %
  { cdid: 'LF2S', dataset: 'lms' },  // inactivity rate 16-64 %
  { cdid: 'MGWY', dataset: 'lms' },  // u-rate 16-24
  { cdid: 'MGXB', dataset: 'lms' },  // u-rate 25-49
  { cdid: 'YBVW', dataset: 'lms' },  // u-rate 50+
  { cdid: 'YBUS', dataset: 'lms' },  // total weekly hours, millions
  { cdid: 'BEAO', dataset: 'lms' },  // redundancies, 000s
  { cdid: 'MGSF', dataset: 'lms' },  // economically active 16+, 000s SA
]

const fmtK = (v: number): string => v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
const fmtM1 = (v: number): string => v.toLocaleString('en-GB', { maximumFractionDigits: 1 })

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

function UnemploymentRatePanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    const ma6 = computeMA(data, 6)
    return data.map((d, i) => ({
      date: d.date, level: d.value,
      ma3: ma3[i]?.value ?? null, ma6: ma6[i]?.value ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const labels: Record<string, string> = { level: 'U-rate', ma3: '3-mo MA', ma6: '6-mo MA' }

  return (
    <Panel
      title="Unemployment Rate"
      subtitle="MGSX — aged 16+, SA, %"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.lfs_rolling} />}
      legend={<>
        <Leg color="#e2e8f0" label="U-rate" />
        <Leg color="#60a5fa" label="3-mo MA" />
        <Leg color="#f97316" label="6-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#e2e8f0" strokeWidth={2}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma3" name="ma3" stroke="#60a5fa" strokeWidth={1.5}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma6" name="ma6" stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

const AGE_LINES = [
  { key: 'y1624', label: '16–24', color: '#f59e0b' },
  { key: 'y2549', label: '25–49', color: '#60a5fa' },
  { key: 'y50', label: '50+', color: '#4ade80' },
] as const

function AgeRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    y1624: allData['MGWY'] ?? [],
    y2549: allData['MGXB'] ?? [],
    y50: allData['YBVW'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const labels: Record<string, string> = Object.fromEntries(AGE_LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Unemployment Rate by Age"
      subtitle="MGWY / MGXB / YBVW — SA, %"
      legend={AGE_LINES.map(l => <Leg key={l.key} color={l.color} label={l.label} />)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          {AGE_LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={1.8}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function EmpInactPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    emp: allData['LF24'] ?? [],
    inact: allData['LF2S'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Employment & Inactivity Rates (16–64)"
      subtitle="LF24 (left) / LF2S (right) — SA, %"
      legend={<>
        <Leg color="#4ade80" label="Employment rate (L)" />
        <Leg color="#a78bfa" label="Inactivity rate (R)" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false}
            width={48} tickFormatter={fmtPctTick} />
          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={TICK}
            tickLine={false} axisLine={false} width={48} tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${v.toFixed(2)}%` : '-',
              name === 'emp' ? 'Employment rate' : 'Inactivity rate',
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="emp" name="emp" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="inact" name="inact" stroke="#a78bfa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function LabourForcePanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    emp: allData['MGRZ'] ?? [],
    active: allData['MGSF'] ?? [],
    unem: allData['MGSC'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const labels: Record<string, string> = {
    emp: 'Employment', active: 'Economically active', unem: 'Unemployed',
  }

  return (
    <Panel
      title="Labour Force Levels"
      subtitle="MGRZ / MGSF (left) / MGSC (right) — thousands, SA"
      legend={<>
        <Leg color="#4ade80" label="Employment (L)" />
        <Leg color="#60a5fa" label="Economically active (L)" />
        <Leg color="#ef4444" label="Unemployed (R)" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false}
            width={58} tickFormatter={fmtK} />
          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={TICK}
            tickLine={false} axisLine={false} width={54} tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${fmtK(v)}k` : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="emp" name="emp" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="left" type="monotone" dataKey="active" name="active" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="unem" name="unem" stroke="#ef4444" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HoursLevelPanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Total Weekly Hours Worked"
      subtitle="YBUS — millions of hours, SA"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.hours_worked} />}
      legend={<Leg color="#60a5fa" label="Total weekly hours (mn)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={58}
            tickFormatter={fmtM1} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${fmtM1(v)}mn hrs` : '-', 'Level'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HoursYoYPanel({ data }: { data: WD[] }) {
  const rows = useMemo(
    () => computeChangePct(data, 12).map(d => ({ date: d.date, yoy: d.value })),
    [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Total Weekly Hours Worked — YoY %"
      subtitle="YBUS — 12-month % change"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.hours_worked} />}
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

function RedundanciesPanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    return data.map((d, i) => ({ date: d.date, level: d.value, ma3: ma3[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Redundancies"
      subtitle="BEAO — thousands, SA"
      legend={<>
        <Leg color="rgba(239,68,68,0.6)" label="Redundancies (000s)" kind="swatch" />
        <Leg color="#e2e8f0" label="3-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'ma3' ? '3-mo MA' : 'Redundancies',
            ] as [string, string]} />
          <Bar dataKey="level" name="level" fill="rgba(239,68,68,0.55)"
            isAnimationActive={false} legendType="none" maxBarSize={16} />
          <Line type="monotone" dataKey="ma3" name="ma3" stroke="#e2e8f0" strokeWidth={1.5}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKLFSContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {SERIES_LIST.length} ONS LFS series...</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (Labour Force Survey) &mdash; rolling 3-month averages, seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <UnemploymentRatePanel data={allData['MGSX'] ?? []} />
        <AgeRatesPanel allData={allData} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <EmpInactPanel allData={allData} />
        <LabourForcePanel allData={allData} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <HoursLevelPanel data={allData['YBUS'] ?? []} />
        <HoursYoYPanel data={allData['YBUS'] ?? []} />
      </div>

      <RedundanciesPanel data={allData['BEAO'] ?? []} />
    </>
  )
}
