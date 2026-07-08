import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia CPI projections — QUARTERLY series only (docs/au-models-mapping.md).
// The complete Monthly CPI only has an index from Apr-2024 (YoY from Apr-2025)
// — far too young to project — so all three projection models run on the
// quarterly family: AU_CPI_Q_SA (all groups, seasonally adjusted, 1986→),
// AU_CPI_Q_TRIMMED and AU_CPI_Q_WGTMED (both SA at source, 1982→).
//
// METHOD (adapted from JPCPIProjectionsContent): the Japan template uses the
// same-calendar-month prior-year MoM pace because Japanese CPI is NSA. These
// Australian inputs are all SEASONALLY ADJUSTED, so no seasonal carry is
// needed — each scenario compounds the average QoQ pace observed over the
// trailing 4 / 8 / 12 quarters (1y / 2y / 3y windows):
//   pace_w = (idx(t) / idx(t−w))^(1/w),  projIdx(t+n) = idx(t) · pace_w^n
// for 8 projected quarters, with projected YoY read off the projected index
// against the actual (or projected) index 4 quarters earlier.

const CODES = ['AU_CPI_Q_SA', 'AU_CPI_Q_TRIMMED', 'AU_CPI_Q_WGTMED'] as const

const FREQ_CAPTION =
  '[QUARTERLY] — projections use the quarterly series; the Monthly CPI (Apr-2024→) is too young to project'

const METHOD_CAPTION =
  'Projection: seasonally adjusted quarterly paces — avg QoQ compounded over trailing 4 / 8 / 12 quarters (1y / 2y / 3y scenarios)'

const PROJ_QUARTERS = 8

const SCENARIOS = [
  { key: 'p1', windowQ: 4, color: '#60a5fa', label: '1y pace (4q)' },
  { key: 'p2', windowQ: 8, color: '#4ade80', label: '2y pace (8q)' },
  { key: 'p3', windowQ: 12, color: '#f97316', label: '3y pace (12q)' },
] as const

type ScenarioKey = typeof SCENARIOS[number]['key']

type ProjRow = {
  date: string
  hist: number | null
  p1: number | null
  p2: number | null
  p3: number | null
}

type AllData = Record<string, AbsPoint[]>

// ── Helpers (duplicated per-file per house convention) ───────────────────────

function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

function addQuarters(date: string, n: number): string {
  return addMonths(date, 3 * n)
}

