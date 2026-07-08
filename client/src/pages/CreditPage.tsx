import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountrySections, type CountrySections } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const BankCreditDashboardContent = lazy(() => import('./BankCreditDashboardPage').then(m => ({ default: m.BankCreditDashboardContent })))
const UKMoneyCreditContent = lazy(() => import('./UKMoneyCreditContent').then(m => ({ default: m.UKMoneyCreditContent })))
const CAHouseholdCreditContent = lazy(() => import('./CAHouseholdCreditContent').then(m => ({ default: m.CAHouseholdCreditContent })))
const JPBankLendingContent = lazy(() => import('./JPBankLendingContent').then(m => ({ default: m.JPBankLendingContent })))
const EU3LendingContent = lazy(() => import('./EU3LendingContent').then(m => ({ default: m.EU3LendingContent })))

const CREDIT_SECTIONS = [
  { key: 'bank-credit', label: 'BANK CREDIT' },
] as const

const UK_CREDIT_SECTIONS = [
  { key: 'money-credit', label: 'MONEY & CREDIT' },
] as const

const CA_CREDIT_SECTIONS = [
  { key: 'household-credit', label: 'HOUSEHOLD CREDIT' },
] as const

// Single-section bars: no onSelectSection (static buttons, matching the
// pre-map behavior where these bars had no click handlers).
const JP_CREDIT_SECTIONS = [
  { key: 'lending', label: 'BANK LENDING' },
] as const

// DE/FR/IT: thin BSI lending build (decision h — verified).
const EU3_CREDIT_SECTIONS = [
  { key: 'bank-lending', label: 'BANK LENDING' },
] as const

const CREDIT_NAV: Record<string, CountrySections> = {
  us: { sections: CREDIT_SECTIONS, defaultKey: 'bank-credit', accent: '#f87171' },
  uk: { sections: UK_CREDIT_SECTIONS, defaultKey: 'money-credit', accent: '#14b8a6' },
  ca: { sections: CA_CREDIT_SECTIONS, defaultKey: 'household-credit', accent: '#f59e0b' },
  jp: { sections: JP_CREDIT_SECTIONS, defaultKey: 'lending', accent: '#e879f9' },
  de: { sections: EU3_CREDIT_SECTIONS, defaultKey: 'bank-lending', accent: '#a3e635' },
  fr: { sections: EU3_CREDIT_SECTIONS, defaultKey: 'bank-lending', accent: '#60a5fa' },
  it: { sections: EU3_CREDIT_SECTIONS, defaultKey: 'bank-lending', accent: '#34d399' },
}

const EU3_CC = { de: 'DE', fr: 'FR', it: 'IT' } as const

export function CreditPage() {
  const { country, setCountry, cfg, section } = useCountrySections(CREDIT_NAV)

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
          activeCategory="credit"
          sections={cfg?.sections}
          activeSection={section}
          sectionAccent={cfg?.accent}
        />

        {country === 'us' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <BankCreditDashboardContent />
          </Suspense>
        ) : country === 'uk' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <UKMoneyCreditContent />
          </Suspense>
        ) : country === 'ca' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <CAHouseholdCreditContent />
          </Suspense>
        ) : country === 'jp' ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <JPBankLendingContent />
          </Suspense>
        ) : country in EU3_CC ? (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <EU3LendingContent cc={EU3_CC[country as keyof typeof EU3_CC]} />
          </Suspense>
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} credit models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
