import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountrySections, type CountrySections } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const FiscalFlowsContent = lazy(() => import('./FiscalFlowsPage').then(m => ({ default: m.FiscalFlowsContent })))
const MtsContent = lazy(() => import('./MtsPage').then(m => ({ default: m.MtsContent })))
const UKFiscalPSFContent = lazy(() => import('./UKFiscalPSFContent').then(m => ({ default: m.UKFiscalPSFContent })))
const UKHMRCReceiptsContent = lazy(() => import('./UKHMRCReceiptsContent').then(m => ({ default: m.UKHMRCReceiptsContent })))
const CAFiscalGFSContent = lazy(() => import('./CAFiscalGFSContent').then(m => ({ default: m.CAFiscalGFSContent })))
const CAFiscalDebtContent = lazy(() => import('./CAFiscalDebtContent').then(m => ({ default: m.CAFiscalDebtContent })))

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

// Canada fiscal is restructured onto quarterly GFS + monthly central-government
// debt; the monthly Fiscal Monitor is a deferred collector (docs/ca-models-mapping.md).
const CA_FISCAL_SECTIONS = [
  { key: 'gfs', label: 'GFS BALANCE' },
  { key: 'debt', label: 'FEDERAL DEBT' },
] as const

const FISCAL_NAV: Record<string, CountrySections> = {
  us: { sections: FISCAL_SECTIONS, defaultKey: 'dts', accent: '#f87171' },
  uk: { sections: UK_FISCAL_SECTIONS, defaultKey: 'psf', accent: '#14b8a6' },
  ca: { sections: CA_FISCAL_SECTIONS, defaultKey: 'gfs', accent: '#f59e0b' },
}

export function FiscalPage() {
  const { country, setCountry, cfg, section, setSection } = useCountrySections(FISCAL_NAV)

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
          sections={cfg?.sections}
          activeSection={section}
          onSelectSection={setSection}
          sectionAccent={cfg?.accent}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'dts' && <FiscalFlowsContent />}
            {section === 'mts' && <MtsContent />}
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'psf' && <UKFiscalPSFContent />}
            {section === 'receipts' && <UKHMRCReceiptsContent />}
          </Suspense>
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'gfs' && <CAFiscalGFSContent />}
            {section === 'debt' && <CAFiscalDebtContent />}
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
