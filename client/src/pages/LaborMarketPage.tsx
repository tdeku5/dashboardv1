import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES, CATEGORIES } from './modelNav'
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
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('cps')
  const [ukSection, setUkSection] = useState<string>('lfs')
  const navigate = useNavigate()

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
        <div className={styles.countryBar}>
          {COUNTRIES.map((c, idx) => (
            <button
              key={c.key}
              className={`${styles.countryBtn} ${country === c.key ? styles.countryBtnActive : ''}`}
              onClick={() => setCountry(c.key)}
              style={{
                border: `1px solid ${country === c.key ? '#60a5fa' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className={styles.categoryBar}>
          {CATEGORIES.map((cat, idx) => (
            <button
              key={cat.key}
              className={`${styles.categoryBtn} ${cat.key === 'labor' ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== 'labor') navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === 'labor' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {country === 'us' ? (
          <>
          <div className={styles.sectionBar}>
            {LABOR_SECTIONS.map((sec, idx) => (
              <button
                key={sec.key}
                className={`${styles.sectionBtn} ${section === sec.key ? styles.sectionBtnActive : ''}`}
                onClick={() => setSection(sec.key)}
                style={{
                  border: `1px solid ${section === sec.key ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`,
                  ...(idx > 0 ? { borderLeft: 'none' } : {}),
                }}
              >
                {sec.label}
              </button>
            ))}
          </div>
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'projection' && <LaborModelsContent />}
            {section === 'cps' && <CPSDashboardContent />}
            {section === 'ces' && <CESDashboardContent />}
            {section === 'jolts' && <JOLTSDashboardContent />}
            {section === 'claims' && <ClaimsDashboardContent />}
            {section === 'productivity' && <ProductivityContent />}
          </Suspense>
          </>
        ) : country === 'uk' ? (
          <>
          <div className={styles.sectionBar}>
            {UK_LABOR_SECTIONS.map((sec, idx) => (
              <button
                key={sec.key}
                className={`${styles.sectionBtn} ${ukSection === sec.key ? styles.sectionBtnActive : ''}`}
                onClick={() => setUkSection(sec.key)}
                style={{
                  border: `1px solid ${ukSection === sec.key ? '#14b8a6' : 'rgba(255, 255, 255, 0.12)'}`,
                  ...(idx > 0 ? { borderLeft: 'none' } : {}),
                }}
              >
                {sec.label}
              </button>
            ))}
          </div>
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {ukSection === 'lfs' && <UKLFSContent />}
            {ukSection === 'claimant' && <UKClaimantContent />}
            {ukSection === 'earnings' && <UKEarningsContent />}
            {ukSection === 'vacancies' && <UKVacanciesContent />}
            {ukSection === 'productivity' && <UKProductivityContent />}
            {ukSection === 'projection' && <UKLaborProjectionContent />}
          </Suspense>
          </>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} labor models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
