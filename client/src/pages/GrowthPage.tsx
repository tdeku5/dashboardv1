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
  {
    path:        '/models/growth/pio',
    title:       'Personal Income & Outlays',
    description: 'Personal income components, disposable income, outlays, PCE, and saving rate — BEA Table 2.6, monthly, SAAR.',
    accent:      '#14b8a6',
    tag:         'PI · DSPI · PCE · PMSAVE · PSAVERT · +38 more',
  },
  {
    path:        '/models/growth/retail',
    title:       'Retail Sales',
    description: 'Total retail trade and food services with category breakdowns — Census Bureau, monthly, seasonally adjusted.',
    accent:      '#f59e0b',
    tag:         'RSAFS · RSFSXMV · RSMVPD · RSGASS · RSFSDP · +12 more',
  },
  {
    path:        '/models/growth/npce',
    title:       'Nominal PCE',
    description: 'Personal consumption expenditures by major type of product — BEA Table 2.8.5, monthly, SAAR.',
    accent:      '#ec4899',
    tag:         'BEA Table 2.8.5 · Monthly · SAAR',
  },
  {
    path:        '/models/growth/rpce',
    title:       'Real PCE',
    description: 'Real personal consumption expenditures by major type of product, 2017=100.',
    accent:      '#a78bfa',
    tag:         'BEA Table 2.8.3 · Monthly · Quantity Indexes',
  },
  {
    path:        '/models/growth/gdi',
    title:       'Gross Domestic Income',
    description: 'GDI income-side decomposition — compensation, net operating surplus, corporate profits, fixed capital consumption, and Real GDI.',
    accent:      '#f97316',
    tag:         'GDI · GDICOMP · PROPINC · COFC · A261RX1Q020SBEA · +19 more',
  },
  {
    path:        '/models/growth/consumer-health',
    title:       'Consumer Health',
    description: 'UMich Consumer Sentiment, Current Conditions, and Consumer Expectations — University of Michigan Surveys of Consumers, monthly.',
    accent:      '#ef4444',
    tag:         'UMCSENT · UMCSI · UMICSE',
  },
  {
    path:        '/models/growth/trade',
    title:       'Trade',
    description: 'U.S. international trade in goods and services — exports, imports, and balances.',
    accent:      '#06b6d4',
    tag:         'Census Bureau / BEA · Monthly · SA',
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
