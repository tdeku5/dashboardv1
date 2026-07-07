import { lazy, Suspense } from 'react'
import { UKNominalGDPContent } from './UKNominalGDPContent'
import { UKRealGDPContent } from './UKRealGDPContent'
import { UKMonthlyGDPContent } from './UKMonthlyGDPContent'
import { UKRetailContent } from './UKRetailContent'
import { UKTradeContent } from './UKTradeContent'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam, useTabParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
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
const CAGDPContent = lazy(() => import('./CAGDPContent').then(m => ({ default: m.CAGDPContent })))
const CAMonthlyGDPContent = lazy(() => import('./CAMonthlyGDPContent').then(m => ({ default: m.CAMonthlyGDPContent })))
const CARetailContent = lazy(() => import('./CARetailContent').then(m => ({ default: m.CARetailContent })))
const CATradeContent = lazy(() => import('./CATradeContent').then(m => ({ default: m.CATradeContent })))
const CAConsumptionContent = lazy(() => import('./CAConsumptionContent').then(m => ({ default: m.CAConsumptionContent })))
const CAHouseholdIncomeContent = lazy(() => import('./CAHouseholdIncomeContent').then(m => ({ default: m.CAHouseholdIncomeContent })))
const CAGDPIncomeContent = lazy(() => import('./CAGDPIncomeContent').then(m => ({ default: m.CAGDPIncomeContent })))
const CAConsumerHealthContent = lazy(() => import('./CAConsumerHealthContent').then(m => ({ default: m.CAConsumerHealthContent })))

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

const CA_GROWTH_SECTIONS = [
  { key: 'gdp', label: 'GDP' },
  { key: 'mgdp', label: 'MONTHLY GDP' },
  { key: 'retail', label: 'RETAIL' },
  { key: 'trade', label: 'TRADE' },
  { key: 'consumption', label: 'CONSUMPTION' },
  { key: 'income', label: 'HOUSEHOLD INCOME' },
  { key: 'gdpi', label: 'GDP(I)' },
  { key: 'consumer', label: 'CONSUMER HEALTH' },
] as const

export function GrowthPage() {
  const [country, setCountry] = useCountryParam()
  const [section, setSection] = useTabParam(GROWTH_SECTIONS.map(s => s.key), 'ngdp')
  const [ukSection, setUkSection] = useTabParam(UK_GROWTH_SECTIONS.map(s => s.key), 'ngdp')
  const [caSection, setCaSection] = useTabParam(CA_GROWTH_SECTIONS.map(s => s.key), 'gdp')

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
        <CountryCategoryNav
          country={country}
          onSelectCountry={setCountry}
          activeCategory="growth"
          sections={country === 'us' ? GROWTH_SECTIONS : country === 'uk' ? UK_GROWTH_SECTIONS : country === 'ca' ? CA_GROWTH_SECTIONS : undefined}
          activeSection={country === 'us' ? section : country === 'uk' ? ukSection : caSection}
          onSelectSection={country === 'us' ? setSection : country === 'uk' ? setUkSection : setCaSection}
          sectionAccent={country === 'us' ? '#f87171' : country === 'uk' ? '#14b8a6' : '#f59e0b'}
        />

        {country === 'us' ? (
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
        ) : country === 'uk' ? (
          <>
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
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {caSection === 'gdp' && <CAGDPContent />}
            {caSection === 'mgdp' && <CAMonthlyGDPContent />}
            {caSection === 'retail' && <CARetailContent />}
            {caSection === 'trade' && <CATradeContent />}
            {caSection === 'consumption' && <CAConsumptionContent />}
            {caSection === 'income' && <CAHouseholdIncomeContent />}
            {caSection === 'gdpi' && <CAGDPIncomeContent />}
            {caSection === 'consumer' && <CAConsumerHealthContent />}
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} growth models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
