import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  type WD,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import {
  DistributionSection, buildDistribution, DIST_BUCKETS_WIDE, DIST_BUCKETS_NARROW,
} from '../components/charts/DistributionSection'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan CPI dashboard — e-Stat table 0003427113 (monthly, 2020=100, NSA, all
// Japan). CRITICAL nomenclature difference vs the US (docs/jp-models-mapping.md
// global caveat 1): Japan's "core" = ex FRESH FOOD ONLY (energy included) —
// the BoJ's policy reference; "core-core" = ex fresh food & energy is the
// US-core analog. All three publish as raw indices, so the standard rates
// panels apply; the trio comparison panel carries the nomenclature caption and
// badge. CPI contribution panel omitted per decision (g): the 2020-base basket
// weights are Excel-only, not on the API.

type AllData = Record<string, EstatPoint[]>

// Rates-side codes (collectors/estatCollector.ts) — index form, 2020=100.
const TRIO = [
  { code: 'CPI_HEADLINE_JP', label: 'All items', color: '#e2e8f0' },
  { code: 'CPI_CORE_JP', label: 'Core (ex fresh food — BoJ reference)', color: '#f59e0b' },
  { code: 'CPI_CORECORE_JP', label: 'Core-core (ex fresh food & energy — US-core analog)', color: '#60a5fa' },
] as const

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CPI_HEADLINE_JP', label: 'CPI — All items', depth: 0 },
  { id: 'CPI_CORE_JP', label: 'CPI — Core (ex fresh food, BoJ reference)', depth: 0 },
  { id: 'CPI_CORECORE_JP', label: 'CPI — Core-core (ex fresh food & energy)', depth: 0 },
  { id: 'JP_CPI_ALL_SA', label: 'CPI — All items (SA)', depth: 0 },
  { id: 'JP_CPI_CORE_SA', label: 'CPI — Core (SA)', depth: 0 },
  { id: 'JP_CPI_CORECORE_SA', label: 'CPI — Core-core (SA)', depth: 0 },
  { id: 'JP_CPI_FRESHFOOD', label: 'CPI — Fresh Food', depth: 0 },
  { id: 'JP_CPI_ENERGY', label: 'CPI — Energy', depth: 0 },
  { id: 'JP_CPI_GOODS', label: 'CPI — Goods', depth: 0 },
  { id: 'JP_CPI_SERVICES', label: 'CPI — Services', depth: 0 },
  { id: 'JP_CPI_EXIMPRENT', label: 'CPI — ex Imputed Rent', depth: 0 },
  { id: 'JP_CPI_FOOD', label: 'CPI 01 Food', depth: 1 },
  { id: 'JP_CPI_HOUSING', label: 'CPI 02 Housing', depth: 1 },
  { id: 'JP_CPI_FUEL', label: 'CPI 03 Fuel, Light & Water', depth: 1 },
  { id: 'JP_CPI_FURNITURE', label: 'CPI 04 Furniture & Household Utensils', depth: 1 },
  { id: 'JP_CPI_CLOTHES', label: 'CPI 05 Clothes & Footwear', depth: 1 },
  { id: 'JP_CPI_MEDICAL', label: 'CPI 06 Medical Care', depth: 1 },
  { id: 'JP_CPI_TRANSPORT', label: 'CPI 07 Transportation & Communication', depth: 1 },
  { id: 'JP_CPI_EDUCATION', label: 'CPI 08 Education', depth: 1 },
  { id: 'JP_CPI_CULTURE', label: 'CPI 09 Culture & Recreation', depth: 1 },
  { id: 'JP_CPI_MISC', label: 'CPI 10 Miscellaneous', depth: 1 },
  { id: 'JP_CPI_DUR', label: 'CPI — Durable Goods', depth: 1 },
  { id: 'JP_CPI_SEMIDUR', label: 'CPI — Semi-durable Goods', depth: 1 },
  { id: 'JP_CPI_NONDUR', label: 'CPI — Non-durable Goods', depth: 1 },
]

