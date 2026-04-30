import styles from './CountrySelector.module.css'

export type CountryCode = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS' | 'Global'

const COUNTRIES: { key: CountryCode; label: string }[] = [
  { key: 'US', label: 'US' },
  { key: 'UK', label: 'UK' },
  { key: 'EU', label: 'EU' },
  { key: 'CAD', label: 'CAD' },
  { key: 'JPY', label: 'JPY' },
  { key: 'AUS', label: 'AUS' },
  { key: 'Global', label: 'GLOBAL' },
]

interface Props {
  value: CountryCode
  onChange: (country: CountryCode) => void
}

export function CountrySelector({ value, onChange }: Props) {
  return (
    <div className={styles.group}>
      {COUNTRIES.map((c, idx) => (
        <button
          key={c.key}
          className={`${styles.btn} ${value === c.key ? styles.btnActive : ''}`}
          onClick={() => onChange(c.key)}
          style={{
            border: `1px solid ${value === c.key ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
            ...(idx > 0 ? { borderLeft: 'none' } : {}),
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
