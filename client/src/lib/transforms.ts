import type { FredObservation } from './fred'

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface ValidObs {
  date:  string
  value: number
}

/** Strip missing ("." or empty) observations and parse to numbers. */
export function toValid(raw: FredObservation[]): ValidObs[] {
  return raw
    .filter(o => o.value !== '.' && o.value.trim() !== '')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !isNaN(o.value))
}

/** Raw "YYYY-MM-DD" of the last valid observation. */
export function lastObsRawDate(obs: ValidObs[]): string | undefined {
  return obs[obs.length - 1]?.date
}

/** Last observation date formatted as "Mon YYYY". */
export function lastObsDate(obs: ValidObs[]): string | undefined {
  const raw = lastObsRawDate(obs)
  if (!raw) return undefined
  const [year, month] = raw.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(month) - 1]} ${year}`
}

// ── Indexing ──────────────────────────────────────────────────────────────────

/** Value n positions from the end (0 = latest, 1 = previous, …). */
export function nthLast(obs: ValidObs[], n: number): number | null {
  const i = obs.length - 1 - n
  return i >= 0 ? obs[i].value : null
}

// ── Date-based period lookup ──────────────────────────────────────────────────

/**
 * Finds the observation whose date falls in exactly the same calendar month
 * as the latest observation, but `months` years/months earlier — by matching
 * on the "YYYY-MM" prefix of the ISO date string.
 *
 * This is immune to gaps in the data and to any extra/revised entries,
 * because it never relies on array-position counting.
 */
function findMonthsAgo(obs: ValidObs[], months: number): ValidObs | null {
  if (obs.length === 0) return null
  const [yearStr, monthStr] = obs[obs.length - 1].date.split('-')
  // Convert to a flat month count, subtract, then back to Y-M
  const total = parseInt(yearStr) * 12 + (parseInt(monthStr) - 1) - months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const prefix = `${y}-${String(m).padStart(2, '0')}`
  return obs.find(o => o.date.startsWith(prefix)) ?? null
}

// ── Rate-of-change calculations (monthly cadence assumed) ────────────────────

/**
 * YoY percent change: (latest / same calendar month 12 months prior) − 1, × 100.
 * Looks up the base by exact YYYY-MM match, not by array index.
 */
export function yoyPct(obs: ValidObs[]): number | null {
  if (obs.length === 0) return null
  const latest = obs[obs.length - 1]
  const base   = findMonthsAgo(obs, 12)
  if (!base || base.value === 0) return null
  return ((latest.value / base.value) - 1) * 100
}

/**
 * Annualised compound growth over `periods` months:
 *   ((curr / base) ^ (12 / periods) − 1) × 100
 * Base is the exact calendar month `periods` months before the latest.
 */
export function annualisedGrowth(obs: ValidObs[], periods: number): number | null {
  if (obs.length === 0) return null
  const latest = obs[obs.length - 1]
  const base   = findMonthsAgo(obs, periods)
  if (!base || base.value === 0) return null
  return (Math.pow(latest.value / base.value, 12 / periods) - 1) * 100
}

/**
 * Simple percent change vs exactly `periods` calendar months ago.
 * Base is the exact calendar month `periods` months before the latest.
 */
export function pctChange(obs: ValidObs[], periods: number): number | null {
  if (obs.length === 0) return null
  const latest = obs[obs.length - 1]
  const base   = findMonthsAgo(obs, periods)
  if (!base || base.value === 0) return null
  return ((latest.value / base.value) - 1) * 100
}

/**
 * Absolute level delta vs exactly `periods` calendar months ago.
 * Base is the exact calendar month `periods` months before the latest.
 */
export function levelDelta(obs: ValidObs[], periods: number): number | null {
  if (obs.length === 0) return null
  const latest = obs[obs.length - 1]
  const base   = findMonthsAgo(obs, periods)
  if (!base) return null
  return latest.value - base.value
}

// ── MoM level-change helpers (for employment series like PAYEMS) ─────────────

function momLevelChanges(obs: ValidObs[]): number[] {
  const out: number[] = []
  for (let i = 1; i < obs.length; i++) out.push(obs[i].value - obs[i - 1].value)
  return out
}

export function latestMomChange(obs: ValidObs[]): number | null {
  const d = momLevelChanges(obs)
  return d.length > 0 ? d[d.length - 1] : null
}

export function prevMomChange(obs: ValidObs[]): number | null {
  const d = momLevelChanges(obs)
  return d.length > 1 ? d[d.length - 2] : null
}

export function avgMomChange(obs: ValidObs[], n: number): number | null {
  const d = momLevelChanges(obs)
  if (d.length < n) return null
  const slice = d.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

// ── YoY history (for regime signal computation) ──────────────────────────────

/**
 * Returns the YoY% change for each observation that has a valid base
 * observation 12 calendar months prior, in chronological order.
 *
 * Used to build the rolling YoY series from which regime signals are derived.
 * Observations lacking a 12-month base (the first ~12 in any window) are
 * silently omitted.
 */
export function buildYoyHistory(obs: ValidObs[]): number[] {
  const result: number[] = []
  for (const o of obs) {
    const [yearStr, monthStr] = o.date.split('-')
    const total = parseInt(yearStr) * 12 + (parseInt(monthStr) - 1) - 12
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    const prefix = `${y}-${String(m).padStart(2, '0')}`
    const base = obs.find(b => b.date.startsWith(prefix))
    if (base && base.value !== 0) {
      result.push((o.value / base.value - 1) * 100)
    }
  }
  return result
}

// ── Formatters ────────────────────────────────────────────────────────────────

const sgn = (v: number) => v >= 0 ? '+' : ''

/** Percent rate: "2.74%" */
export function fmtPct(v: number | null, dp = 2): string {
  if (v === null) return '—'
  return v.toFixed(dp) + '%'
}

/** Signed percent rate: "+2.74%" */
export function fmtPctSgn(v: number | null, dp = 2): string {
  if (v === null) return '—'
  return sgn(v) + v.toFixed(dp) + '%'
}

/** Raw level already in %: "4.1%" */
export function fmtPctLvl(v: number | null, dp = 2): string {
  if (v === null) return '—'
  return v.toFixed(dp) + '%'
}

/** Fixed decimal: "102.34" */
export function fmtFixed(v: number | null, dp = 2): string {
  if (v === null) return '—'
  return v.toFixed(dp)
}

/** Signed fixed: "+0.45" */
export function fmtFixedSgn(v: number | null, dp = 2): string {
  if (v === null) return '—'
  return sgn(v) + v.toFixed(dp)
}

/** PAYEMS-style thousands → "+145K" */
export function fmtK(v: number | null): string {
  if (v === null) return '—'
  const r = Math.round(v)
  return sgn(r) + r.toString() + 'K'
}

/** Large dollar level (billions) → "$17.2T" or "$450.0B" */
export function fmtBillions(v: number | null, dp = 1): string {
  if (v === null) return '—'
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(dp) + 'T'
  return '$' + v.toFixed(dp) + 'B'
}

/** BPS from a percent value: 3.15 → "315 bps" */
export function fmtBps(v: number | null): string {
  if (v === null) return '—'
  return Math.round(v * 100) + ' bps'
}

// ── Direction helper ──────────────────────────────────────────────────────────

export function dirOf(v: number | null): 'up' | 'down' | 'flat' | undefined {
  if (v === null) return undefined
  if (Math.abs(v) < 1e-10) return 'flat'
  return v > 0 ? 'up' : 'down'
}
