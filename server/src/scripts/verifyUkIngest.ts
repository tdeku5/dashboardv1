// Verification report for UK Economic Data Models ingestion (Phase 2).
// Prints row count + latest observation date + latest value for every
// configured ONS CDID and BoE series, plus the uk_hpi / hmrc_receipts /
// paye_rti tables. Run with:  npx tsx src/scripts/verifyUkIngest.ts

import { db } from '../db'
import { ALL_ONS_SERIES } from '../fetchAllOnsSeries'
import { getAllBoeSeriesCodes } from '../fetchAllBoeSeries'

function line(cols: Array<string | number>, widths: number[]): string {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join(' ')
}

console.log('═══ ONS series (ons_observations) ═══')
const onsStmt = db.prepare(`
  SELECT COUNT(*) AS n, MAX(date) AS latest,
    (SELECT value FROM ons_observations o2 WHERE o2.cdid = o1.cdid AND o2.dataset_id = o1.dataset_id ORDER BY date DESC LIMIT 1) AS last_val
  FROM ons_observations o1 WHERE cdid = ? AND dataset_id = ?
`)
let onsMissing = 0
for (const s of ALL_ONS_SERIES) {
  const r = onsStmt.get(s.cdid, s.datasetId) as { n: number; latest: string | null; last_val: number | null }
  if (r.n === 0) {
    onsMissing++
    console.log(line([s.cdid, s.datasetId, 'MISSING — 0 rows', '', ''], [8, 6, 20, 12, 12]))
  } else {
    console.log(line([s.cdid, s.datasetId, r.n, r.latest ?? '', r.last_val ?? ''], [8, 6, 20, 12, 12]))
  }
}

console.log('\n═══ BoE series (boe_observations) ═══')
const boeStmt = db.prepare(`
  SELECT COUNT(*) AS n, MAX(date) AS latest,
    (SELECT value FROM boe_observations b2 WHERE b2.series_code = b1.series_code ORDER BY date DESC LIMIT 1) AS last_val
  FROM boe_observations b1 WHERE series_code = ?
`)
let boeMissing = 0
for (const code of getAllBoeSeriesCodes()) {
  const r = boeStmt.get(code) as { n: number; latest: string | null; last_val: number | null }
  if (r.n === 0) {
    boeMissing++
    console.log(line([code, 'MISSING — 0 rows', '', ''], [10, 20, 12, 12]))
  } else {
    console.log(line([code, r.n, r.latest ?? '', r.last_val ?? ''], [10, 20, 12, 12]))
  }
}

console.log('\n═══ uk_hpi ═══')
const hpiRows = db.prepare(`
  SELECT region, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS latest,
    (SELECT average_price FROM uk_hpi h2 WHERE h2.region = h1.region ORDER BY date DESC LIMIT 1) AS last_price
  FROM uk_hpi h1 GROUP BY region ORDER BY region
`).all() as Array<{ region: string; n: number; first: string; latest: string; last_price: number }>
for (const r of hpiRows) {
  console.log(line([r.region, r.n, `${r.first} → ${r.latest}`, `£${r.last_price}`], [18, 8, 28, 12]))
}
if (hpiRows.length === 0) console.log('MISSING — 0 rows')

console.log('\n═══ hmrc_receipts ═══')
const hmrcRows = db.prepare(`
  SELECT tax_head, COUNT(*) AS n, MAX(date) AS latest,
    (SELECT value FROM hmrc_receipts h2 WHERE h2.tax_head = h1.tax_head ORDER BY date DESC LIMIT 1) AS last_val
  FROM hmrc_receipts h1 GROUP BY tax_head ORDER BY tax_head
`).all() as Array<{ tax_head: string; n: number; latest: string; last_val: number }>
for (const r of hmrcRows) {
  console.log(line([r.tax_head.slice(0, 52), r.n, r.latest, r.last_val], [54, 6, 12, 10]))
}
if (hmrcRows.length === 0) console.log('MISSING — 0 rows')

console.log('\n═══ paye_rti ═══')
const payeRows = db.prepare(`
  SELECT metric, COUNT(*) AS n, MAX(date) AS latest,
    (SELECT value FROM paye_rti p2 WHERE p2.metric = p1.metric ORDER BY date DESC LIMIT 1) AS last_val
  FROM paye_rti p1 GROUP BY metric ORDER BY metric
`).all() as Array<{ metric: string; n: number; latest: string; last_val: number }>
for (const r of payeRows) {
  console.log(line([r.metric, r.n, r.latest, r.last_val], [24, 6, 12, 16]))
}
if (payeRows.length === 0) console.log('MISSING — 0 rows')

console.log(`\nSummary: ${ALL_ONS_SERIES.length} ONS configured (${onsMissing} missing), ` +
  `${getAllBoeSeriesCodes().length} BoE configured (${boeMissing} missing), ` +
  `uk_hpi regions: ${hpiRows.length}, hmrc heads: ${hmrcRows.length}, paye metrics: ${payeRows.length}`)
