// Series-colour sources for charts. A series colour is either an identity
// colour (constants/identityColors.ts — what the line IS) or a sign token
// (what its value DOES). The chart theme itself carries neither.
import type { SignTone } from './acmFormat'

/** The seven sign-family tokens (valence, direction, alert, status). */
export const SIGN_TOKENS = [
  'acm-positive', 'acm-negative', 'acm-dir-up', 'acm-dir-down',
  'acm-alert-mild', 'acm-alert-strong', 'acm-status-warning',
] as const

export type SignToken = (typeof SIGN_TOKENS)[number]

/** var() reference for a sign token, for SVG fills/strokes (e.g. Δ bars). */
export function signColor(token: SignToken): string {
  return `var(--${token})`
}

/** The text/fill colour for a value tone. */
export function toneColor(tone: SignTone): string {
  return signColor(`acm-${tone}` as SignToken)
}
