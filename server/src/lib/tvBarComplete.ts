// Is a TradingView daily bar a COMPLETED close? The one implementation behind
// both TypeScript callers and the `tv_bar_complete` SQL function (registered in
// db.ts). Spec: docs/prompts/tv-completed-bars-prompt.md (+ phase0-decisions).
//
// A bar is complete iff its market's session close is at or before the moment
// the data was CAPTURED (the CSV's file mtime, stored as tv_*.captured_at) —
// never "now": a bar captured at Tuesday noon still holds the noon intraday
// price at Tuesday night.
//
// `captured_at IS NULL` means COMPLETE. Rows ingested before captured_at
// existed are legacy bars; treating them as complete is what leaves existing
// partial bars to be overwritten by the next download rather than hiding them.
//
// Pure module: no db import, so db.ts can register the SQL function from it.

import { FALLBACK_CLOSE, MARKET_CLOSES, resolveMarketGroup, type MarketClose, type MarketGroup } from '../tvMarketRegistry'

const DAY = 86_400

/**
 * Fast path: a capture at least 2 days after the start (00:00 UTC) of the bar's
 * session date is complete. Proven safe from the registry by tvBarComplete.test
 * (every group's and the fallback's close falls before session date + 2 days).
 */
export const FAST_PATH_SECONDS = 2 * DAY

/**
 * The bar's true session date as epoch seconds at 00:00 UTC. tv_*.time is an
 * epoch at midnight Europe/London, so +3600 recovers the session date for BST
 * bars too (the convention readers keep returning is untouched).
 */
export function sessionDayStartUtc(barTime: number | string): number {
  const t = typeof barTime === 'number' ? barTime : Number.parseInt(barTime, 10)
  return Math.floor((t + 3600) / DAY) * DAY
}

// ── Zoned wall time → epoch (DST-correct via Intl) ───────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** The zone's UTC offset (seconds) at a given instant. */
function offsetSeconds(timeZone: string, epoch: number): number {
  const parts: Record<string, number> = {}
  for (const p of formatterFor(timeZone).formatToParts(new Date(epoch * 1000))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 1000
  return asUtc - epoch
}

/** Epoch of a local wall time in a zone. `hour` may be 24 (= next day 00:00). */
function zonedEpoch(timeZone: string, y: number, m: number, d: number, hour: number, minute: number): number {
  const wall = Date.UTC(y, m, d, hour, minute) / 1000
  let guess = wall - offsetSeconds(timeZone, wall)
  guess = wall - offsetSeconds(timeZone, guess) // second pass settles DST edges
  return guess
}

function parseClose(closeLocal: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(closeLocal)
  if (!m) throw new Error(`Bad closeLocal '${closeLocal}' (want HH:MM, 24:00 allowed)`)
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) throw new Error(`Bad closeLocal '${closeLocal}'`)
  return [h, mi]
}

const closeCache = new Map<string, number>()

/** Session close (epoch seconds) for a close rule on the session date that starts at `dayStartUtc`. */
export function sessionCloseEpoch(rule: MarketClose, dayStartUtc: number): number {
  const key = `${rule.timeZone}|${rule.closeLocal}|${dayStartUtc}`
  const hit = closeCache.get(key)
  if (hit !== undefined) return hit
  const d = new Date(dayStartUtc * 1000)
  const [h, mi] = parseClose(rule.closeLocal)
  const epoch = zonedEpoch(rule.timeZone, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi)
  closeCache.set(key, epoch)
  return epoch
}

// ── Symbol → close rule (with warn-once fallback) ────────────────────────────

const warnedFallback = new Set<string>()

function closeRuleFor(symbol: string): MarketClose {
  const g = resolveMarketGroup(symbol)
  if (g) return MARKET_CLOSES[g]
  if (!warnedFallback.has(symbol)) {
    warnedFallback.add(symbol)
    console.warn(`[tv-complete] Unknown TradingView symbol '${symbol}' — using fallback close ${FALLBACK_CLOSE.closeLocal} ${FALLBACK_CLOSE.timeZone}`)
  }
  return FALLBACK_CLOSE
}

/** Test hook: forget which fallback symbols have already been warned about. */
export function resetFallbackWarnings(): void {
  warnedFallback.clear()
}

// ── The predicate ────────────────────────────────────────────────────────────

/**
 * True when the bar is a completed daily close as of its capture.
 * capturedAt null/undefined → true (legacy rows; see header).
 */
export function isBarComplete(symbol: string, barTime: number | string, capturedAt: number | null | undefined): boolean {
  if (capturedAt == null) return true
  const day = sessionDayStartUtc(barTime)
  if (capturedAt >= day + FAST_PATH_SECONDS) return true
  return sessionCloseEpoch(closeRuleFor(symbol), day) <= capturedAt
}

/** Session close for a group (or the fallback when `group` is null) — for tests and the view helpers. */
export function groupSessionClose(group: MarketGroup | null, barTime: number | string): number {
  return sessionCloseEpoch(group ? MARKET_CLOSES[group] : FALLBACK_CLOSE, sessionDayStartUtc(barTime))
}

// ── SQL form ─────────────────────────────────────────────────────────────────

/** Name of the SQL function registered in db.ts. */
export const TV_BAR_COMPLETE_FN = 'tv_bar_complete'

/**
 * The SQL-function adapter: SQLite passes (symbol TEXT, time TEXT, captured_at
 * INTEGER|NULL) and wants an integer back. Delegates to isBarComplete.
 */
export function tvBarCompleteSql(symbol: unknown, time: unknown, capturedAt: unknown): number {
  const cap = capturedAt == null ? null : Number(capturedAt)
  return isBarComplete(String(symbol), String(time), cap) ? 1 : 0
}

/**
 * Reusable WHERE fragment for readers, e.g. `... WHERE symbol = ? AND ${tvCompleteSql()}`
 * or `${tvCompleteSql('t')}` for an aliased table. The NULL check short-circuits
 * legacy rows before the function is called; semantics equal isBarComplete.
 */
export function tvCompleteSql(alias?: string): string {
  const a = alias ? `${alias}.` : ''
  return `(${a}captured_at IS NULL OR ${TV_BAR_COMPLETE_FN}(${a}symbol, ${a}time, ${a}captured_at) = 1)`
}
