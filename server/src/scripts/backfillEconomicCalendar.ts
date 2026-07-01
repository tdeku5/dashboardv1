// One-off, non-destructive backfill for the Economic Data Log.
//
//   npm run econ-backfill            (from server/)  → DRY RUN: scrape + diff, no writes
//   npm run econ-backfill -- --apply                 → APPLY: upsert + reclassify
//
// Motivation: before the "Previous Month" trailing range was added, events that
// passed just before a month boundary (e.g. 2026-06-22 … 06-30, viewed on
// 07-01) fell out of the forward-only scrape window and never had their actuals
// re-pulled. This script scrapes TE's "Previous Month" view and fills those
// actuals/expected onto the EXISTING rows.
//
// Safety:
//  - DRY RUN is the default. It scrapes + parses + diffs against the DB and
//    prints exactly what WOULD change, writing nothing. Review it first.
//  - APPLY reuses syncEconomicCalendar({ ranges: ['Previous Month'] }), which
//    uses the same non-destructive upsert as the cron: it only ever fills a
//    blank or updates a changed value, NEVER blanks a populated one, and never
//    deletes or duplicates rows (PK = date|country|baseEvent). Idempotent —
//    re-running is harmless.

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') })

import { scrapeCalendar, type CalendarRange } from '../economicCalendar/firecrawlScrape'
import { parseReleasesFromMarkdown } from '../economicCalendar/parseReleases'
import { splitReferencePeriod } from '../economicCalendar/referencePeriod'
import { classifyCategory } from '../economicCalendar/categorize'
import { reclassifyAll, getEconomicReleases } from '../economicCalendar'
import { upsertEconomicReleases } from '../db'
import type { EconomicRelease, CategorizedRelease } from '../economicCalendar/types'

const BACKFILL_RANGE: CalendarRange = 'Previous Month'
// Window highlighted in the preview sample (the known-broken days). The scrape
// itself covers all of "Previous Month"; this only scopes what we print.
const FOCUS_START = '2026-06-22'
const FOCUS_END = '2026-06-30'

const hasVal = (v: string | null | undefined): boolean => v != null && v !== ''

// Optional `--from-file <path>`: read pre-scraped TE markdown instead of hitting
// Firecrawl live. Useful when Firecrawl's proxy is flaky (ERR_TUNNEL_...), and
// for a deterministic, reproducible backfill from a captured scrape.
function fromFileArg(): string | null {
  const i = process.argv.indexOf('--from-file')
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const mdFile = fromFileArg()
  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY RUN'} range="${BACKFILL_RANGE}"${mdFile ? ` source=file:${mdFile}` : ''}`)

  // --- Obtain markdown (live scrape OR saved file) + parse (no writes yet) --
  const markdown = mdFile
    ? fs.readFileSync(mdFile, 'utf8')
    : (await scrapeCalendar({ range: BACKFILL_RANGE })).markdown
  const parsed = await parseReleasesFromMarkdown(markdown, { scrapedAt: new Date().toISOString() })

  // Same merge/filter/split as the orchestrator, minus persistence.
  const merged = new Map<string, EconomicRelease>()
  for (const r of parsed) {
    if (r.importance < 2) continue
    const { baseEvent, referencePeriod } = splitReferencePeriod(r.event)
    const key = `${r.release_date}|${r.country}|${baseEvent}`
    const prior = merged.get(key)
    merged.set(key, {
      ...r,
      event: baseEvent,
      reference_period: referencePeriod ?? prior?.reference_period ?? null,
      expected: hasVal(r.expected) ? r.expected : (prior?.expected ?? r.expected),
      actual:   hasVal(r.actual)   ? r.actual   : (prior?.actual   ?? r.actual),
    })
  }
  const rows = [...merged.values()]
  console.log(`[backfill] scraped+parsed ${parsed.length} rows → ${rows.length} merged (importance≥2)`)

  // --- Diff against current DB (read-only) --------------------------------
  const dates = rows.map(r => r.release_date).sort()
  const stored = new Map<string, { expected: string | null; actual: string | null }>()
  for (const row of getEconomicReleases({ startDate: dates[0], endDate: dates[dates.length - 1] })) {
    stored.set(`${row.release_date}|${row.country}|${row.event}`, { expected: row.expected, actual: row.actual })
  }

  let wouldInsert = 0, wouldUpdate = 0, wouldFillActual = 0, wouldFillExpected = 0
  const sample: string[] = []
  for (const r of rows) {
    const key = `${r.release_date}|${r.country}|${r.event}`
    const prev = stored.get(key)
    if (!prev) wouldInsert++; else wouldUpdate++
    const fillsActual = hasVal(r.actual) && !hasVal(prev?.actual)
    const fillsExpected = hasVal(r.expected) && !hasVal(prev?.expected)
    if (fillsActual) wouldFillActual++
    if (fillsExpected) wouldFillExpected++
    if ((fillsActual || fillsExpected) && r.release_date >= FOCUS_START && r.release_date <= FOCUS_END && sample.length < 30) {
      sample.push(`   ${r.release_date} ${r.country.padEnd(14)} ${r.event.slice(0, 30).padEnd(30)} ` +
        `exp ${JSON.stringify(prev?.expected ?? null)}→${JSON.stringify(r.expected)}  ` +
        `act ${JSON.stringify(prev?.actual ?? null)}→${JSON.stringify(r.actual)}`)
    }
  }

  console.log(`[backfill] diff vs DB: would insert=${wouldInsert} update=${wouldUpdate} | fill actual=${wouldFillActual} fill expected=${wouldFillExpected}`)
  console.log(`[backfill] sample of newly-filled rows in ${FOCUS_START}…${FOCUS_END}:`)
  console.log(sample.length ? sample.join('\n') : '   (none — already populated)')

  if (!apply) {
    console.log('[backfill] DRY RUN — no changes written. Re-run with --apply to persist.')
    return
  }

  // --- Apply (non-destructive upsert + reclassify) ------------------------
  // Upsert the rows we ALREADY scraped above (no second scrape). The upsert is
  // the same non-destructive INSERT…ON CONFLICT the cron uses, then we re-run
  // surprise classification so any newly-filled actuals get a label.
  const before = countActuals(FOCUS_START, FOCUS_END)
  const categorized: CategorizedRelease[] = rows.map(r => ({ ...r, category: classifyCategory(r.event) }))
  const upserted = upsertEconomicReleases(categorized)
  const surprise = reclassifyAll()
  const after = countActuals(FOCUS_START, FOCUS_END)
  console.log(`[backfill] APPLIED — upserted=${upserted} (would insert=${wouldInsert} update=${wouldUpdate}) ` +
    `filled actual=${wouldFillActual} expected=${wouldFillExpected} · surprise=${JSON.stringify(surprise)}`)
  console.log(`[backfill] ${FOCUS_START}…${FOCUS_END} rows-with-actual: ${before} → ${after}`)
}

function countActuals(start: string, end: string): number {
  return getEconomicReleases({ startDate: start, endDate: end }).filter(r => hasVal(r.actual)).length
}

main().catch(e => { console.error('[backfill] ERROR', e); process.exit(1) })
