import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam, useTabParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const LaborModelsContent = lazy(() => import('./LaborModelsPage').then(m => ({ default: m.LaborModelsContent })))
const CPSDashboardContent = lazy(() => import('./CPSDashboardPage').then(m => ({ default: m.CPSDashboardContent })))
const CESDashboardContent = lazy(() => import('./CESDashboardPage').then(m => ({ default: m.CESDashboardContent })))
const JOLTSDashboardContent = lazy(() => import('./JOLTSDashboardPage').then(m => ({ default: m.JOLTSDashboardContent })))
const ClaimsDashboardContent = lazy(() => import('./ClaimsDashboardPage').then(m => ({ default: m.ClaimsDashboardContent })))
const ProductivityContent = lazy(() => import('./ProductivityPage').then(m => ({ default: m.ProductivityContent })))
const UKLFSContent = lazy(() => import('./UKLFSContent').then(m => ({ default: m.UKLFSContent })))
const UKClaimantContent = lazy(() => import('./UKClaimantContent').then(m => ({ default: m.UKClaimantContent })))
const UKEarningsContent = lazy(() => import('./UKEarningsContent').then(m => ({ default: m.UKEarningsContent })))
const UKVacanciesContent = lazy(() => import('./UKVacanciesContent').then(m => ({ default: m.UKVacanciesContent })))
const UKProductivityContent = lazy(() => import('./UKProductivityContent').then(m => ({ default: m.UKProductivityContent })))
const UKLaborProjectionContent = lazy(() => import('./UKLaborProjectionContent').then(m => ({ default: m.UKLaborProjectionContent })))

const LABOR_SECTIONS = [
  { key: 'projection', label: 'U-3 PROJECTION' },
  { key: 'cps', label: 'CPS' },
  { key: 'ces', label: 'CES' },
  { key: 'jolts', label: 'JOLTS' },
  { key: 'claims', label: 'CLAIMS' },
  { key: 'productivity', label: 'PRODUCTIVITY' },
] as const

const UK_LABOR_SECTIONS = [
  { key: 'lfs', label: 'LFS' },
  { key: 'claimant', label: 'CLAIMANT COUNT' },
  { key: 'earnings', label: 'EARNINGS & PAYROLLS' },
  { key: 'vacancies', label: 'VACANCIES' },
  { key: 'productivity', label: 'PRODUCTIVITY' },
  { key: 'projection', label: 'PROJECTION' },
] as const

export function LaborMarketPage() {
  const [country, setCountry] = useCountryParam()
  const [section, setSection] = useTabParam(LABOR_SECTIONS.map(s => s.key), 'cps')
  const [ukSection, setUkSection] = useTabParam(UK_LABOR_SECTIONS.map(s => s.key), 'lfs')

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
          activeCategory="labor"
          sections={country === 'us' ? LABOR_SECTIONS : country === 'uk' ? UK_LABOR_SECTIONS : undefined}
          activeSection={country === 'us' ? section : ukSection}
          onSelectSection={country === 'us' ? setSection : setUkSection}
          sectionAccent={country === 'us' ? '#f87171' : '#14b8a6'}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'projection' && <LaborModelsContent />}
            {section === 'cps' && <CPSDashboardContent />}
            {section === 'ces' && <CESDashboardContent />}
            {section === 'jolts' && <JOLTSDashboardContent />}
            {section === 'claims' && <ClaimsDashboardContent />}
            {section === 'productivity' && <ProductivityContent />}
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {ukSection === 'lfs' && <UKLFSContent />}
            {ukSection === 'claimant' && <UKClaimantContent />}
            {ukSection === 'earnings' && <UKEarningsContent />}
            {ukSection === 'vacancies' && <UKVacanciesContent />}
            {ukSection === 'productivity' && <UKProductivityContent />}
            {ukSection === 'projection' && <UKLaborProjectionContent />}
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} labor models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
