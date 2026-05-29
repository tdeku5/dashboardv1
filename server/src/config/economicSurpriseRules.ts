// Surprise-classification rules for the Economic Data Log, keyed by event name.
// Stored as a typed TS module (the repo has no YAML parser and configs live in
// TS — cf. client/src/data/seriesConfig.ts). Edit by hand or via the Phase 3
// admin view. Events with no rule are classified `unclassified` and logged to
// needs_classification.log for triage.
//
// THRESHOLDS form an ascending magnitude ladder applied to the direction-adjusted
// surprise s = (actual − expected) × direction:
//   • in_line_threshold — half-width of the neutral "in line" deadzone
//   • warm_threshold     — mild/strong split inside the warm & cool families
//   • hot_threshold      — cutoff above which a beat is "hot" / a miss is "cold"
// With five output labels the active boundaries are in_line and hot (see
// classifySurprise.ts); warm_threshold is the documented midpoint, used by the
// UI to graduate the warm/cool shades and reserved for a finer scale.
//
// DIRECTION: +1 = higher-than-expected is the "hot" (economically strong/hawkish)
// outcome. −1 inverts it for indicators where lower is hotter (unemployment,
// jobless claims). UNIT controls how the raw TE string is parsed into a number
// (see parseSurpriseValue in classifySurprise.ts).

import type { SurpriseRule } from '../economicCalendar/types'

export const ECONOMIC_SURPRISE_RULES: Record<string, SurpriseRule> = {
  'CPI':       { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: 1,  unit: 'percent' },
  'Core CPI':  { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: 1,  unit: 'percent' },
  'PCE':       { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: 1,  unit: 'percent' },
  'Core PCE':  { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: 1,  unit: 'percent' },

  'GDP':       { in_line_threshold: 0.2, warm_threshold: 0.5, hot_threshold: 1.0, direction: 1,  unit: 'percent' },

  'Nonfarm Payrolls':  { in_line_threshold: 20, warm_threshold: 50, hot_threshold: 100, direction: 1,  unit: 'thousands' },
  'Employment Change': { in_line_threshold: 20, warm_threshold: 50, hot_threshold: 100, direction: 1,  unit: 'thousands' },

  'Unemployment Rate': { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: -1, unit: 'percent' },

  'Initial Claims':    { in_line_threshold: 10, warm_threshold: 25, hot_threshold: 50, direction: -1, unit: 'thousands' },
  'Continuing Claims': { in_line_threshold: 10, warm_threshold: 25, hot_threshold: 50, direction: -1, unit: 'thousands' },

  'Manufacturing PMI': { in_line_threshold: 0.5, warm_threshold: 1.5, hot_threshold: 3.0, direction: 1, unit: 'absolute' },
  'Services PMI':      { in_line_threshold: 0.5, warm_threshold: 1.5, hot_threshold: 3.0, direction: 1, unit: 'absolute' },
  'Composite PMI':     { in_line_threshold: 0.5, warm_threshold: 1.5, hot_threshold: 3.0, direction: 1, unit: 'absolute' },

  'Retail Sales':         { in_line_threshold: 0.2, warm_threshold: 0.5, hot_threshold: 1.0, direction: 1, unit: 'percent' },
  'Industrial Production': { in_line_threshold: 0.3, warm_threshold: 0.7, hot_threshold: 1.5, direction: 1, unit: 'percent' },
}

// Case-insensitive, punctuation-insensitive lookup key so "Core CPI",
// "core cpi" and "Core  CPI" collapse to the same rule. Shared with the DB
// rule merge (ruleLookup.ts) so seed and user rules key identically.
export function normalizeEventKey(event: string): string {
  return event.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const RULES_BY_NORMALIZED_KEY: Map<string, SurpriseRule> = new Map(
  Object.entries(ECONOMIC_SURPRISE_RULES).map(([name, rule]) => [normalizeEventKey(name), rule]),
)

// Looks up a rule for a TE event name. Exact (normalized) match only — fuzzy
// matching would mis-bucket releases, so unknown events deliberately fall
// through to `unclassified` + needs_classification.log for manual triage.
export function findSurpriseRule(event: string): SurpriseRule | null {
  return RULES_BY_NORMALIZED_KEY.get(normalizeEventKey(event)) ?? null
}
