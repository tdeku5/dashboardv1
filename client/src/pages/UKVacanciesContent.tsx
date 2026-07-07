import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Line, Bar, Cell, Brush,
  XAxis, YAxis, ZAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, type NV,
  fmtAxisDate, fmtFullDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK Vacancies dashboard — the UK analogue of JOLTS. The ONS vacancy survey
// (AP2Y, from 2001) is a rolling 3-month average with no hires/quits/layoffs
// flows — those panels are deliberately absent (no UK source exists);
// redundancies (BEAO) stand in for layoffs in the final panel.

type AllData = Record<string, WD[]>

const SERIES_LIST: ReadonlyArray<{ cdid: string; dataset: string }> = [
  { cdid: 'AP2Y', dataset: 'lms' },  // vacancies, thousands, SA, rolling 3-mo
  { cdid: 'MGRZ', dataset: 'lms' },  // employment level, 000s
  { cdid: 'MGSC', dataset: 'unem' }, // unemployment level, 000s
  { cdid: 'MGSX', dataset: 'lms' },  // unemployment rate 16+ %
  { cdid: 'BEAO', dataset: 'lms' },  // redundancies, 000s
]

const fmtK = (v: number): string => v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
const fmtKSigned = (v: number): string => `${v >= 0 ? '+' : ''}${fmtK(v)}k`

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

/** JOLTS-style vacancy rate: vacancies / (vacancies + employment) × 100, aligned by date. */
function computeVacancyRate(ap2y: WD[], mgrz: WD[]): NV[] {
  const empMap = new Map(mgrz.map(p => [p.date, p.value]))
  return ap2y.map(p => {
    const e = empMap.get(p.date)
    if (e == null || p.value + e <= 0) return { date: p.date, value: null }
    return { date: p.date, value: (p.value / (p.value + e)) * 100 }
  })
}

// ── Panels ───────────────────────────────────────────────────────────────────

function VacanciesLevelPanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Vacancies"
      subtitle="AP2Y — thousands, SA, rolling 3-month average"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancies} />}
      legend={<Leg color="#60a5fa" label="Vacancies (000s)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${fmtK(v)}k` : '-', 'Vacancies'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function VacanciesChangePanel({ data }: { data: WD[] }) {
  const rows = useMemo(() => data.map((d, i) => ({
    date: d.date,
    chg: i < 3 ? null : d.value - data[i - 3].value,
  })), [data])
  const { brush, onBrush } = useBrush(rows.length, 120)

  return (
    <Panel
      title="Vacancies — 3-Month Change"
      subtitle="AP2Y — change vs 3 months prior, thousands"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancies} />}
      legend={<>
        <Leg color="rgba(74,222,128,0.75)" label="Increase" kind="swatch" />
        <Leg color="rgba(239,68,68,0.75)" label="Decrease" kind="swatch" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={54} tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtKSigned(v) : '-', '3-mo change'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Bar dataKey="chg" name="chg" isAnimationActive={false} legendType="none" maxBarSize={16}>
            {rows.map((r, idx) => (
              <Cell key={`chg-${idx}`}
                fill={(r.chg ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
            ))}
          </Bar>
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function VacancyRatePanel({ vacancyRate }: { vacancyRate: NV[] }) {
  const rows = useMemo(
    () => vacancyRate.map(d => ({ date: d.date, rate: d.value })),
    [vacancyRate])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Vacancy Rate"
      subtitle="AP2Y / (AP2Y + MGRZ) × 100 — JOLTS-rate formula"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancy_rate} />}
      legend={<Leg color="#4ade80" label="Vacancy rate" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', 'Vacancy rate'] as [string, string]} />
          <Line type="monotone" dataKey="rate" name="rate" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function VacanciesPerUnemployedPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const unemMap = new Map((allData['MGSC'] ?? []).map(p => [p.date, p.value]))
    return (allData['AP2Y'] ?? []).map(p => {
      const u = unemMap.get(p.date)
      return { date: p.date, ratio: u != null && u > 0 ? p.value / u : null }
    })
  }, [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Vacancies per Unemployed Person"
      subtitle="AP2Y / MGSC — labour-market tightness (1.0 = one vacancy per unemployed)"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancies} />}
      legend={<>
        <Leg color="#f59e0b" label="Vacancies / unemployed" />
        <Leg color="rgba(255,255,255,0.35)" label="1.0 (balance)" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => v.toFixed(2)} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? v.toFixed(3) : '-', 'V / U'] as [string, string]} />
          <ReferenceLine y={1} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="5 3" />
          <Line type="monotone" dataKey="ratio" name="ratio" stroke="#f59e0b" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
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
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>{fmtFullDate(p.date)}</div>
      <div>U-rate: {p.x.toFixed(1)}%</div>
      <div>Vacancy rate: {p.y.toFixed(2)}%</div>
    </div>
  )
}

