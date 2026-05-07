import * as XLSX from 'xlsx'
import { db, getGDPNowLatestDate } from './db'

const EXCEL_URL = 'https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/cqer/researchcq/gdpnow/GDPTrackingModelDataAndForecasts.xlsx'

interface ParsedForecast {
  quarter: string
  forecastDate: string
  value: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDateCell(value: unknown): string | null {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  if (value == null) return null
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

/** Convert a date cell (Excel serial or JS Date or string) to "Q1 2025" style label */
function dateToQuarterLabel(dateCell: unknown): string | null {
  let month: number
  let year: number

  if (typeof dateCell === 'number') {
    const d = XLSX.SSF.parse_date_code(dateCell)
    if (!d) return null
    month = d.m
    year = d.y
  } else if (dateCell instanceof Date) {
    month = dateCell.getMonth() + 1
    year = dateCell.getFullYear()
  } else if (typeof dateCell === 'string') {
    const d = new Date(dateCell)
    if (isNaN(d.getTime())) return null
    month = d.getMonth() + 1
    year = d.getFullYear()
  } else {
    return null
  }

  let q: string
  if (month <= 3) q = 'Q1'
  else if (month <= 6) q = 'Q2'
  else if (month <= 9) q = 'Q3'
  else q = 'Q4'

  return `${q} ${year}`
}

/** Advance a "Q4 2025" label to the next quarter */
function getNextQuarter(quarter: string): string {
  const match = quarter.match(/Q(\d)\s+(\d{4})/)
  if (!match) return quarter
  let q = parseInt(match[1])
  let y = parseInt(match[2])
  q++
  if (q > 4) { q = 1; y++ }
  return `Q${q} ${y}`
}

// Chronological comparator. Plain string sort orders Q1 2026 < Q2 2014 because
// it compares character-by-character — wrong for "find the latest quarter."
function quarterCompare(a: string, b: string): number {
  const ma = a.match(/Q(\d)\s+(\d{4})/)
  const mb = b.match(/Q(\d)\s+(\d{4})/)
  if (!ma || !mb) return a.localeCompare(b)
  const yearDiff = parseInt(ma[2]) - parseInt(mb[2])
  if (yearDiff !== 0) return yearDiff
  return parseInt(ma[1]) - parseInt(mb[1])
}

// ── Sheet parsers ────────────────────────────────────────────────────────────

function parseTrackingArchives(workbook: XLSX.WorkBook): ParsedForecast[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().replace(/\s+/g, '').includes('trackingarchive'))
  if (!sheetName) throw new Error(`TrackingArchives sheet not found. Available: ${workbook.SheetNames.join(', ')}`)

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  if (rows.length < 2) throw new Error('TrackingArchives sheet has insufficient data')

  const headerRow = rows[0] ?? []

  // Find the GDPNowcast column by header text
  const dateColIdx = 0      // Column A: forecast date
  let quarterColIdx = 1     // Column B: quarter being forecasted (date value)
  let gdpColIdx = -1

  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().replace(/\s+/g, '')
    if (h.includes('gdpnowcast') || h === 'gdpnowcast') {
      gdpColIdx = i
    }
    if (h.includes('quarterbeingforecasted') || h === 'quarterbeingforecasted') {
      quarterColIdx = i
    }
  }

  // Fallback: column AB = index 27
  if (gdpColIdx === -1) {
    gdpColIdx = 27
    console.log('[gdpnow] GDPNowcast column not found by name, using index 27')
  }

  console.log(`[gdpnow] TrackingArchives: date=${dateColIdx}, quarter=${quarterColIdx}, gdp=${gdpColIdx}`)
  console.log(`[gdpnow] GDP column header: "${headerRow[gdpColIdx]}"`)
  console.log(`[gdpnow] Quarter column header: "${headerRow[quarterColIdx]}"`)
  // Log all headers so we can verify column alignment
  console.log(`[gdpnow] TrackingArchives headers: ${(headerRow as unknown[]).map((h, i) => `${i}:${h}`).filter((_, i) => i < 35).join(', ')}`)

