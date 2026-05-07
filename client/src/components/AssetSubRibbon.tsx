import styles from './AssetSubRibbon.module.css'

export interface AssetSubRibbonItem<T extends string> {
  key: T
  label: string
}

interface Props<T extends string> {
  items: ReadonlyArray<AssetSubRibbonItem<T>>
  value: T
  onChange: (next: T) => void
  // Hex used for the active button's border + text. Background is derived.
  accent?: string
  accentBg?: string
}

export function AssetSubRibbon<T extends string>({
  items,
  value,
  onChange,
  accent = '#4ade80',
  accentBg = 'rgba(34, 197, 94, 0.12)',
}: Props<T>) {
  return (
    <div className={styles.group}>
      {items.map((it, idx) => {
        const active = value === it.key
        return (
          <button
            key={it.key}
            className={`${styles.btn} ${active ? styles.btnActive : ''}`}
            onClick={() => onChange(it.key)}
            style={{
              border: `1px solid ${active ? accent : 'rgba(255, 255, 255, 0.12)'}`,
              ...(active ? { color: accent, background: accentBg } : {}),
              ...(idx > 0 ? { borderLeft: 'none' } : {}),
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
