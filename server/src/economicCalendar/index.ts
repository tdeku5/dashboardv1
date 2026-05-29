// Economic Data Log orchestrator: scrape (Firecrawl) → parse (Claude) → persist
// (SQLite upsert) → classify (surprise rules), in sequence. Idempotent — the
// (release_date, country, event) upsert means re-running the same day fills in
// `actual` values without duplicating. Wired into the server startup + a daily
// 23:00 UTC cron in index.ts, and runnable standalone via
// `tsx src/scripts/runEconomicCalendar.ts` (which exits non-zero on failure).

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import {
  upsertEconomicReleases,
  updateReleaseSurprise,
  getEconomicReleases,
  getReleasesMissingCategory,
  setReleaseCategory,
} from '../db'
import { scrapeCalendar, type FirecrawlLike, type CalendarRange } from './firecrawlScrape'
import { parseReleasesFromMarkdown, type GenerateFn } from './parseReleases'
import { classifyRelease } from './classifySurprise'
import { classifyCategory } from './categorize'
import { buildRuleLookup } from './ruleLookup'
import { splitReferencePeriod } from './referencePeriod'
import type { EconomicRelease, CategorizedRelease } from './types'

// Ranges scraped each run. "This Month" + "Next Month" give gap-free coverage
// from the start of the current month through the end of the next (≈ today + 5
// weeks, rolling) — see firecrawlScrape.ts for why we drive TE's native options.
const SCRAPE_RANGES: CalendarRange[] = ['This Month', 'Next Month']

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') })

// Repo-relative log paths (server/). needs_classification.log is the triage
// queue for events with no surprise rule; the debug file captures the raw
// markdown when a parse fails so a broken TE scrape can be diagnosed.
const NEEDS_CLASSIFICATION_LOG = path.join(__dirname, '..', '..', 'needs_classification.log')
const DEBUG_DIR = path.join(__dirname, '..', '..')

function logNeedsClassification(r: EconomicRelease): void {
  const line = `${new Date().toISOString()}\t${r.country}\t${r.event}\n`
  try {
    fs.appendFileSync(NEEDS_CLASSIFICATION_LOG, line)
  } catch (err) {
    console.error('[econ-calendar] Could not write needs_classification.log:', err)
  }
}

function writeRawScrapeForDebug(markdown: string): string {
  const file = path.join(DEBUG_DIR, `econ-calendar-failed-scrape-${Date.now()}.md`)
  try {
    fs.writeFileSync(file, markdown)
  } catch {
    /* best-effort */
  }
  return file
}

export interface SyncOptions {
  ranges?: CalendarRange[]      // default This Month + Next Month
  scrapeClient?: FirecrawlLike  // injectable for tests
  generate?: GenerateFn         // Claude text generator; injectable for tests
  backoffMs?: number            // retry backoff override for tests
}

export interface SyncResult {
  upserted: number
  classified: number
  unclassified: number
}

// Scrapes + parses one TE range into validated, watchlist releases. On parse
// failure the raw scrape is dumped for debugging and the error rethrown.
async function scrapeAndParseRange(range: CalendarRange, opts: SyncOptions): Promise<EconomicRelease[]> {
  const scrape = await scrapeCalendar({ range, client: opts.scrapeClient, backoffMs: opts.backoffMs })
  try {
    return await parseReleasesFromMarkdown(scrape.markdown, { generate: opts.generate, scrapedAt: scrape.scrapedAt })
  } catch (err) {
    const debugPath = writeRawScrapeForDebug(scrape.markdown)
    console.error(`[econ-calendar] Parse/validation failed (${range}): ${err instanceof Error ? err.message : String(err)}`)
    console.error(`[econ-calendar] Raw scrape saved for debugging: ${debugPath}`)
    throw err
  }
}