function BeveridgePanel({ allData, vacancyRate }: { allData: AllData; vacancyRate: NV[] }) {
  const { byYear, years, latest } = useMemo(() => {
    const urateMap = new Map((allData['MGSX'] ?? []).map(p => [p.date, p.value]))
    const pts: BevPoint[] = []
    for (const vr of vacancyRate) {
      if (vr.date < '2001-01-01' || vr.value == null) continue
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
  }, [allData, vacancyRate])

  const yearColor = (i: number): string => `hsl(${(i * 47) % 360} 70% 60%)`

  return (
    <Panel
      title="Beveridge Curve"
      subtitle="x = unemployment rate (MGSX), y = vacancy rate — monthly, 2001 onward; latest point in white"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancy_rate} />}
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

function RedundanciesVsVacanciesPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const vacMap = new Map((allData['AP2Y'] ?? []).map(p => [p.date, p.value]))
    const redMap = new Map((allData['BEAO'] ?? []).map(p => [p.date, p.value]))
    const dates = new Set<string>([...vacMap.keys(), ...redMap.keys()])
    return [...dates].sort().map(date => ({
      date,
      red: redMap.get(date) ?? null,
      vac: vacMap.get(date) ?? null,
    }))
  }, [allData])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Redundancies vs Vacancies"
      subtitle="BEAO (left) / AP2Y (right) — thousands; redundancies proxy the missing layoffs flow"
      badge={<ProxyBadge caveat={UK_PROXY_CAVEATS.vacancies} />}
      legend={<>
        <Leg color="#ef4444" label="Redundancies (L)" />
        <Leg color="#60a5fa" label="Vacancies (R)" />
      </>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis yAxisId="left" domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false}
            width={48} tickFormatter={fmtK} />
          <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={TICK}
            tickLine={false} axisLine={false} width={54} tickFormatter={fmtK} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${fmtK(v)}k` : '-',
              name === 'red' ? 'Redundancies' : 'Vacancies',
            ] as [string, string]} />
          <Line yAxisId="left" type="monotone" dataKey="red" name="red" stroke="#ef4444" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Line yAxisId="right" type="monotone" dataKey="vac" name="vac" stroke="#60a5fa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function UKVacanciesContent() {
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

  const vacancyRate = useMemo(
    () => computeVacancyRate(allData['AP2Y'] ?? [], allData['MGRZ'] ?? []),
    [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {SERIES_LIST.length} ONS vacancy series...</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics vacancy survey (from 2001) &mdash; rolling 3-month averages, seasonally adjusted; no UK hires/quits/layoffs flows exist
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacanciesLevelPanel data={allData['AP2Y'] ?? []} />
        <VacanciesChangePanel data={allData['AP2Y'] ?? []} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <VacancyRatePanel vacancyRate={vacancyRate} />
        <VacanciesPerUnemployedPanel allData={allData} />
      </div>

      <BeveridgePanel allData={allData} vacancyRate={vacancyRate} />

      <RedundanciesVsVacanciesPanel allData={allData} />
    </>
  )
}
