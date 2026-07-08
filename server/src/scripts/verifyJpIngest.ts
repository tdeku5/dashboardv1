// Verification report for the Japan Economic Data Models ingestion (Phase 2).
// Prints row count + latest observation date + latest value for every series
// in ALL_ESTAT_SERIES, the customs trade codes, ALL_BOJ_SERIES, and the
// rates-side e-Stat codes the Japan pages will read.
// Run with:  npx tsx src/scripts/verifyJpIngest.ts

import { db } from '../db'
import { ALL_ESTAT_SERIES } from '../fetchAllEstatSeries'
import { ALL_BOJ_SERIES } from '../bojTsCollector'

const RATES_SIDE = ['CPI_HEADLINE_JP', 'CPI_CORE_JP', 'CPI_CORECORE_JP', 'UNRATE_JP']
const TRADE = ['JP_TRADE_EXP', 'JP_TRADE_IMP', 'JP_TRADE_BAL']

let missing = 0
function report(table: string, code: string, unit: string) {
  const r = db.prepare(`
    SELECT COUNT(*) AS n, MAX(date) AS latest,
      (SELECT value FROM ${table} t2 WHERE t2.series_code = t1.series_code ORDER BY date DESC LIMIT 1) AS last_val
    FROM ${table} t1 WHERE series_code = ?
  `).get(code) as { n: number; latest: string | null; last_val: number | null }
  if (r.n === 0) {
    missing++
    console.log(`${code.padEnd(26)} MISSING — 0 rows`)
  } else {
    console.log(`${code.padEnd(26)} ${String(r.n).padEnd(7)} ${(r.latest ?? '').padEnd(12)} ${r.last_val ?? ''} ${unit}`)
  }
}

console.log('═══ e-Stat series (estat_observations) ═══')
for (const s of ALL_ESTAT_SERIES) report('estat_observations', s.code, s.unit)

console.log('\n═══ Customs trade (estat_observations, source=Customs) ═══')
for (const c of TRADE) report('estat_observations', c, 'thousand yen')

console.log('\n═══ BoJ Time-Series (bojts_observations) ═══')
for (const s of ALL_BOJ_SERIES) report('bojts_observations', s.code, s.unit)

console.log('\n═══ Rates-side e-Stat codes (read by Japan pages) ═══')
for (const c of RATES_SIDE) report('estat_observations', c, '')

console.log(`\nSummary: ${ALL_ESTAT_SERIES.length} e-Stat + ${TRADE.length} trade + ${ALL_BOJ_SERIES.length} BoJ configured (${missing} missing), ${RATES_SIDE.length} rates-side checked`)
