import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES, CATEGORIES } from './modelNav'
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
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('dts')
  const [ukSection, setUkSection] = useState<string>('psf')
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
              className={`${styles.categoryBtn} ${cat.key === 'fiscal' ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== 'fiscal') navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === 'fiscal' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
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
            {FISCAL_SECTIONS.map((sec, idx) => (
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
            {section === 'dts' && <FiscalFlowsContent />}
            {section === 'mts' && <MtsContent />}
          </Suspense>
          </>
        ) : country === 'uk' ? (
          <>
          <div className={styles.sectionBar}>
            {UK_FISCAL_SECTIONS.map((sec, idx) => (
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
            {ukSection === 'psf' && <UKFiscalPSFContent />}
            {ukSection === 'receipts' && <UKHMRCReceiptsContent />}
          </Suspense>
          </>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} fiscal models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
