// One as-of date per view (docs/prompts/tv-completed-bars-phase0-decisions.md,
// redefined by tv-completed-bars-phase1-rulings.md R1).
//
// All TradingView series share the US03MY chart's row dates but markets close
// at different times. Alignment waits only on bars that EXIST but aren't
// finished: a missing row (holiday, no trade) never blocks a view.
//
//   firstIncomplete(G) = earliest time of any row of G's symbols that is not
//                        complete (tv_bar_complete false), or null
//   frontier           = min firstIncomplete(G) over the view's groups
//   viewAsOf           = latest stored row time (for the view's symbols)
//                        strictly earlier than the frontier; with no frontier,
//                        the latest row time overall
//
// Readers then select `time <= viewAsOf` plus the completeness predicate.
// Legacy NULL captured_at rows are complete, so they never block.
//
// Scan bound: an incomplete row's capture is < its session date + the fast-path
// limit, so a row captured within BOUND_SLACK of the group's newest capture can
// only be incomplete if its time > maxCaptured(G) − BOUND_SECONDS. Rows older
// than that are skipped. Besides speed, this lets a symbol that left the export
// mid-session (its last bar frozen incomplete) stop blocking once newer captures
// move past it — the unbounded scan would block on it forever.
//
// Results are cached until the next TradingView ingest (tv_ingest_log grows by
// one row per file processed) — completeness depends on captured_at, not the clock.
//
// Speed: CAST(time AS INTEGER) defeats the (symbol, time) primary-key index, so
// a recent window is read per symbol with an index range seek on the 10-digit
// time strings (text order = numeric order inside that range; a CAST check
// drops the few older 9-digit strings that sort into it). Completeness there is
// judged by the same isBarComplete. Whenever the window can't answer a question
// (a group with no recent rows, or a bound reaching past the window), the full
// SQL scan below answers it instead — same results either way.

import { db } from '../db'
import { resolveMarketGroup, type MarketGroup } from '../tvMarketRegistry'
import { FAST_PATH_SECONDS, isBarComplete } from './tvBarComplete'

const DAY = 86_400
/** Captures this close to the group's newest one are fully covered by the bound. */
const BOUND_SLACK = DAY
/** firstIncomplete scans rows with time > maxCaptured(G) − BOUND_SECONDS (the +3600 is the London-midnight label offset). */
export const BOUND_SECONDS = FAST_PATH_SECONDS + BOUND_SLACK + 3600

type Table = 'tv_series' | 'tv_ohlcv'
interface Membership { tv_series: Map<MarketGroup, string[]>; tv_ohlcv: Map<MarketGroup, string[]> }

/** Recent window read per symbol for the fast path (wall clock only picks the window, never the answer). */
const RECENT_WINDOW_SECONDS = 120 * DAY

interface RecentRow { t: number; cap: number | null; complete: boolean }
interface Snapshot { lo: number; rows: Map<string, RecentRow[]> } // key `${table}|${symbol}`

let cacheKey: number | null = null
let membership: Membership | null = null
let snapshot: Snapshot | null = null
const incompleteCache = new Map<string, number | null>()   // `${group}|${bounded}`
const viewCache = new Map<string, number | null>()         // sorted group list

function dataVersion(): number {
  return (db.prepare('SELECT COALESCE(MAX(id), 0) AS v FROM tv_ingest_log').get() as { v: number }).v
}

function freshen(): void {
  const v = dataVersion()
  if (v !== cacheKey) clearViewAsOfCache(v)
}

/** Drop cached state (tests write tv_* rows without an ingest log entry). */
export function clearViewAsOfCache(version: number | null = null): void {
  cacheKey = version
  membership = null
  snapshot = null
  incompleteCache.clear()
  viewCache.clear()
}

