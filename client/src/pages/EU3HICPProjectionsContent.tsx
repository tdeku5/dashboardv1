import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip, fmtFullDate,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 HICP projections — one parameterized page serving DE / FR / IT.
// Same-month-prior-year MoM pace methodology (mechanics copied from
// JPCPIProjectionsContent). Country-level HICP has NO seasonally adjusted
// variant on the ECB portal, so a carry-forward-recent-MoM model would bake
// the latest seasonal swing into every future month. Instead, each projected
// month applies the MoM pace observed in the SAME calendar month of prior
// years:
//   projIndex(t+n) = projIndex(t+n−1) × avg over k years of [ idx(m−12j) / idx(m−12j−1mo) ]
// for k = 1 / 2 / 3 (three scenarios); projected YoY is read off the projected
// index against the actual (or projected) index 12 months earlier. Inputs are
// the ECB `HICP` dataflow indices (monthly, NSA, 2025=100). Every panel
// carries eu3Caveat('hicp_projection_nsa', cc). The 2% reference is the ECB's
// symmetric medium-term inflation target.

const METHOD_CAPTION =
  'Projection: same-calendar-month prior-year MoM pace (1y / 2y avg / 3y avg) — NSA (no country-level SA HICP exists)'

const SCENARIOS = [
  { key: 'p1', years: 1, color: '#60a5fa', label: '1y pace' },
  { key: 'p2', years: 2, color: '#4ade80', label: '2y avg pace' },
  { key: 'p3', years: 3, color: '#f97316', label: '3y avg pace' },
] as const

type ScenarioKey = typeof SCENARIOS[number]['key']

type ProjRow = {
  date: string
  hist: number | null
  p1: number | null
  p2: number | null
  p3: number | null
}

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  return {
    headline: `${cc}_HICP`,
    core: `${cc}_HICP_XEF`,
    coreEcb: `${cc}_HICP_XEFUN`,
  }
}

// ── Projection math (JPCPIProjectionsContent mechanics) ──────────────────────

function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/** 12 projected index points beyond the last observation, using the average
 *  same-calendar-month MoM pace of the prior `years` years. */
function buildProjectionIndex(data: WD[], years: number): WD[] {
  if (data.length === 0) return []
  const idxMap = new Map(data.map(p => [p.date, p.value]))
  const last = data[data.length - 1]
  const out: WD[] = []
  let prev = last.value
  for (let n = 1; n <= 12; n++) {
    const target = addMonths(last.date, n)
    const paces: number[] = []
    for (let j = 1; j <= years; j++) {
      const m = addMonths(target, -12 * j)
      const a = idxMap.get(m)
      const b = idxMap.get(addMonths(m, -1))
      if (a != null && b != null && b !== 0) paces.push(a / b)
    }
    if (paces.length === 0) break
    const avgPace = paces.reduce((s, p) => s + p, 0) / paces.length
    prev = prev * avgPace
    out.push({ date: target, value: prev })
  }
  return out
}

/** Projected YoY % for each projected month: projIdx(t+n)/idx(t+n−12) − 1,
 *  falling back to the projected index where the −12 month is itself projected. */
function projectYoY(data: WD[], years: number): NV[] {
  const projIdx = buildProjectionIndex(data, years)
  const histMap = new Map(data.map(p => [p.date, p.value]))
  const projMap = new Map(projIdx.map(p => [p.date, p.value]))
  return projIdx.map(p => {
    const baseDate = addMonths(p.date, -12)
    const base = histMap.get(baseDate) ?? projMap.get(baseDate)
    return {
      date: p.date,
      value: base != null && base !== 0 ? (p.value / base - 1) * 100 : null,
    }
  })
}

// ── Per-series projection section ────────────────────────────────────────────

function ProjectionSection({ title, subtitle, code, data, badge }: {
  title: string
  subtitle?: string
  code: string
  data: WD[]
  badge?: ReactNode
}) {
  const model = useMemo(() => {
    const hist = computeChangePct(data, 12)

    const byScenario = {} as Record<ScenarioKey, NV[]>
    for (const s of SCENARIOS) byScenario[s.key] = projectYoY(data, s.years)

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
    const latestMonth = lastRow?.date ?? null
    const proj6 = {} as Record<ScenarioKey, number | null>
    for (const s of SCENARIOS) proj6[s.key] = byScenario[s.key][5]?.value ?? null
    const reaches2 = SCENARIOS.some(s => byScenario[s.key].some(p => p.value != null && p.value <= 2.0))

    return { rows, currentYoY, latestMonth, proj6, reaches2 }
  }, [data])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (model.rows.length === 0) return
    // ~180 historical months + the 12 projected months in the default window.
    setBrush({ start: Math.max(0, model.rows.length - 192), end: model.rows.length - 1 })
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
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <ReferenceLine y={2} stroke="rgba(148,163,184,0.6)" strokeWidth={1} strokeDasharray="4 4"
              label={{ value: 'ECB 2% target', position: 'insideTopLeft', fill: '#64748B', fontSize: 10 }} />
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
          <span className={kit.statLabel}>Latest Month</span>
          <span className={kit.statValue}>{model.latestMonth ? fmtFullDate(model.latestMonth) : '–'}</span>
        </div>
        {SCENARIOS.map(s => (
          <div key={s.key} className={kit.stat}>
            <span className={kit.statLabel}>+6m — {s.label}</span>
            <span className={kit.statValue} style={{ color: s.color }}>{fmtStat(model.proj6[s.key])}</span>
          </div>
        ))}
        <div className={kit.stat}>
          <span className={kit.statLabel}>Reaches &le;2% (12m)</span>
          <span className={kit.statValue} style={{ color: model.reaches2 ? '#4ade80' : '#f87171' }}>
            {model.reaches2 ? 'YES' : 'NO'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3HICPProjectionsContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(
    () => [codes.headline, codes.core, codes.coreEcb],
    [codes]
  )

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
      setError(e instanceof Error ? e.message : 'Failed to load HICP data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} HICP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const country = EU3_COUNTRY_LABEL[cc]
  const badge = <ProxyBadge caveat={eu3Caveat('hicp_projection_nsa', cc)} />

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ECB Data Portal (HICP dataflow) &mdash; monthly indices, 2025=100, not seasonally adjusted.
        Projections are mechanical seasonal-pace extrapolations, not forecasts. The 2% reference is the ECB inflation target.
      </div>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#94a3b8',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        METHODOLOGY: NSA series &mdash; no country-level seasonally adjusted HICP exists. Projected
        months use the same-calendar-month MoM change from the prior year (averaged over 1 / 2 / 3
        years for the three scenarios), so the seasonal pattern is carried by construction rather
        than the latest monthly swing.
      </div>

      <ProjectionSection
        title={`${country} Headline HICP — YoY Projection`}
        subtitle="All items"
        code={codes.headline}
        data={allData[codes.headline] ?? []}
        badge={badge}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ProjectionSection
          title={`${country} Core HICP — YoY Projection`}
          subtitle="Ex energy, food, alcohol & tobacco — the market-standard core (US-core analog)"
          code={codes.core}
          data={allData[codes.core] ?? []}
          badge={badge}
        />
        <ProjectionSection
          title={`${country} ECB Core HICP — YoY Projection`}
          subtitle="Ex energy & unprocessed food — the ECB's core definition"
          code={codes.coreEcb}
          data={allData[codes.coreEcb] ?? []}
          badge={badge}
        />
      </div>
    </>
  )
}
