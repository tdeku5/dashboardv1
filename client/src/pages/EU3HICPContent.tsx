import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  type WD, type ContribRow,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import {
  DistributionSection, buildDistribution, DIST_BUCKETS_WIDE, DIST_BUCKETS_NARROW,
} from '../components/charts/DistributionSection'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// EU3 HICP dashboard — one parameterized page serving DE / FR / IT (the trio
// shares sources and structure; only captions/config differ). Indices come
// from the ECB `HICP` dataflow (monthly, NSA, 2025=100 — no country-level SA
// exists); COICOP division weights from Eurostat `prc_hicp_inw` (annual
// per-mille, 2025 vintage forward-filled until 2026 publishes). Euro-area
// reference overlays (decision g) reuse the rates-side EA rows — same
// 2025=100 base, verified.

const COUNTRY_LABEL: Record<Eu3Country, string> = { DE: 'Germany', FR: 'France', IT: 'Italy' }

const DIVISIONS = [
  { cp: 'CP01', label: '01 Food & non-alc beverages', color: '#4ade80' },
  { cp: 'CP02', label: '02 Alcohol & tobacco', color: '#94a3b8' },
  { cp: 'CP03', label: '03 Clothing & footwear', color: '#e879f9' },
  { cp: 'CP04', label: '04 Housing & utilities', color: '#38bdf8' },
  { cp: 'CP05', label: '05 Furnishings & household', color: '#a78bfa' },
  { cp: 'CP06', label: '06 Health', color: '#fb7185' },
  { cp: 'CP07', label: '07 Transport', color: '#f59e0b' },
  { cp: 'CP08', label: '08 Information & communication', color: '#22d3ee' },
  { cp: 'CP09', label: '09 Recreation & culture', color: '#fbbf24' },
  { cp: 'CP10', label: '10 Education', color: '#86efac' },
  { cp: 'CP11', label: '11 Restaurants & accommodation', color: '#f472b6' },
  { cp: 'CP12', label: '12 Insurance & financial', color: '#64748b' },
] as const

const DIST_STEMS = [
  'D_CEREALS', 'D_MEAT', 'D_FISH', 'D_DAIRY', 'D_FRUIT', 'D_VEG', 'D_ALCOHOL',
  'D_CLOTHING', 'D_RENTS', 'D_MAINT', 'D_WATER', 'D_ELECTRICITY', 'D_GAS',
  'D_LIQFUEL', 'D_FURNITURE', 'D_APPLIANCES', 'D_MEDICINES', 'D_CARS',
  'D_MOTORFUEL', 'D_TRANSPSVC', 'D_ICTEQUIP', 'D_ICTSVC', 'D_CULTGOODS',
  'D_CULTSVC', 'D_RESTAURANTS', 'D_ACCOMM', 'D_INSURANCE',
] as const

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  const p = (stem: string) => `${cc}_${stem}`
  return {
    headline: p('HICP'),
    core: p('HICP_XEF'),
    coreEcb: p('HICP_XEFUN'),
    divisions: DIVISIONS.map(d => p(`HICP_${d.cp}`)),
    weights: DIVISIONS.map(d => p(`HICPW_${d.cp}`)),
    aggregates: ['HICP_ENERGY', 'HICP_FOOD', 'HICP_FOODUN', 'HICP_SERVICES', 'HICP_GOODS', 'HICP_NEIG', 'HICP_DUR', 'HICP_NONDUR', 'HICP_SEMIDUR'].map(p),
    dist: DIST_STEMS.map(s => p(`HICP_${s}`)),
    // Euro-area overlays (rates-side rows, decision g — read-only reuse)
    eaHeadline: 'HICP_HEADLINE',
    eaCore: 'HICP_SUPERCORE',
  }
}

// ── Weighted contribution (annual per-mille weights, forward-filled) ────────

function latestWeightAt(weights: EurostatPoint[], date: string): number | null {
  let w: number | null = null
  for (const pt of weights) {
    if (pt.date > date) break
    w = pt.value
  }
  return w
}

