// ECB Data Portal (SDMX) collector for the EU rates fundamental model.
// Pulls euro-area macro series from the public ECB Data Portal REST API
// (https://data-api.ecb.europa.eu) as CSV (`format=csvdata`) and upserts them
// into `ecb_observations`. Read-only consumption of a public API — no key.
//
// ── 2026 HICP DATASET MIGRATION (ICP → HICP) ─────────────────────────────────
// Root cause of the "stale at Dec 2025" symptom: NOT a local bug. Eurostat
// changed the euro-area HICP methodology effective 4 Feb 2026 and the ECB
// DISCONTINUED the old `ICP` dataflow — it carries no observations past
// 2025-12. The replacement is the new `HICP` dataflow (DSD ECB_ICP3), which
// publishes 2026 data and is rebased from 2015=100 to **2025=100**.
// Key differences vs old ICP keys (M.U2.{N|Y}.<item>.{4|3}.INX):
//   • dataflow ICP → HICP
//   • position-5 dimension STS_INSTITUTION → DATA_PROVIDER
//       NSA: institution 4 → provider 4D0 ; SA: institution 3 → provider 4F0
//   • ICP_ITEM codes (000000 / XEFUN0 / XEF000) and ADJUSTMENT (N/Y) unchanged
// Because the index base changed, old (2015=100) rows must NOT coexist with new
// (2025=100) rows under the same series_code — the route computes YoY/MoM from
// raw levels, so a mixed-base boundary would corrupt them. A one-time migration
// (server/src/migrations/migrateEcbHicpDataset.ts, gated by PRAGMA user_version)
// purges the old HICP_* rows so syncIncremental re-backfills full history on the
// new base. The CSV parser keys columns by header name, so the new dataflow's
// different column layout needs no parser change.
//
// NOTE ON SERIES KEYS (important — read before editing):
// The original task referenced an uploaded `ecb-eu-fundamental-series-guide.md`
// that was NOT present in the repo, and its inline key table was internally
// inconsistent (one key 404s, another's code contradicted its description).
// These keys were resolved empirically against the live ECB ICP_ITEM codelist
// so the dashboard series_codes honor the intended economic *descriptions*:
//   HICP_HEADLINE  = ICP M.U2.N.000000.4.INX  "HICP - Overall index"
//   HICP_CORE      = ICP M.U2.N.XEFUN0.4.INX  "excl. energy & unprocessed food"
//                    (the medium core — ingested but NOT surfaced in the UI toggle)
//   HICP_SUPERCORE = ICP M.U2.N.XEF000.4.INX  "excl. energy & food" (= excl.
//                    energy, food, alcohol & tobacco — the market-standard euro
//                    area "core"; surfaced as "CORE" in the toggle)
//   UNRATE_EA      = LFSI M.I9.S.UNEHRT.TOTAL0.15_74.T  euro-area unemployment %
// Conventions (per the task): HICP uses U2 (changing composition) + N (NSA);
// unemployment uses I9 (fixed 20-country area) + S (SA). Do not mix these up.

import { storeEcbObservations, getEcbLatestDate } from '../db'

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data'

interface EcbSeriesDef {
  code: string         // dashboard series_code stored in ecb_observations
  unit: 'index' | 'percent'
  dataflow: string     // SDMX dataflow, e.g. 'ICP' or 'LFSI'
  key: string          // SDMX series key
}

const SERIES: EcbSeriesDef[] = [
  // ── NSA (Eurostat) — used for YoY + level display ──
  // DATA_PROVIDER=4D0 (was STS_INSTITUTION=4 under the old ICP dataflow).
  { code: 'HICP_HEADLINE',  unit: 'index',   dataflow: 'HICP', key: 'M.U2.N.000000.4D0.INX' },
  { code: 'HICP_CORE',      unit: 'index',   dataflow: 'HICP', key: 'M.U2.N.XEFUN0.4D0.INX' },
  { code: 'HICP_SUPERCORE', unit: 'index',   dataflow: 'HICP', key: 'M.U2.N.XEF000.4D0.INX' },
  // ── Seasonally adjusted — used for sequential MoM + projection paths ──
  // NB: HICP has no ADJUSTMENT=S; the seasonally (and working-day) adjusted index
  // is ADJUSTMENT=Y. Under the new HICP dataflow the adjusted series sits under
  // DATA_PROVIDER=4F0 (was STS_INSTITUTION=3 under old ICP). Each SA code pairs
  // with the same ICP_ITEM as its NSA sibling so the toggle pairs the same
  // conceptual measure (criterion 9). Verified empirically against the live API.
  { code: 'HICP_HEADLINE_SA',  unit: 'index', dataflow: 'HICP', key: 'M.U2.Y.000000.4F0.INX' },
  { code: 'HICP_CORE_SA',      unit: 'index', dataflow: 'HICP', key: 'M.U2.Y.XEFUN0.4F0.INX' },
  { code: 'HICP_SUPERCORE_SA', unit: 'index', dataflow: 'HICP', key: 'M.U2.Y.XEF000.4F0.INX' },
  // ── Labor (SA at source) — unaffected by the HICP migration ──
  { code: 'UNRATE_EA',      unit: 'percent', dataflow: 'LFSI', key: 'M.I9.S.UNEHRT.TOTAL0.15_74.T' },
]

