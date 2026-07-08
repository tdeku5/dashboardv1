import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Brush,
  XAxis, YAxis, ZAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, breakDates, type EurostatPoint } from '../lib/eurostat'
import {
  fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 Job Vacancies dashboard — the JOLTS-analog tab for DE / FR / IT.
// One series per country: the Eurostat job-vacancy rate (jvs_q_nace2,
// NACE B-S, quarterly SA, ~2-quarter publication lag). No hires/quits/layoffs
// flows exist anywhere in Europe — those JOLTS panels are deliberately absent.
// Italy publishes NO vacancy levels (rate only) so there is no level panel.
// Every panel carries eu3Caveat('vacancies', cc); country-specific coverage
// caveats (FR d-flag / 10+-employee coverage, IT rate-only) are in the
// registry overrides AND surfaced in the visible captions below.

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  return {
    vacRate: `${cc}_VACRATE`,   // Eurostat jvs_q_nace2, quarterly SA, NACE B-S
    unrate: `UNRATE_${cc}`,     // ECB LFSI monthly SA — quarterly-averaged for the Beveridge panel
  }
}

// Visible per-country coverage notes (mirrors the caveat-registry overrides).
const CC_NOTE: Record<Eu3Country, string> = {
  DE: 'history from 2006, levels also published',
  FR: 'coverage: establishments with 10+ employees; definition-differs flag on all observations',
  IT: 'rate only — Italy publishes no vacancy levels',
}

const BREAK_CAPTION = 'vertical dashes mark Eurostat break-in-series flags'

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

function fmtQAxis(d: string): string {
  const [y, m] = d.split('-')
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} '${y.slice(2)}`
}

function fmtQFull(d: unknown): string {
  if (typeof d !== 'string') return ''
  const [y, m] = d.split('-')
  return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`
}

/** Average a monthly series into quarter-start-dated points (terminal-computed). */
function quarterlyAverage(data: EurostatPoint[]): Array<{ date: string; value: number }> {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const p of data) {
    const [y, m] = p.date.split('-')
    const q = Math.floor((Number(m) - 1) / 3)
    const key = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
    const acc = sums.get(key)
    if (acc) { acc.sum += p.value; acc.n += 1 } else sums.set(key, { sum: p.value, n: 1 })
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, n }]) => ({ date, value: sum / n }))
}

// ── Panels ───────────────────────────────────────────────────────────────────

function VacancyRatePanel({ data, cc }: { data: EurostatPoint[]; cc: Eu3Country }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, rate: d.value })), [data])
  const breaks = useMemo(() => breakDates(data), [data])
  const { brush, onBrush } = useBrush(rows.length, Number.MAX_SAFE_INTEGER)

  return (
    <Panel
      title={`${EU3_COUNTRY_LABEL[cc]} Job Vacancy Rate`}
      subtitle={`Eurostat jvs_q_nace2 — quarterly, SA, NACE B-S, ~2-quarter publication lag · ${CC_NOTE[cc]}${breaks.length ? ` · ${BREAK_CAPTION}` : ''}`}
      badge={<ProxyBadge caveat={eu3Caveat('vacancies', cc)} />}
      legend={<Leg color="#4ade80" label="Vacancy rate (%)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtQAxis} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={fmtQFull}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', 'Vacancy rate'] as [string, string]} />
          <BreakLines dates={breaks} />
          <Line type="monotone" dataKey="rate" name="rate" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} tickFormatter={fmtQAxis} />
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
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>{fmtQFull(p.date)}</div>
      <div>U-rate (qtr avg): {p.x.toFixed(2)}%</div>
      <div>Vacancy rate: {p.y.toFixed(2)}%</div>
    </div>
  )
}

function BeveridgePanel({ allData, cc }: { allData: AllData; cc: Eu3Country }) {
  const codes = codesFor(cc)
  const { byYear, years, latest } = useMemo(() => {
    const uq = quarterlyAverage(allData[codes.unrate] ?? [])
    const urateMap = new Map(uq.map(p => [p.date, p.value]))
    const pts: BevPoint[] = []
    for (const vr of allData[codes.vacRate] ?? []) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allData, cc])

  const yearColor = (i: number): string => `hsl(${(i * 47) % 360} 70% 60%)`

  return (
    <Panel
      title="Beveridge Curve"
      subtitle={`x = unemployment rate (UNRATE_${cc}, monthly ECB series quarterly-averaged — terminal-computed), y = job vacancy rate — quarterly; latest point in white`}
      badge={<ProxyBadge caveat={eu3Caveat('vacancies', cc)} />}
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

export function EU3VacanciesContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [codes.vacRate, codes.unrate], [codes])

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
      setError(e instanceof Error ? e.message : 'Failed to load vacancy data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} vacancy series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Eurostat job vacancies (jvs_q_nace2, NACE B-S) &mdash; quarterly, SA, ~2-quarter publication lag.
        {EU3_COUNTRY_LABEL[cc]}: {CC_NOTE[cc]}. No European hires/quits/layoffs flows exist.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacancyRatePanel data={allData[codes.vacRate] ?? []} cc={cc} />
        <BeveridgePanel allData={allData} cc={cc} />
      </div>
    </>
  )
}