function groupMembers(): Membership {
  if (membership) return membership
  const bucket = (rows: Array<{ symbol: string }>): Map<MarketGroup, string[]> => {
    const m = new Map<MarketGroup, string[]>()
    for (const { symbol } of rows) {
      const g = resolveMarketGroup(symbol)
      if (!g) continue // fallback symbols are filtered per row but don't set a view date
      const arr = m.get(g)
      if (arr) arr.push(symbol)
      else m.set(g, [symbol])
    }
    return m
  }
  membership = {
    tv_series: bucket(db.prepare('SELECT DISTINCT symbol FROM tv_series').all() as Array<{ symbol: string }>),
    tv_ohlcv: bucket(db.prepare(`SELECT DISTINCT symbol FROM tv_ohlcv WHERE timeframe = '1D'`).all() as Array<{ symbol: string }>),
  }
  return membership
}

function recent(): Snapshot {
  if (snapshot) return snapshot
  const now = Math.floor(Date.now() / 1000)
  const lo = now - RECENT_WINDOW_SECONDS
  // Tight upper bound keeps shorter pre-2001 strings (e.g. '9998…') out of the text range.
  const hi = now + RECENT_WINDOW_SECONDS
  const rows = new Map<string, RecentRow[]>()
  const m = groupMembers()
  for (const table of ['tv_series', 'tv_ohlcv'] as const) {
    const tf = table === 'tv_ohlcv' ? ` AND timeframe = '1D'` : ''
    const stmt = db.prepare(`
      SELECT symbol, time, captured_at FROM ${table}
      WHERE symbol = ?${tf} AND time BETWEEN ? AND ? AND close IS NOT NULL
    `)
    for (const symbols of m[table].values()) {
      for (const sym of symbols) {
        const out: RecentRow[] = []
        for (const r of stmt.all(sym, String(lo), String(hi)) as Array<{ symbol: string; time: string; captured_at: number | null }>) {
          const t = Number.parseInt(r.time, 10)
          if (!(t >= lo && t <= hi)) continue // a shorter (pre-2001) string that sorts into the text range
          out.push({ t, cap: r.captured_at, complete: isBarComplete(sym, t, r.captured_at) })
        }
        if (out.length > 0) rows.set(`${table}|${sym}`, out)
      }
    }
  }
  snapshot = { lo, rows }
  // A bar dated beyond `hi` can't exist (hi is ~4 months ahead of now), so the window's top is open in practice.
  return snapshot
}

/** The group's recent rows, or null when it has none in the window. */
function recentRowsOf(groups: readonly MarketGroup[]): RecentRow[] | null {
  const snap = recent()
  const m = groupMembers()
  const out: RecentRow[] = []
  for (const table of ['tv_series', 'tv_ohlcv'] as const) {
    for (const g of groups) for (const sym of m[table].get(g) ?? []) out.push(...(snap.rows.get(`${table}|${sym}`) ?? []))
  }
  return out.length > 0 ? out : null
}

function scope(table: Table, symbols: string[]): { where: string; params: string[] } {
  const tf = table === 'tv_ohlcv' ? ` AND timeframe = '1D'` : ''
  return { where: `symbol IN (${symbols.map(() => '?').join(', ')})${tf}`, params: symbols }
}

function minOf(a: number | null, b: number | null): number | null {
  return a == null ? b : b == null ? a : Math.min(a, b)
}
function maxOf(a: number | null, b: number | null): number | null {
  return a == null ? b : b == null ? a : Math.max(a, b)
}

/**
 * Earliest raw `time` of an incomplete row among a group's symbols, or null.
 * `bounded` (default) applies the scan bound described in the header.
 */
export function firstIncomplete(group: MarketGroup, opts: { bounded?: boolean } = {}): number | null {
  freshen()
  const bounded = opts.bounded ?? true
  const key = `${group}|${bounded}`
  if (incompleteCache.has(key)) return incompleteCache.get(key) ?? null
  if (bounded) {
    const rows = recentRowsOf([group])
    if (rows) {
      const caps = rows.map(r => r.cap).filter((c): c is number => c != null)
      if (caps.length === 0) { incompleteCache.set(key, null); return null } // all legacy NULL
      const floor = Math.max(...caps) - BOUND_SECONDS
      if (floor >= recent().lo) {
        let f: number | null = null
        for (const r of rows) if (r.t > floor && !r.complete) f = minOf(f, r.t)
        incompleteCache.set(key, f)
        return f
      }
    }
  }
  return firstIncompleteSql(group, bounded, key)
}

