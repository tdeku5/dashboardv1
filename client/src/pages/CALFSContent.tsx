import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeMA,
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Canada LFS dashboard — Labour Force Survey headline aggregates (mirrors the
// US CPS page), StatCan table 14-10-0287, monthly SA from 1976. Unlike the UK
// LFS these are TRUE single-month survey estimates — no rolling-3-month
// caveat, so headline panels carry no proxy badge. R1–R8 supplementary rates
// are deferred (no U1–U6-style panels here).

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = [
  'UNRATE_CA', 'CA_UNEMPLOYMENT', 'CA_EMPLOYMENT', 'CA_EMP_FT', 'CA_EMP_PT',
  'CA_LABOUR_FORCE', 'CA_PART_RATE', 'CA_EMP_RATE',
  'CA_UR_15_24', 'CA_UR_25_54', 'CA_UR_55PLUS',
] as const

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

function UnemploymentRatePanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const ma3 = computeMA(data, 3)
    const ma6 = computeMA(data, 6)
    return data.map((d, i) => ({
      date: d.date, level: d.value,
      ma3: ma3[i]?.value ?? null, ma6: ma6[i]?.value ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)
  const labels: Record<string, string> = { level: 'U-rate', ma3: '3-mo MA', ma6: '6-mo MA' }

  return (
    <Panel
      title="Unemployment Rate"
      subtitle="v2062815 — aged 15+, SA, %"
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
  { key: 'y1524', code: 'CA_UR_15_24', label: '15–24', color: '#f59e0b' },
  { key: 'y2554', code: 'CA_UR_25_54', label: '25–54', color: '#60a5fa' },
  { key: 'y55', code: 'CA_UR_55PLUS', label: '55+', color: '#4ade80' },
] as const

function AgeRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate(
    Object.fromEntries(AGE_LINES.map(l => [l.key, allData[l.code] ?? []]))
  ), [allData])
  const { brush, onBrush } = useBrush(rows.length, 120)
  const labels: Record<string, string> = Object.fromEntries(AGE_LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Unemployment Rate by Age"
      subtitle="15–24 / 25–54 / 55+ — SA, %"
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

function PartEmpRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    part: allData['CA_PART_RATE'] ?? [],
    emp: allData['CA_EMP_RATE'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Participation & Employment Rates"
      subtitle="v2062816 (left) / v2062817 (right) — aged 15+, SA, %"
      legend={<>
        <Leg color="#60a5fa" label="Participation rate (L)" />
        <Leg color="#4ade80" label="Employment rate (R)" />
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
              name === 'part' ? 'Participation rate' : 'Employment rate',
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="part" name="part" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="emp" name="emp" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function EmploymentChangePanel({ data }: { data: StatcanPoint[] }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma6 = computeMA(diff, 6)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma6: ma6[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Employment — Monthly Change"
      subtitle="v2062811 MoM change, thousands — the market-moving monthly LFS print"
      legend={<>
        <Leg color="rgba(74,222,128,0.75)" label="Jobs added" kind="swatch" />
        <Leg color="rgba(239,68,68,0.75)" label="Jobs lost" kind="swatch" />
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

function FtPtPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    ft: allData['CA_EMP_FT'] ?? [],
    pt: allData['CA_EMP_PT'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Full-time vs Part-time Employment"
      subtitle="v2062812 (left) / v2062813 (right) — thousands, SA"
      legend={<>
        <Leg color="#4ade80" label="Full-time (L)" />
        <Leg color="#a78bfa" label="Part-time (R)" />
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
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'ft' ? 'Full-time' : 'Part-time',
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="ft" name="ft" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="pt" name="pt" stroke="#a78bfa" strokeWidth={1.8}
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
    lf: allData['CA_LABOUR_FORCE'] ?? [],
    unem: allData['CA_UNEMPLOYMENT'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Labour Force & Unemployment Levels"
      subtitle="v2062810 (left) / v2062814 (right) — thousands, SA"
      legend={<>
        <Leg color="#60a5fa" label="Labour force (L)" />
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
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'lf' ? 'Labour force' : 'Unemployed',
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="lf" name="lf" stroke="#60a5fa" strokeWidth={1.8}
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

// ══════════════════════════════════════════════════════════════════════════════

export function CALFSContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan LFS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada Labour Force Survey (14-10-0287) &mdash; monthly, seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <UnemploymentRatePanel data={allData['UNRATE_CA'] ?? []} />
        <AgeRatesPanel allData={allData} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <PartEmpRatesPanel allData={allData} />
        <EmploymentChangePanel data={allData['CA_EMPLOYMENT'] ?? []} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <FtPtPanel allData={allData} />
        <LabourForcePanel allData={allData} />
      </div>
    </>
  )
}
