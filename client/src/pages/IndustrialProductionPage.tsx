import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountrySections, type CountrySections } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const IPExplorerDashboardContent = lazy(() => import('./IPExplorerDashboardPage').then(m => ({ default: m.IPExplorerDashboardContent })))
const UKIoPContent = lazy(() => import('./UKIoPContent').then(m => ({ default: m.UKIoPContent })))
const CAIndustrialContent = lazy(() => import('./CAIndustrialContent').then(m => ({ default: m.CAIndustrialContent })))
const JPIIPContent = lazy(() => import('./JPIIPContent').then(m => ({ default: m.JPIIPContent })))
const JPPPIContent = lazy(() => import('./JPPPIContent').then(m => ({ default: m.JPPPIContent })))

const IP_SECTIONS = [
  { key: 'ip-explorer', label: 'IP EXPLORER' },
] as const

const UK_IP_SECTIONS = [
  { key: 'iop', label: 'IOP EXPLORER' },
] as const

const CA_IP_SECTIONS = [
  { key: 'industrial', label: 'GDP BY INDUSTRY' },
] as const

// Japan carries the BoJ PPI here per the Phase 3 approval (verified decision h).
const JP_IP_SECTIONS = [
  { key: 'iip', label: 'IIP' },
  { key: 'ppi', label: 'PPI (BOJ)' },
] as const

const IP_NAV: Record<string, CountrySections> = {
  us: { sections: IP_SECTIONS, defaultKey: 'ip-explorer', accent: '#f87171' },
  uk: { sections: UK_IP_SECTIONS, defaultKey: 'iop', accent: '#14b8a6' },
  ca: { sections: CA_IP_SECTIONS, defaultKey: 'industrial', accent: '#f59e0b' },
  jp: { sections: JP_IP_SECTIONS, defaultKey: 'iip', accent: '#e879f9' },
}

export function IndustrialProductionPage() {
  const { country, setCountry, cfg, section, setSection } = useCountrySections(IP_NAV)

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
          sections={cfg?.sections}
          activeSection={section}
          onSelectSection={country === 'jp' ? setSection : undefined}
          sectionAccent={cfg?.accent}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <IPExplorerDashboardContent />
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <UKIoPContent />
          </Suspense>
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <CAIndustrialContent />
          </Suspense>
        ) : country === 'jp' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'iip' && <JPIIPContent />}
            {section === 'ppi' && <JPPPIContent />}
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
