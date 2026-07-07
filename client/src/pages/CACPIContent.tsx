import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
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
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada CPI dashboard — mirrors the US/UK CPI pages on StatCan table
// 18-10-0004 (monthly, NSA, 2002=100). Headline/ex-food-energy indices power
// the standard explorer/rates panels (DIRECT); the BoC preferred core trio
// (CPI-trim/median/common) is published as YoY % ONLY — no index exists — so
// it gets a dedicated published-rates panel (decision b) with a visible
// methodology caption and the boc_core_rates badge.

type AllData = Record<string, StatcanPoint[]>

// ── Contribution buckets (major components × published basket weights) ───────
// Weights come from table 18-10-0007 (occasional, % of basket at link-month
// prices) — the weight in force at each date is the latest published ≤ date.

const CONTRIB_BUCKETS = [
  { key: 'food',       idx: 'CA_CPI_FOOD',       wt: 'CA_CPIW_FOOD',       label: 'Food',                    color: '#4ade80' },
  { key: 'shelter',    idx: 'CA_CPI_SHELTER',    wt: 'CA_CPIW_SHELTER',    label: 'Shelter',                 color: '#38bdf8' },
  { key: 'hhops',      idx: 'CA_CPI_HHOPS',      wt: 'CA_CPIW_HHOPS',      label: 'Household Ops & Furnishings', color: '#a78bfa' },
  { key: 'clothing',   idx: 'CA_CPI_CLOTHING',   wt: 'CA_CPIW_CLOTHING',   label: 'Clothing & Footwear',     color: '#e879f9' },
  { key: 'transport',  idx: 'CA_CPI_TRANSPORT',  wt: 'CA_CPIW_TRANSPORT',  label: 'Transportation',          color: '#f59e0b' },
  { key: 'health',     idx: 'CA_CPI_HEALTH',     wt: 'CA_CPIW_HEALTH',     label: 'Health & Personal Care',  color: '#fb7185' },
  { key: 'recreation', idx: 'CA_CPI_RECREATION', wt: 'CA_CPIW_RECREATION', label: 'Recreation & Education',  color: '#fbbf24' },
  { key: 'alctob',     idx: 'CA_CPI_ALCTOB',     wt: 'CA_CPIW_ALCTOB',     label: 'Alcohol, Tobacco & Cannabis', color: '#94a3b8' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] = CONTRIB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// ── Explorer items ───────────────────────────────────────────────────────────

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CPI_HEADLINE', label: 'CPI — All-items', depth: 0 },
  { id: 'CPI_XFE', label: 'CPI — All-items ex Food & Energy', depth: 0 },
  { id: 'CA_CPI_SA', label: 'CPI — All-items (Seasonally Adjusted)', depth: 0 },
  { id: 'CA_CPI_EXFOOD', label: 'CPI — ex Food', depth: 0 },
  { id: 'CA_CPI_EXENERGY', label: 'CPI — ex Energy', depth: 0 },
  { id: 'CA_CPI_GOODS', label: 'CPI — Goods', depth: 0 },
  { id: 'CA_CPI_SERVICES', label: 'CPI — Services', depth: 0 },
  { id: 'CA_CPI_SVC_EXSHELTER', label: 'CPI — Services ex Shelter', depth: 0 },
  { id: 'CA_CPI_ENERGY', label: 'CPI — Energy', depth: 0 },
  { id: 'CA_CPI_DUR', label: 'CPI — Durable Goods', depth: 0 },
  { id: 'CA_CPI_SEMIDUR', label: 'CPI — Semi-durable Goods', depth: 0 },
  { id: 'CA_CPI_NONDUR', label: 'CPI — Non-durable Goods', depth: 0 },
  { id: 'CA_CPI_FOOD', label: 'CPI 01 Food', depth: 1 },
  { id: 'CA_CPI_SHELTER', label: 'CPI 02 Shelter', depth: 1 },
  { id: 'CA_CPI_HHOPS', label: 'CPI 03 Household Ops & Furnishings', depth: 1 },
  { id: 'CA_CPI_CLOTHING', label: 'CPI 04 Clothing & Footwear', depth: 1 },
  { id: 'CA_CPI_TRANSPORT', label: 'CPI 05 Transportation', depth: 1 },
  { id: 'CA_CPI_HEALTH', label: 'CPI 06 Health & Personal Care', depth: 1 },
  { id: 'CA_CPI_RECREATION', label: 'CPI 07 Recreation, Education & Reading', depth: 1 },
  { id: 'CA_CPI_ALCTOB', label: 'CPI 08 Alcohol, Tobacco & Cannabis', depth: 1 },
  { id: 'CA_CPI_MIC', label: 'CPI — Mortgage Interest Cost', depth: 1 },
  { id: 'CA_CPI_RENTED', label: 'CPI — Rented Accommodation', depth: 1 },
  { id: 'CA_CPI_GASOLINE', label: 'CPI — Gasoline', depth: 1 },
]

