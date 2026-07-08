import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type WD, type NV, computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip, fmtFullDate,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan CPI projections — same-month-prior-year MoM pace methodology (the
// UK/Canada model on Japanese data; mechanics copied from
// CACPIProjectionsContent). Japanese CPI is NSA, so a carry-forward-recent-MoM
// model would bake the latest seasonal swing into every future month. Instead,
// each projected month applies the MoM pace observed in the SAME calendar
// month of prior years:
//   projIndex(t+n) = projIndex(t+n−1) × avg over k years of [ idx(m−12j) / idx(m−12j−1mo) ]
// for k = 1 / 2 / 3 (three scenarios), then projected YoY is read off the
// projected index against the actual (or projected) index 12 months earlier.
// All three inputs are the national aggregates (e-Stat 0003427113, 2020=100).
// CRITICAL nomenclature (docs/jp-models-mapping.md caveat 1): Japan's "core"
// = ex FRESH FOOD ONLY (energy included) — the BoJ policy reference;
// "core-core" = ex fresh food & energy is the US-core analog. The core /
// core-core panels carry the nomenclature ProxyBadge.

const CODES = ['CPI_HEADLINE_JP', 'CPI_CORE_JP', 'CPI_CORECORE_JP'] as const

const METHOD_CAPTION =
  'Projection: same-calendar-month prior-year MoM pace (1y / 2y avg / 3y avg) — NSA'

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

type AllData = Record<string, EstatPoint[]>

// ── Projection math ──────────────────────────────────────────────────────────

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
    const yoyAll = computeChangePct(data, 12)
    const hist = yoyAll.filter(p => p.date >= '2018-01-01')

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
    setBrush({ start: 0, end: model.rows.length - 1 })
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
              label={{ value: 'BoJ 2% target', position: 'insideTopLeft', fill: '#64748B', fontSize: 10 }} />
            <Line type="monotone" dataKey="hist" name="YoY"
              stroke="#ffffff" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            {SCENARIOS.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
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
          <span className={kit.statLabel}>Reaches 2% (12m)</span>
          <span className={kit.statValue} style={{ color: model.reaches2 ? '#4ade80' : '#f87171' }}>
            {model.reaches2 ? 'YES' : 'NO'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPCPIProjectionsContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(CODES).then(map => {
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

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} e-Stat CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau of Japan (e-Stat 0003427113) &mdash; monthly indices, 2020=100, not seasonally adjusted.
        Projections are mechanical seasonal-pace extrapolations, not forecasts. The 2% reference is the BoJ price-stability target.
      </div>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#94a3b8',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        METHODOLOGY: NSA series &mdash; projected months use the same-calendar-month MoM change
        from the prior year (averaged over 1 / 2 / 3 years for the three scenarios), so the
        seasonal pattern is carried by construction rather than the latest monthly swing.
      </div>

      <ProjectionSection
        title="Headline CPI — YoY Projection"
        subtitle="All items, national"
        code="CPI_HEADLINE_JP"
        data={allData['CPI_HEADLINE_JP'] ?? []}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ProjectionSection
          title="Core CPI — YoY Projection"
          subtitle="Core = ex FRESH FOOD ONLY — energy INCLUDED (the BoJ policy reference; not US core)"
          code="CPI_CORE_JP"
          data={allData['CPI_CORE_JP'] ?? []}
          badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.core_nomenclature} />}
        />
        <ProjectionSection
          title="Core-core CPI — YoY Projection"
          subtitle="Core-core = ex fresh food & energy — the US-core analog"
          code="CPI_CORECORE_JP"
          data={allData['CPI_CORECORE_JP'] ?? []}
          badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.core_nomenclature} />}
        />
      </div>
    </>
  )
}
