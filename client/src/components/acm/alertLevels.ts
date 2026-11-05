// Alert-family thresholds for unsigned extremeness readings. The level drives a
// cell tint / badge / outline only (tones `alertClass`); value text stays
// primary. Both work on the value as displayed, so the tint matches the number.
import type { AlertLevel } from './acmFormat'

/** Z-scores (Phase 0 Decision 2): |z| > 3 strong, |z| > 2 mild, on the 2dp value. */
export function zAlertLevel(z: number | null | undefined): AlertLevel | undefined {
  if (z == null || !Number.isFinite(z)) return undefined
  const a = Math.abs(Number(z.toFixed(2)))
  if (a > 3) return 'strong'
  if (a > 2) return 'mild'
  return undefined
}

/**
 * IV rank / IV percentile on a 0–100 scale (M1 ruling 2), both ends:
 * >= 98 or <= 2 strong, >= 90 or <= 10 mild, on the whole-number value shown.
 */
export function rankAlertLevel(v: number | null | undefined): AlertLevel | undefined {
  if (v == null || !Number.isFinite(v)) return undefined
  const r = Math.round(v)
  if (r >= 98 || r <= 2) return 'strong'
  if (r >= 90 || r <= 10) return 'mild'
  return undefined
}
