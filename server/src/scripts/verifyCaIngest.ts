// Verification report for the Canada Economic Data Models ingestion (Phase 2).
// Prints row count + latest observation date + latest value for every series in
// ALL_STATCAN_SERIES (plus the rates-side StatCan codes the Canada pages will
// read). Run with:  npx tsx src/scripts/verifyCaIngest.ts

import { db } from '../db'
import { ALL_STATCAN_SERIES } from '../fetchAllStatcanSeries'

const RATES_SIDE_CODES = ['CPI_HEADLINE', 'CPI_XFE', 'CPI_TRIM', 'CPI_MEDIAN', 'CPI_COMMON', 'UNRATE_CA']

const stmt = db.prepare(`
  SELECT COUNT(*) AS n, MAX(date) AS latest,
    (SELECT value FROM statcan_observations s2 WHERE s2.series_code = s1.series_code ORDER BY date DESC LIMIT 1) AS last_val
  FROM statcan_observations s1 WHERE series_code = ?
`)

let missing = 0
function report(code: string, unit: string) {
  const r = stmt.get(code) as { n: number; latest: string | null; last_val: number | null }
  if (r.n === 0) {
    missing++
    console.log(`${code.padEnd(24)} ${'MISSING — 0 rows'}`)
  } else {
    console.log(`${code.padEnd(24)} ${String(r.n).padEnd(7)} ${(r.latest ?? '').padEnd(12)} ${r.last_val ?? ''} ${unit}`)
  }
}

console.log('═══ Canada econ-model series (fetchAllStatcanSeries) ═══')
for (const s of ALL_STATCAN_SERIES) report(s.code, s.unit)

console.log('\n═══ Rates-side StatCan codes (read by Canada pages) ═══')
for (const c of RATES_SIDE_CODES) report(c, '')

console.log(`\nSummary: ${ALL_STATCAN_SERIES.length} configured (${missing} missing), ` +
  `${RATES_SIDE_CODES.length} rates-side codes checked`)
