import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Brush,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import { fmtPctTick, TICK, TOOLTIP_STYLE, BRUSH_STYLE } from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia Job Vacancies dashboard — the JOLTS-analog tab. One survey:
// ABS Job Vacancies (quarterly SA, thousands, 1979-Q2→). No hires/quits/
// layoffs flows exist. THE 2008–09 SURVEY SUSPENSION IS A REAL GAP IN THE
// DATA — five quarters (2008-Q3 → 2009-Q3) have no values. The level panel
// renders the gap as a gap (connectNulls={false} over a full quarterly date
// spine), never interpolated. The Beveridge panel plots a terminal-computed
// vacancy-rate proxy (vacancies / labour force × 100, both quarterly-averaged
// where monthly) against the quarterly-averaged SA unemployment rate.

type AllData = Record<string, AbsPoint[]>

const ALL_CODES = ['AU_VACANCIES', 'AU_LABOUR_FORCE', 'AU_UNRATE_SA'] as const

const GAP_CAPTION =
  'the ABS suspended the Job Vacancies survey 2008-Q3 → 2009-Q3 — those 5 quarters have NO values and render as a visible gap (never interpolated)'

// ── Quarterly helpers (per-file per house convention) ────────────────────────

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
}

function quarterIndex(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return y * 4 + Math.floor((m - 1) / 3)
}

function quarterDate(idx: number): string {
  return `${Math.floor(idx / 4)}-${String((idx % 4) * 3 + 1).padStart(2, '0')}-01`
}

/** Average a monthly series into quarter-start-dated points (terminal-computed). */
function quarterlyAverage(data: readonly AbsPoint[]): Array<{ date: string; value: number }> {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const p of data) {
    const key = quarterDate(quarterIndex(p.date))
    const acc = sums.get(key)
    if (acc) { acc.sum += p.value; acc.n += 1 } else sums.set(key, { sum: p.value, n: 1 })
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, n }]) => ({ date, value: sum / n }))
}

// ── Local panel kit ──────────────────────────────────────────────────────────

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

// ── Vacancy level panel (with the visible 2008–09 gap) ───────────────────────

type LevelRow = { date: string; vac: number | null }

function VacancyLevelPanel({ data }: { data: AbsPoint[] }) {
  // Full quarterly date spine from first to last observation so the 2008–09
  // suspension quarters exist as null rows — connectNulls={false} renders them
  // as a break in the line, not a straight bridge.
  const rows = useMemo((): LevelRow[] => {
    if (!data.length) return []
    const map = new Map(data.map(p => [p.date, p.value]))
    const first = quarterIndex(data[0].date)
    const last = quarterIndex(data[data.length - 1].date)
    const out: LevelRow[] = []
    for (let q = first; q <= last; q++) {
      const date = quarterDate(q)
      out.push({ date, vac: map.get(date) ?? null })
    }
    return out
  }, [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title="Job Vacancies — Level"
      subtitle={`ABS Job Vacancies survey — quarterly, SA, thousands, 1979-Q2→ · ${GAP_CAPTION}`}
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.jv_vacancies} />}
      legend={<Leg color="#4ade80" label="Vacancies (thousands, SA)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={52}
            tickFormatter={(v: number) => `${v.toFixed(0)}k`} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(1)}k` : 'no survey (2008–09 suspension)',
                'Vacancies'] as [string, string]} />
          <Line type="monotone" dataKey="vac" name="vac" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls={false} legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ── Beveridge curve (colored by era) ─────────────────────────────────────────

type BevPoint = { x: number; y: number; z: number; date: string }

const ERAS = [
  { label: '1979–89', toYear: 1989, color: '#64748b' },
  { label: '1990–99', toYear: 1999, color: '#a78bfa' },
  { label: '2000–09', toYear: 2009, color: '#38bdf8' },
  { label: '2010–19', toYear: 2019, color: '#4ade80' },
  { label: '2020→', toYear: 9999, color: '#f59e0b' },
] as const

function eraOf(date: string): number {
  const y = Number(date.slice(0, 4))
  return ERAS.findIndex(e => y <= e.toYear)
}

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
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>{fmtQFull(p.date)}</div>
      <div>U-rate (qtr avg): {p.x.toFixed(2)}%</div>
      <div>Vacancy rate (proxy): {p.y.toFixed(2)}%</div>
    </div>
  )
}

function BeveridgePanel({ allData }: { allData: AllData }) {
  const { byEra, latest } = useMemo(() => {
    const lfQ = new Map(quarterlyAverage(allData['AU_LABOUR_FORCE'] ?? []).map(p => [p.date, p.value]))
    const uQ = new Map(quarterlyAverage(allData['AU_UNRATE_SA'] ?? []).map(p => [p.date, p.value]))
    const pts: BevPoint[] = []
    for (const v of allData['AU_VACANCIES'] ?? []) {
      const lf = lfQ.get(v.date)
      const u = uQ.get(v.date)
      if (lf == null || u == null || lf <= 0) continue
      pts.push({ x: u, y: (v.value / lf) * 100, z: 1, date: v.date })
    }
    const byEra = new Map<number, BevPoint[]>()
    for (const p of pts) {
      const e = eraOf(p.date)
      const arr = byEra.get(e)
      if (arr) arr.push(p); else byEra.set(e, [p])
    }
    const latest = pts.length ? { ...pts[pts.length - 1], z: 8 } : null
    return { byEra, latest }
  }, [allData])

  return (
    <Panel
      title="Beveridge Curve"
      subtitle="x = unemployment rate (AU_UNRATE_SA, monthly SA quarterly-averaged — terminal-computed), y = vacancy-rate PROXY: vacancies / labour force × 100 (AU_LABOUR_FORCE quarterly-averaged — terminal-computed, not an ABS-published rate) · 2008–09 suspension quarters absent by construction; latest point in white"
      badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.jv_vacancies} />}
      legend={<>
        {ERAS.map((e, i) => byEra.has(i) && <Leg key={e.label} color={e.color} label={e.label} kind="swatch" />)}
        {latest && <Leg color="#ffffff" label="Latest" kind="swatch" />}
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" dataKey="x" name="U-rate" domain={['auto', 'auto']}
            tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtPctTick} />
          <YAxis type="number" dataKey="y" name="Vacancy rate" domain={['auto', 'auto']}
            tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <ZAxis type="number" dataKey="z" range={[28, 220]} domain={[1, 8]} />
          <Tooltip content={<BeveridgeTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
          {ERAS.map((e, i) => (
            <Scatter key={e.label} name={e.label} data={byEra.get(i) ?? []}
              fill={e.color} fillOpacity={0.7} isAnimationActive={false} />
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

export function AUVacanciesContent() {
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
      setError(e instanceof Error ? e.message : 'Failed to load ABS vacancy data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS vacancy series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Job Vacancies survey &mdash; quarterly, SA, thousands, 1979-Q2&rarr;, ~2-month publication lag.
        No hires/quits/layoffs flows exist (unlike JOLTS). NOTE: {GAP_CAPTION}.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacancyLevelPanel data={allData['AU_VACANCIES'] ?? []} />
        <BeveridgePanel allData={allData} />
      </div>
    </>
  )
}
