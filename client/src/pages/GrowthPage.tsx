import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './GrowthPage.module.css'

const GROWTH_MODELS = [
  {
    path:        '/models/growth/ngdp',
    title:       'Nominal GDP Dashboard',
    description: 'Full NIPA Table 1.1.5 expenditure hierarchy — contribution decompositions, trend charts, regime detection, and component-level explorer.',
    accent:      '#3b82f6',
    tag:         'GDP · PCEC · GPDI · NETEXP · GCE · +44 more',
  },
  {
    path:        '/models/growth/rgdp',
    title:       'Real GDP Dashboard',
    description: 'Full NIPA Table 1.1.6 expenditure hierarchy in chained 2017 dollars — component-level explorer with trend charts, regime detection, and growth analytics.',
    accent:      '#8b5cf6',
    tag:         'GDPC1 · PCECC96 · GPDIC1 · NETEXC · GCEC · +44 more',
  },
]

export function GrowthPage() {
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
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>Growth</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Growth</div>
          <div className={styles.pageSub}>Gross Domestic Product, Income, and Investment models</div>
        </div>

        <div className={styles.cardGrid}>
          {GROWTH_MODELS.map(model => (
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
