// How readers see TradingView bars (docs/prompts/tv-completed-bars-*.md, Phase 2).
//
// Every reader query against tv_series / tv_ohlcv includes `${tvVisible(...)}`
// in its WHERE clause, BEFORE any ORDER BY / LIMIT / MAX / as-of selection, so
// an unfinished bar never takes a "latest N" slot:
//
//   (completeness predicate) AND CAST(time AS INTEGER) <= viewAsOf
//
// viewAsOf comes from lib/tvViewAsOf (R1: only incomplete rows block; holidays
// never do). Which groups a view spans:
//   - a route that assembles one view from several calls declares them once per
//     request with withTvView(groups, fn) — every tvVisible() inside uses them;
//   - otherwise the groups of the symbols passed to tvVisible() (one query =
//     one view).
// With every captured_at NULL (legacy data) the predicate is always true and
// viewAsOf is the latest stored row, so outputs are unchanged.
//
// The guard test (tvReaders.guard.test.ts) fails on any tv_* query that neither
// uses these helpers nor carries an explicit `tv-raw-ok:` marker.

import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '../db'
import { resolveMarketGroup, type MarketGroup } from '../tvMarketRegistry'
import { tvCompleteSql } from './tvBarComplete'
import { groupsForSymbols, viewAsOf } from './tvViewAsOf'

const viewScope = new AsyncLocalStorage<{ groups: readonly MarketGroup[] }>()

/** Run `fn` as one aligned view over `groups` (multi-call routes). */
export function withTvView<T>(groups: readonly MarketGroup[], fn: () => T): T {
  return viewScope.run({ groups }, fn)
}

/** The groups the current view spans (declared scope, else the given symbols'). */
function activeGroups(symbols: readonly string[]): readonly MarketGroup[] {
  return viewScope.getStore()?.groups ?? groupsForSymbols(symbols)
}

/** The view as-of for these symbols (or the declared view), or null when unconstrained. */
export function tvAsOf(symbols: readonly string[]): number | null {
  return viewAsOf(activeGroups(symbols))
}

/**
 * WHERE fragment: completeness predicate + `time <= viewAsOf`. `alias` qualifies
 * the columns for joins. The as-of is an integer we computed, inlined as a literal.
 */
export function tvVisible(symbols: readonly string[], alias?: string): string {
  const a = alias ? `${alias}.` : ''
  const asOf = tvAsOf(symbols)
  if (asOf != null && !Number.isSafeInteger(asOf)) throw new Error(`tvVisible: bad as-of ${String(asOf)}`)
  const cap = asOf == null ? '' : ` AND CAST(${a}time AS INTEGER) <= ${asOf}`
  return `(${tvCompleteSql(alias)}${cap})`
}

/** Symbols currently stored that match a GLOB pattern (e.g. 'SR3[FGHJKMNQUVXZ][0-9]*'). */
export function tvSymbolsMatching(globPattern: string): string[] {
  const rows = db.prepare(/* tv-raw-ok: symbol list only, no bar values */ `
    SELECT DISTINCT symbol FROM tv_series WHERE symbol GLOB ?
  `).all(globPattern) as Array<{ symbol: string }>
  return rows.map(r => r.symbol)
}

/** tvVisible for every stored symbol matching a GLOB pattern. */
export function tvVisibleGlob(globPattern: string, alias?: string): string {
  return tvVisible(tvSymbolsMatching(globPattern), alias)
}

/**
 * Market group of a futures root (e.g. 'SR3', 'EUR', 'TOA3'), via the registry
 * resolver on a representative contract code. Null for roots it doesn't know.
 */
export function groupForFuturesRoot(root: string): MarketGroup | null {
  return resolveMarketGroup(`${root}Z9`)
}

/** Distinct groups for a set of futures roots (unknown roots contribute none). */
export function groupsForFuturesRoots(roots: readonly string[]): MarketGroup[] {
  return [...new Set(roots.map(groupForFuturesRoot).filter((g): g is MarketGroup => g != null))]
}