// 31 verified sub-indices (docs/jp-models-mapping.md; codes in fetchAllEstatSeries.ts)
const DIST_CODES = [
  'JP_CPI_CEREALS', 'JP_CPI_FISH', 'JP_CPI_MEATS', 'JP_CPI_DAIRY', 'JP_CPI_VEGETABLES',
  'JP_CPI_FRUITS', 'JP_CPI_CAKES', 'JP_CPI_BEVERAGES', 'JP_CPI_ALCOHOL', 'JP_CPI_EATINGOUT',
  'JP_CPI_RENT', 'JP_CPI_REPAIRS', 'JP_CPI_ELECTRICITY', 'JP_CPI_GAS', 'JP_CPI_WATER',
  'JP_CPI_HHDURABLES', 'JP_CPI_CLOTHING', 'JP_CPI_FOOTWEAR', 'JP_CPI_MEDICINES',
  'JP_CPI_MEDSERVICES', 'JP_CPI_PUBTRANSPORT', 'JP_CPI_PRIVTRANSPORT', 'JP_CPI_GASOLINE',
  'JP_CPI_COMMUNICATION', 'JP_CPI_SCHOOLFEES', 'JP_CPI_TUTORIAL', 'JP_CPI_BOOKS',
  'JP_CPI_RECSERVICES', 'JP_CPI_HOTELS', 'JP_CPI_PERSONALCARE', 'JP_CPI_EFFECTS',
] as const

const ALL_CODES = [...new Set([
  ...TRIO.map(s => s.code),
  ...EXPLORER_ITEMS.map(i => i.id),
  ...DIST_CODES,
])]

// ── Core trio YoY panel (computed from raw indices; nomenclature caption) ─────

function yoyRows(allData: AllData): Array<Record<string, number | string | null>> {
  const maps = TRIO.map(s => new Map((allData[s.code] ?? []).map(p => [p.date, p.value])))
  const dates = [...new Set(TRIO.flatMap(s => (allData[s.code] ?? []).map(p => p.date)))].sort()
  return dates.map(date => {
    const [y, m] = date.split('-').map(Number)
    const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const row: Record<string, number | string | null> = { date }
    TRIO.forEach((s, i) => {
      const now = maps[i].get(date)
      const then = maps[i].get(prior)
      row[s.code] = now != null && then != null && then !== 0 ? (now / then - 1) * 100 : null
    })
    return row
  })
}

function CoreTrioPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => yoyRows(allData), [allData])
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 180), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            Headline vs Core vs Core-core — YoY
            <ProxyBadge caveat={JP_PROXY_CAVEATS.core_nomenclature} />
          </div>
          <div className={kit.sectionSubtitle}>
            Japan&rsquo;s &ldquo;core&rdquo; = ex FRESH FOOD ONLY (energy included) — the BoJ policy reference.
            &ldquo;Core-core&rdquo; = ex fresh food &amp; energy — the US-core analog. Do not read Japan&rsquo;s core as US core.
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {TRIO.map(s => (
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
                const s = TRIO.find(x => x.code === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={2} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1} />
            {TRIO.map(s => (
              <Line key={s.code} type="monotone" dataKey={s.code} name={s.code}
                stroke={s.color} strokeWidth={s.code === 'CPI_CORE_JP' ? 2.2 : 1.6}
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

export function JPCPIContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} e-Stat CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau of Japan (e-Stat 0003427113) &mdash; monthly, 2020=100, NSA (SA exists for the three headline aggregates only).
        No contribution panel: 2020-base basket weights are Excel-only, not on the API.
      </div>

      <CoreTrioPanel allData={allData} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Headline CPI"
          subtitle="All items (NSA — short-run rates carry seasonality)"
          data={allData['CPI_HEADLINE_JP'] ?? []}
        />
        <RatesChart
          title="Core CPI — ex Fresh Food (BoJ reference)"
          subtitle="Energy INCLUDED — this is not US core (NSA)"
          data={allData['CPI_CORE_JP'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Core-core CPI — ex Fresh Food & Energy (SA)"
          subtitle="The US-core analog, seasonally adjusted — clean short-run paces"
          data={allData['JP_CPI_CORECORE_SA'] ?? []}
        />
        <RatesChart
          title="Headline CPI (SA)"
          subtitle="All items, seasonally adjusted — clean short-run paces"
          data={allData['JP_CPI_ALL_SA'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <DistributionSection
          title="CPI Distribution — Wide Buckets"
          subtitle="Share of 31 CPI sub-indices by YoY range"
          data={distWide}
          buckets={DIST_BUCKETS_WIDE}
        />
        <DistributionSection
          title="CPI Distribution — Narrow Buckets"
          subtitle="Share of 31 CPI sub-indices by YoY range"
          data={distNarrow}
          buckets={DIST_BUCKETS_NARROW}
        />
      </div>

      <SeriesExplorer
        title="Japan CPI Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CPI_HEADLINE_JP"
        unitLabel="Index, 2020=100"
      />
    </>
  )
}

export { DIST_CODES as JP_CPI_DIST_CODES }
