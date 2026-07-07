import { useState, useEffect, useMemo } from 'react'
import { fetchOnsSeries } from '../lib/ons'
import { type WD, type ContribRow } from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import {
  DistributionSection, buildDistribution, DIST_BUCKETS_WIDE, DIST_BUCKETS_NARROW,
} from '../components/charts/DistributionSection'
import kit from '../components/charts/ChartKit.module.css'

// UK CPI dashboard — mirrors the US CPI page (contribution / distribution /
// rates / explorer) on ONS MM23 data. All series are DIRECT equivalents
// (docs/uk-models-mapping.md); no proxy badges needed on this page.
// NOTE: UK CPI is NSA-only — MoM panels carry seasonal variation by design.

type AllData = Record<string, WD[]>

// ── Contribution buckets (HICP special aggregates + published weights) ───────
// Unlike the US page's fixed Dec-2024 weights, ONS publishes the weight series
// (parts per 1000) — contributions use the weight in force at each date.

const CONTRIB_BUCKETS = [
  { key: 'food',     idx: 'DK9O', wt: 'A9EW', label: 'Food, Alcohol & Tobacco', color: '#4ade80' },
  { key: 'energy',   idx: 'DK9T', wt: 'A9F3', label: 'Energy',                  color: '#f59e0b' },
  { key: 'coreGoods', idx: 'DK9J', wt: 'A9ER', label: 'Core Goods (NEIG)',      color: '#60a5fa' },
  { key: 'services', idx: 'D7F5', wt: 'ICVI', label: 'Services',                color: '#a78bfa' },
] as const

const CONTRIB_ITEMS: readonly ContribItem[] = CONTRIB_BUCKETS.map(b => ({ id: b.key, label: b.label, color: b.color }))

// ── CPI divisions (indices, mm23, NSA) ───────────────────────────────────────

const DIVISIONS = [
  { cdid: 'D7BU', label: '01 Food & Non-Alcoholic Beverages' },
  { cdid: 'D7BV', label: '02 Alcohol & Tobacco' },
  { cdid: 'D7BW', label: '03 Clothing & Footwear' },
  { cdid: 'D7BX', label: '04 Housing, Water & Fuels' },
  { cdid: 'D7BY', label: '05 Furniture & Household Equipment' },
  { cdid: 'D7BZ', label: '06 Health' },
  { cdid: 'D7C2', label: '07 Transport' },
  { cdid: 'D7C3', label: '08 Communication' },
  { cdid: 'D7C4', label: '09 Recreation & Culture' },
  { cdid: 'D7C5', label: '10 Education' },
  { cdid: 'D7C6', label: '11 Hotels, Cafes & Restaurants' },
  { cdid: 'D7C7', label: '12 Miscellaneous Goods & Services' },
] as const

// ── Group-level indices (XX.Y) for the distribution panels ──────────────────

const GROUP_INDICES = [
  { cdid: 'D7C8', label: '01.1 Food' },
  { cdid: 'D7C9', label: '01.2 Non-Alcoholic Beverages' },
  { cdid: 'D7CA', label: '02.1 Alcoholic Beverages' },
  { cdid: 'D7CB', label: '02.2 Tobacco' },
  { cdid: 'D7CC', label: '03.1 Clothing' },
  { cdid: 'D7CD', label: '03.2 Footwear' },
  { cdid: 'D7CE', label: '04.1 Actual Rents' },
  { cdid: 'D7CF', label: '04.3 Dwelling Maintenance' },
  { cdid: 'D7CG', label: '04.4 Water & Dwelling Services' },
  { cdid: 'D7CH', label: '04.5 Electricity, Gas & Fuels' },
  { cdid: 'D7CI', label: '05.1 Furniture & Furnishings' },
  { cdid: 'D7CJ', label: '05.2 Household Textiles' },
  { cdid: 'D7CK', label: '05.3 Household Appliances' },
  { cdid: 'D7CL', label: '05.4 Glassware & Tableware' },
  { cdid: 'D7CM', label: '05.5 Tools & Equipment' },
  { cdid: 'D7CN', label: '05.6 Routine Maintenance' },
  { cdid: 'D7F6', label: '06.1 Medical Products' },
  { cdid: 'D7F9', label: '06.2 Out-Patient Services' },
  { cdid: 'D7FC', label: '06.3 Hospital Services' },
  { cdid: 'D7CO', label: '07.1 Purchase of Vehicles' },
  { cdid: 'D7CP', label: '07.2 Personal Transport Operation' },
  { cdid: 'D7CQ', label: '07.3 Transport Services' },
  { cdid: 'D7CR', label: '08.1 Postal Services' },
  { cdid: 'D7CS', label: '09.1 Audio-Visual Equipment' },
  { cdid: 'D7CT', label: '09.2 Other Recreation Durables' },
  { cdid: 'D7CU', label: '09.3 Other Recreational Items' },
  { cdid: 'D7CV', label: '09.4 Recreational & Cultural Services' },
  { cdid: 'D7FJ', label: '09.5 Books & Newspapers' },
  { cdid: 'D7FN', label: '09.6 Package Holidays' },
  { cdid: 'D7CW', label: '11.1 Catering Services' },
  { cdid: 'D7CX', label: '11.2 Accommodation Services' },
  { cdid: 'D7CY', label: '12.1 Personal Care' },
  { cdid: 'D7FO', label: '12.3 Personal Effects' },
  { cdid: 'D7D2', label: '12.4 Social Protection' },
  { cdid: 'D7D3', label: '12.5 Insurance' },
  { cdid: 'D7D4', label: '12.6 Financial Services' },
  { cdid: 'D7FR', label: '12.7 Other Services' },
] as const

