import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, breakDates, type EurostatPoint } from '../lib/eurostat'
import {
  type NV, computeMA,
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Unemployment dashboard — one parameterized page serving DE / FR / IT.
// Headline u-rate is the ECB LFSI harmonized monthly SA series (UNRATE_{CC});
// youth (under-25) rate and unemployment level come from Eurostat une_rt_m /
// une_nb_m equivalents (monthly SA). All three are DIRECT harmonized series —
// no proxy badges — but the Eurostat detail series carry break-in-series
// flags (obs_flag 'b') which render as vertical dashed markers, derived at
// runtime via breakDates(), never hardcoded.

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  return {
    headline: `UNRATE_${cc}`,       // ECB LFSI, monthly SA headline
    youth: `${cc}_UR_YOUTH`,        // Eurostat, under-25 u-rate, SA
    level: `${cc}_UNEMP_LEVEL`,     // Eurostat, unemployed persons, thousands, SA
  }
}

const BREAK_CAPTION = 'vertical dashes mark Eurostat break-in-series flags'

// Levels publish in thousands of persons — display in millions.
const fmtMTick = (v: number): string => `${(v / 1000).toFixed(1)}M`
const fmtMTip = (v: number): string => `${(v / 1000).toFixed(2)}M`

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

function Leg({ color, label }: { color: string; label: string }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kit.legendLine} style={{ background: color }} />
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

function HeadlinePanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, rate: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title={`${EU3_COUNTRY_LABEL[cc]} Unemployment Rate`}
      subtitle="ECB LFSI harmonized headline — monthly, SA, full history"
      legend={<Leg color="#e2e8f0" label="Unemployment rate (SA)" />}
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
              [typeof v === 'number' ? `${v.toFixed(1)}%` : '-', 'U-rate (SA)'] as [string, string]} />
          <Line type="monotone" dataKey="rate" name="rate" stroke="#e2e8f0" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HeadlineVsYouthPanel({ allData, cc }: { allData: AllData; cc: Eu3Country }) {
  const codes = codesFor(cc)
  const youth = allData[codes.youth] ?? []
  const rows = useMemo(() => mergeByDate({
    head: allData[codes.headline] ?? [],
    youth,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allData, cc])
  const breaks = useMemo(() => breakDates(youth), [youth])
  const { brush, onBrush } = useBrush(rows.length, 300)
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
    { key: 'head', label: 'Headline u-rate (SA)', color: '#e2e8f0' },
    { key: 'youth', label: 'Youth u-rate, under-25 (SA)', color: '#f59e0b' },
  ] as const
  const labels: Record<string, string> = Object.fromEntries(LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Headline vs Youth Unemployment"
      subtitle={`Under-25 rate runs 2–3× headline — click legend to toggle${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
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
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(1)}%` : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <BreakLines dates={breaks} />
          {LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={1.8} hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function LevelPanel({ data }: { data: EurostatPoint[] }) {
  const rows = useMemo(() => {
    const nv: NV[] = data.map(d => ({ date: d.date, value: d.value }))
    const ma12 = computeMA(nv, 12)
    return data.map((d, i) => ({ date: d.date, level: d.value, ma12: ma12[i]?.value ?? null }))
  }, [data])
  const breaks = useMemo(() => breakDates(data), [data])
  const { brush, onBrush } = useBrush(rows.length, 300)

  return (
    <Panel
      title="Unemployment Level"
      subtitle={`Unemployed persons, SA (published in thousands, shown in millions) with 12-mo MA${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      legend={<>
        <Leg color="#60a5fa" label="Unemployed persons" />
        <Leg color="#f97316" label="12-mo MA" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtMTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtMTip(v) : '-',
              name === 'ma12' ? '12-mo MA' : 'Unemployed persons',
            ] as [string, string]} />
          <BreakLines dates={breaks} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma12" name="ma12" stroke="#f97316" strokeWidth={1.5} strokeDasharray="5 3"
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3UnemploymentContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [codes.headline, codes.youth, codes.level], [codes])

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
      setError(e instanceof Error ? e.message : 'Failed to load unemployment data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} unemployment series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Headline: ECB LFSI harmonized unemployment rate (monthly, SA). Youth (under-25) rate and
        unemployment level: Eurostat (monthly, SA, level in thousand persons). All DIRECT harmonized
        series &mdash; no proxies.
      </div>

      <HeadlinePanel data={allData[codes.headline] ?? []} cc={cc} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <HeadlineVsYouthPanel allData={allData} cc={cc} />
        <LevelPanel data={allData[codes.level] ?? []} />
      </div>
    </>
  )
}
