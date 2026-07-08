// Verification report for the Australia Economic Data Models ingestion
// (Phase 2). Reports row count + latest date + latest value per series,
// asserts the dual-frequency CPI separation, and runs the PERMANENT
// contributions-sum assertion (decision f): the eight TCH component
// contributions must sum to GDP's own TCH row (± rounding) every quarter.
// Run with:  npx tsx src/scripts/verifyAuIngest.ts

import { db } from '../db'
import { ALL_ABS_SERIES } from '../fetchAllAbsSeries'

const RATES_SIDE = [
  'AU_CPI_M_HEADLINE', 'AU_CPI_M_TRIMMED', 'AU_CPI_M_WGTMED',
  'AU_CPI_Q_HEADLINE', 'AU_CPI_Q_TRIMMED', 'AU_CPI_Q_WGTMED',
  'AU_UNRATE_SA', 'AU_UNRATE_TREND',
]

let missing = 0
let failures = 0

function report(code: string, unit: string) {
  const r = db.prepare(`
    SELECT COUNT(*) AS n, MAX(date) AS latest, MIN(date) AS first,
      (SELECT value FROM au_macro_series t2 WHERE t2.series_code = t1.series_code ORDER BY date DESC LIMIT 1) AS last_val,
      (SELECT frequency FROM au_macro_series t2 WHERE t2.series_code = t1.series_code LIMIT 1) AS freq
    FROM au_macro_series t1 WHERE series_code = ?
  `).get(code) as { n: number; latest: string | null; first: string | null; last_val: number | null; freq: string | null }
  if (r.n === 0) {
    missing++
    console.log(`${code.padEnd(26)} MISSING — 0 rows`)
  } else {
    console.log(`${code.padEnd(26)} ${(r.freq ?? '?').padEnd(2)} ${String(r.n).padEnd(6)} ${(r.first ?? '').slice(0, 7).padEnd(9)}→ ${(r.latest ?? '').slice(0, 7).padEnd(9)} ${r.last_val ?? ''} ${unit}`)
  }
}

console.log('═══ ABS econ series (au_macro_series) ═══')
for (const s of ALL_ABS_SERIES) report(s.code, s.unit)
console.log('\n═══ Rates-side codes (read by AU pages) ═══')
for (const c of RATES_SIDE) report(c, '')

// Dual-frequency discipline: every series carries exactly ONE frequency value.
const mixed = db.prepare(`
  SELECT series_code, COUNT(DISTINCT frequency) AS nf FROM au_macro_series
  GROUP BY series_code HAVING nf > 1
`).all() as Array<{ series_code: string; nf: number }>
if (mixed.length > 0) {
  failures++
  console.log(`\n✗ FREQUENCY MIXING: ${mixed.map(m => m.series_code).join(', ')}`)
} else {
  console.log('\n✓ dual-frequency discipline: no series mixes frequencies')
}

// Contributions-sum assertion (decision f — permanent): for every quarter where
// all 9 TCH rows exist (8 components + statistical discrepancy), the sum must
// match GDP's own TCH row within 0.45pp — the worst-case rounding envelope of
// nine values each published to 0.1pp (9 × 0.05). Observed worst: 0.40pp.
const COMPONENTS = ['AU_CTB_CONS', 'AU_CTB_GOV', 'AU_CTB_BUSINV', 'AU_CTB_DWELL', 'AU_CTB_PUBINV', 'AU_CTB_INVENT', 'AU_CTB_EXPORTS', 'AU_CTB_IMPORTS', 'AU_CTB_SDE']
const gdpRows = db.prepare(`SELECT date, value FROM au_macro_series WHERE series_code = 'AU_CTB_GDP' ORDER BY date`).all() as Array<{ date: string; value: number }>
const compStmt = db.prepare(`SELECT value FROM au_macro_series WHERE series_code = ? AND date = ?`)
let checked = 0
let worst = 0
let worstDate = ''
for (const g of gdpRows) {
  const vals = COMPONENTS.map(c => (compStmt.get(c, g.date) as { value: number } | undefined)?.value)
  if (vals.some(v => v == null)) continue
  const sum = (vals as number[]).reduce((a, b) => a + b, 0)
  const diff = Math.abs(sum - g.value)
  checked++
  if (diff > worst) { worst = diff; worstDate = g.date }
  if (diff > 0.45) {
    failures++
    console.log(`✗ TCH SUM MISMATCH ${g.date}: components ${sum.toFixed(2)} vs GDP ${g.value} (Δ${diff.toFixed(2)})`)
  }
}
console.log(`✓ TCH contributions-sum assertion: ${checked} quarters checked, worst |Δ| = ${worst.toFixed(2)}pp (${worstDate}); tolerance 0.45 (9 × 0.05 rounding envelope)`)

// Flag inventory (frontend surfacing check)
const flags = db.prepare(`
  SELECT series_code, obs_status, COUNT(*) AS n FROM au_macro_series
  WHERE obs_status IS NOT NULL AND obs_status != '' AND series_code LIKE 'AU\\_%' ESCAPE '\\'
  GROUP BY series_code, obs_status ORDER BY series_code
`).all() as Array<{ series_code: string; obs_status: string; n: number }>
console.log('\n═══ OBS_STATUS inventory ═══')
for (const f of flags.slice(0, 15)) console.log(`  ${f.series_code} '${f.obs_status}': ${f.n} obs`)

console.log(`\nSummary: ${ALL_ABS_SERIES.length} econ + ${RATES_SIDE.length} rates-side series checked; ${missing} missing; ${failures} assertion failures`)
if (missing > 0 || failures > 0) process.exit(1)
