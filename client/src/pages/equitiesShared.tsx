// EQUITIES helpers shared by the EQUITIES pages (E1: INDEX COMPARISON, SECTOR
// ATTRIBUTION, BREADTH, VOL; reused by E2). Token-only classes in
// equitiesShared.module.css — the pages' own legacy modules are left for Z.
//
// Colour rules (design notes rule 7): returns / performance are valence
// (up = positive, down = negative, text only); levels, breadth %, vol levels,
// realized vol and vol point changes are plain primary text; series lines take
// registry identity colours.
import type { ReactNode } from 'react'
import { fmtSignedFixed, roundForDisplay, type SignTone } from '../components/acm'
import { cx } from '../components/acm/acmFormat'
import { tooltipLabelStyle, tooltipSurfaceStyle } from '../components/acm/chartTheme'
import { toneClass } from '../components/acm/tones'
import styles from './equitiesShared.module.css'

export { styles as eqStyles }

/** Signed percent at `dp` decimals: '+1.23%', '-0.40%', '0.00%' at zero. ASCII '-'. */
export function fmtSignedPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, dp, '%')
}

/** Valence tone for a return displayed at `dp` decimals; none when it prints as zero. */
export function returnTone(v: number | null | undefined, dp = 2): SignTone | undefined {
  if (v == null || !Number.isFinite(v)) return undefined
  const r = roundForDisplay(v, dp)
  return r > 0 ? 'positive' : r < 0 ? 'negative' : undefined
}

interface ButtonRowProps<T extends string> {
  items: ReadonlyArray<{ key: T; label: string }>
  value: T
  onChange: (v: T) => void
  label?: string
}

/** Range / lookback buttons: one active treatment (accent), section-wide. */
export function ButtonRow<T extends string>({ items, value, onChange, label }: ButtonRowProps<T>) {
  return (
    <div className={styles.eqRangeRow}>
      {label && <span className={styles.eqRangeLabel}>{label}</span>}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          className={cx(styles.eqBtn, value === it.key && styles.eqBtnActive)}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export interface TipRow {
  key: string
  name: string
  /** Identity colour of the series (swatch only). */
  color?: string
  value: string
  /** Valence tone for return values; omitted for levels. */
  tone?: SignTone
}

/** Chart tooltip body on the theme's tooltip surface. */
export function EqTooltip({ label, rows }: { label: ReactNode; rows: ReadonlyArray<TipRow> }) {
  if (rows.length === 0) return null
  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{label}</div>
      {rows.map((r) => (
        <div key={r.key} className={styles.eqTipRow}>
          {r.color && <span className={styles.eqTipDot} style={{ background: r.color }} />}
          <span className={styles.eqTipName}>{r.name}</span>
          <span className={cx(styles.eqTipVal, toneClass(r.tone))}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Loading / empty / error line inside a chart or panel. */
export function EqState({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div className={cx(styles.eqState, error && styles.eqStateError)}>{children}</div>
}

/** "Missing data for: …" note (status-warning text, never a data colour). */
export function EqWarning({ children }: { children: ReactNode }) {
  return <div className={styles.eqWarning}>{children}</div>
}
