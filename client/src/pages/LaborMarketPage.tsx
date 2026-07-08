import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountrySections, type CountrySections } from '../lib/modelNavParams'
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
const CALFSContent = lazy(() => import('./CALFSContent').then(m => ({ default: m.CALFSContent })))
const CAEIContent = lazy(() => import('./CAEIContent').then(m => ({ default: m.CAEIContent })))
const CAPayrollsContent = lazy(() => import('./CAPayrollsContent').then(m => ({ default: m.CAPayrollsContent })))
const CAVacanciesContent = lazy(() => import('./CAVacanciesContent').then(m => ({ default: m.CAVacanciesContent })))
const CAProductivityContent = lazy(() => import('./CAProductivityContent').then(m => ({ default: m.CAProductivityContent })))
const CALaborProjectionContent = lazy(() => import('./CALaborProjectionContent').then(m => ({ default: m.CALaborProjectionContent })))
const JPLFSContent = lazy(() => import('./JPLFSContent').then(m => ({ default: m.JPLFSContent })))
const JPJobOffersContent = lazy(() => import('./JPJobOffersContent').then(m => ({ default: m.JPJobOffersContent })))
const JPWagesContent = lazy(() => import('./JPWagesContent').then(m => ({ default: m.JPWagesContent })))
const JPLaborProjectionContent = lazy(() => import('./JPLaborProjectionContent').then(m => ({ default: m.JPLaborProjectionContent })))
const EU3UnemploymentContent = lazy(() => import('./EU3UnemploymentContent').then(m => ({ default: m.EU3UnemploymentContent })))
const EU3EmploymentContent = lazy(() => import('./EU3EmploymentContent').then(m => ({ default: m.EU3EmploymentContent })))
const EU3VacanciesContent = lazy(() => import('./EU3VacanciesContent').then(m => ({ default: m.EU3VacanciesContent })))
const EU3LabourCostsContent = lazy(() => import('./EU3LabourCostsContent').then(m => ({ default: m.EU3LabourCostsContent })))
const AULabourForceContent = lazy(() => import('./AULabourForceContent').then(m => ({ default: m.AULabourForceContent })))
const AUEmploymentContent = lazy(() => import('./AUEmploymentContent').then(m => ({ default: m.AUEmploymentContent })))
const AUUnderutilisationContent = lazy(() => import('./AUUnderutilisationContent').then(m => ({ default: m.AUUnderutilisationContent })))
const AUVacanciesContent = lazy(() => import('./AUVacanciesContent').then(m => ({ default: m.AUVacanciesContent })))
const AUWagesContent = lazy(() => import('./AUWagesContent').then(m => ({ default: m.AUWagesContent })))
const AULaborProjectionContent = lazy(() => import('./AULaborProjectionContent').then(m => ({ default: m.AULaborProjectionContent })))

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

const CA_LABOR_SECTIONS = [
  { key: 'lfs', label: 'LFS' },
  { key: 'ei', label: 'EI BENEFICIARIES' },
  { key: 'payrolls', label: 'PAYROLLS & EARNINGS' },
  { key: 'vacancies', label: 'VACANCIES' },
  { key: 'productivity', label: 'PRODUCTIVITY' },
  { key: 'projection', label: 'PROJECTION' },
] as const

// Japan: no weekly-claims concept; the job-offers ratio is the JOLTS analog;
// WAGES is thin per decision (e) — full MLS wages are file-only and deferred.
const JP_LABOR_SECTIONS = [
  { key: 'lfs', label: 'LFS' },
  { key: 'joboffers', label: 'JOB OFFERS' },
  { key: 'wages', label: 'WAGES' },
  { key: 'projection', label: 'PROJECTION' },
] as const

// DE/FR/IT shared structure; no claims concept, no projection tab (decision i
// — quarterly inputs under-determine a monthly mechanical model).
const EU3_LABOR_SECTIONS = [
  { key: 'unemployment', label: 'UNEMPLOYMENT' },
  { key: 'employment', label: 'EMPLOYMENT' },
  { key: 'vacancies', label: 'VACANCIES' },
  { key: 'labour-costs', label: 'LABOUR COSTS' },
] as const

const LABOR_NAV: Record<string, CountrySections> = {
  us: { sections: LABOR_SECTIONS, defaultKey: 'cps', accent: '#f87171' },
  uk: { sections: UK_LABOR_SECTIONS, defaultKey: 'lfs', accent: '#14b8a6' },
  ca: { sections: CA_LABOR_SECTIONS, defaultKey: 'lfs', accent: '#f59e0b' },
  jp: { sections: JP_LABOR_SECTIONS, defaultKey: 'lfs', accent: '#e879f9' },
  de: { sections: EU3_LABOR_SECTIONS, defaultKey: 'unemployment', accent: '#a3e635' },
  fr: { sections: EU3_LABOR_SECTIONS, defaultKey: 'unemployment', accent: '#60a5fa' },
  it: { sections: EU3_LABOR_SECTIONS, defaultKey: 'unemployment', accent: '#34d399' },
  // Australia: no payrolls tab (STP series discontinued Jul-2025 — decision c);
  // PROJECTION builds because all inputs are monthly (decision h, vs the EU3 omit).
  au: {
    sections: [
      { key: 'labour-force', label: 'LABOUR FORCE' },
      { key: 'employment', label: 'EMPLOYMENT' },
      { key: 'underutilisation', label: 'UNDERUTILISATION' },
      { key: 'vacancies', label: 'VACANCIES' },
      { key: 'wages', label: 'WAGES' },
      { key: 'projection', label: 'PROJECTION' },
    ],
    defaultKey: 'labour-force', accent: '#facc15',
  },
}

const EU3_CC = { de: 'DE', fr: 'FR', it: 'IT' } as const

export function LaborMarketPage() {
  const { country, setCountry, cfg, section, setSection } = useCountrySections(LABOR_NAV)

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
          sections={cfg?.sections}
          activeSection={section}
          onSelectSection={setSection}
          sectionAccent={cfg?.accent}
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
            {section === 'lfs' && <UKLFSContent />}
            {section === 'claimant' && <UKClaimantContent />}
            {section === 'earnings' && <UKEarningsContent />}
            {section === 'vacancies' && <UKVacanciesContent />}
            {section === 'productivity' && <UKProductivityContent />}
            {section === 'projection' && <UKLaborProjectionContent />}
          </Suspense>
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'lfs' && <CALFSContent />}
            {section === 'ei' && <CAEIContent />}
            {section === 'payrolls' && <CAPayrollsContent />}
            {section === 'vacancies' && <CAVacanciesContent />}
            {section === 'productivity' && <CAProductivityContent />}
            {section === 'projection' && <CALaborProjectionContent />}
          </Suspense>
        ) : country === 'jp' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'lfs' && <JPLFSContent />}
            {section === 'joboffers' && <JPJobOffersContent />}
            {section === 'wages' && <JPWagesContent />}
            {section === 'projection' && <JPLaborProjectionContent />}
          </Suspense>
        ) : country in EU3_CC ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'unemployment' && <EU3UnemploymentContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'employment' && <EU3EmploymentContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'vacancies' && <EU3VacanciesContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'labour-costs' && <EU3LabourCostsContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
          </Suspense>
        ) : country === 'au' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'labour-force' && <AULabourForceContent />}
            {section === 'employment' && <AUEmploymentContent />}
            {section === 'underutilisation' && <AUUnderutilisationContent />}
            {section === 'vacancies' && <AUVacanciesContent />}
            {section === 'wages' && <AUWagesContent />}
            {section === 'projection' && <AULaborProjectionContent />}
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
