import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type NV, computeMA,
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan LFS dashboard — Labour Force Survey headline aggregates (mirrors the
// US CPS / CA LFS pages). CRITICAL vs Canada/US: the LFS detail series on the
// e-Stat API are NSA (0002060001); the seasonally adjusted headline
// unemployment rate comes from the Cabinet Office composite-indicator table
// (3060) as JP_UNRATE_SA — that SA line is the number markets quote. Employed
// persons publish in TEN-THOUSANDS (6890 = 68.90M).

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = [
  'UNRATE_JP',      // unemployment rate, NSA, LFS, 2000→
  'JP_UNRATE_SA',   // unemployment rate, SA, Cabinet Office composite table, 1975→
  'JP_PART_RATE',   // participation rate, NSA, %
  'JP_EMP_RATE',    // employment rate, NSA, %
  'JP_EMPLOYED',    // employed persons, ten-thousands, 1985→
  'JP_UR_15_24', 'JP_UR_25_34', 'JP_UR_35_44', 'JP_UR_45_54', 'JP_UR_55_64', // by age, NSA, 1968→
] as const

// Employed persons publish in ten-thousands: 6890 = 68.90M.
const fmtEmpTick = (v: number): string => `${(v / 100).toFixed(1)}M`
const fmtEmpTip = (v: number): string => `${(v / 100).toFixed(2)}M`

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

function Leg({ color, label }: { color: string; label: string }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kit.legendLine} style={{ background: color }} />
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

function UnemploymentRatePanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    sa: allData['JP_UNRATE_SA'] ?? [],
    nsa: allData['UNRATE_JP'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const labels: Record<string, string> = { sa: 'U-rate (SA — headline)', nsa: 'U-rate (NSA, LFS)' }

  return (
    <Panel
      title="Unemployment Rate — SA vs NSA"
      subtitle="The SA line is Japan's headline number — sourced from the Cabinet Office composite-indicator table (3060), 1975→. The NSA line is the raw LFS API series (2000→) and carries seasonal patterns."
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.unemployment_nsa} />}
      legend={<>
        <Leg color="#e2e8f0" label="SA (headline, composite table)" />
        <Leg color="#64748B" label="NSA (LFS)" />
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
          <Line type="monotone" dataKey="sa" name="sa" stroke="#e2e8f0" strokeWidth={2.2}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="nsa" name="nsa" stroke="#64748B" strokeWidth={1.2}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function PartEmpRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    part: allData['JP_PART_RATE'] ?? [],
    emp: allData['JP_EMP_RATE'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Participation & Employment Rates"
      subtitle="LFS, NSA percent — seasonal swings are real; compare like calendar months"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.unemployment_nsa} />}
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

function EmployedLevelPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(() => {
    const nv: NV[] = data.map(d => ({ date: d.date, value: d.value }))
    const ma12 = computeMA(nv, 12)
    return data.map((d, i) => ({
      date: d.date, level: d.value, ma12: ma12[i]?.value ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Employed Persons"
      subtitle="LFS household-survey level, NSA — published in ten-thousands (6,890 = 68.90M); 12-mo MA strips the seasonal cycle"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.lfs_payrolls_jp} />}
      legend={<>
        <Leg color="#4ade80" label="Employed persons" />
        <Leg color="#60a5fa" label="12-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtEmpTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtEmpTip(v) : '-',
              name === 'ma12' ? '12-mo MA' : 'Employed persons',
            ] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma12" name="ma12" stroke="#60a5fa" strokeWidth={1.5}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

const AGE_LINES = [
  { key: 'a1524', code: 'JP_UR_15_24', label: '15–24', color: '#f59e0b' },
  { key: 'a2534', code: 'JP_UR_25_34', label: '25–34', color: '#60a5fa' },
  { key: 'a3544', code: 'JP_UR_35_44', label: '35–44', color: '#4ade80' },
  { key: 'a4554', code: 'JP_UR_45_54', label: '45–54', color: '#a78bfa' },
  { key: 'a5564', code: 'JP_UR_55_64', label: '55–64', color: '#f472b6' },
] as const

function AgeRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate(
    Object.fromEntries(AGE_LINES.map(l => [l.key, allData[l.code] ?? []]))
  ), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const labels: Record<string, string> = Object.fromEntries(AGE_LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Unemployment Rate by Age"
      subtitle="LFS, NSA, 1968→ — click legend items to toggle age bands"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.unemployment_nsa} />}
      legend={AGE_LINES.map(l => (
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
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          {AGE_LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={1.6} hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPLFSContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} e-Stat LFS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau of Japan, Labour Force Survey (e-Stat 0002060001) &mdash; monthly, NSA on the API;
        SA headline u-rate from the Cabinet Office composite-indicator table (3060). Employed persons in ten-thousands.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <UnemploymentRatePanel allData={allData} />
        <PartEmpRatesPanel allData={allData} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <EmployedLevelPanel data={allData['JP_EMPLOYED'] ?? []} />
        <AgeRatesPanel allData={allData} />
      </div>
    </>
  )
}
