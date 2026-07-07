import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam, useTabParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const CPIDashboardContent = lazy(() => import('./CPIDashboardPage').then(m => ({ default: m.CPIDashboardContent })))
const CPIProjectionsContent = lazy(() => import('./CPIProjectionsPage').then(m => ({ default: m.CPIProjectionsContent })))
const PCEDashboardContent = lazy(() => import('./PCEDashboardPage').then(m => ({ default: m.PCEDashboardContent })))
const PCEProjectionsContent = lazy(() => import('./PCEProjectionsPage').then(m => ({ default: m.PCEProjectionsContent })))
const PPIDashboardContent = lazy(() => import('./PPIDashboardPage').then(m => ({ default: m.PPIDashboardContent })))
const OtherInflationContent = lazy(() => import('./OtherInflationPage').then(m => ({ default: m.OtherInflationContent })))
const UKCPIContent = lazy(() => import('./UKCPIContent').then(m => ({ default: m.UKCPIContent })))
const UKCPIProjectionsContent = lazy(() => import('./UKCPIProjectionsContent').then(m => ({ default: m.UKCPIProjectionsContent })))
const UKPPIContent = lazy(() => import('./UKPPIContent').then(m => ({ default: m.UKPPIContent })))
const UKOtherInflationContent = lazy(() => import('./UKOtherInflationContent').then(m => ({ default: m.UKOtherInflationContent })))

const INFLATION_SECTIONS = [
  { key: 'cpi', label: 'CPI' },
  { key: 'cpi-proj', label: 'CPI PROJECTIONS' },
  { key: 'pce', label: 'PCE' },
  { key: 'pce-proj', label: 'PCE PROJECTIONS' },
  { key: 'ppi', label: 'PPI' },
  { key: 'other', label: 'OTHER' },
] as const

// No UK PCE sections: the UK publishes no monthly consumption deflator
// (docs/uk-models-mapping.md — PCE pages classified GAP, omitted by decision).
const UK_INFLATION_SECTIONS = [
  { key: 'cpi', label: 'CPI' },
  { key: 'cpi-proj', label: 'CPI PROJECTIONS' },
  { key: 'ppi', label: 'PPI' },
  { key: 'other', label: 'OTHER' },
] as const

export function InflationPage() {
  const [country, setCountry] = useCountryParam()
  const [section, setSection] = useTabParam(INFLATION_SECTIONS.map(s => s.key), 'cpi')
  const [ukSection, setUkSection] = useTabParam(UK_INFLATION_SECTIONS.map(s => s.key), 'cpi')

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
          activeCategory="inflation"
          sections={country === 'us' ? INFLATION_SECTIONS : country === 'uk' ? UK_INFLATION_SECTIONS : undefined}
          activeSection={country === 'us' ? section : ukSection}
          onSelectSection={country === 'us' ? setSection : setUkSection}
          sectionAccent={country === 'us' ? '#f87171' : '#14b8a6'}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'cpi' && <CPIDashboardContent />}
            {section === 'cpi-proj' && <CPIProjectionsContent />}
            {section === 'pce' && <PCEDashboardContent />}
            {section === 'pce-proj' && <PCEProjectionsContent />}
            {section === 'ppi' && <PPIDashboardContent />}
            {section === 'other' && <OtherInflationContent />}
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {ukSection === 'cpi' && <UKCPIContent />}
            {ukSection === 'cpi-proj' && <UKCPIProjectionsContent />}
            {ukSection === 'ppi' && <UKPPIContent />}
            {ukSection === 'other' && <UKOtherInflationContent />}
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} inflation models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
