import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam, useTabParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const FiscalFlowsContent = lazy(() => import('./FiscalFlowsPage').then(m => ({ default: m.FiscalFlowsContent })))
const MtsContent = lazy(() => import('./MtsPage').then(m => ({ default: m.MtsContent })))
const UKFiscalPSFContent = lazy(() => import('./UKFiscalPSFContent').then(m => ({ default: m.UKFiscalPSFContent })))
const UKHMRCReceiptsContent = lazy(() => import('./UKHMRCReceiptsContent').then(m => ({ default: m.UKHMRCReceiptsContent })))

const FISCAL_SECTIONS = [
  { key: 'dts', label: 'DTS FLOWS' },
  { key: 'mts', label: 'MTS BALANCE' },
] as const

// UK fiscal is restructured around monthly Public Sector Finances — the UK
// publishes no DTS-style daily flows (docs/uk-models-mapping.md).
const UK_FISCAL_SECTIONS = [
  { key: 'psf', label: 'PSF BORROWING' },
  { key: 'receipts', label: 'HMRC RECEIPTS' },
] as const

export function FiscalPage() {
  const [country, setCountry] = useCountryParam()
  const [section, setSection] = useTabParam(FISCAL_SECTIONS.map(s => s.key), 'dts')
  const [ukSection, setUkSection] = useTabParam(UK_FISCAL_SECTIONS.map(s => s.key), 'psf')

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
          activeCategory="fiscal"
          sections={country === 'us' ? FISCAL_SECTIONS : country === 'uk' ? UK_FISCAL_SECTIONS : undefined}
          activeSection={country === 'us' ? section : ukSection}
          onSelectSection={country === 'us' ? setSection : setUkSection}
          sectionAccent={country === 'us' ? '#f87171' : '#14b8a6'}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'dts' && <FiscalFlowsContent />}
            {section === 'mts' && <MtsContent />}
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {ukSection === 'psf' && <UKFiscalPSFContent />}
            {ukSection === 'receipts' && <UKHMRCReceiptsContent />}
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} fiscal models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
