// Hephaestus transforms + derived-series ops — pure functions over date-sorted
// {date, value} points. All computation is server-side; the model only names a
// transform in the spec.
//
// Honesty rules (canonical, per the accepted alignment deviation):
//   - Derived ops (a op b) compute ONLY on dates where BOTH inputs have a
//     native observation — no fill, no interpolation. daily⊖daily aligns
//     fully; daily⊖monthly yields at most monthly points (sparse-but-honest).
//   - yoy/mom look back by CALENDAR date (latest own observation at or before
//     the target date, within a tolerance), never by fabricated values; a
//     point with no in-tolerance base is skipped.

import type { Transform } from './chartSpec'
import type { Point } from './render'

const YOY_TOLERANCE_DAYS = 45   // covers monthly/quarterly stamping drift
const MOM_TOLERANCE_DAYS = 15

function shiftIso(iso: string, years: number, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/** Latest index with points[i].date <= target, or -1. Points are date-sorted. */
function latestAtOrBefore(points: Point[], target: string): number {
  let lo = 0, hi = points.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].date <= target) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
}

function pctVsLookback(points: Point[], years: number, months: number, toleranceDays: number): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const target = shiftIso(p.date, -years, -months)
    const i = latestAtOrBefore(points, target)
    if (i === -1) continue
    const base = points[i]
    if (daysBetween(base.date, target) > toleranceDays || base.value === 0) continue
    out.push({ date: p.date, value: (p.value / base.value - 1) * 100 })
  }
  return out
}

export function applyTransform(points: Point[], t: Transform | undefined): Point[] {
  if (!t || t.type === 'level') return points
  if (points.length === 0) return points

  switch (t.type) {
    case 'rebase100': {
      const base = points[0].value
      if (base === 0) throw new Error('rebase100: first value in range is 0 — cannot rebase')
      return points.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
    }
    case 'yoy_pct':
      return pctVsLookback(points, 1, 0, YOY_TOLERANCE_DAYS)
    case 'mom_pct':
      return pctVsLookback(points, 0, 1, MOM_TOLERANCE_DAYS)
    case 'diff':
      return points.slice(t.periods).map((p, i) => ({ date: p.date, value: p.value - points[i].value }))
    case 'rolling_mean': {
      const out: Point[] = []
      let sum = 0
      for (let i = 0; i < points.length; i++) {
        sum += points[i].value
        if (i >= t.window) sum -= points[i - t.window].value
        if (i >= t.window - 1) out.push({ date: points[i].date, value: sum / t.window })
      }
      return out
    }
    case 'zscore': {
      const out: Point[] = []
      for (let i = t.window - 1; i < points.length; i++) {
        const win = points.slice(i - t.window + 1, i + 1)
        const mean = win.reduce((a, p) => a + p.value, 0) / t.window
        const variance = win.reduce((a, p) => a + (p.value - mean) ** 2, 0) / t.window
        const std = Math.sqrt(variance)
        if (std === 0) continue
        out.push({ date: points[i].date, value: (points[i].value - mean) / std })
      }
      return out
    }
  }
}

export type DerivedOp = 'subtract' | 'add' | 'ratio'

/**
 * a op b on the exact-date intersection of the two inputs (no fill — see the
 * sparsity rule at the top of this file). ratio skips dates where b is 0.
 */
export function computeDerived(op: DerivedOp, a: Point[], b: Point[]): Point[] {
  const bByDate = new Map(b.map(p => [p.date, p.value]))
  const out: Point[] = []
  for (const p of a) {
    const bv = bByDate.get(p.date)
    if (bv === undefined) continue
    if (op === 'ratio' && bv === 0) continue
    out.push({
      date: p.date,
      value: op === 'subtract' ? p.value - bv : op === 'add' ? p.value + bv : p.value / bv,
    })
  }
  return out
}

/** Normalize a catalog frequency string to a coarse bucket for comparisons. */
export function frequencyBucket(freq: string | null): string | null {
  if (!freq) return null
  const f = freq.toLowerCase()
  for (const b of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual']) {
    if (f.startsWith(b)) return b
  }
  return f
}
