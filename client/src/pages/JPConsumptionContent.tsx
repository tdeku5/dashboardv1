import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type WD, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan household consumption — FIES (Family Income & Expenditure Survey,
// e-Stat 0002070001): monthly NSA living expenditure in YEN PER TWO-OR-MORE-
// PERSON HOUSEHOLD PER MONTH (¥320,345 May-26), 2000→. This is a household-
// survey PROXY for the US monthly PCE page, so EVERY panel carries the
// fies_consumption badge. The Statistics Bureau deflates FIES with CPI LESS
// IMPUTED RENT — the official real series is file-only, so the real line here
// is terminal-computed with the same deflator (JP_CPI_EXIMPRENT, 2020=100)
// and carries a mandatory visible caption saying so.

type AllData = Record<string, EstatPoint[]>
type Row = { date: string; [key: string]: number | string | null }

const ALL_CODES = ['JP_HH_SPENDING', 'JP_CPI_EXIMPRENT'] as const

const REAL_CAPTION =
  'terminal-computed real (deflated by CPI less imputed rent, the Bureau’s method) — the official real series is not API-published'

const DEFAULT_M = 120 // ~10 years of months

// ── formatters (yen per household per month) ─────────────────────────────────

const fmtYenTick = (v: number) => `¥${(v / 1000).toFixed(0)}k`
const fmtYenTooltip = (v: number) =>
  `¥${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

// ── helpers ──────────────────────────────────────────────────────────────────

/** Align multiple series on the union of their dates (missing values → null). */
function buildRows(
  series: ReadonlyArray<{ key: string; data: ReadonlyArray<{ date: string; value: number | null }> }>,
): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({
    key: s.key,
    m: new Map(s.data.map(p => [p.date, p.value])),
  }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    return row
  })
}

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  return [brush, setBrush] as const
}

// ── multi-line panel (toggleable legend) ─────────────────────────────────────

type LineDef = { key: string; label: string; color: string; width?: number }

function LinesPanel({
  title, subtitle, badge, lines, rows,
  tickFmt, tooltipFmt, zeroRef = false, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineDef[]
  rows: Row[]
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
}) {
  const [vis, setVis] = useState<Set<string>>(() => new Set(lines.map(l => l.key)))
  const toggle = (key: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(l => (
            <button key={l.key} type="button"
              className={`${kit.legendItem} ${vis.has(l.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(l.key)}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={tickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.filter(l => vis.has(l.key)).map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                stroke={l.color} strokeWidth={l.width ?? 1.8}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            ))}
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── YoY bars + MA panel (signed green/red bars with a smoothing line) ────────

function YoyBarsPanel({
  title, subtitle, badge, barLabel, maLabel, rows, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  barLabel: string
  maLabel: string
  rows: Row[]
  defaultCount?: number
}) {
  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            {barLabel} +
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} &minus;
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            {maLabel}
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', '']
                return [fmtPctTooltip(v), name === 'ma' ? maLabel : barLabel] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="yoy" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((r, i) => (
                <Cell key={`y-${i}`}
                  fill={typeof r.yoy === 'number' && r.yoy < 0
                    ? 'rgba(239,68,68,0.75)'
                    : 'rgba(74,222,128,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma" name="ma"
              stroke="#e2e8f0" strokeWidth={1.8}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPConsumptionContent() {
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

  const badge = <ProxyBadge caveat={JP_PROXY_CAVEATS.fies_consumption} />

  const spending = useMemo(() => allData['JP_HH_SPENDING'] ?? [], [allData])

  // Terminal-computed real spending: nominal / (CPI less imputed rent) × 100.
  // The Bureau's own deflation choice — the official real series is file-only.
  const realSpending = useMemo((): WD[] => {
    const cpi = new Map((allData['JP_CPI_EXIMPRENT'] ?? []).map(p => [p.date, p.value]))
    const out: WD[] = []
    for (const p of spending) {
      const c = cpi.get(p.date)
      if (c != null && c !== 0) out.push({ date: p.date, value: (p.value / c) * 100 })
    }
    return out
  }, [allData, spending])

  const levelRows = useMemo(
    () => buildRows([
      { key: 'level', data: spending },
      { key: 'ma', data: computeMA(spending, 12) },
    ]),
    [spending]
  )
  const nominalYoyRows = useMemo(() => {
    const yoy = computeChangePct(spending, 12)
    const ma = computeMA(yoy, 12)
    return yoy.map((d, i) => ({ date: d.date, yoy: d.value, ma: ma[i]?.value ?? null }))
  }, [spending])
  const realYoyRows = useMemo(() => {
    const yoy = computeChangePct(realSpending, 12)
    const ma = computeMA(yoy, 12)
    return yoy.map((d, i) => ({ date: d.date, yoy: d.value, ma: ma[i]?.value ?? null }))
  }, [realSpending])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} e-Stat FIES series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau FIES (e-Stat 0002070001) &mdash; monthly, NSA, yen per two-or-more-person
        household per month, 2000&rarr;. Household-survey basis (~9k households) &mdash; volatile;
        compare like months.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Household Spending — Level"
          subtitle="Monthly living expenditure per two-or-more-person household, nominal yen, NSA"
          badge={badge}
          lines={[
            { key: 'level', label: 'Spending (¥/household/mo)', color: '#60a5fa' },
            { key: 'ma', label: '12-mo MA', color: '#f59e0b', width: 2.2 },
          ]}
          rows={levelRows}
          tickFmt={fmtYenTick}
          tooltipFmt={fmtYenTooltip}
        />
        <YoyBarsPanel
          title="Household Spending — Nominal YoY %"
          subtitle="% change vs same month a year earlier (NSA — the only clean monthly compare)"
          badge={badge}
          barLabel="Nominal YoY"
          maLabel="12-mo MA"
          rows={nominalYoyRows}
        />
      </div>

      <YoyBarsPanel
        title="Household Spending — Real YoY %"
        subtitle={REAL_CAPTION}
        badge={badge}
        barLabel="Real YoY"
        maLabel="12-mo MA"
        rows={realYoyRows}
      />
    </>
  )
}
