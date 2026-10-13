import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmPanel.module.css'
import { cx } from './acmFormat'

interface Props {
  title?: string
  /** Right-aligned header controls (range buttons, toggles). */
  actions?: ReactNode
  /** Small caption under the body (source, as-of, footnote). */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function AcmPanel({ title, actions, footer, children, className }: Props) {
  return (
    <section className={cx('acm-root', styles.panel, className)}>
      {(title || actions) && (
        <div className={styles.head}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  )
}
