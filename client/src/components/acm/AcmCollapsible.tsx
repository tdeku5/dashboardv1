import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmCollapsible.module.css'
import { cx } from './acmFormat'

interface Props {
  title: string
  /** Collapsed by default — methodology and reference text is opt-in. */
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

/** Methodology / reference section. Native <details>, so it works without JS state. */
export function AcmCollapsible({ title, defaultOpen = false, children, className }: Props) {
  return (
    <details className={cx('acm-root', styles.details, className)} open={defaultOpen}>
      <summary className={styles.summary}>{title}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