const BACKFILL_START = '2000-01'

// ── Minimal RFC-4180-ish CSV parser ─────────────────────────────────────────
// ECB csvdata includes a header row and quoted fields with embedded commas
// (e.g. the OBS_COM note). papaparse isn't a server dependency, so parse here.
// Returns an array of objects keyed by the header row — robust to the differing
// column layouts of the ICP vs LFSI dataflows (we read columns by name).
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length === 0) return []
  const header = rows[0]
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {}
    header.forEach((h, idx) => { obj[h] = r[idx] ?? '' })
    return obj
  })
}

interface RawObs { date: string; value: number | null; obsStatus: string | null }

// Fetch one ECB series as CSV and return parsed observations. ECB TIME_PERIOD
// is monthly "YYYY-MM"; we store it as first-of-month "YYYY-MM-01" to match the
// dashboard's monthly-series convention (ONS/UK). Returns [] on 404/empty
// (logged, not fabricated).
async function fetchSeries(def: EcbSeriesDef, startPeriod: string): Promise<RawObs[]> {
  const url = `${ECB_BASE}/${def.dataflow}/${def.key}?startPeriod=${startPeriod}&format=csvdata`
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.warn(`[ECB] ${def.code}: fetch failed — ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
  if (res.status === 404) {
    console.warn(`[ECB] ${def.code}: 404 (no results for ${def.dataflow}/${def.key} from ${startPeriod})`)
    return []
  }
  if (!res.ok) {
    console.warn(`[ECB] ${def.code}: HTTP ${res.status}`)
    return []
  }
  const text = await res.text()
  if (!text.trim()) return []

  const records = parseCsv(text)
  const out: RawObs[] = []
  for (const rec of records) {
    const period = rec['TIME_PERIOD']
    const rawVal = rec['OBS_VALUE']
    if (!period || rawVal === undefined || rawVal === '') continue
    // Only handle monthly periods (YYYY-MM); skip anything unexpected.
    const m = /^(\d{4})-(\d{2})$/.exec(period.trim())
    if (!m) continue
    const num = parseFloat(rawVal)
    if (!Number.isFinite(num)) continue
    out.push({
      date: `${m[1]}-${m[2]}-01`,
      value: num,
      obsStatus: (rec['OBS_STATUS'] || '').trim() || null,
    })
  }
  return out
}

// Next month (YYYY-MM) after a stored "YYYY-MM-01" date — used as the
// incremental startPeriod so we only request observations from there onward.
function nextMonthPeriod(isoDate: string): string {
  const [y, mm] = isoDate.split('-').map(Number)
  const total = y * 12 + (mm - 1) + 1
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

// Full history for all four series from 2000-01.
export async function backfill(): Promise<void> {
  console.log('[ECB] backfill starting…')
  for (const def of SERIES) {
    const obs = await fetchSeries(def, BACKFILL_START)
    const n = storeEcbObservations(def.code, def.unit, obs)
    console.log(`[ECB] backfill ${def.code}: ${n} rows (${obs[0]?.date ?? '—'} → ${obs[obs.length - 1]?.date ?? '—'})`)
  }
  console.log('[ECB] backfill done.')
}

// Pull only observations from the month after the latest stored date per series.
// Falls back to a full backfill for any series with no rows yet (so a single
// startup/cron call handles both the empty and steady-state cases).
export async function syncIncremental(): Promise<void> {
  for (const def of SERIES) {
    const latest = getEcbLatestDate(def.code)
    const start = latest ? nextMonthPeriod(latest) : BACKFILL_START
    const obs = await fetchSeries(def, start)
    const n = storeEcbObservations(def.code, def.unit, obs)
    if (n > 0) console.log(`[ECB] sync ${def.code}: +${n} rows from ${start}`)
  }
}
