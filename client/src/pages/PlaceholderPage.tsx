import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { COUNTRIES, CATEGORIES } from './modelNav'
import styles from './ModelsPage.module.css'

export function PlaceholderCategoryPage({ categoryKey, label }: { categoryKey: string; label: string }) {
  const [country, setCountry] = useState('us')
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
              className={`${styles.categoryBtn} ${cat.key === categoryKey ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== categoryKey) navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === categoryKey ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className={styles.comingSoon}>{label} coming soon</div>
      </main>
    </div>
  )
}

export function IndustrialProductionPage() {
  return <PlaceholderCategoryPage categoryKey="industrial" label="Industrial Production" />
}