/** "2026-01-01" → "2026-Q1" (quarter-start months 01/04/07/10). */
function fmtQuarter(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

/** 8 projected quarterly index points beyond the last observation, compounding
 *  the average QoQ pace of the trailing `windowQ` quarters (SA series — direct
 *  recent-pace, no seasonal carry needed). */
function buildProjectionIndex(data: WD[], windowQ: number): WD[] {
  if (data.length < windowQ + 1) return []
  const last = data[data.length - 1]
  const base = data[data.length - 1 - windowQ]
  if (base.value <= 0 || last.value <= 0) return []
  const pace = Math.pow(last.value / base.value, 1 / windowQ)
  const out: WD[] = []
  let prev = last.value
  for (let n = 1; n <= PROJ_QUARTERS; n++) {
    prev = prev * pace
    out.push({ date: addQuarters(last.date, n), value: prev })
  }
  return out
}

/** Projected YoY % per projected quarter: projIdx(t+n)/idx(t+n−4q) − 1,
 *  falling back to the projected index where the −4q base is itself projected. */
function projectYoY(data: WD[], windowQ: number): NV[] {
  const projIdx = buildProjectionIndex(data, windowQ)
  const histMap = new Map(data.map(p => [p.date, p.value]))
  const projMap = new Map(projIdx.map(p => [p.date, p.value]))
  return projIdx.map(p => {
    const baseDate = addQuarters(p.date, -4)
    const base = histMap.get(baseDate) ?? projMap.get(baseDate)
    return {
      date: p.date,
      value: base != null && base !== 0 ? (p.value / base - 1) * 100 : null,
    }
  })
}

const RBA_BAND = (
  <>
    <ReferenceArea y1={2} y2={3} fill="rgba(250, 204, 21, 0.06)" stroke="none" />
    <ReferenceLine y={2.5} stroke="rgba(250,204,21,0.45)" strokeDasharray="4 3" strokeWidth={1}
      label={{ value: 'RBA 2.5% midpoint', position: 'insideTopRight', fill: '#facc15', fontSize: 9 }} />
  </>
)

// ── Per-series projection section ────────────────────────────────────────────

function ProjectionSection({ title, subtitle, code, data, badge }: {
  title: string
  subtitle?: string
  code: string
  data: WD[]
  badge?: ReactNode
}) {
  const model = useMemo(() => {
    const yoyAll = computeChangePct(data, 4)
    const hist = yoyAll.filter(p => p.date >= '1990-01-01')

    const byScenario = {} as Record<ScenarioKey, NV[]>
    for (const s of SCENARIOS) byScenario[s.key] = projectYoY(data, s.windowQ)

    const rows: ProjRow[] = hist.map(p => ({ date: p.date, hist: p.value, p1: null, p2: null, p3: null }))

    // Anchor: projection lines start at the last historical point so they connect.
    const lastRow = rows.length > 0 ? rows[rows.length - 1] : null
    if (lastRow && lastRow.hist != null) {
      lastRow.p1 = lastRow.hist
      lastRow.p2 = lastRow.hist
      lastRow.p3 = lastRow.hist
    }

    const maps = {} as Record<ScenarioKey, Map<string, number | null>>
    for (const s of SCENARIOS) maps[s.key] = new Map(byScenario[s.key].map(p => [p.date, p.value]))
    const projDates = [...new Set(SCENARIOS.flatMap(s => byScenario[s.key].map(p => p.date)))].sort()
    for (const date of projDates) {
      rows.push({
        date,
        hist: null,
        p1: maps.p1.get(date) ?? null,
        p2: maps.p2.get(date) ?? null,
        p3: maps.p3.get(date) ?? null,
      })
    }

    const currentYoY = lastRow?.hist ?? null
    const latestQuarter = lastRow?.date ?? null
    const proj4 = {} as Record<ScenarioKey, number | null>
    for (const s of SCENARIOS) proj4[s.key] = byScenario[s.key][3]?.value ?? null
    const inBand = SCENARIOS.some(s =>
      byScenario[s.key].some(p => p.value != null && p.value >= 2.0 && p.value <= 3.0))

    return { rows, currentYoY, latestQuarter, proj4, inBand }
  }, [data])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (model.rows.length === 0) return
    setBrush({ start: Math.max(0, model.rows.length - 120), end: model.rows.length - 1 })
  }, [model.rows.length])

  if (data.length === 0) {
    return <div className={kit.statusBlock}>No data for {code}</div>
  }

  const fmtStat = (v: number | null) => v != null ? `${v.toFixed(1)}%` : '–'

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          <div className={kit.sectionSubtitle}>{FREQ_CAPTION}</div>
          <div className={kit.sectionSubtitle}>{METHOD_CAPTION}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#ffffff' }} />
            YoY (actual, {code})
          </span>
          {SCENARIOS.map(s => (
            <span key={s.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              Proj — {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={model.rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                const s = SCENARIOS.find(x => x.key === name)
                const lbl = s ? `Proj — ${s.label}` : 'YoY'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            {RBA_BAND}
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Line type="monotone" dataKey="hist" name="YoY"
              stroke="#ffffff" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            {SCENARIOS.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={1.6} strokeDasharray="5 4"
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
      <div className={kit.statsRow}>
        <div className={kit.stat}>
          <span className={kit.statLabel}>Current YoY</span>
          <span className={kit.statValue}>{fmtStat(model.currentYoY)}</span>
        </div>
        <div className={kit.stat}>
          <span className={kit.statLabel}>Latest Quarter</span>
          <span className={kit.statValue}>{model.latestQuarter ? fmtQuarter(model.latestQuarter) : '–'}</span>
        </div>
        {SCENARIOS.map(s => (
          <div key={s.key} className={kit.stat}>
            <span className={kit.statLabel}>+4q — {s.label}</span>
            <span className={kit.statValue} style={{ color: s.color }}>{fmtStat(model.proj4[s.key])}</span>
          </div>
        ))}
        <div className={kit.stat}>
          <span className={kit.statLabel}>In 2–3% band (8q)</span>
          <span className={kit.statValue} style={{ color: model.inBand ? '#4ade80' : '#f87171' }}>
            {model.inBand ? 'YES' : 'NO'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUCPIProjectionsContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(CODES).then(map => {
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

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} ABS CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS (CPI_Q dataflow, wtd avg 8 capitals) &mdash; {FREQ_CAPTION}. All three inputs are
        seasonally adjusted at source. Projections are mechanical pace extrapolations, not forecasts.
        The shaded band is the RBA&rsquo;s 2&ndash;3% inflation target with its 2.5% midpoint.
      </div>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#94a3b8',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        METHODOLOGY: unlike the NSA same-calendar-month method used for Japan/Canada, these SA series
        take DIRECT recent-pace scenarios &mdash; the average QoQ pace over the trailing 4 / 8 / 12
        quarters (1y / 2y / 3y windows) compounded forward {PROJ_QUARTERS} quarters, with projected
        YoY read against the index 4 quarters earlier.
      </div>

      <ProjectionSection
        title="Headline CPI (SA) — YoY Projection [QUARTERLY]"
        subtitle="All groups, seasonally adjusted (CPI_Q flow, 1986→)"
        code="AU_CPI_Q_SA"
        data={allData['AU_CPI_Q_SA'] ?? []}
        badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.dual_freq_cpi} />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ProjectionSection
          title="Trimmed Mean CPI — YoY Projection [QUARTERLY]"
          subtitle="The RBA's stated primary underlying-inflation reference during the monthly transition (SA at source, 1982→)"
          code="AU_CPI_Q_TRIMMED"
          data={allData['AU_CPI_Q_TRIMMED'] ?? []}
          badge={<ProxyBadge caveat={AU_PROXY_CAVEATS.trimmed_mean_reference} />}
        />
        <ProjectionSection
          title="Weighted Median CPI — YoY Projection [QUARTERLY]"
          subtitle="Companion underlying measure (SA at source, 1982→)"
          code="AU_CPI_Q_WGTMED"
          data={allData['AU_CPI_Q_WGTMED'] ?? []}
        />
      </div>
    </>
  )
}