  const forecasts: ParsedForecast[] = []
  let skippedOutOfRange = 0

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] ?? []
    const dateCell = row[dateColIdx]
    const quarterCell = row[quarterColIdx]
    const gdpCell = row[gdpColIdx]

    if (dateCell == null || quarterCell == null || gdpCell == null) continue
    if (typeof gdpCell !== 'number' || isNaN(gdpCell)) continue

    // Sanity check — GDP growth SAAR should be between -30% and +30%
    if (gdpCell < -30 || gdpCell > 30) {
      if (skippedOutOfRange < 3) {
        console.log(`[gdpnow] WARNING: Skipping suspicious value ${gdpCell} at row ${rowIdx}`)
      }
      skippedOutOfRange++
      continue
    }

    const forecastDate = parseDateCell(dateCell)
    if (!forecastDate) continue

    // Convert column B date to quarter label (e.g. serial 45657 → "Q4 2025")
    const quarter = dateToQuarterLabel(quarterCell)
    if (!quarter) continue

    // Log first few data points for verification
    if (forecasts.length < 3) {
      console.log(`[gdpnow] Sample: date=${forecastDate}, quarter=${quarter}, gdpValue=${gdpCell}`)
    }

    forecasts.push({ quarter, forecastDate, value: gdpCell })
  }

  if (skippedOutOfRange > 0) {
    console.log(`[gdpnow] TrackingArchives: skipped ${skippedOutOfRange} out-of-range values (wrong column?)`)
  }
  console.log(`[gdpnow] TrackingArchives: ${forecasts.length} points across ${new Set(forecasts.map((f) => f.quarter)).size} vintages`)
  return forecasts
}

function parseTableCont(workbook: XLSX.WorkBook, lastArchiveQuarter: string): ParsedForecast[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().replace(/\s+/g, '').includes('tablecont'))
  if (!sheetName) {
    console.log('[gdpnow] TableCont sheet not found, skipping current quarter')
    return []
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  if (rows.length < 2) return []

  const headerRow = rows[0] ?? []

  // Find columns by header name
  let dateColIdx = 0   // Column A: date
  let gdpColIdx = 2    // Column C: GDP

  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().trim()
    if (h === 'date') dateColIdx = i
    if (h === 'gdp') gdpColIdx = i
  }

  console.log(`[gdpnow] TableCont: date=${dateColIdx} ("${headerRow[dateColIdx]}"), gdp=${gdpColIdx} ("${headerRow[gdpColIdx]}")`)
  // Log all headers to verify column alignment
  console.log(`[gdpnow] TableCont headers: ${(headerRow as unknown[]).map((h, i) => `${i}:${h}`).join(', ')}`)

  // Current quarter = one after the last archived quarter
  const currentQuarter = getNextQuarter(lastArchiveQuarter)
  console.log(`[gdpnow] Current nowcast quarter (from TableCont): ${currentQuarter}`)

  const forecasts: ParsedForecast[] = []
  let skippedOutOfRange = 0

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] ?? []
    const dateCell = row[dateColIdx]
    const gdpCell = row[gdpColIdx]

    if (dateCell == null || gdpCell == null) continue
    if (typeof gdpCell !== 'number' || isNaN(gdpCell)) continue

    // Sanity check — GDP growth SAAR should be between -30% and +30%
    if (gdpCell < -30 || gdpCell > 30) {
      if (skippedOutOfRange < 3) {
        console.log(`[gdpnow] WARNING: TableCont suspicious value ${gdpCell} at row ${rowIdx}`)
      }
      skippedOutOfRange++
      continue
    }

    const forecastDate = parseDateCell(dateCell)
    if (!forecastDate) continue

    // Log first few data points for verification
    if (forecasts.length < 3) {
      console.log(`[gdpnow] TableCont sample: date=${forecastDate}, value=${gdpCell}`)
    }

    forecasts.push({ quarter: currentQuarter, forecastDate, value: gdpCell })
  }

  if (skippedOutOfRange > 0) {
    console.log(`[gdpnow] TableCont: skipped ${skippedOutOfRange} out-of-range values (wrong column?)`)
  }
  console.log(`[gdpnow] TableCont: ${forecasts.length} points for ${currentQuarter}`)
  return forecasts
}

