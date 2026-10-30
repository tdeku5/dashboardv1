// Display rules shared by the Asset Class Models primitives.
// Callers format their own numbers (precision, units, '+' prefixes); the
// primitives only enforce the two section-wide conventions on the result:
//   • null / undefined / '' / NaN  → the em dash '—'   (Phase 0 null convention)
//   • U+2212 '−'                    → ASCII '-'        (Decision 3: pastes into Excel as a number)

export const NULL_DASH = '—'
const UNICODE_MINUS = /−/g

export type CellValue = string | number | null | undefined

export function displayValue(value: CellValue, format?: (v: number) => string): string {
  if (value === null || value === undefined) return NULL_DASH
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NULL_DASH
    return (format ? format(value) : String(value)).replace(UNICODE_MINUS, '-')
  }
  return value === '' ? NULL_DASH : value.replace(UNICODE_MINUS, '-')
}

/**
 * Sign tones colour VALUE TEXT only (Rule 2).
 * positive / negative: valence (returns, P&L). dir-up / dir-down: the red / green
 * direction pair (yield / rate / spread up = red, down = green; hike red, cut
 * green; futures price up green). vol-premium-up / -down: exception 2, the VOL
 * implied-vol premium's own orange / blue.
 */
export type SignTone = 'positive' | 'negative' | 'dir-up' | 'dir-down' | 'vol-premium-up' | 'vol-premium-down'

/**
 * A value as it is DISPLAYED: rounded to `dp` decimals, with -0 normalised to 0.
 * Display text and tone / fill decisions both use this, so a value that prints
 * as zero is never signed or coloured (e.g. -0.04 at 1dp → 0, untoned). The
 * underlying value is never changed.
 */
export function roundForDisplay(v: number, dp: number): number {
  const r = Number(v.toFixed(dp))
  return r === 0 ? 0 : r
}

/** Signed fixed-point text at `dp` decimals: '+1.2', '-0.4', and '0.0' at zero (never '-0.0' / '+0.0'). ASCII '-'. */
export function fmtSignedFixed(v: number, dp: number, suffix = ''): string {
  const r = roundForDisplay(v, dp)
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(dp)}${suffix}`
}

/** Alert levels colour a cell TINT + outline only — never value text (Rule 2). */
export type AlertLevel = 'mild' | 'strong'

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}
