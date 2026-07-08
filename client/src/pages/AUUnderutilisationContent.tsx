import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type NV, computeMA,
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia Underutilisation dashboard — the slack measures that make the
// Australian labour release distinctive: underemployment (employed but wanting
// more hours) and underutilisation (unemployment + underemployment — the RBA's
// preferred broad slack read), plus youth unemployment (persistently 2–3× the
// headline rate). ABS Labour Force Survey, monthly, 1978→. THE (b) DECISION
// applies: ABS explicitly recommends TREND over SA for the headline rates
// (±0.2pp SA standard error), so every rate panel renders the trend line
// thick with SA thin/muted alongside.

type AllData = Record<string, AbsPoint[]>

const ALL_CODES = [
  'AU_UNDERUTIL_RATE_TREND', 'AU_UNDERUTIL_RATE',  // underutilisation rate, %, 1978→
  'AU_UNDEREMP_RATE_TREND', 'AU_UNDEREMP_RATE',    // underemployment rate, %, 1978→
  'AU_UNDEREMPLOYED',                              // underemployed persons, thousands, SA
  'AU_UR_YOUTH_TREND', 'AU_UR_YOUTH',              // unemployment rate 15–24, %, 1978→
] as const

// Levels publish in thousands: 163.9 = 163.9k persons.
const fmtLevelTick = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)}M` : `${Math.round(v)}k`
const fmtLevelTip = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(3)}M` : `${v.toFixed(1)}k`

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

function useToggles() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  return { hidden, toggle }
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

function LegT({ color, label, hidden, onClick }: {
  color: string
  label: string
  hidden: boolean
  onClick: () => void
}) {
  return (
    <span className={kit.legendItem}
      style={{ cursor: 'pointer', opacity: hidden ? 0.35 : 1 }}
      onClick={onClick}>
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

const SLACK_LINES = [
  { key: 'util_t', code: 'AU_UNDERUTIL_RATE_TREND', label: 'Underutilisation (trend)', color: '#e2e8f0', width: 2.2, dash: undefined },
  { key: 'util_sa', code: 'AU_UNDERUTIL_RATE', label: 'Underutilisation (SA)', color: '#64748B', width: 1.2, dash: undefined },
  { key: 'uemp_t', code: 'AU_UNDEREMP_RATE_TREND', label: 'Underemployment (trend)', color: '#60a5fa', width: 2.2, dash: undefined },
  { key: 'uemp_sa', code: 'AU_UNDEREMP_RATE', label: 'Underemployment (SA)', color: '#3b5b82', width: 1.2, dash: '4 3' },
] as const

function SlackRatesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate(
    Object.fromEntries(SLACK_LINES.map(l => [l.key, allData[l.code] ?? []]))
  ), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = Object.fromEntries(SLACK_LINES.map(l => [l.key, l.label]))

  return (
    <Panel
      title="Underutilisation & Underemployment Rates — Trend vs SA"
      subtitle="Underutilisation = unemployment + underemployment (the RBA's preferred broad slack read); underemployed = employed but wanting more hours. Trend thick per ABS guidance (±0.2pp SA standard error), SA thin. Click legend items to toggle."
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.trend_vs_sa} />}
      legend={SLACK_LINES.map(l => (
        <LegT key={l.key} color={l.color} label={l.label}
          hidden={hidden.has(l.key)} onClick={() => toggle(l.key)} />
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
          {SLACK_LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.key}
              stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash}
              hide={hidden.has(l.key)}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
          ))}
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function UnderemployedLevelPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => {
    const nv: NV[] = data.map(d => ({ date: d.date, value: d.value }))
    const ma12 = computeMA(nv, 12)
    return data.map((d, i) => ({
      date: d.date, level: d.value, ma12: ma12[i]?.value ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = { level: 'Underemployed (SA)', ma12: '12-mo MA' }

  return (
    <Panel
      title="Underemployed Persons"
      subtitle="Employed persons who want and are available for more hours — thousands, SA, 1978→"
      legend={<>
        <LegT color="#f59e0b" label="Underemployed (SA)" hidden={hidden.has('level')} onClick={() => toggle('level')} />
        <LegT color="#60a5fa" label="12-mo MA" hidden={hidden.has('ma12')} onClick={() => toggle('ma12')} />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtLevelTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtLevelTip(v) : '-', labels[String(name)] ?? String(name)] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#f59e0b" strokeWidth={1.6}
            hide={hidden.has('level')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="ma12" name="ma12" stroke="#60a5fa" strokeWidth={1.5}
            hide={hidden.has('ma12')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function YouthUnemploymentPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    trend: allData['AU_UR_YOUTH_TREND'] ?? [],
    sa: allData['AU_UR_YOUTH'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = {
    trend: 'Youth U-rate (trend)', sa: 'Youth U-rate (SA)',
  }

  return (
    <Panel
      title="Youth Unemployment Rate (15–24) — Trend vs SA"
      subtitle="~10.4% latest, persistently 2–3× the headline rate — trend thick per ABS guidance, SA thin"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.trend_vs_sa} />}
      legend={<>
        <LegT color="#e2e8f0" label="Trend (ABS-recommended)" hidden={hidden.has('trend')} onClick={() => toggle('trend')} />
        <LegT color="#64748B" label="Seasonally adjusted" hidden={hidden.has('sa')} onClick={() => toggle('sa')} />
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
          <Line type="monotone" dataKey="sa" name="sa" stroke="#64748B" strokeWidth={1.2}
            hide={hidden.has('sa')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="trend" name="trend" stroke="#e2e8f0" strokeWidth={2.2}
            hide={hidden.has('trend')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUUnderutilisationContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ABS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS underutilisation series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Labour Force Survey &mdash; monthly, 1978&rarr;. underutilisation = unemployment +
        underemployment &mdash; the RBA&rsquo;s preferred broad slack read. Trend (thick) is the
        ABS-recommended headline; SA (thin, muted) carries a &plusmn;0.2pp standard error.
      </div>

      <SlackRatesPanel allData={allData} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <UnderemployedLevelPanel data={allData['AU_UNDEREMPLOYED'] ?? []} />
        <YouthUnemploymentPanel allData={allData} />
      </div>
    </>
  )
}
