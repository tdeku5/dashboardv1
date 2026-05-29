// Surprise classifier for the Economic Data Log. Pure functions: given a
// release row + the rule table, return one of the SurpriseLabel values. Runs
// after persistence (see index.ts) and writes the result onto the row.

import { findSurpriseRule } from '../config/economicSurpriseRules'
import type { EconomicRelease, SurpriseLabel, SurpriseRule } from './types'

// Extracts the comparable number from a raw Trading Economics value string.
// Handles: "%", thousands/millions suffixes (K/M), thousands separators, signs,
// and multi-horizon strings like "0.2mom, 2.8yoy" (takes the FIRST / headline
// figure — seed thresholds for CPI/PCE/Retail/IP are calibrated to the MoM
// print, which TE lists first). Returns null when no number is present.
export function parseSurpriseValue(raw: string | null | undefined, unit: SurpriseRule['unit']): number | null {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (s === '' || s === '-' || s === '—' || s === 'n/a') return null

  // First numeric token, optionally followed by a K/M/B/% suffix.
  const m = s.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*([kmb%])?/)
  if (!m) return null

  let value = parseFloat(m[1])
  if (!Number.isFinite(value)) return null
  const suffix = m[2]

  if (unit === 'percent') {
    // "2.8%" → 2.8; a bare number is already in percentage points.
    return value
  }

  if (unit === 'thousands') {
    // Normalize everything to thousands. "200k" → 200, "1.2m" → 1200, and a
    // bare "200" is assumed already in thousands (matches TE's payrolls "200K"
    // and the rule thresholds, which are expressed in thousands).
    if (suffix === 'm' || suffix === 'b') value *= 1000
    return value
  }

  // 'absolute' (PMIs, etc.) — take the number as-is.
  return value
}

// Maps a direction-adjusted surprise onto the 5-label scale. See
// economicSurpriseRules.ts for the threshold semantics: with five output labels
// the active boundaries are in_line (neutral deadzone) and hot (strong move).
export function classifySurprise(actual: number, expected: number, rule: SurpriseRule): SurpriseLabel {
  // s > 0 ⇒ "hotter" than expected in the indicator's economic-strength sense
  // (direction flips this for inverted indicators like unemployment). Round to
  // 6dp so float noise (e.g. 3.7 − 4.0 = −0.2999999999999998) can't push a
  // value that should sit exactly on a threshold into the wrong band.
  const s = Math.round((actual - expected) * rule.direction * 1e6) / 1e6
  const mag = Math.abs(s)

  if (mag <= rule.in_line_threshold) return 'in line'
  if (s > 0) return mag >= rule.hot_threshold ? 'hot' : 'warm'
  return mag >= rule.hot_threshold ? 'cold' : 'cool'
}

// Classifies one release. Returns:
//   • a SurpriseLabel when a rule matches and both actual & expected parse
//   • 'unclassified' when no rule matches the event (caller logs it for triage)
//   • null when a rule exists but the surprise can't be computed yet (e.g. the
//     release hasn't printed, so actual is missing) — stored as NULL, distinct
//     from 'unclassified'.
// `findRule` is injectable: defaults to the static TS seed lookup; production
// passes a DB-merged lookup (ruleLookup.ts) so triage-added rules apply.
export function classifyRelease(
  release: EconomicRelease,
  findRule: (event: string) => SurpriseRule | null = findSurpriseRule,
): SurpriseLabel | null {
  const rule = findRule(release.event)
  if (!rule) return 'unclassified'

  const actual = parseSurpriseValue(release.actual, rule.unit)
  const expected = parseSurpriseValue(release.expected, rule.unit)
  if (actual == null || expected == null) return null

  return classifySurprise(actual, expected, rule)
}