/** Full-scan form of firstIncomplete (fallback, and the unbounded reference). */
function firstIncompleteSql(group: MarketGroup, bounded: boolean, key: string): number | null {
  const m = groupMembers()
  let first: number | null = null
  for (const table of ['tv_series', 'tv_ohlcv'] as const) {
    const symbols = m[table].get(group) ?? []
    if (symbols.length === 0) continue
    const { where, params } = scope(table, symbols)
    let floor = Number.MIN_SAFE_INTEGER
    if (bounded) {
      const cap = (db.prepare(`SELECT MAX(captured_at) AS c FROM ${table} WHERE ${where}`).get(...params) as { c: number | null }).c
      if (cap == null) continue // every row is legacy NULL → nothing can be incomplete
      floor = cap - BOUND_SECONDS
    }
    const row = db.prepare(`
      SELECT MIN(CAST(time AS INTEGER)) AS t FROM ${table}
      WHERE ${where} AND close IS NOT NULL AND captured_at IS NOT NULL
        AND CAST(time AS INTEGER) > ? AND tv_bar_complete(symbol, time, captured_at) = 0
    `).get(...params, floor) as { t: number | null }
    first = minOf(first, row.t)
  }
  incompleteCache.set(key, first)
  return first
}

/** Latest stored row time for the groups' symbols, optionally strictly before `before`. */
function latestRowTime(groups: readonly MarketGroup[], before: number | null): number | null {
  const rows = recentRowsOf(groups)
  if (rows) {
    let best: number | null = null
    for (const r of rows) if (before == null || r.t < before) best = maxOf(best, r.t)
    if (best != null) return best // the window holds the answer (anything older is smaller)
  }
  return latestRowTimeSql(groups, before)
}

function latestRowTimeSql(groups: readonly MarketGroup[], before: number | null): number | null {
  const m = groupMembers()
  let latest: number | null = null
  for (const table of ['tv_series', 'tv_ohlcv'] as const) {
    const symbols = groups.flatMap(g => m[table].get(g) ?? [])
    if (symbols.length === 0) continue
    const { where, params } = scope(table, symbols)
    const cut = before == null ? '' : ' AND CAST(time AS INTEGER) < ?'
    const row = db.prepare(`
      SELECT MAX(CAST(time AS INTEGER)) AS t FROM ${table} WHERE ${where} AND close IS NOT NULL${cut}
    `).get(...params, ...(before == null ? [] : [before])) as { t: number | null }
    latest = maxOf(latest, row.t)
  }
  return latest
}

/** The frontier for a set of groups: the earliest incomplete row time, or null. */
export function frontier(groups: readonly MarketGroup[], opts: { bounded?: boolean } = {}): number | null {
  let f: number | null = null
  for (const g of new Set(groups)) f = minOf(f, firstIncomplete(g, opts))
  return f
}

/** The view's single as-of time (raw tv_*.time epoch), or null when the groups hold no rows. */
export function viewAsOf(groups: readonly MarketGroup[], opts: { bounded?: boolean } = {}): number | null {
  freshen()
  const uniq = [...new Set(groups)].sort()
  const key = `${uniq.join(',')}|${opts.bounded ?? true}`
  if (viewCache.has(key)) return viewCache.get(key) ?? null
  const asOf = latestRowTime(uniq, frontier(uniq, opts))
  viewCache.set(key, asOf)
  return asOf
}

/** Distinct market groups for a list of symbols (unknown symbols contribute none). */
export function groupsForSymbols(symbols: readonly string[]): MarketGroup[] {
  const out = new Set<MarketGroup>()
  for (const s of symbols) {
    const g = resolveMarketGroup(s)
    if (g) out.add(g)
  }
  return [...out]
}