export async function syncEconomicCalendar(opts: SyncOptions = {}): Promise<SyncResult> {
  const ranges = opts.ranges ?? SCRAPE_RANGES
  console.log(`[econ-calendar] Sync starting (ranges=${ranges.join(' + ')})…`)

  // 1+2. Scrape + parse each range, then merge on (release_date, country, event)
  //      so the overlapping month windows don't duplicate. Ingestion is filtered
  //      to **medium + high impact (importance ≥ 2)** only: the URL passes
  //      importance=2 to TE (server-side filter) AND we re-filter post-parse —
  //      TE occasionally returns low-tier events (energy stocks, mortgage rate)
  //      under a 2+ request, and Claude can read those as 1-star. The post-parse
  //      floor enforces the policy strictly.
  const perRange = await Promise.all(ranges.map(r => scrapeAndParseRange(r, opts)))
  const merged = new Map<string, EconomicRelease>()
  for (const list of perRange) {
    for (const r of list) {
      if (r.importance < 2) continue   // low-impact (1-star) — drop, per policy
      // Strip the trailing reference-period suffix ("APR", "MAY/23", "Q1") so
      // the identity stays stable across pulls — without this, the same event
      // ends up on two rows (one blank, one with the actual) once TE appends
      // the suffix. The merge map and the upsert both key on the base name.
      // If a later scrape has a non-null suffix, prefer it on conflict.
      const { baseEvent, referencePeriod } = splitReferencePeriod(r.event)
      const key = `${r.release_date}|${r.country}|${baseEvent}`
      const prior = merged.get(key)
      merged.set(key, {
        ...r,
        event: baseEvent,
        reference_period: referencePeriod ?? prior?.reference_period ?? null,
      })
    }
  }

  // 3. Categorize (ingestion-time) + persist. Category classifies on the base
  //    event name — same answer whether or not TE has appended a suffix yet.
  const rows: CategorizedRelease[] = [...merged.values()].map(r => ({ ...r, category: classifyCategory(r.event) }))
  const upserted = upsertEconomicReleases(rows)

  // 4. Classify surprise (separate step, post-persistence). Unknown events →
  //    'unclassified' + needs_classification.log triage queue. Uses the
  //    DB-merged rule lookup so triage-added rules apply on every sync.
  const findRule = buildRuleLookup()
  let classified = 0
  let unclassified = 0
  const loggedUnknown = new Set<string>()
  for (const r of rows) {
    const label = classifyRelease(r, findRule)
    updateReleaseSurprise(r.release_date, r.country, r.event, label)
    if (label === 'unclassified') {
      unclassified++
      if (!loggedUnknown.has(r.event)) { logNeedsClassification(r); loggedUnknown.add(r.event) }
    } else if (label != null) {
      classified++
    }
  }

  console.log(`[econ-calendar] Sync complete — upserted=${upserted} classified=${classified} unclassified=${unclassified} (${loggedUnknown.size} distinct unknown events)`)
  return { upserted, classified, unclassified }
}

// One-shot cleanup of duplicate rows caused by TE's reference-period suffix
// mutation (see referencePeriod.ts and the upsert key change in db.ts). Groups
// stored rows by (date, country, baseEvent); single-row groups are normalized
// in place (event → base, reference_period populated); multi-row groups are
// merged into one — winner = the row with the actual, ties broken by reference
// period present then by most-recent scraped_at — with non-null fields filled
// in from the other rows, then the redundant rows are deleted. Idempotent:
// after a clean sweep there are no duplicates left and singles already match.
// Called on server startup like backfillMissingCategories.
import { db } from '../db'

