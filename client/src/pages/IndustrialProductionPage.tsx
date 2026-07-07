import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const IPExplorerDashboardContent = lazy(() => import('./IPExplorerDashboardPage').then(m => ({ default: m.IPExplorerDashboardContent })))
const UKIoPContent = lazy(() => import('./UKIoPContent').then(m => ({ default: m.UKIoPContent })))

const IP_SECTIONS = [
  { key: 'ip-explorer', label: 'IP EXPLORER' },
] as const

const UK_IP_SECTIONS = [
  { key: 'iop', label: 'IOP EXPLORER' },
] as const

export function IndustrialProductionPage() {
  const [country, setCountry] = useCountryParam()

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}>{country === 'us' && <FredRefreshButton />}</div>
      </header>

      <main className={styles.body}>
        <CountryCategoryNav
          country={country}
          onSelectCountry={setCountry}
          activeCategory="industrial"
          sections={country === 'us' ? IP_SECTIONS : country === 'uk' ? UK_IP_SECTIONS : undefined}
          activeSection={country === 'us' ? 'ip-explorer' : 'iop'}
          sectionAccent={country === 'us' ? '#f87171' : '#14b8a6'}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <IPExplorerDashboardContent />
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <UKIoPContent />
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} industrial production models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
