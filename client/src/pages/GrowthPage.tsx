import { useState, lazy, Suspense } from 'react'
import { UKNominalGDPContent } from './UKNominalGDPContent'
import { UKRealGDPContent } from './UKRealGDPContent'
import { UKMonthlyGDPContent } from './UKMonthlyGDPContent'
import { UKRetailContent } from './UKRetailContent'
import { UKTradeContent } from './UKTradeContent'
import { useNavigate } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES, CATEGORIES } from './modelNav'
import styles from './ModelsPage.module.css'

const NGDPDashboardContent = lazy(() => import('./NGDPDashboardPage').then(m => ({ default: m.NGDPDashboardContent })))
const RGDPDashboardContent = lazy(() => import('./RGDPDashboardPage').then(m => ({ default: m.RGDPDashboardContent })))
const PIODashboardContent = lazy(() => import('./PIODashboardPage').then(m => ({ default: m.PIODashboardContent })))
const RetailSalesDashboardContent = lazy(() => import('./RetailSalesDashboardPage').then(m => ({ default: m.RetailSalesDashboardContent })))
const NPCEDashboardContent = lazy(() => import('./NPCEDashboardPage').then(m => ({ default: m.NPCEDashboardContent })))
const RPCEDashboardContent = lazy(() => import('./RPCEDashboardPage').then(m => ({ default: m.RPCEDashboardContent })))
const GDIDashboardContent = lazy(() => import('./GDIDashboardPage').then(m => ({ default: m.GDIDashboardContent })))
const ConsumerHealthDashboardContent = lazy(() => import('./ConsumerHealthDashboardPage').then(m => ({ default: m.ConsumerHealthDashboardContent })))
const TradeDashboardContent = lazy(() => import('./TradeDashboardPage').then(m => ({ default: m.TradeDashboardContent })))
const UKConsumptionContent = lazy(() => import('./UKConsumptionContent').then(m => ({ default: m.UKConsumptionContent })))
const UKHouseholdIncomeContent = lazy(() => import('./UKHouseholdIncomeContent').then(m => ({ default: m.UKHouseholdIncomeContent })))
const UKGDPIncomeContent = lazy(() => import('./UKGDPIncomeContent').then(m => ({ default: m.UKGDPIncomeContent })))
const UKConsumerHealthContent = lazy(() => import('./UKConsumerHealthContent').then(m => ({ default: m.UKConsumerHealthContent })))

const GROWTH_SECTIONS = [
  { key: 'ngdp', label: 'NOMINAL GDP' },
  { key: 'rgdp', label: 'REAL GDP' },
  { key: 'pio', label: 'PIO' },
  { key: 'retail', label: 'RETAIL' },
  { key: 'npce', label: 'NOMINAL PCE' },
  { key: 'rpce', label: 'REAL PCE' },
  { key: 'gdi', label: 'GDI' },
  { key: 'consumer', label: 'CONSUMER HEALTH' },
  { key: 'trade', label: 'TRADE' },
] as const

const UK_GROWTH_SECTIONS = [
  { key: 'ngdp', label: 'NOMINAL GDP' },
  { key: 'rgdp', label: 'REAL GDP' },
  { key: 'mgdp', label: 'MONTHLY GDP' },
  { key: 'retail', label: 'RETAIL' },
  { key: 'trade', label: 'TRADE' },
  { key: 'consumption', label: 'CONSUMPTION' },
  { key: 'income', label: 'HOUSEHOLD INCOME' },
  { key: 'gdpi', label: 'GDP(I)' },
  { key: 'consumer', label: 'CONSUMER HEALTH' },
] as const

export function GrowthPage() {
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('ngdp')
  const [ukSection, setUkSection] = useState('ngdp')
  const navigate = useNavigate()

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}>{country === 'us' && <FredRefreshButton />}</div>
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
              className={`${styles.categoryBtn} ${cat.key === 'growth' ? styles.categoryBtnActive : ''}`}
              onClick={() => { if (cat.key !== 'growth') navigate(cat.path) }}
              style={{
                border: `1px solid ${cat.key === 'growth' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {country === 'us' ? (
          <>
          <div className={styles.sectionBar}>
            {GROWTH_SECTIONS.map((sec, idx) => (
              <button
                key={sec.key}
                className={`${styles.sectionBtn} ${section === sec.key ? styles.sectionBtnActive : ''}`}
                onClick={() => setSection(sec.key)}
                style={{
                  border: `1px solid ${section === sec.key ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`,
                  ...(idx > 0 ? { borderLeft: 'none' } : {}),
                }}
              >
                {sec.label}
              </button>
            ))}
          </div>
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'ngdp' && <NGDPDashboardContent />}
            {section === 'rgdp' && <RGDPDashboardContent />}
            {section === 'pio' && <PIODashboardContent />}
            {section === 'retail' && <RetailSalesDashboardContent />}
            {section === 'npce' && <NPCEDashboardContent />}
            {section === 'rpce' && <RPCEDashboardContent />}
            {section === 'gdi' && <GDIDashboardContent />}
            {section === 'consumer' && <ConsumerHealthDashboardContent />}
            {section === 'trade' && <TradeDashboardContent />}
          </Suspense>
          </>
        ) : country === 'uk' ? (
          <>
            <div className={styles.sectionBar}>
              {UK_GROWTH_SECTIONS.map((sec, idx) => (
                <button
                  key={sec.key}
                  className={`${styles.sectionBtn} ${ukSection === sec.key ? styles.sectionBtnActive : ''}`}
                  onClick={() => setUkSection(sec.key)}
                  style={{
                    border: `1px solid ${ukSection === sec.key ? '#14b8a6' : 'rgba(255, 255, 255, 0.12)'}`,
                    ...(idx > 0 ? { borderLeft: 'none' } : {}),
                  }}
                >
                  {sec.label}
                </button>
              ))}
            </div>
            {ukSection === 'ngdp' && <UKNominalGDPContent />}
            {ukSection === 'rgdp' && <UKRealGDPContent />}
            {ukSection === 'mgdp' && <UKMonthlyGDPContent />}
            {ukSection === 'retail' && <UKRetailContent />}
            {ukSection === 'trade' && <UKTradeContent />}
            <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
              {ukSection === 'consumption' && <UKConsumptionContent />}
              {ukSection === 'income' && <UKHouseholdIncomeContent />}
              {ukSection === 'gdpi' && <UKGDPIncomeContent />}
              {ukSection === 'consumer' && <UKConsumerHealthContent />}
            </Suspense>
          </>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} growth models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
