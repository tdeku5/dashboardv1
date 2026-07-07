import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import { type WD, buildContribSeries } from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ContribSection, type ContribItem } from '../components/charts/ContribSection'
import styles from './RetailSalesDashboardPage.module.css'

// 2026-07 (UK models Phase 3): the inline explorer / rates / contribution
// implementations were extracted into the shared parameterized components in
// components/charts (SeriesExplorer, RatesChart, ContribSection) and
// lib/seriesTransforms. This page is the canonical US consumer of all three.

type AllData = Record<string, WD[]>

// ── Retail hierarchy ─────────────────────────────────────────────────────────

const RETAIL_HIERARCHY: ExplorerItem[] = [
  { id: 'RSAFS',          label: 'Retail Trade and Food Services',                            depth: 0 },
  { id: 'RSFSXMV',        label: 'Retail Trade and Food Services, ex Auto',                   depth: 0 },
  { id: 'MRTSSM44W72USS', label: 'Retail Trade and Food Services, ex Auto and Gas',           depth: 0 },
  { id: 'RSMVPD',         label: 'Motor Vehicle and Parts Dealers',                           depth: 0 },
  { id: 'RSGASS',         label: 'Gasoline Stations',                                         depth: 0 },
  { id: 'MRTSSM4413USS',  label: 'Auto Parts, Accessories, and Tires Stores',                 depth: 0 },
  { id: 'RSFHFS',         label: 'Furniture and Home Furnishings Stores',                     depth: 0 },
  { id: 'RSEAS',          label: 'Electronics and Appliance Stores',                          depth: 0 },
  { id: 'RSBMGESD',       label: 'Building Material and Garden Equipment & Supplies Dealers', depth: 0 },
  { id: 'RSDBS',          label: 'Food and Beverage Stores',                                  depth: 0 },
  { id: 'RSHPCS',         label: 'Health and Personal Care Stores',                           depth: 0 },
  { id: 'RSCCAS',         label: 'Clothing and Clothing Access. Stores',                      depth: 0 },
  { id: 'RSSGHBMS',       label: 'Sporting Goods, Hobby, Book, and Music Stores',             depth: 0 },
  { id: 'RSGMS',          label: 'General Merchandise Stores',                                depth: 0 },
  { id: 'RSMSR',          label: 'Miscellaneous Store Retailers',                             depth: 0 },
  { id: 'RSNSR',          label: 'Nonstore Retailers',                                        depth: 0 },
  { id: 'RSFSDP',         label: 'Food Services and Drinking Places',                         depth: 0 },
]

const FRED_SERIES_IDS = RETAIL_HIERARCHY.map(n => n.id)

const RETAIL_CONTRIB_ITEMS: readonly ContribItem[] = [
  { id: 'mvpd',         label: 'Motor Vehicle & Parts',            color: '#60a5fa' },
  { id: 'gas',          label: 'Gasoline Stations',                color: '#f59e0b' },
  { id: 'foodServices', label: 'Food Services & Drinking Places',  color: '#fb7185' },
  { id: 'furn',         label: 'Furniture & Home Furnishings',     color: '#a78bfa' },
  { id: 'elec',         label: 'Electronics & Appliance',          color: '#f87171' },
  { id: 'bldg',         label: 'Building Material & Garden',       color: '#fb923c' },
  { id: 'food',         label: 'Food & Beverage Stores',           color: '#4ade80' },
  { id: 'health',       label: 'Health & Personal Care',           color: '#38bdf8' },
  { id: 'clothing',     label: 'Clothing & Accessories',           color: '#e879f9' },
  { id: 'sport',        label: 'Sporting/Hobby/Book/Music',        color: '#fbbf24' },
  { id: 'genmerch',     label: 'General Merchandise',              color: '#818cf8' },
  { id: 'misc',         label: 'Miscellaneous Retailers',          color: '#94a3b8' },
  { id: 'nonstore',     label: 'Nonstore Retailers',               color: '#2dd4bf' },
]

