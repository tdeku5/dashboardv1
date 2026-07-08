// Verification report for the DE/FR/IT (EU3) economic-models ingestion
// (Phase 2). Reports row count + latest date + latest value for every ECB
// country series (ecb_observations) and every Eurostat series
// (eurostat_observations), plus per-country flag inventories (break/estimate
// markers the frontend must surface).
// Run with:  npx tsx src/scripts/verifyEu3Ingest.ts

import { db } from '../db'
import { ALL_EUROSTAT_SERIES } from '../fetchAllEurostatSeries'

const GEOS = ['DE', 'FR', 'IT'] as const

let missing = 0
function report(table: string, code: string, unit: string) {
  const r = db.prepare(`
    SELECT COUNT(*) AS n, MAX(date) AS latest,
      (SELECT value FROM ${table} t2 WHERE t2.series_code = t1.series_code ORDER BY date DESC LIMIT 1) AS last_val
    FROM ${table} t1 WHERE series_code = ?
  `).get(code) as { n: number; latest: string | null; last_val: number | null }
  if (r.n === 0) {
    missing++
    console.log(`${code.padEnd(24)} MISSING — 0 rows`)
  } else {
    console.log(`${code.padEnd(24)} ${String(r.n).padEnd(7)} ${(r.latest ?? '').padEnd(12)} ${r.last_val ?? ''} ${unit}`)
  }
}

// ECB country series — enumerate from the stored codes rather than importing
// the collector (its module has no config export; codes follow fixed stems).
const ecbCodes = (db.prepare(`
  SELECT DISTINCT series_code FROM ecb_observations
  WHERE series_code LIKE 'DE\\_%' ESCAPE '\\' OR series_code LIKE 'FR\\_%' ESCAPE '\\'
     OR series_code LIKE 'IT\\_%' ESCAPE '\\' OR series_code IN ('UNRATE_DE','UNRATE_FR','UNRATE_IT')
  ORDER BY series_code
`).all() as Array<{ series_code: string }>).map(r => r.series_code)

console.log(`═══ ECB country series (ecb_observations) — ${ecbCodes.length} codes ═══`)
const expectedEcbPerGeo = 51 + 1 + 4 // HICP items + UNRATE + BSI
for (const code of ecbCodes) report('ecb_observations', code, '')
if (ecbCodes.length !== expectedEcbPerGeo * GEOS.length) {
  missing++
  console.log(`⚠ expected ${expectedEcbPerGeo * GEOS.length} ECB country codes, found ${ecbCodes.length}`)
}

console.log('\n═══ Eurostat series (eurostat_observations) ═══')
for (const def of ALL_EUROSTAT_SERIES) {
  for (const geo of GEOS) report('eurostat_observations', def.codes[geo], def.unit)
}

console.log('\n═══ OBS_FLAG inventory (frontend surfacing check) ═══')
const flags = db.prepare(`
  SELECT substr(series_code, 1, 2) AS cc, obs_flag, COUNT(*) AS n
  FROM eurostat_observations WHERE obs_flag IS NOT NULL
  GROUP BY cc, obs_flag ORDER BY cc, obs_flag
`).all() as Array<{ cc: string; obs_flag: string; n: number }>
for (const f of flags) console.log(`  ${f.cc} flag '${f.obs_flag}': ${f.n} obs`)
const dePermitE = db.prepare(`
  SELECT COUNT(*) AS n FROM eurostat_observations
  WHERE series_code IN ('DE_PERMITS','DE_PERMITS_NSA') AND obs_flag LIKE '%e%'
`).get() as { n: number }
console.log(`  DE permits e-flagged obs: ${dePermitE.n} (must be > 0 — decision c surfacing)`)

console.log(`\nSummary: ${ecbCodes.length} ECB + ${ALL_EUROSTAT_SERIES.length * GEOS.length} Eurostat series checked, ${missing} missing/mismatched`)
