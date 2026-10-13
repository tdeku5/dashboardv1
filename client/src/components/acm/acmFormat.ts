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
 * Sign tones colour VALUE TEXT only (Rule 2). Valence = up is good;
 * direction = up is neither good nor bad.
 */
export type SignTone = 'positive' | 'negative' | 'dir-up' | 'dir-down'

/** Alert levels colour a cell TINT + outline only — never value text (Rule 2). */
export type AlertLevel = 'mild' | 'strong'

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}
