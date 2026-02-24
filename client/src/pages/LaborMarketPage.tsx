import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './LaborMarketPage.module.css'

const LABOR_MODELS = [
  {
    path:        '/models/labor/projection',
    title:       'U-3 Payroll Based Projection',
    description: 'Forward-project the U-3 unemployment rate under four payroll growth scenarios using CE16OV and CLF16OV.',
    accent:      '#22c55e',
    tag:         'UNRATE · CE16OV · CLF16OV',
  },
  {
    path:        '/models/labor/cps',
    title:       'CPS Dashboard',
    description: 'U-3 unemployment rate with 3-month and 6-month moving averages. Full FRED history with interactive brush range selector.',
    accent:      '#3b82f6',
    tag:         'UNRATE',
  },
  {
    path:        '/models/labor/claims',
    title:       'Claims Dashboard',
    description: 'Initial and continuing claims with seasonal adjustment comparison, year-over-year trends, and seasonal cycle analysis.',
    accent:      '#f97316',
    tag:         'ICNSA · ICSA · CCNSA · CCSA',
  },
  {
    path:        '/models/labor/ces',
    title:       'CES Dashboard',
    description: 'Monthly payroll employment decomposition by sector with adjustable lookback, sector/category grouping, and total nonfarm overlay.',
    accent:      '#10b981',
    tag:         'PAYEMS · MANEMP · USPBS · USEHS · USLAH · +10 more',
  },
  {
    path:        '/models/labor/jolts',
    title:       'JOLTS Dashboard',
    description: 'Job openings, hires, quits and separations — rate charts, implied NFP decomposition, and Beveridge curve scatter.',
    accent:      '#818cf8',
    tag:         'JTSJOL · JTSHIL · JTSQUL · JTSLDL · JTSOSL · JTSTSL',
  },
  {
    path:        '/models/labor/productivity',
    title:       'Productivity & Unit Labor Costs',
    description: 'Nonfarm business sector labor productivity and unit labor costs — levels, q/q annualized growth, y/y changes, and pre-Covid trend comparison.',
    accent:      '#7FB3D3',
    tag:         'OPHNFB · ULCNFB',
  },
]

export function LaborMarketPage() {
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
        <span className={styles.breadcrumbCurrent}>Labor Market</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Labor Market</div>
          <div className={styles.pageSub}>Unemployment and employment models based on CPS and payroll survey data</div>
        </div>

        <div className={styles.cardGrid}>
          {LABOR_MODELS.map(model => (
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
