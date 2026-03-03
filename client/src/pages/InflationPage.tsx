import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './InflationPage.module.css'

const INFLATION_MODELS = [
  {
    path:        '/models/inflation/cpi',
    title:       'CPI Dashboard',
    description: 'CPI series explorer with outright index, YoY regimes, YoY delta, MoM with moving averages, annualized MoM, and seasonal sequential comparison.',
    accent:      '#f59e0b',
    tag:         'CPIAUCSL \u00b7 CPILFESL \u00b7 +102 more',
  },
  {
    path:        '/models/inflation/projections',
    title:       'CPI Projections',
    description: 'Forward projection of headline and core CPI YoY% under constant MoM growth scenarios with interactive heatmap tables.',
    accent:      '#f59e0b',
    tag:         'CPIAUCSL \u00b7 CPILFESL',
  },
  {
    path:        '/models/inflation/pce',
    title:       'PCE Dashboard',
    description: 'PCE price index explorer with outright index, YoY regimes, YoY delta, MoM with moving averages, annualized MoM, and seasonal sequential comparison.',
    accent:      '#8b5cf6',
    tag:         'BEA Table 2.3.4U \u00b7 23 line items',
  },
  {
    path:        '/models/inflation/pce-projections',
    title:       'PCE Projections',
    description: 'Forward projection of headline and core PCE YoY% under constant MoM growth scenarios with interactive charts and summary analysis.',
    accent:      '#8b5cf6',
    tag:         'PCEPI \u00b7 Core PCE',
  },
  {
    path:        '/models/inflation/ppi',
    title:       'PPI Dashboard',
    description: 'PPI Final Demand series explorer with outright index, YoY regimes, YoY delta, MoM with moving averages, annualized MoM, and seasonal sequential comparison.',
    accent:      '#34d399',
    tag:         'PPIFIS \u00b7 PPIFES \u00b7 +12 more',
  },
  {
    path:        '/models/inflation/other',
    title:       'Other Inflation Measures',
    description: 'Alternative inflation gauges \u2014 Michigan expectations, Dallas trimmed-mean PCE, OECD harmonized CPI, Atlanta sticky-price CPI.',
    accent:      '#64748b',
    tag:         'MICH \u00b7 PCETRIM \u00b7 CP0000US \u00b7 CORESTICK',
  },
]

export function InflationPage() {
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
        <span className={styles.breadcrumbCurrent}>Inflation</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Inflation</div>
          <div className={styles.pageSub}>CPI component analysis with series explorer, regime detection, and momentum decomposition</div>
        </div>

        <div className={styles.cardGrid}>
          {INFLATION_MODELS.map(model => (
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
