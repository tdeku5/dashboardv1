import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './FiscalPage.module.css'

const FISCAL_MODELS = [
  {
    path:        '/models/fiscal/dts',
    title:       'Daily Treasury Statement',
    description: 'Cumulative net fiscal flows (ΔTGA − ΔDebt), withheld income & employment tax receipts with 12-period rolling cycle analysis.',
    accent:      '#ef4444',
    tag:         'DTS Table I · Table II · Table III-A',
  },
  {
    path:        '/models/fiscal/mts',
    title:       'Monthly Treasury Statement',
    description: 'Monthly federal receipts and outlays with category breakdowns and year-over-year comparisons.',
    accent:      '#3b82f6',
    tag:         'MTS Receipts · Outlays · Surplus/Deficit',
  },
]

export function FiscalPage() {
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

      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Fiscal</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Fiscal</div>
          <div className={styles.pageSub}>Federal fiscal flow analysis via Daily and Monthly Treasury Statements</div>
        </div>

        <div className={styles.cardGrid}>
          {FISCAL_MODELS.map(model => (
            <Link
              key={model.path}
              to={model.path}
              className={styles.card}
              style={{ '--accent': model.accent } as React.CSSProperties}
            >
              <div className={styles.cardAccent} />
              <div className={styles.cardInner}>
                <div className={styles.cardTitle}>{model.title}</div>
                <div className={styles.cardDesc}>{model.description}</div>
                <div className={styles.cardTag}>{model.tag}</div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
