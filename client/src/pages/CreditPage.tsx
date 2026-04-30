import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES, CATEGORIES } from './modelNav'
import styles from './ModelsPage.module.css'

const BankCreditDashboardContent = lazy(() => import('./BankCreditDashboardPage').then(m => ({ default: m.BankCreditDashboardContent })))

const CREDIT_SECTIONS = [
  { key: 'bank-credit', label: 'BANK CREDIT' },
] as const

export function CreditPage() {
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('bank-credit')
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
              className={`${styles.categoryBtn} ${cat.key === 'credit' ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== 'credit') navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === 'credit' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className={styles.sectionBar}>
          {CREDIT_SECTIONS.map((sec, idx) => (
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

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'bank-credit' && <BankCreditDashboardContent />}
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} credit models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