// ── Distribution items (32 verified sub-indices) ────────────────────────────

const DIST_CODES = [
  'CA_CPI_MEAT', 'CA_CPI_DAIRY', 'CA_CPI_BAKERY', 'CA_CPI_FRUIT', 'CA_CPI_VEG', 'CA_CPI_RESTAURANTS',
  'CA_CPI_RENT', 'CA_CPI_HOMEREPL', 'CA_CPI_PROPTAX', 'CA_CPI_HOMEINS', 'CA_CPI_HOMEMAINT',
  'CA_CPI_ELECTRICITY', 'CA_CPI_WATER', 'CA_CPI_NATGAS', 'CA_CPI_TELEPHONE', 'CA_CPI_INTERNET',
  'CA_CPI_FURNITURE', 'CA_CPI_APPLIANCES', 'CA_CPI_WCLOTHING', 'CA_CPI_MCLOTHING', 'CA_CPI_FOOTWEAR',
  'CA_CPI_VEHICLES', 'CA_CPI_GASOLINE', 'CA_CPI_PUBTRANSIT', 'CA_CPI_MEDICINES', 'CA_CPI_PERSONALCARE',
  'CA_CPI_RECEQUIP', 'CA_CPI_TRAVELSVCS', 'CA_CPI_TRAVELACCOM', 'CA_CPI_EDUCATION', 'CA_CPI_ALCOHOL',
  'CA_CPI_TOBACCO', 'CA_CPI_FINSVCS',
] as const

const BOC_CORE = [
  { code: 'CPI_TRIM', label: 'CPI-trim', color: '#e2e8f0' },
  { code: 'CPI_MEDIAN', label: 'CPI-median', color: '#60a5fa' },
  { code: 'CPI_COMMON', label: 'CPI-common', color: '#f59e0b' },
] as const

const ALL_CODES = [...new Set([
  'CPI_HEADLINE', 'CPI_XFE', 'CPI_TRIM', 'CPI_MEDIAN', 'CPI_COMMON',
  ...EXPLORER_ITEMS.map(i => i.id),
  ...CONTRIB_BUCKETS.flatMap(b => [b.idx, b.wt]),
  ...DIST_CODES,
])]

// ── Weighted contribution rows (latest published weight ≤ date) ─────────────

function latestWeightAt(weights: StatcanPoint[], date: string): number | null {
  let w: number | null = null
  for (const p of weights) {
    if (p.date > date) break
    w = p.value
  }
  return w
}

function buildCaCpiContrib(allData: AllData, mode: 'yoy' | 'mom'): ContribRow[] {
  const headline = allData['CPI_HEADLINE'] ?? []
  const bucketData = CONTRIB_BUCKETS.map(b => ({
    key: b.key,
    idxMap: new Map((allData[b.idx] ?? []).map(p => [p.date, p.value])),
    weights: allData[b.wt] ?? [],
  }))
  const headMap = new Map(headline.map(p => [p.date, p.value]))

  return headline.map((pt, i) => {
    const { date } = pt
    let priorDate: string | undefined
    if (mode === 'yoy') {
      const [y, m] = date.split('-').map(Number)
      let pm = m - 12, py = y
      if (pm <= 0) { pm += 12; py -= 1 }
      priorDate = `${py}-${String(pm).padStart(2, '0')}-01`
    } else {
      if (i === 0) {
        const row: ContribRow = { date }
        for (const b of CONTRIB_BUCKETS) row[b.key] = null
        row.line = null
        return row
      }
      priorDate = headline[i - 1].date
    }

    const row: ContribRow = { date }
    for (const b of bucketData) {
      const now = b.idxMap.get(date)
      const prior = b.idxMap.get(priorDate)
      const w = latestWeightAt(b.weights, date)
      if (now == null || prior == null || prior === 0 || w == null) {
        row[b.key] = null
      } else {
        row[b.key] = (w / 100) * ((now / prior) - 1) * 100
      }
    }

    const hNow = headMap.get(date)
    const hPrior = headMap.get(priorDate)
    row.line = (hNow != null && hPrior != null && hPrior !== 0) ? (hNow / hPrior - 1) * 100 : null
    return row
  })
}