function buildContrib(allData: AllData, cc: Eu3Country, mode: 'yoy' | 'mom'): ContribRow[] {
  const codes = codesFor(cc)
  const headline = allData[codes.headline] ?? []
  const buckets = DIVISIONS.map((d, i) => ({
    key: d.cp,
    idxMap: new Map((allData[codes.divisions[i]] ?? []).map(pt => [pt.date, pt.value])),
    weights: allData[codes.weights[i]] ?? [],
  }))
  const headMap = new Map(headline.map(pt => [pt.date, pt.value]))

  return headline.map((pt, i) => {
    const { date } = pt
    let priorDate: string
    if (mode === 'yoy') {
      const [y, m] = date.split('-').map(Number)
      priorDate = `${y - 1}-${String(m).padStart(2, '0')}-01`
    } else {
      if (i === 0) {
        const row: ContribRow = { date }
        for (const d of DIVISIONS) row[d.cp] = null
        row.line = null
        return row
      }
      priorDate = headline[i - 1].date
    }

    const row: ContribRow = { date }
    for (const b of buckets) {
      const now = b.idxMap.get(date)
      const prior = b.idxMap.get(priorDate)
      const w = latestWeightAt(b.weights, date)
      row[b.key] = (now != null && prior != null && prior !== 0 && w != null)
        ? (w / 1000) * ((now / prior) - 1) * 100
        : null
    }
    const hNow = headMap.get(date)
    const hPrior = headMap.get(priorDate)
    row.line = (hNow != null && hPrior != null && hPrior !== 0) ? (hNow / hPrior - 1) * 100 : null
    return row
  })
}

const CONTRIB_ITEMS: readonly ContribItem[] = DIVISIONS.map(d => ({ id: d.cp, label: d.label, color: d.color }))

// ── Country vs euro-area YoY overlay (decision g) ────────────────────────────

