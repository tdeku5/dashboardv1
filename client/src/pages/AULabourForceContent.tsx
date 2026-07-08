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

// Australia Labour Force dashboard — LFS headline aggregates (mirrors the US
// CPS / CA LFS / JP LFS pages), ABS Labour Force Survey, monthly, 1978→.
// THE (b) DECISION: unlike every other country page, the ABS EXPLICITLY
// recommends TREND estimates over seasonally adjusted for the headline rates
// (the SA series carries a ±0.2pp standard error month-to-month). Every rate
// panel therefore renders BOTH: the TREND line thick/white as the primary
// read, SA thin/muted alongside, with the trend_vs_sa proxy badge.

type AllData = Record<string, AbsPoint[]>

const ALL_CODES = [
  'AU_UNRATE_TREND', 'AU_UNRATE_SA',       // unemployment rate, %, 1978→
  'AU_PART_RATE_TREND', 'AU_PART_RATE',    // participation rate, %, 1978→
  'AU_EMP_POP_TREND', 'AU_EMP_POP',        // employment-to-population, %, 1978→
  'AU_UNEMPLOYED',                         // unemployed persons, thousands, SA
] as const

// Levels publish in thousands: 426.9 = 426.9k persons.
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

// ── Trend-vs-SA rate panel (the (b) decision, reused across the page) ────────

const TREND_COLOR = '#e2e8f0'
const SA_COLOR = '#64748B'

function TrendSaRatePanel({ allData, title, subtitle, trendCode, saCode, saLabel }: {
  allData: AllData
  title: string
  subtitle: string
  trendCode: string
  saCode: string
  saLabel?: string
}) {
  const rows = useMemo(() => mergeByDate({
    trend: allData[trendCode] ?? [],
    sa: allData[saCode] ?? [],
  }), [allData, trendCode, saCode])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = {
    trend: 'Trend (ABS-recommended)',
    sa: saLabel ?? 'Seasonally adjusted',
  }

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.trend_vs_sa} />}
      legend={<>
        <LegT color={TREND_COLOR} label={labels.trend} hidden={hidden.has('trend')} onClick={() => toggle('trend')} />
        <LegT color={SA_COLOR} label={labels.sa} hidden={hidden.has('sa')} onClick={() => toggle('sa')} />
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
          <Line type="monotone" dataKey="sa" name="sa" stroke={SA_COLOR} strokeWidth={1.2}
            hide={hidden.has('sa')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line type="monotone" dataKey="trend" name="trend" stroke={TREND_COLOR} strokeWidth={2.2}
            hide={hidden.has('trend')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ── Unemployed persons level ─────────────────────────────────────────────────

function UnemployedLevelPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => {
    const nv: NV[] = data.map(d => ({ date: d.date, value: d.value }))
    const ma12 = computeMA(nv, 12)
    return data.map((d, i) => ({
      date: d.date, level: d.value, ma12: ma12[i]?.value ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = { level: 'Unemployed (SA)', ma12: '12-mo MA' }

  return (
    <Panel
      title="Unemployed Persons"
      subtitle="LFS, thousands, seasonally adjusted, 1978→ — the 12-mo MA is the smoothed read on the level"
      legend={<>
        <LegT color="#ef4444" label="Unemployed (SA)" hidden={hidden.has('level')} onClick={() => toggle('level')} />
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
          <Line type="monotone" dataKey="level" name="level" stroke="#ef4444" strokeWidth={1.6}
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

// ══════════════════════════════════════════════════════════════════════════════

export function AULabourForceContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS Labour Force series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Labour Force Survey &mdash; monthly, 1978&rarr;. TREND (thick, white) is the ABS-recommended
        headline read; SA (thin, muted) shown alongside &mdash; the SA rate carries a &plusmn;0.2pp standard
        error, so trend leads and monthly SA surprises often wash out.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <TrendSaRatePanel
          allData={allData}
          title="Unemployment Rate — Trend vs SA"
          subtitle="Aged 15+, % of labour force — ABS explicitly recommends the trend estimate over SA (±0.2pp SA standard error)"
          trendCode="AU_UNRATE_TREND"
          saCode="AU_UNRATE_SA"
        />
        <TrendSaRatePanel
          allData={allData}
          title="Participation Rate — Trend vs SA"
          subtitle="Labour force as % of civilian population 15+ (latest ~66.7%) — trend thick per ABS guidance, SA thin"
          trendCode="AU_PART_RATE_TREND"
          saCode="AU_PART_RATE"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <TrendSaRatePanel
          allData={allData}
          title="Employment-to-Population — Trend vs SA"
          subtitle="Employed as % of civilian population 15+ — trend thick per ABS guidance, SA thin"
          trendCode="AU_EMP_POP_TREND"
          saCode="AU_EMP_POP"
        />
        <UnemployedLevelPanel data={allData['AU_UNEMPLOYED'] ?? []} />
      </div>
    </>
  )
}
