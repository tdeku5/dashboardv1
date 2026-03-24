import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { COUNTRIES, CATEGORIES } from './modelNav'
import styles from './ModelsPage.module.css'

const CPIDashboardContent = lazy(() => import('./CPIDashboardPage').then(m => ({ default: m.CPIDashboardContent })))
const CPIProjectionsContent = lazy(() => import('./CPIProjectionsPage').then(m => ({ default: m.CPIProjectionsContent })))
const PCEDashboardContent = lazy(() => import('./PCEDashboardPage').then(m => ({ default: m.PCEDashboardContent })))
const PCEProjectionsContent = lazy(() => import('./PCEProjectionsPage').then(m => ({ default: m.PCEProjectionsContent })))
const PPIDashboardContent = lazy(() => import('./PPIDashboardPage').then(m => ({ default: m.PPIDashboardContent })))
const OtherInflationContent = lazy(() => import('./OtherInflationPage').then(m => ({ default: m.OtherInflationContent })))

const INFLATION_SECTIONS = [
  { key: 'cpi', label: 'CPI' },
  { key: 'cpi-proj', label: 'CPI PROJECTIONS' },
  { key: 'pce', label: 'PCE' },
  { key: 'pce-proj', label: 'PCE PROJECTIONS' },
  { key: 'ppi', label: 'PPI' },
  { key: 'other', label: 'OTHER' },
] as const

export function InflationPage() {
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('cpi')
  const navigate = useNavigate()

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      <main className={styles.body}>
        <div className={styles.countryBar}>
          {COUNTRIES.map((c, idx) => (
            <button
              key={c.key}
              className={`${styles.countryBtn} ${country === c.key ? styles.countryBtnActive : ''}`}
              onClick={() => setCountry(c.key)}
              style={{
                border: `1px solid ${country === c.key ? '#FFD700' : 'rgba(255, 255, 255, 0.15)'}`,
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
              className={`${styles.categoryBtn} ${cat.key === 'inflation' ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== 'inflation') navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === 'inflation' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className={styles.sectionBar}>
          {INFLATION_SECTIONS.map((sec, idx) => (
            <button
              key={sec.key}
              className={`${styles.sectionBtn} ${section === sec.key ? styles.sectionBtnActive : ''}`}
              onClick={() => setSection(sec.key)}
              style={{
                border: `1px solid ${section === sec.key ? '#4EC9B0' : 'rgba(255, 255, 255, 0.12)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {sec.label}
            </button>
          ))}
        </div>

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'cpi' && <CPIDashboardContent />}
            {section === 'cpi-proj' && <CPIProjectionsContent />}
            {section === 'pce' && <PCEDashboardContent />}
            {section === 'pce-proj' && <PCEProjectionsContent />}
            {section === 'ppi' && <PPIDashboardContent />}
            {section === 'other' && <OtherInflationContent />}
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