function EaOverlayPanel({ allData, cc }: { allData: AllData; cc: Eu3Country }) {
  const codes = codesFor(cc)
  const SERIES = [
    { code: codes.headline, label: `${COUNTRY_LABEL[cc]} headline`, color: '#e2e8f0', width: 2.2, dash: undefined as string | undefined },
    { code: codes.core, label: `${COUNTRY_LABEL[cc]} core (XEF)`, color: '#f59e0b', width: 1.8, dash: undefined },
    { code: codes.eaHeadline, label: 'Euro area headline', color: '#64748b', width: 1.4, dash: '5 3' },
    { code: codes.eaCore, label: 'Euro area core', color: '#4e6070', width: 1.2, dash: '5 3' },
  ]
  const rows = useMemo(() => {
    const maps = SERIES.map(s => new Map((allData[s.code] ?? []).map(pt => [pt.date, pt.value])))
    const dates = [...new Set((allData[codes.headline] ?? []).map(pt => pt.date))].sort()
    return dates.map(date => {
      const [y, m] = date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const row: Record<string, number | string | null> = { date }
      SERIES.forEach((s, i) => {
        const now = maps[i].get(date)
        const then = maps[i].get(prior)
        row[s.code] = now != null && then != null && then !== 0 ? (now / then - 1) * 100 : null
      })
      return row
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allData, cc])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 180), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{COUNTRY_LABEL[cc]} vs Euro Area — HICP YoY</div>
          <div className={kit.sectionSubtitle}>
            Country divergence from the euro-area aggregate (both on the 2025=100 HICP base; EA lines dashed)
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {SERIES.map(s => (
            <span key={s.code} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
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
                const s = SERIES.find(x => x.code === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={2} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1} />
            {SERIES.map(s => (
              <Line key={s.code} type="monotone" dataKey={s.code} name={s.code}
                stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash}
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

// ══════════════════════════════════════════════════════════════════════════════

export function EU3HICPContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [...new Set([
    codes.headline, codes.core, codes.coreEcb,
    ...codes.divisions, ...codes.weights, ...codes.aggregates, ...codes.dist,
    codes.eaHeadline, codes.eaCore,
  ])], [codes])

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

  const contribYoy = useMemo(
    () => Object.keys(allData).length > 0 ? buildContrib(allData, cc, 'yoy') : [],
    [allData, cc]
  )
  const contribMom = useMemo(
    () => Object.keys(allData).length > 0 ? buildContrib(allData, cc, 'mom') : [],
    [allData, cc]
  )
  const distWide = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, codes.dist, DIST_BUCKETS_WIDE) : [],
    [allData, codes]
  )
  const distNarrow = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, codes.dist, DIST_BUCKETS_NARROW) : [],
    [allData, codes]
  )

  const explorerItems: ExplorerItem[] = useMemo(() => [
    { id: codes.headline, label: 'HICP — All items', depth: 0 },
    { id: codes.core, label: 'HICP — Core (ex energy, food, alcohol & tobacco)', depth: 0 },
    { id: codes.coreEcb, label: 'HICP — ex energy & unprocessed food (ECB core)', depth: 0 },
    ...codes.aggregates.map(code => ({
      id: code,
      label: `HICP — ${code.split('HICP_')[1].replace(/_/g, ' ')}`,
      depth: 0,
    })),
    ...DIVISIONS.map((d, i) => ({ id: codes.divisions[i], label: `HICP ${d.label}`, depth: 1 })),
  ], [codes])

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of explorerItems) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData, explorerItems])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} HICP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ECB Data Portal (HICP dataflow) &mdash; monthly, 2025=100, NSA (no country-level SA exists).
        Contribution weights: Eurostat prc_hicp_inw, 2025 vintage forward-filled until the 2026 publication.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ContribSection
          title={`${COUNTRY_LABEL[cc]} HICP — YoY Contribution`}
          subtitle="COICOP-division contribution to all-items YoY %Δ (2025 HICP weights, forward-filled)"
          data={contribYoy}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="HICP YoY"
          clipPrefix={`eu3${cc.toLowerCase()}yoy`}
        />
        <ContribSection
          title={`${COUNTRY_LABEL[cc]} HICP — MoM Contribution`}
          subtitle="COICOP-division contribution to all-items MoM %Δ (NSA)"
          data={contribMom}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="HICP MoM"
          clipPrefix={`eu3${cc.toLowerCase()}mom`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Headline HICP"
          subtitle="All items (NSA — short-run rates carry seasonality)"
          data={allData[codes.headline] ?? []}
        />
        <RatesChart
          title="Core HICP — ex Energy, Food, Alcohol & Tobacco"
          subtitle="The market-standard core (US-core analog), NSA"
          data={allData[codes.core] ?? []}
        />
      </div>

      <EaOverlayPanel allData={allData} cc={cc} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <DistributionSection
          title="HICP Distribution — Wide Buckets"
          subtitle="Share of 27 HICP sub-indices by YoY range"
          data={distWide}
          buckets={DIST_BUCKETS_WIDE}
        />
        <DistributionSection
          title="HICP Distribution — Narrow Buckets"
          subtitle="Share of 27 HICP sub-indices by YoY range"
          data={distNarrow}
          buckets={DIST_BUCKETS_NARROW}
        />
      </div>

      <SeriesExplorer
        title={`${COUNTRY_LABEL[cc]} HICP Explorer`}
        selectorLabel="Series"
        items={explorerItems}
        data={explorerData}
        defaultId={codes.headline}
        unitLabel="Index, 2025=100, NSA"
      />
    </>
  )
}

// All panels on this page are DIRECT (harmonized indices) — no badges. The
// projections tab carries eu3Caveat('hicp_projection_nsa', cc).
export { DIST_STEMS as EU3_HICP_DIST_STEMS, DIVISIONS as EU3_HICP_DIVISIONS, COUNTRY_LABEL as EU3_COUNTRY_LABEL }
