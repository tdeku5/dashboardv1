import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './ModelsPage.module.css'

const MODEL_CARDS = [
  {
    path:        '/models/labor',
    category:    'Labor Market',
    title:       'Labor Market',
    description: 'Unemployment and employment models based on CPS and payroll survey data.',
    accent:      '#22c55e',
    tag:         'UNRATE · CE16OV · CLF16OV',
  },
]

export function ModelsPage() {
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
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Economic Data Models</div>
          <div className={styles.pageSub}>Analytical models built on live FRED data</div>
        </div>

        <div className={styles.cardGrid}>
          {MODEL_CARDS.map(card => (
            <Link key={card.path} to={card.path} className={styles.card} style={{ '--accent': card.accent } as React.CSSProperties}>
              <div className={styles.cardAccent} />
              <div className={styles.cardInner}>
                <div className={styles.cardCategory}>{card.category}</div>
                <div className={styles.cardTitle}>{card.title}</div>
                <div className={styles.cardDesc}>{card.description}</div>
                <div className={styles.cardTag}>{card.tag}</div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
