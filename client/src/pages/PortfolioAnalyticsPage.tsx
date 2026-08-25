import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import styles from './PortfolioAnalyticsPage.module.css'

// PORTFOLIO ANALYTICS section hub — card grid linking to the section's pages,
// per the model-hub convention (path / title / description / accent / tag).
const CARDS = [
  {
    path: '/portfolio/position-sizing',
    title: 'POSITION SIZING',
    description:
      'Futures position sizer ported from the position_sizing.xlsx model — risk-unit ladder, contract grids, margin funding checks, and the inverse stop-width grid.',
    accent: '#38bdf8',
    tag: 'CALCULATOR',
  },
]

export function PortfolioAnalyticsPage() {
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
        <span className={styles.breadcrumbCurrent}>Portfolio Analytics</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.cardGrid}>
          {CARDS.map(card => (
            <Link
              key={card.path}
              to={card.path}
              className={styles.card}
              style={{ borderTopColor: card.accent }}
            >
              <div className={styles.cardHead}>
                <span className={styles.cardTitle}>{card.title}</span>
                <span className={styles.cardTag}>{card.tag}</span>
              </div>
              <p className={styles.cardDesc}>{card.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