export function mergeDuplicateReleases(): { groupsMerged: number; rowsRemoved: number; rowsNormalized: number } {
  const all = getEconomicReleases()
  type R = (typeof all)[number] & { baseEvent: string; freshPeriod: string | null }
  const groups = new Map<string, R[]>()
  for (const row of all) {
    const { baseEvent, referencePeriod } = splitReferencePeriod(row.event)
    const key = `${row.release_date}|${row.country}|${baseEvent}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...row, baseEvent, freshPeriod: row.reference_period ?? referencePeriod })
  }

  const deleteByPk     = db.prepare('DELETE FROM economic_releases WHERE release_date=? AND country=? AND event=?')
  const updateNormalize = db.prepare('UPDATE economic_releases SET event=?, reference_period=? WHERE release_date=? AND country=? AND event=?')
  const insertMerged   = db.prepare(`INSERT INTO economic_releases
    (release_date, day_of_week, country, event, reference_period, category, expected, actual, previous, importance, surprise, scraped_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)

  let groupsMerged = 0, rowsRemoved = 0, rowsNormalized = 0
  const tx = db.transaction(() => {
    for (const rows of groups.values()) {
      if (rows.length === 1) {
        const r = rows[0]
        if (r.event === r.baseEvent && r.reference_period === r.freshPeriod) continue   // already normalized
        updateNormalize.run(r.baseEvent, r.freshPeriod, r.release_date, r.country, r.event)
        rowsNormalized++
        continue
      }
      // Multi-row group: pick winner, merge fields, delete losers, insert merged.
      const sorted = [...rows].sort((a, b) => {
        const aHas = a.actual != null && a.actual !== ''
        const bHas = b.actual != null && b.actual !== ''
        if (aHas !== bHas) return aHas ? -1 : 1
        const aP = a.freshPeriod != null, bP = b.freshPeriod != null
        if (aP !== bP) return aP ? -1 : 1
        return (b.scraped_at ?? '').localeCompare(a.scraped_at ?? '')
      })
      const winner = sorted[0]
      const pickNonNull = <T,>(get: (r: R) => T | null | undefined): T | null => {
        for (const r of sorted) { const v = get(r); if (v != null && v !== '') return v as T }
        return null
      }
      const merged = {
        release_date:    winner.release_date,
        day_of_week:     winner.day_of_week || pickNonNull(r => r.day_of_week) || '',
        country:         winner.country,
        event:           winner.baseEvent,
        reference_period: winner.freshPeriod ?? pickNonNull(r => r.freshPeriod),
        category:        winner.category ?? pickNonNull(r => r.category),
        expected:        winner.expected ?? pickNonNull(r => r.expected),
        actual:          winner.actual ?? pickNonNull(r => r.actual),
        previous:        winner.previous ?? pickNonNull(r => r.previous),
        importance:      winner.importance ?? pickNonNull(r => r.importance) ?? 2,
        // If the winning row already had a non-null surprise, keep it — the
        // actual is unchanged. (reclassifyAll() runs separately if rules change.)
        surprise:        winner.surprise,
        scraped_at:      winner.scraped_at,
      }
      for (const r of rows) deleteByPk.run(r.release_date, r.country, r.event)
      insertMerged.run(
        merged.release_date, merged.day_of_week, merged.country, merged.event,
        merged.reference_period, merged.category, merged.expected, merged.actual,
        merged.previous, merged.importance, merged.surprise, merged.scraped_at,
      )
      groupsMerged++
      rowsRemoved += rows.length - 1
    }
  })
  tx()
  if (groupsMerged > 0 || rowsNormalized > 0) {
    console.log(`[econ-calendar] Duplicate-merge sweep: ${groupsMerged} groups merged, ${rowsRemoved} rows removed, ${rowsNormalized} singles normalized`)
  }
  return { groupsMerged, rowsRemoved, rowsNormalized }
}

// Backfills `category` for rows ingested before the category column existed, so
// the column is populated without waiting for a full scrape. Idempotent + cheap.
export function backfillMissingCategories(): number {
  const rows = getReleasesMissingCategory()
  for (const r of rows) setReleaseCategory(r.release_date, r.country, r.event, classifyCategory(r.event))
  if (rows.length > 0) console.log(`[econ-calendar] Backfilled category for ${rows.length} rows`)
  return rows.length
}

// Re-classifies every stored release against the current (DB-merged) rule set
// and writes the updated label. Called after the triage UI adds/edits/removes a
// rule so previously-unclassified rows get their surprise immediately. Cheap
// (the table is a few hundred rows). Returns the post-state counts.
export function reclassifyAll(): { classified: number; unclassified: number; pending: number } {
  const findRule = buildRuleLookup()
  const rows = getEconomicReleases()
  let classified = 0, unclassified = 0, pending = 0
  for (const r of rows) {
    const label = classifyRelease(r, findRule)
    updateReleaseSurprise(r.release_date, r.country, r.event, label)
    if (label === 'unclassified') unclassified++
    else if (label == null) pending++
    else classified++
  }
  console.log(`[econ-calendar] Reclassified ${rows.length} rows — classified=${classified} unclassified=${unclassified} pending=${pending}`)
  return { classified, unclassified, pending }
}

// Re-export the DB reader so consumers (route, scripts) have one import surface.
export { getEconomicReleases }