// ── Explorer items ───────────────────────────────────────────────────────────

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'D7BT', label: 'CPI — All Items', depth: 0 },
  { id: 'DKC6', label: 'CPI — Core (ex energy, food, alcohol & tobacco)', depth: 0 },
  { id: 'D7F4', label: 'CPI — Goods', depth: 0 },
  { id: 'D7F5', label: 'CPI — Services', depth: 0 },
  { id: 'DK9T', label: 'CPI — Energy', depth: 0 },
  { id: 'DK9J', label: 'CPI — Non-Energy Industrial Goods', depth: 0 },
  { id: 'DK9O', label: 'CPI — Food, Alcohol & Tobacco', depth: 0 },
  ...DIVISIONS.map(d => ({ id: d.cdid, label: `CPI ${d.label}`, depth: 1 })),
  { id: 'L522', label: 'CPIH — All Items', depth: 0 },
  { id: 'CHAW', label: 'RPI — All Items', depth: 0 },
]

const CONTRIB_FETCH = CONTRIB_BUCKETS.flatMap(b => [b.idx, b.wt])
const ALL_CDIDS = [...new Set([
  'D7BT', 'DKC6', 'D7G7', 'L522', 'CHAW', 'D7F4',
  ...CONTRIB_FETCH,
  ...DIVISIONS.map(d => d.cdid),
  ...GROUP_INDICES.map(g => g.cdid),
])]

// ── UK contribution rows: weightₖ(t)/1000 · %Δ indexₖ · 100 ─────────────────

function latestWeightAt(weights: WD[], date: string): number | null {
  // weight series are annual/monthly step functions — take the latest value ≤ date
  let w: number | null = null
  for (const p of weights) {
    if (p.date > date) break
    w = p.value
  }
  return w
}

function buildUkCpiContrib(allData: AllData, mode: 'yoy' | 'mom'): ContribRow[] {
  const headline = allData['D7BT'] ?? []
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
        row[b.key] = (w / 1000) * ((now / prior) - 1) * 100
      }
    }

    const hNow = headMap.get(date)
    const hPrior = headMap.get(priorDate)
    row.line = (hNow != null && hPrior != null && hPrior !== 0) ? (hNow / hPrior - 1) * 100 : null
    return row
  })
}

// Distribution panels now come from the shared
// components/charts/DistributionSection (extracted for Canada Phase 3).

// ══════════════════════════════════════════════════════════════════════════════

export function UKCPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'mm23')
        .then(d => [cdid, d] as [string, WD[]])
        .catch(() => [cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ONS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const contribYoy = useMemo(
    () => Object.keys(allData).length > 0 ? buildUkCpiContrib(allData, 'yoy') : [],
    [allData]
  )
  const contribMom = useMemo(
    () => Object.keys(allData).length > 0 ? buildUkCpiContrib(allData, 'mom') : [],
    [allData]
  )

  const distCdids = useMemo(() => GROUP_INDICES.map(g => g.cdid), [])
  const distWide = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, distCdids, DIST_BUCKETS_WIDE) : [],
    [allData, distCdids]
  )
  const distNarrow = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, distCdids, DIST_BUCKETS_NARROW) : [],
    [allData, distCdids]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CDIDS.length} ONS CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (MM23) &mdash; monthly, 2015=100, not seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <ContribSection
          title="UK CPI — YoY Contribution"
          subtitle="Weight-based contribution to CPI All Items YoY %Δ (published ONS weights)"
          data={contribYoy}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="CPI YoY"
          clipPrefix="ukcpiyoy"
        />
        <ContribSection
          title="UK CPI — MoM Contribution"
          subtitle="Weight-based contribution to CPI All Items MoM %Δ (NSA)"
          data={contribMom}
          items={CONTRIB_ITEMS}
          lineKey="line"
          lineLabel="CPI MoM"
          clipPrefix="ukcpimom"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Headline CPI"
          subtitle="D7BT — YoY / annualized (NSA: short-run rates carry seasonality)"
          data={allData['D7BT'] ?? []}
        />
        <RatesChart
          title="Core CPI (ex energy, food, alcohol & tobacco)"
          subtitle="DKC6 — YoY / annualized (NSA)"
          data={allData['DKC6'] ?? []}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <DistributionSection
          title="CPI Distribution — Wide Buckets"
          subtitle="Share of 37 COICOP group indices by YoY range"
          data={distWide}
          buckets={DIST_BUCKETS_WIDE}
        />
        <DistributionSection
          title="CPI Distribution — Narrow Buckets"
          subtitle="Share of 37 COICOP group indices by YoY range"
          data={distNarrow}
          buckets={DIST_BUCKETS_NARROW}
        />
      </div>

      <SeriesExplorer
        title="UK CPI Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={allData}
        defaultId="D7BT"
        unitLabel="Index, 2015=100, NSA"
      />
    </>
  )
}
