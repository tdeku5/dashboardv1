import { lazy, Suspense } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES } from './modelNav'
import { useCountryParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

const BankCreditDashboardContent = lazy(() => import('./BankCreditDashboardPage').then(m => ({ default: m.BankCreditDashboardContent })))
const UKMoneyCreditContent = lazy(() => import('./UKMoneyCreditContent').then(m => ({ default: m.UKMoneyCreditContent })))
const CAHouseholdCreditContent = lazy(() => import('./CAHouseholdCreditContent').then(m => ({ default: m.CAHouseholdCreditContent })))

const CREDIT_SECTIONS = [
  { key: 'bank-credit', label: 'BANK CREDIT' },
] as const

const UK_CREDIT_SECTIONS = [
  { key: 'money-credit', label: 'MONEY & CREDIT' },
] as const

const CA_CREDIT_SECTIONS = [
  { key: 'household-credit', label: 'HOUSEHOLD CREDIT' },
] as const

export function CreditPage() {
  const [country, setCountry] = useCountryParam()

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
          sections={country === 'us' ? CREDIT_SECTIONS : country === 'uk' ? UK_CREDIT_SECTIONS : country === 'ca' ? CA_CREDIT_SECTIONS : undefined}
          activeSection={country === 'us' ? 'bank-credit' : country === 'uk' ? 'money-credit' : 'household-credit'}
          sectionAccent={country === 'us' ? '#f87171' : country === 'uk' ? '#14b8a6' : '#f59e0b'}
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
        ) : (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} credit models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