// ── Contributions parser ─────────────────────────────────────────────────────

interface ContributionRow {
  forecastDate: string
  gdp: number | null
  pce: number | null
  equipment: number | null
  intellProp: number | null
  nonresStruct: number | null
  residInvest: number | null
  govt: number | null
  netExports: number | null
}

function parseTableContContributions(workbook: XLSX.WorkBook): ContributionRow[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().replace(/\s+/g, '').includes('tablecont'))
  if (!sheetName) {
    console.log('[gdpnow] TableCont sheet not found for contributions')
    return []
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  if (rows.length < 2) return []

  const headerRow = rows[0] ?? []
  console.log(`[gdpnow] TableCont contrib headers: ${(headerRow as unknown[]).map((h, i) => `${i}:${h}`).join(', ')}`)

  const results: ContributionRow[] = []

  const toNum = (v: unknown): number | null => {
    if (v == null || typeof v !== 'number' || isNaN(v as number)) return null
    return v as number
  }

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] ?? []
    const dateCell = row[0]    // Column A: Date
    const descCell = row[1]    // Column B: Major Releases
    const gdpCell = row[2]     // Column C: GDP
    const pceCell = row[3]     // Column D: PCE
    const equipCell = row[4]   // Column E: Equipment
    const ipCell = row[5]      // Column F: Intell. prop. prod.
    const nsCell = row[6]      // Column G: Nonres. struct.
    const riCell = row[7]      // Column H: Resid. inves.
    const govtCell = row[8]    // Column I: Govt.
    const nxCell = row[9]      // Column J: Net exports

    if (dateCell == null) continue

    // Filter out non-nowcast rows
    if (descCell != null) {
      const desc = String(descCell).toLowerCase()
      if (desc.includes('latest bea estimate') || desc.includes('maximum forecast') || desc.includes('minimum forecast')) {
        continue
      }
    }

    // Skip rows without a numeric GDP value
    if (gdpCell == null || typeof gdpCell !== 'number') continue

    // Sanity check — GDP growth SAAR should be between -30% and +30%
    // Values in the millions are BEA GDP levels, not nowcast growth rates
    if (gdpCell < -30 || gdpCell > 30) continue

    const forecastDate = parseDateCell(dateCell)
    if (!forecastDate) continue

    if (results.length < 3) {
      console.log(`[gdpnow] Contrib sample: date=${forecastDate}, gdp=${gdpCell}, pce=${pceCell}, equip=${equipCell}`)
    }

    results.push({
      forecastDate,
      gdp: toNum(gdpCell),
      pce: toNum(pceCell),
      equipment: toNum(equipCell),
      intellProp: toNum(ipCell),
      nonresStruct: toNum(nsCell),
      residInvest: toNum(riCell),
      govt: toNum(govtCell),
      netExports: toNum(nxCell),
    })
  }

  console.log(`[gdpnow] TableCont contributions: ${results.length} data rows`)
  return results
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncGDPNow(): Promise<{ total: number; newRows: number }> {
  console.log('[gdpnow] Starting sync...')

  // Clear any rows with bad quarter labels from previous buggy parsing
  const badLabels = db.prepare(`SELECT COUNT(*) AS cnt FROM gdpnow_forecasts WHERE quarter NOT LIKE 'Q%'`).get() as { cnt: number }
  if (badLabels.cnt > 0) {
    console.log(`[gdpnow] Found ${badLabels.cnt} rows with bad quarter labels, clearing for re-sync`)
    db.prepare('DELETE FROM gdpnow_forecasts').run()
  }

  // Clear any rows with out-of-range values from previous buggy column reads
  const badValues = db.prepare(`SELECT COUNT(*) AS cnt FROM gdpnow_forecasts WHERE value > 30 OR value < -30`).get() as { cnt: number }
  if (badValues.cnt > 0) {
    console.log(`[gdpnow] Found ${badValues.cnt} rows with out-of-range values, clearing for re-sync`)
    db.prepare('DELETE FROM gdpnow_forecasts').run()
  }

  let response: Response
  try {
    response = await fetch(EXCEL_URL)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[gdpnow] Failed to fetch GDPNow Excel from www.atlantafed.org: ${msg}`)
    throw err
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch GDPNow Excel: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  console.log('[gdpnow] Available sheets:', workbook.SheetNames.join(', '))

  // Parse historical vintages from TrackingArchives
  const archiveForecasts = parseTrackingArchives(workbook)

  // Determine the last archived quarter for TableCont (chronological — string
  // sort would put Q4 2025 above Q1 2026 and mis-tag TableCont's current
  // vintages as the prior quarter).
  const allQuarters = [...new Set(archiveForecasts.map((f) => f.quarter))].sort(quarterCompare)
  const lastArchiveQuarter = allQuarters[allQuarters.length - 1] || 'Q4 2025'

  // Parse current quarter from TableCont
  const currentForecasts = parseTableCont(workbook, lastArchiveQuarter)

  // Combine
  const allForecasts = [...archiveForecasts, ...currentForecasts]
  console.log(`[gdpnow] Total: ${allForecasts.length} points across ${new Set(allForecasts.map((f) => f.quarter)).size} vintages`)

  const latestBefore = getGDPNowLatestDate()

  // Full replacement: TrackingArchives is the authoritative source for archived
  // vintages, and TableCont contributes the current (still-being-forecast)
  // quarter. Wiping and re-inserting on every sync makes the table self-healing
  // — a row that was previously mis-tagged (e.g. a TableCont row attributed to
  // the prior quarter because of a sort bug) won't survive as an orphan.
  // UPSERT tolerates within-parse duplicates (TrackingArchives + TableCont
  // can overlap by one row during the transition into a new quarter).
  const upsertStmt = db.prepare(`
    INSERT INTO gdpnow_forecasts (quarter, forecast_date, value)
    VALUES (?, ?, ?)
    ON CONFLICT(quarter, forecast_date) DO UPDATE SET value = excluded.value
  `)

  db.transaction(() => {
    db.prepare('DELETE FROM gdpnow_forecasts').run()
    for (const item of allForecasts) {
      upsertStmt.run(item.quarter, item.forecastDate, item.value)
    }
  })()

  // Parse and store contributions from TableCont
  const contributions = parseTableContContributions(workbook)
  if (contributions.length > 0) {
    // Deduplicate: multiple releases can happen on the same date, keep the last one
    const byDate = new Map<string, ContributionRow>()
    for (const c of contributions) {
      byDate.set(c.forecastDate, c)
    }
    const deduped = [...byDate.values()]

    db.prepare('DELETE FROM gdpnow_contributions').run()
    const contribStmt = db.prepare(`
      INSERT INTO gdpnow_contributions (forecast_date, gdp, pce, equipment, intell_prop, nonres_struct, resid_invest, govt, net_exports)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.transaction(() => {
      for (const c of deduped) {
        contribStmt.run(c.forecastDate, c.gdp, c.pce, c.equipment, c.intellProp, c.nonresStruct, c.residInvest, c.govt, c.netExports)
      }
    })()
    console.log(`[gdpnow] Stored ${deduped.length} contribution rows (${contributions.length - deduped.length} duplicates removed)`)
  }

  const newRows = latestBefore
    ? allForecasts.filter((f) => f.forecastDate > latestBefore).length
    : allForecasts.length

  console.log(`[gdpnow] Sync complete. ${allForecasts.length} total, ~${newRows} new/updated`)
  return { total: allForecasts.length, newRows }
}
