import { db } from '../db'

// One-time migration for the ECB ICP → HICP dataset switch (Feb 2026).
//
// The ECB discontinued the old `ICP` dataflow after 2025-12 and replaced it with
// a new `HICP` dataflow that is rebased 2015=100 → 2025=100 (see ecbCollector.ts
// header). The old HICP_* rows already in ecb_observations are on the 2015=100
// base; the new collector keys pull the 2025=100 base. Mixing the two bases under
// one series_code would corrupt the route's level-based YoY/MoM at the boundary,
// so we delete the old rows here. The next syncIncremental() then sees those
// series empty and re-backfills full history on the new base.
//
// UNRATE_EA is left untouched (LFSI dataflow, unaffected by the HICP migration).
//
// Bump when adding new migrations. Existing DBs persist user_version across
// restarts, so this runs at most once per database. MUST run AFTER
// runStaleTipCleanup (which targets version 1) so the absolute user_version set
// here doesn't skip earlier migrations on a fresh DB.
const TARGET_USER_VERSION = 2

const HICP_SERIES_CODES = [
  'HICP_HEADLINE', 'HICP_HEADLINE_SA',
  'HICP_CORE', 'HICP_CORE_SA',
  'HICP_SUPERCORE', 'HICP_SUPERCORE_SA',
]

export function runEcbHicpDatasetMigration(): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= TARGET_USER_VERSION) return

  console.log('[ecb-hicp-migration] Starting one-time ICP→HICP rebase migration (purging old 2015=100 HICP rows)…')

  const del = db.prepare('DELETE FROM ecb_observations WHERE series_code = ?')
  let deleted = 0

  db.transaction(() => {
    for (const code of HICP_SERIES_CODES) {
      const result = del.run(code)
      if (result.changes > 0) {
        deleted += result.changes
        console.log(`[ecb-hicp-migration] Purged ${result.changes} old-base rows for ${code}`)
      }
    }
    db.pragma(`user_version = ${TARGET_USER_VERSION}`)
  })()

  console.log(
    `[ecb-hicp-migration] Migration complete: ${deleted} old-base rows purged. ` +
    'Next ECB sync will re-backfill these series on the new 2025=100 HICP dataset.'
  )
}
