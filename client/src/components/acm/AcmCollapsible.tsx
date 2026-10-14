import { useState, type ReactNode } from 'react'
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

/**
 * Methodology / reference section. A <details>/<summary> for semantics and
 * keyboard support, but the body is only MOUNTED while open — closed content
 * stays out of the DOM (and out of find-in-page), as the hand-rolled toggles
 * it replaces behaved.
 */
export function AcmCollapsible({ title, defaultOpen = false, children, className }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details className={cx('acm-root', styles.details, className)} open={open}>
      <summary
        className={styles.summary}
        onClick={e => { e.preventDefault(); setOpen(o => !o) }}
      >
        {title}
      </summary>
      {open && <div className={styles.body}>{children}</div>}
    </details>
  )
}
