// Merged surprise-rule lookup: static TS seeds (config/economicSurpriseRules.ts)
// overlaid with runtime user rules from the DB (economic_surprise_rules, added
// via the Phase 3 triage UI). DB rules win on key collision. Returns a pure
// `(event) => rule | null` function so the classifier stays testable — the DB
// read happens once, here, not inside classifyRelease.

import { ECONOMIC_SURPRISE_RULES, normalizeEventKey } from '../config/economicSurpriseRules'
import { getSurpriseRulesFromDb } from '../db'
import type { SurpriseRule } from './types'

export type RuleLookup = (event: string) => SurpriseRule | null

export function buildRuleLookup(): RuleLookup {
  const map = new Map<string, SurpriseRule>()
  // Seed rules first…
  for (const [name, rule] of Object.entries(ECONOMIC_SURPRISE_RULES)) {
    map.set(normalizeEventKey(name), rule)
  }
  // …then user/DB rules override.
  for (const r of getSurpriseRulesFromDb()) {
    map.set(normalizeEventKey(r.event), {
      in_line_threshold: r.in_line_threshold,
      warm_threshold: r.warm_threshold,
      hot_threshold: r.hot_threshold,
      direction: r.direction === -1 ? -1 : 1,
      unit: r.unit,
    })
  }
  return (event: string) => map.get(normalizeEventKey(event)) ?? null
}
