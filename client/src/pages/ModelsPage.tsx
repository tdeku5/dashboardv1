import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { COUNTRIES, CATEGORIES } from './modelNav'
import styles from './ModelsPage.module.css'

export function ModelsPage() {
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
                border: `1px solid ${country === c.key ? '#FFD700' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {country === 'us' && (
          <div className={styles.categoryBar}>
            {CATEGORIES.map((cat, idx) => (
              <button
                key={cat.key}
                className={styles.categoryBtn}
                onClick={() => navigate(cat.path)}
                style={{
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  ...(idx > 0 ? { borderLeft: 'none' } : {}),
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {country !== 'us' && (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
