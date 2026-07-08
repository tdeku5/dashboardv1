import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type NV, type WD, computeMA, computeChangePct,
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia Employment dashboard — the jobs tab (mirrors the US CES / CA
// employment panels), ABS Labour Force Survey, monthly, 1978→. CRITICAL vs
// the US pattern: this is household-survey employment — the STP Weekly
// Payroll Jobs series was discontinued Jul-2025; no establishment count
// exists. Every panel carries the lf_jobs badge for that reason. Employment
// levels publish in thousands (14,738.8 = 14.74M employed); hours worked in
// thousand hours (~2,000,000 = ~2.0B hours/month).

type AllData = Record<string, AbsPoint[]>

const ALL_CODES = [
  'AU_EMPLOYED',        // employed persons, thousands, SA, 1978→
  'AU_EMPLOYED_TREND',  // employed persons, thousands, trend
  'AU_EMP_FT',          // full-time employed, thousands, SA
  'AU_EMP_PT',          // part-time employed, thousands, SA
  'AU_HOURS',           // monthly hours worked, thousand hours, SA, 1978-07→
] as const

// Employment levels in thousands: 14,738.8 = 14.74M.
const fmtEmpTick = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${Math.round(v)}k`
const fmtEmpTip = (v: number): string =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(3)}M` : `${v.toFixed(1)}k`
// Monthly change in thousands: +42.3 = +42.3k.
const fmtChgTick = (v: number): string => `${Math.round(v)}k`
const fmtChgTip = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}k`
// Hours worked publish in thousand hours: 2,000,000 = 2.0B hours.
const fmtHoursTick = (v: number): string => `${(v / 1e6).toFixed(2)}B`
const fmtHoursTip = (v: number): string => `${(v / 1e6).toFixed(3)}B hrs`

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

function LegT({ color, label, hidden, onClick, kind = 'line' }: {
  color: string
  label: string
  hidden: boolean
  onClick: () => void
  kind?: 'line' | 'swatch'
}) {
  return (
    <span className={kit.legendItem}
      style={{ cursor: 'pointer', opacity: hidden ? 0.35 : 1 }}
      onClick={onClick}>
      <span className={kind === 'line' ? kit.legendLine : kit.legendSwatch} style={{ background: color }} />
      {label}
    </span>
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

function EmployedLevelPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeByDate({
    trend: allData['AU_EMPLOYED_TREND'] ?? [],
    sa: allData['AU_EMPLOYED'] ?? [],
  }), [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = { trend: 'Employed (trend)', sa: 'Employed (SA)' }

  return (
    <Panel
      title="Employed Persons — Trend vs SA"
      subtitle="LFS household survey, thousands (14,738.8k = 14.74M latest) — trend thick per ABS guidance, SA thin"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.lf_jobs} />}
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
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtEmpTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) =>
              [typeof v === 'number' ? fmtEmpTip(v) : '-', labels[String(name)] ?? String(name)] as [string, string]} />
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

function EmploymentChangePanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => {
    const diff: NV[] = data.map((d, i) =>
      i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
    const ma6 = computeMA(diff, 6)
    return diff.map((d, i) => ({ date: d.date, chg: d.value, ma6: ma6[i]?.value ?? null }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Employment — Monthly Change"
      subtitle="MoM change in SA employed persons, thousands (terminal-computed) — the market-moving monthly LFS print"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.lf_jobs} />}
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
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={54} tickFormatter={fmtChgTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? fmtChgTip(v) : '-',
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
  const rows = useMemo(() => {
    const merged = mergeByDate({
      ft: allData['AU_EMP_FT'] ?? [],
      pt: allData['AU_EMP_PT'] ?? [],
    })
    return merged.map(r => {
      const ft = typeof r.ft === 'number' ? r.ft : null
      const pt = typeof r.pt === 'number' ? r.pt : null
      const share = ft !== null && pt !== null && ft + pt > 0 ? (ft / (ft + pt)) * 100 : null
      return { ...r, share }
    })
  }, [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = {
    ft: 'Full-time (L)', pt: 'Part-time (L)', share: 'FT share (R)',
  }

  return (
    <Panel
      title="Full-time vs Part-time Employment"
      subtitle="Thousands, SA (left) — full-time share of total employment, % (right, terminal-computed)"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.lf_jobs} />}
      legend={<>
        <LegT color="#4ade80" label="Full-time (L)" hidden={hidden.has('ft')} onClick={() => toggle('ft')} />
        <LegT color="#a78bfa" label="Part-time (L)" hidden={hidden.has('pt')} onClick={() => toggle('pt')} />
        <LegT color="#f59e0b" label="FT share (R)" hidden={hidden.has('share')} onClick={() => toggle('share')} />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false}
            width={54} tickFormatter={fmtEmpTick} />
          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={TICK}
            tickLine={false} axisLine={false} width={48} tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number'
                ? (name === 'share' ? `${v.toFixed(2)}%` : fmtEmpTip(v))
                : '-',
              labels[String(name)] ?? String(name),
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="ft" name="ft" stroke="#4ade80" strokeWidth={1.8}
            hide={hidden.has('ft')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="left" type="monotone" dataKey="pt" name="pt" stroke="#a78bfa" strokeWidth={1.8}
            hide={hidden.has('pt')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="share" name="share" stroke="#f59e0b"
            strokeWidth={1.2} strokeDasharray="4 3" hide={hidden.has('share')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function HoursWorkedPanel({ data }: { data: AbsPoint[] }) {
  const rows = useMemo(() => {
    const wd: WD[] = data.map(d => ({ date: d.date, value: d.value }))
    const yoy = computeChangePct(wd, 12)
    const yoyMap = new Map(yoy.map(p => [p.date, p.value]))
    return data.map(d => ({
      date: d.date, level: d.value, yoy: yoyMap.get(d.date) ?? null,
    }))
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, 240)
  const { hidden, toggle } = useToggles()
  const labels: Record<string, string> = { level: 'Hours worked (L)', yoy: 'YoY % (R)' }

  return (
    <Panel
      title="Monthly Hours Worked — Level & YoY"
      subtitle="All jobs, SA, billions of hours per month (published in thousand hours), 1978→ — the intensive-margin read"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.lf_jobs} />}
      legend={<>
        <LegT color="#38bdf8" label="Hours worked (L)" hidden={hidden.has('level')} onClick={() => toggle('level')} />
        <LegT color="#f59e0b" label="YoY % (R)" hidden={hidden.has('yoy')} onClick={() => toggle('yoy')} />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false}
            width={54} tickFormatter={fmtHoursTick} />
          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={TICK}
            tickLine={false} axisLine={false} width={48} tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number'
                ? (name === 'yoy' ? `${v.toFixed(2)}%` : fmtHoursTip(v))
                : '-',
              labels[String(name)] ?? String(name),
            ] as [string, string]} />
          <ReferenceLine yAxisId="right" y={0} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <Line yAxisId="left" type="monotone" dataKey="level" name="level" stroke="#38bdf8" strokeWidth={1.8}
            hide={hidden.has('level')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="yoy" name="yoy" stroke="#f59e0b" strokeWidth={1.2}
            hide={hidden.has('yoy')}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUEmploymentContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS employment series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Labour Force Survey &mdash; monthly, 1978&rarr;, levels in thousands. household-survey
        employment &mdash; the STP Weekly Payroll Jobs series was discontinued Jul-2025; no establishment
        count exists.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <EmployedLevelPanel allData={allData} />
        <EmploymentChangePanel data={allData['AU_EMPLOYED'] ?? []} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <FtPtPanel allData={allData} />
        <HoursWorkedPanel data={allData['AU_HOURS'] ?? []} />
      </div>
    </>
  )
}
