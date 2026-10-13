import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmChartFrame.module.css'
import { cx } from './acmFormat'
import { allIdentityColors } from '../../constants/identityColors'
import { SIGN_TOKENS } from './chartColors'

export interface AcmLegendItem {
  label: string
  /** An identity-registry colour or a sign-token var(--acm-*), supplied by the caller. */
  color: string
  /** Dashed series render a dashed swatch. */
  dashed?: boolean
  /** Hidden series (legend toggles) render dimmed. */
  hidden?: boolean
  onClick?: () => void
}

interface Props {
  title: string
  subtitle?: string
  legend?: ReadonlyArray<AcmLegendItem>
  /** Header controls (range buttons). */
  actions?: ReactNode
  /** Plot height in px; the chart inside should fill it (e.g. ResponsiveContainer height="100%"). */
  height: number
  /** The Recharts chart. Spread `chartTheme` from './chartTheme' on its grid / axes / tooltip. */
  children: ReactNode
  className?: string
}

const ALLOWED_SERIES = new Set<string>([
  ...allIdentityColors().map(([, v]) => v.toLowerCase()),
  ...SIGN_TOKENS.map(t => `var(--${t})`),
])

/** True when a series colour comes from the identity registry or a sign token. */
export function isSeriesColor(color: string): boolean {
  return ALLOWED_SERIES.has(color.toLowerCase())
}

export function AcmChartFrame({ title, subtitle, legend, actions, height, children, className }: Props) {
  if (import.meta.env.DEV && legend) {
    for (const item of legend) {
      if (!isSeriesColor(item.color)) {
        console.warn(`[AcmChartFrame] legend colour ${item.color} for "${item.label}" is not from the identity registry or a sign token`)
      }
    }
  }
  return (
    <figure className={cx('acm-root', styles.frame, className)}>
      <figcaption className={styles.head}>
        <div className={styles.titles}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </figcaption>
      {legend && legend.length > 0 && (
        <ul className={styles.legend}>
          {legend.map(item => (
            <li key={item.label} className={cx(styles.legendItem, item.hidden && styles.legendHidden)}>
              <button type="button" className={styles.legendButton} onClick={item.onClick} disabled={!item.onClick} aria-pressed={item.onClick ? !item.hidden : undefined}>
                <span
                  aria-hidden="true"
                  className={cx(styles.swatch, item.dashed && styles.swatchDashed)}
                  style={{ ['--acm-swatch' as string]: item.color }}
                />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.plot} style={{ height }}>
        {children}
      </div>
    </figure>
  )
}
