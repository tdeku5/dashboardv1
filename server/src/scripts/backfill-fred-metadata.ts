// FRED metadata backfill (series-catalog follow-up, Phase 2).
// Fetches title/units/frequency/seasonal_adjustment from the FRED `series`
// endpoint for every catalog-unresolved FRED id and fills the gaps in
// `series_metadata` — NEVER overwriting a non-empty title from any source.
// Idempotent: a second run finds no empty-title targets and updates 0 rows.
// Rejected ids (400/404 — discontinued or non-FRED strays) are logged once to
// docs/fred-backfill-unresolved.md and left untouched.
// Guardrails: ~2 req/s throttle (FRED cap is 120/min); per-100 batch
// transactions (interrupt-safe/resumable); aborts if >10% of targets reject
// (a pattern that suggests a misconstructed target list, not dead series).
// Run:  npx tsx src/scripts/backfill-fred-metadata.ts

import { db } from '../db'
import fs from 'fs'
import path from 'path'

const API_KEY = process.env.FRED_API_KEY
if (!API_KEY) {
  console.error('[backfill] FRED_API_KEY missing from environment — aborting (no unauthenticated calls).')
  process.exit(1)
}

const THROTTLE_MS = 500
const BATCH = 100
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface FredSeriesMeta {
  title?: string
  units?: string
  units_short?: string
  frequency?: string
  seasonal_adjustment?: string
}

async function fetchMeta(sid: string): Promise<{ ok: true; meta: FredSeriesMeta } | { ok: false; status: number }> {
  const url = `https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(sid)}&api_key=${API_KEY}&file_type=json`
  const res = await fetch(url)
  if (!res.ok) return { ok: false, status: res.status }
  const body = await res.json() as { seriess?: FredSeriesMeta[] }
  const meta = body.seriess?.[0]
  return meta ? { ok: true, meta } : { ok: false, status: 200 }
}

async function main(): Promise<void> {
  // Target = the catalog's unresolved FRED set (by construction: non-BEA,
  // empty in-DB title, no config-registry label).
  const targets = (db.prepare(
    "SELECT series_id FROM series_catalog WHERE data_source = 'FRED' AND description_source = 'unresolved' ORDER BY series_id"
  ).all() as Array<{ series_id: string }>).map(r => r.series_id)
  console.log(`[backfill] ${targets.length} target series (catalog-unresolved FRED)`)

  const upsert = db.prepare(`
    INSERT INTO series_metadata (series_id, title, frequency, units, seasonal_adjustment, last_fetched)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(series_id) DO UPDATE SET
      title = excluded.title,
      frequency = COALESCE(NULLIF(series_metadata.frequency, ''), excluded.frequency),
      units = COALESCE(NULLIF(series_metadata.units, ''), excluded.units),
      seasonal_adjustment = COALESCE(series_metadata.seasonal_adjustment, excluded.seasonal_adjustment),
      last_fetched = excluded.last_fetched
    WHERE series_metadata.title IS NULL OR series_metadata.title = ''
  `)
  const hasTitle = db.prepare(
    "SELECT 1 FROM series_metadata WHERE series_id = ? AND title IS NOT NULL AND title != ''"
  )

  let fetched = 0
  let updated = 0
  let skipped = 0
  const rejected: Array<{ sid: string; status: number }> = []
  const abortThreshold = Math.ceil(targets.length * 0.10)

  let pending: Array<{ sid: string; meta: FredSeriesMeta }> = []
  const flush = (): void => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    db.transaction(() => {
      for (const { sid, meta } of batch) {
        const r = upsert.run(
          sid, meta.title ?? null, meta.frequency ?? null,
          meta.units_short ?? meta.units ?? null, meta.seasonal_adjustment ?? null,
        )
        if (r.changes > 0) updated += 1
      }
    })()
  }

  for (const sid of targets) {
    // Fill-gaps-only: skip anything that gained a title since the target list
    // was built (idempotency — second run skips everything).
    if (hasTitle.get(sid)) { skipped += 1; continue }
    await sleep(THROTTLE_MS)
    const result = await fetchMeta(sid)
    if (!result.ok) {
      rejected.push({ sid, status: result.status })
      if (rejected.length > abortThreshold) {
        flush()
        console.error(`[backfill] ABORT: ${rejected.length} rejections exceed the 10% threshold (${abortThreshold}) — target list may be misconstructed. State is consistent (batched transactions); nothing retried.`)
        writeRejectReport(rejected)
        process.exit(1)
      }
      continue
    }
    fetched += 1
    pending.push({ sid, meta: result.meta })
    if (pending.length >= BATCH) flush()
  }
  flush()

  writeRejectReport(rejected)
  console.log(`[backfill] fetched=${fetched} updated=${updated} skipped(already filled)=${skipped} rejected=${rejected.length}`)
}

function writeRejectReport(rejected: Array<{ sid: string; status: number }>): void {
  const out = path.resolve(__dirname, '..', '..', '..', 'docs', 'fred-backfill-unresolved.md')
  const lines = [
    '# FRED Metadata Backfill — Rejected IDs',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} by backfill-fred-metadata.ts.`,
    'These ids were rejected by the FRED `series` endpoint (discontinued series or',
    'non-FRED strays). Metadata left untouched; not retried. Resolve manually or',
    'confirm retirement.',
    '',
    ...(rejected.length === 0
      ? ['(none — every target id was recognized by the API)']
      : rejected.map(r => `- \`${r.sid}\` — HTTP ${r.status}`)),
  ]
  fs.writeFileSync(out, lines.join('\n'))
}

main().catch(err => {
  console.error('[backfill] fatal:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
