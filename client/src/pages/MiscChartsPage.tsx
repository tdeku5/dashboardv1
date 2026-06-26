import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { HeadlineCoreCpiChart } from './miscCharts/HeadlineCoreCpiChart'
import styles from './MiscChartsPage.module.css'

/*
 * Misc. Charts — a catch-all container for standalone quick charts that
 * don't belong to a specific model.
 *
 * To add a new chart: build a self-contained component under
 * ./miscCharts/ (fetches its own data, renders a `.section` card using the
 * shared MiscChartsPage.module.css) and drop it into the stack below.
 */

const CHARTS = [
  HeadlineCoreCpiChart,
  // ↓ add the next standalone chart component here
]

export function MiscChartsPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}><FredRefreshButton /></div>
      </header>

      <nav className={styles.breadcrumb}>
        <span className={styles.breadcrumbCurrent}>Misc. Charts</span>
      </nav>

      <div className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>MISC. CHARTS</div>
          <div className={styles.pageSubtitle}>Standalone charts &amp; quick references</div>
        </div>

        <div className={styles.stack}>
          {CHARTS.map((Chart, i) => <Chart key={i} />)}
        </div>
      </div>
    </div>
  )
}
