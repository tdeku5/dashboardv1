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
  unit: 'index' | 'percent' | 'mio_eur'
  dataflow: string     // SDMX dataflow, e.g. 'HICP', 'LFSI' or 'BSI'
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

// ── DE/FR/IT country series (EU3 econ models, docs/eu3-models-mapping.md) ────
// Additive extension (Phase 2, 2026-07): country-level HICP on the same
// post-migration `HICP` dataflow (2025=100, NSA — no country SA exists on the
// portal), LFSI unemployment, and BSI bank lending (decision h, verified).
// The euro-area entries above are the rates-model's and stay untouched; these
// country entries only ADD to the same config array and reuse all logic.

const EU3_GEOS = ['DE', 'FR', 'IT'] as const

// ICP_ITEM → code suffix. Verified live against the DE item list (435 items);
// all items exist identically for FR/IT (same codelist, e-COICOP 2).
const EU3_HICP_ITEMS: ReadonlyArray<[item: string, suffix: string]> = [
  ['000000', 'HICP'],           // All items
  ['XEF000', 'HICP_XEF'],       // ex energy, food, alcohol & tobacco (US-core analog)
  ['XEFUN0', 'HICP_XEFUN'],     // ex energy & unprocessed food (ECB core)
  // 12 COICOP divisions
  ['010000', 'HICP_CP01'], ['020000', 'HICP_CP02'], ['030000', 'HICP_CP03'],
  ['040000', 'HICP_CP04'], ['050000', 'HICP_CP05'], ['060000', 'HICP_CP06'],
  ['070000', 'HICP_CP07'], ['080000', 'HICP_CP08'], ['090000', 'HICP_CP09'],
  ['100000', 'HICP_CP10'], ['110000', 'HICP_CP11'], ['120000', 'HICP_CP12'],
  // Special aggregates
  ['NRGY00', 'HICP_ENERGY'], ['FOOD00', 'HICP_FOOD'], ['FOODUN', 'HICP_FOODUN'],
  ['SERV00', 'HICP_SERVICES'], ['GOODS0', 'HICP_GOODS'], ['IGXE00', 'HICP_NEIG'],
  ['IGXEDU', 'HICP_DUR'], ['IGXEND', 'HICP_NONDUR'], ['IGXESD', 'HICP_SEMIDUR'],
  // Distribution sub-items (27; e-COICOP 2 — no tobacco item exists post-restructure)
  ['011100', 'HICP_D_CEREALS'], ['011200', 'HICP_D_MEAT'], ['011300', 'HICP_D_FISH'],
  ['011400', 'HICP_D_DAIRY'], ['011600', 'HICP_D_FRUIT'], ['011700', 'HICP_D_VEG'],
  ['021000', 'HICP_D_ALCOHOL'], ['031000', 'HICP_D_CLOTHING'], ['041000', 'HICP_D_RENTS'],
  ['043000', 'HICP_D_MAINT'], ['044000', 'HICP_D_WATER'], ['045100', 'HICP_D_ELECTRICITY'],
  ['045200', 'HICP_D_GAS'], ['045300', 'HICP_D_LIQFUEL'], ['051000', 'HICP_D_FURNITURE'],
  ['053000', 'HICP_D_APPLIANCES'], ['061000', 'HICP_D_MEDICINES'], ['071100', 'HICP_D_CARS'],
  ['072200', 'HICP_D_MOTORFUEL'], ['073000', 'HICP_D_TRANSPSVC'], ['081000', 'HICP_D_ICTEQUIP'],
  ['083000', 'HICP_D_ICTSVC'], ['095000', 'HICP_D_CULTGOODS'], ['096000', 'HICP_D_CULTSVC'],
  ['111000', 'HICP_D_RESTAURANTS'], ['112000', 'HICP_D_ACCOMM'], ['121000', 'HICP_D_INSURANCE'],
]

const EU3_SERIES: EcbSeriesDef[] = EU3_GEOS.flatMap(cc => [
  ...EU3_HICP_ITEMS.map(([item, suffix]): EcbSeriesDef => ({
    code: `${cc}_${suffix}`, unit: 'index',
    dataflow: 'HICP', key: `M.${cc}.N.${item}.4D0.INX`,
  })),
  // Unemployment rate (SA) — same LFSI conventions as UNRATE_EA
  { code: `UNRATE_${cc}`, unit: 'percent', dataflow: 'LFSI', key: `M.${cc}.S.UNEHRT.TOTAL0.15_74.T` },
  // BSI bank lending (decision h — verified live: DE HH €2,110bn May-26, +2.18% YoY)
  { code: `${cc}_LOANS_HH`, unit: 'mio_eur', dataflow: 'BSI', key: `M.${cc}.N.A.A20.A.1.U2.2250.Z01.E` },
  { code: `${cc}_LOANS_NFC`, unit: 'mio_eur', dataflow: 'BSI', key: `M.${cc}.N.A.A20.A.1.U2.2240.Z01.E` },
  { code: `${cc}_LOANS_HH_YOY`, unit: 'percent', dataflow: 'BSI', key: `M.${cc}.N.A.A20.A.I.U2.2250.Z01.A` },
  { code: `${cc}_LOANS_NFC_YOY`, unit: 'percent', dataflow: 'BSI', key: `M.${cc}.N.A.A20.A.I.U2.2240.Z01.A` },
])

SERIES.push(...EU3_SERIES)

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

// Polite spacing between requests now that the EU3 extension takes the config
// from 7 to ~175 series (ECB asks for restraint; 150ms ≈ 6-7 req/s).
const throttle = () => new Promise<void>(r => setTimeout(r, 150))

// Full history for all series from 2000-01.
export async function backfill(): Promise<void> {
  console.log('[ECB] backfill starting…')
  for (const def of SERIES) {
    await throttle()
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
    await throttle()
    const latest = getEcbLatestDate(def.code)
    const start = latest ? nextMonthPeriod(latest) : BACKFILL_START
    const obs = await fetchSeries(def, start)
    const n = storeEcbObservations(def.code, def.unit, obs)
    if (n > 0) console.log(`[ECB] sync ${def.code}: +${n} rows from ${start}`)
  }
}
