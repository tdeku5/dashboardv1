import { useNavigate } from 'react-router-dom'
import { COUNTRIES, CATEGORIES } from '../pages/modelNav'
import { categoryPath } from '../lib/modelNavParams'
import styles from '../pages/ModelsPage.module.css'

// Shared country / category / sub-tab bars for the Economic Data Models hubs.
// Extracted 2026-07 (Canada Phase 0) from the identical inline pattern that was
// duplicated across 8 pages — the duplication is why the country-loss nav bug
// had to be fixed in 8 places. Rendering and query-param behavior are
// byte-compatible with the inline originals:
//   • country buttons call onSelectCountry (pages pass useCountryParam's setter)
//   • category buttons navigate to categoryPath(cat.path, country) unless the
//     category is already active; with no activeCategory (ModelsPage) every
//     category button navigates and none is styled active
//   • the section bar renders only when `sections` is provided; buttons are
//     static (no onClick) when onSelectSection is omitted (single-section bars)

export interface NavSection {
  key: string
  label: string
}

export function CountryCategoryNav({
  country,
  onSelectCountry,
  activeCategory,
  sections,
  activeSection,
  onSelectSection,
  sectionAccent = '#f87171',
}: {
  country: string
  onSelectCountry: (key: string) => void
  /** Active category key (e.g. 'inflation'); omit on the /models landing page */
  activeCategory?: string
  /** Section defs for the active country branch; omit to hide the section bar */
  sections?: ReadonlyArray<NavSection>
  activeSection?: string
  /** Omit for static single-section bars (button renders without onClick) */
  onSelectSection?: (key: string) => void
  /** Active-section border color: '#f87171' (US pages), '#14b8a6' (UK) */
  sectionAccent?: string
}) {
  const navigate = useNavigate()

  return (
    <>
      <div className={styles.countryBar}>
        {COUNTRIES.map((c, idx) => (
          <button
            key={c.key}
            className={`${styles.countryBtn} ${country === c.key ? styles.countryBtnActive : ''}`}
            onClick={() => onSelectCountry(c.key)}
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
            className={`${styles.categoryBtn} ${cat.key === activeCategory ? styles.categoryBtnActive : ''}`}
            onClick={() => { if (cat.key !== activeCategory) navigate(categoryPath(cat.path, country)) }}
            style={{
              border: `1px solid ${cat.key === activeCategory ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`,
              ...(idx > 0 ? { borderLeft: 'none' } : {}),
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {sections && (
        <div className={styles.sectionBar}>
          {sections.map((sec, idx) => (
            <button
              key={sec.key}
              className={`${styles.sectionBtn} ${activeSection === sec.key ? styles.sectionBtnActive : ''}`}
              onClick={onSelectSection ? () => onSelectSection(sec.key) : undefined}
              style={{
                border: `1px solid ${activeSection === sec.key ? sectionAccent : 'rgba(255, 255, 255, 0.12)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {sec.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
