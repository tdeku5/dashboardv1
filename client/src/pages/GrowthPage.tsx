import { lazy, Suspense } from 'react'
import { UKNominalGDPContent } from './UKNominalGDPContent'
import { UKRealGDPContent } from './UKRealGDPContent'
import { UKMonthlyGDPContent } from './UKMonthlyGDPContent'
import { UKRetailContent } from './UKRetailContent'
import { UKTradeContent } from './UKTradeContent'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountrySections, type CountrySections } from '../lib/modelNavParams'
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
const JPGDPContent = lazy(() => import('./JPGDPContent').then(m => ({ default: m.JPGDPContent })))
const JPConsumptionContent = lazy(() => import('./JPConsumptionContent').then(m => ({ default: m.JPConsumptionContent })))
const JPTradeContent = lazy(() => import('./JPTradeContent').then(m => ({ default: m.JPTradeContent })))
const EU3GDPContent = lazy(() => import('./EU3GDPContent').then(m => ({ default: m.EU3GDPContent })))
const EU3RetailContent = lazy(() => import('./EU3RetailContent').then(m => ({ default: m.EU3RetailContent })))
const EU3TradeContent = lazy(() => import('./EU3TradeContent').then(m => ({ default: m.EU3TradeContent })))
const EU3SentimentContent = lazy(() => import('./EU3SentimentContent').then(m => ({ default: m.EU3SentimentContent })))

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

// Japan: retail deferred (e-Stat DB frozen Jan-2025), GDI folded into GDP,
// Consumer Health omitted (docs/jp-models-mapping.md).
const JP_GROWTH_SECTIONS = [
  { key: 'gdp', label: 'GDP' },
  { key: 'consumption', label: 'CONSUMPTION' },
  { key: 'trade', label: 'TRADE' },
] as const

// DE/FR/IT shared structure; SENTIMENT = harmonized DG-ECFIN surveys
// (decision e). No monthly GDP / consumer-health concepts.
const EU3_GROWTH_SECTIONS = [
  { key: 'gdp', label: 'GDP' },
  { key: 'retail', label: 'RETAIL' },
  { key: 'trade', label: 'TRADE' },
  { key: 'sentiment', label: 'SENTIMENT' },
] as const

const GROWTH_NAV: Record<string, CountrySections> = {
  us: { sections: GROWTH_SECTIONS, defaultKey: 'ngdp', accent: '#f87171' },
  uk: { sections: UK_GROWTH_SECTIONS, defaultKey: 'ngdp', accent: '#14b8a6' },
  ca: { sections: CA_GROWTH_SECTIONS, defaultKey: 'gdp', accent: '#f59e0b' },
  jp: { sections: JP_GROWTH_SECTIONS, defaultKey: 'gdp', accent: '#e879f9' },
  de: { sections: EU3_GROWTH_SECTIONS, defaultKey: 'gdp', accent: '#a3e635' },
  fr: { sections: EU3_GROWTH_SECTIONS, defaultKey: 'gdp', accent: '#60a5fa' },
  it: { sections: EU3_GROWTH_SECTIONS, defaultKey: 'gdp', accent: '#34d399' },
}

const EU3_CC = { de: 'DE', fr: 'FR', it: 'IT' } as const

export function GrowthPage() {
  const { country, setCountry, cfg, section, setSection } = useCountrySections(GROWTH_NAV)

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
          sections={cfg?.sections}
          activeSection={section}
          onSelectSection={setSection}
          sectionAccent={cfg?.accent}
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
            {section === 'ngdp' && <UKNominalGDPContent />}
            {section === 'rgdp' && <UKRealGDPContent />}
            {section === 'mgdp' && <UKMonthlyGDPContent />}
            {section === 'retail' && <UKRetailContent />}
            {section === 'trade' && <UKTradeContent />}
            <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
              {section === 'consumption' && <UKConsumptionContent />}
              {section === 'income' && <UKHouseholdIncomeContent />}
              {section === 'gdpi' && <UKGDPIncomeContent />}
              {section === 'consumer' && <UKConsumerHealthContent />}
            </Suspense>
          </>
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'gdp' && <CAGDPContent />}
            {section === 'mgdp' && <CAMonthlyGDPContent />}
            {section === 'retail' && <CARetailContent />}
            {section === 'trade' && <CATradeContent />}
            {section === 'consumption' && <CAConsumptionContent />}
            {section === 'income' && <CAHouseholdIncomeContent />}
            {section === 'gdpi' && <CAGDPIncomeContent />}
            {section === 'consumer' && <CAConsumerHealthContent />}
          </Suspense>
        ) : country === 'jp' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'gdp' && <JPGDPContent />}
            {section === 'consumption' && <JPConsumptionContent />}
            {section === 'trade' && <JPTradeContent />}
          </Suspense>
        ) : country in EU3_CC ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            {section === 'gdp' && <EU3GDPContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'retail' && <EU3RetailContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'trade' && <EU3TradeContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
            {section === 'sentiment' && <EU3SentimentContent cc={EU3_CC[country as keyof typeof EU3_CC]} />}
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
