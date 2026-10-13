import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmStatTile.module.css'
import { cx, displayValue, NULL_DASH, type AlertLevel, type CellValue, type SignTone } from './acmFormat'
import { alertClass, toneClass } from './tones'

export interface AcmStatTileProps {
  label: string
  value: CellValue
  format?: (v: number) => string
  /** Tone of the headline value text (valence / direction). */
  tone?: SignTone
  delta?: { value: CellValue; format?: (v: number) => string; tone?: SignTone; label?: string }
  /** Already-formatted as-of / observation date. */
  asOf?: string | null
  /** Tile-level alert: tint + outline, never text colour. */
  alert?: AlertLevel
  className?: string
}

export function AcmStatTile({ label, value, format, tone, delta, asOf, alert, className }: AcmStatTileProps) {
  const shown = displayValue(value, format)
  const deltaShown = delta ? displayValue(delta.value, delta.format) : null
  return (
    <div className={cx('acm-root', styles.tile, alertClass(alert), className)}>
      <div className={styles.label}>{label}</div>
      <div className={cx(styles.value, 'acm-num', shown === NULL_DASH ? styles.null : toneClass(tone))}>{shown}</div>
      {delta && (
        <div className={styles.delta}>
          <span className={cx('acm-num', deltaShown === NULL_DASH ? styles.null : toneClass(delta.tone))}>{deltaShown}</span>
          {delta.label && <span className={styles.deltaLabel}>{delta.label}</span>}
        </div>
      )}
      {asOf && <div className={cx(styles.asOf, 'acm-num')}>{asOf}</div>}
    </div>
  )
}

interface StripProps {
  children: ReactNode
  className?: string
}

/** A row of stat tiles that wraps on narrow widths. */
export function AcmStatStrip({ children, className }: StripProps) {
  return <div className={cx('acm-root', styles.strip, className)}>{children}</div>
}
