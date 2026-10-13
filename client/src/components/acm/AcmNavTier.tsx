import '../../styles/acm-tokens.css'
import styles from './AcmNavTier.module.css'
import { cx } from './acmFormat'

export interface AcmNavItem<T extends string> {
  key: T
  label: string
}

/**
 * Which of the three nav tiers this row is. The tier sets SIZE only — the
 * active treatment is identical on every tier (accent text on accent-muted),
 * replacing the old per-tier blue / green / red, which encoded nothing.
 */
export type AcmNavTierLevel = 'asset-class' | 'country' | 'section'

interface Props<T extends string> {
  tier: AcmNavTierLevel
  items: ReadonlyArray<AcmNavItem<T>>
  value: T
  onChange: (next: T) => void
  /** Accessible name for the tab list, e.g. "Asset class". */
  label: string
  className?: string
}

export function AcmNavTier<T extends string>({ tier, items, value, onChange, label, className }: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      data-tier={tier}
      className={cx('acm-root', styles.row, styles[tier], className)}
    >
      {items.map(item => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx(styles.tab, active && styles.active)}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
