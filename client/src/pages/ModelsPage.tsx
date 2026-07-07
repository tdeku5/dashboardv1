import { NavDropdown } from '../components/NavDropdown'
import { COUNTRIES } from './modelNav'
import { useCountryParam } from '../lib/modelNavParams'
import { CountryCategoryNav } from '../components/CountryCategoryNav'
import styles from './ModelsPage.module.css'

export function ModelsPage() {
  const [country, setCountry] = useCountryParam()

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

      <main className={styles.body}>
        <CountryCategoryNav country={country} onSelectCountry={setCountry} />

        {country !== 'us' && country !== 'uk' && (
          <div className={styles.comingSoon}>
            {COUNTRIES.find(c => c.key === country)?.label} models coming soon
          </div>
        )}
      </main>
    </div>
  )
}