// ── BoC core trio panel (published YoY rates — decision b) ───────────────────

function BocCorePanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const maps = BOC_CORE.map(s => new Map((allData[s.code] ?? []).map(p => [p.date, p.value])))
    const dates = new Set<string>()
    for (const s of BOC_CORE) for (const p of allData[s.code] ?? []) dates.add(p.date)
    return [...dates].sort().map(date => {
      const row: Record<string, number | string | null> = { date }
      BOC_CORE.forEach((s, i) => { row[s.code] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 120), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            Bank of Canada Preferred Core Measures
            <ProxyBadge caveat={CA_PROXY_CAVEATS.boc_core_rates} />
          </div>
          <div className={kit.sectionSubtitle}>
            Published year-over-year rates (no index form exists) — CPI-trim / CPI-median / CPI-common, table 18-10-0256
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {BOC_CORE.map(s => (
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
                const s = BOC_CORE.find(x => x.code === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={2} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1} />
            {BOC_CORE.map(s => (
              <Line key={s.code} type="monotone" dataKey={s.code} name={s.code}
                stroke={s.color} strokeWidth={s.code === 'CPI_TRIM' ? 2.2 : 1.6}
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

export function CACPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load StatCan data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const contribYoy = useMemo(
    () => Object.keys(allData).length > 0 ? buildCaCpiContrib(allData, 'yoy') : [],
    [allData]
  )
  const contribMom = useMemo(
    () => Object.keys(allData).length > 0 ? buildCaCpiContrib(allData, 'mom') : [],
    [allData]
  )

  const distWide = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, DIST_CODES, DIST_BUCKETS_WIDE) : [],
    [allData]
  )
  const distNarrow = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, DIST_CODES, DIST_BUCKETS_NARROW) : [],
    [allData]
  )

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} StatCan CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (18-10-0004 / 18-10-0256) &mdash; monthly, 2002=100, not seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ContribSection
          title="Canada CPI — YoY Contribution"
          subtitle="Major-component contribution to All-items YoY %Δ (published basket weights, 18-10-0007)"
          data={contribYoy}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="CPI YoY"
          clipPrefix="cacpiyoy"
        />
        <ContribSection
          title="Canada CPI — MoM Contribution"
          subtitle="Major-component contribution to All-items MoM %Δ (NSA)"
          data={contribMom}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="CPI MoM"
          clipPrefix="cacpimom"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Headline CPI"
          subtitle="All-items (v41690973) — YoY / annualized (NSA: short-run rates carry seasonality)"
          data={allData['CPI_HEADLINE'] ?? []}
        />
        <RatesChart
          title="CPI ex Food & Energy"
          subtitle="Index-form core (v41691233) — YoY / annualized (NSA)"
          data={allData['CPI_XFE'] ?? []}
        />
      </div>

      <BocCorePanel allData={allData} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <DistributionSection
          title="CPI Distribution — Wide Buckets"
          subtitle="Share of 33 CPI sub-indices by YoY range"
          data={distWide}
          buckets={DIST_BUCKETS_WIDE}
        />
        <DistributionSection
          title="CPI Distribution — Narrow Buckets"
          subtitle="Share of 33 CPI sub-indices by YoY range"
          data={distNarrow}
          buckets={DIST_BUCKETS_NARROW}
        />
      </div>

      <SeriesExplorer
        title="Canada CPI Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CPI_HEADLINE"
        unitLabel="Index, 2002=100, NSA"
      />
    </>
  )
}

export { DIST_CODES as CA_CPI_DIST_CODES }