const RETAIL_CONTRIB_COMPONENTS = [
  { key: 'mvpd',         seriesId: 'RSMVPD'   },
  { key: 'gas',          seriesId: 'RSGASS'   },
  { key: 'foodServices', seriesId: 'RSFSDP'   },
  { key: 'furn',         seriesId: 'RSFHFS'   },
  { key: 'elec',         seriesId: 'RSEAS'    },
  { key: 'bldg',         seriesId: 'RSBMGESD' },
  { key: 'food',         seriesId: 'RSDBS'    },
  { key: 'health',       seriesId: 'RSHPCS'   },
  { key: 'clothing',     seriesId: 'RSCCAS'   },
  { key: 'sport',        seriesId: 'RSSGHBMS' },
  { key: 'genmerch',     seriesId: 'RSGMS'    },
  { key: 'misc',         seriesId: 'RSMSR'    },
  { key: 'nonstore',     seriesId: 'RSNSR'    },
] as const

function fmtMillions(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}B`
  return `${v.toFixed(0)}M`
}

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function RetailSalesDashboardContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          FRED_SERIES_IDS.map(async (id) => {
            const obs = await fetchFredSeries(id)
            return [id, parseObs(obs)] as [string, WD[]]
          })
        )
        if (cancelled) return
        setAllData(Object.fromEntries(entries))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to fetch data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const retailContribYoyData = useMemo(
    () => Object.keys(allData).length > 0
      ? buildContribSeries(allData, 'RSAFS', RETAIL_CONTRIB_COMPONENTS, 'line', 'yoy')
      : [],
    [allData]
  )

  const retailContribMomData = useMemo(
    () => Object.keys(allData).length > 0
      ? buildContribSeries(allData, 'RSAFS', RETAIL_CONTRIB_COMPONENTS, 'line', 'mom')
      : [],
    [allData]
  )

  return (
    <>
      <div className={styles.majorHeader}>Retail Sales Dashboard</div>
      <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
        U.S. Census Bureau &mdash; monthly, millions of dollars, seasonally adjusted
      </div>

      {loading && (
        <div className={styles.statusBlock}>Loading {FRED_SERIES_IDS.length} retail sales series...</div>
      )}
      {error && (
        <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
      )}

      {!loading && !error && Object.keys(allData).length > 0 && (
        <>
          <div className={styles.twoColGrid}>
            <ContribSection
              title="Retail Sales — YoY Contribution"
              subtitle="Weighted contribution to Total Retail Sales (RSAFS) YoY %Δ"
              data={retailContribYoyData}
              items={RETAIL_CONTRIB_ITEMS}
              lineKey="line"
              lineLabel="Total YoY"
              clipPrefix="rcyoy"
            />
            <ContribSection
              title="Retail Sales — MoM Contribution"
              subtitle="Weighted contribution to Total Retail Sales (RSAFS) MoM %Δ"
              data={retailContribMomData}
              items={RETAIL_CONTRIB_ITEMS}
              lineKey="line"
              lineLabel="Total MoM"
              clipPrefix="rcmom"
            />
          </div>

          <div className={styles.majorHeader}>Retail Sales Growth Rates</div>

          <div className={styles.twoColGrid}>
            <RatesChart title="Retail Sales" data={allData['RSAFS'] ?? []} />
            <RatesChart title="Retail Sales ex Auto" data={allData['RSFSXMV'] ?? []} />
          </div>

          <SeriesExplorer
            title="Retail Sales Explorer"
            selectorLabel="Category"
            items={RETAIL_HIERARCHY}
            data={allData}
            defaultId="RSAFS"
            unitLabel="Millions of dollars, seasonally adjusted"
            levelFormatter={fmtMillions}
          />
        </>
      )}
    </>
  )
}

export function RetailSalesDashboardPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}><FredRefreshButton /></div>
      </header>
      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/growth" className={styles.breadcrumbLink}>Growth</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Retail Sales</span>
      </nav>
      <div className={styles.body}>
        <RetailSalesDashboardContent />
      </div>
    </div>
  )
}
