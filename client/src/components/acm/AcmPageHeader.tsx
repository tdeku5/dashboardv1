import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmPageHeader.module.css'
import { cx } from './acmFormat'

interface Props {
  title: string
  subtitle?: string
  /** Already-formatted as-of date, e.g. "2026-10-12". Omitted when absent. */
  asOf?: string | null
  /** Right-aligned page controls (e.g. a refresh button). */
  actions?: ReactNode
  className?: string
}

export function AcmPageHeader({ title, subtitle, asOf, actions, className }: Props) {
  return (
    <header className={cx('acm-root', styles.header, className)}>
      <div className={styles.titles}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {(asOf || actions) && (
        <div className={styles.side}>
          {asOf && (
            <div className={styles.asOf}>
              <span className={styles.asOfLabel}>As of</span>
              <span className="acm-num">{asOf}</span>
            </div>
          )}
          {actions}
        </div>
      )}
    </header>
  )
}
