import * as XLSX from 'xlsx'
import { storeGDPContributions, db } from './db'

const DATASET_PAGE = 'https://www.ons.gov.uk/economy/grossdomesticproductgdp/datasets/contributionstomonthlygdp'

const MONTH_MAP: Record<string, string> = {
  'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
  'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}

function parseContribDate(raw: unknown): string | null {
  if (!raw) return null
  // Format: "2024 Jan"
  if (typeof raw === 'string') {
    const parts = raw.trim().split(/\s+/)
    if (parts.length === 2 && MONTH_MAP[parts[1]] && /^\d{4}$/.test(parts[0])) {
      return `${parts[0]}-${MONTH_MAP[parts[1]]}-01`
    }
    // Try "Jan 2024" (reversed)
    if (parts.length === 2 && MONTH_MAP[parts[0]] && /^\d{4}$/.test(parts[1])) {
      return `${parts[1]}-${MONTH_MAP[parts[0]]}-01`
    }
  }
  // Excel serial number
  if (typeof raw === 'number' && raw > 30000) {
    const epoch = new Date(1899, 11, 30)
    const d = new Date(epoch.getTime() + raw * 86400000)
    const y = d.getFullYear()
    if (y < 1990 || y > 2100) return null
    return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  return null
}

// Map category text to period type
function categoryToPeriodType(cat: string): string | null {
  const c = cat.toLowerCase()
  if (c.includes('month on previous month')) return 'mom'
  if (c.includes('3 months on previous 3 months')) return '3m3m'
  if (c.includes('month on same month a year')) return 'yoy'
  if (c.includes('3 months on same 3 months a year')) return '3m3m_yoy'
  if (c.includes('weight')) return null // skip weights
  return null
}

// Map column header to sector name
function headerToSector(header: string): string | null {
  const h = header.toLowerCase()
  if (h.includes('total gva') || h.includes('a - t') || h.includes('a-t')) return 'gdp'
  if (h.includes('agriculture') || h.startsWith('a)') || h.includes('(a)')) return 'agriculture'
  if (h.includes('total production') || h.includes('b - e') || h.includes('b-e')) return 'production'
  if (h.includes('mining') || h.includes('(b)')) return 'mining'
  if (h.includes('manufacturing') || h.includes('(c)')) return 'manufacturing'
  if (h.includes('electricity') || h.includes('(d)')) return 'electricity_gas'
  if (h.includes('water supply') || h.includes('(e)')) return 'water_waste'
  if (h.includes('construction') || h.includes('(f)')) return 'construction'
  if (h.includes('total service') || h.includes('g-t') || h.includes('g - t')) return 'services'
  if (h.includes('wholesale') || h.includes('(g)')) return 'wholesale_retail'
  if (h.includes('transport') && h.includes('storage') || h.includes('(h)')) return 'transport_storage'
  if (h.includes('accommodation') || h.includes('(i)')) return 'accommodation_food'
  if (h.includes('information') || h.includes('(j)')) return 'info_communication'
  if (h.includes('financial') || h.includes('(k)')) return 'financial_insurance'
  if (h.includes('real estate') || h.includes('(l)')) return 'real_estate'
  if (h.includes('professional') || h.includes('(m)')) return 'professional_scientific'
  if (h.includes('administrative') || h.includes('(n)')) return 'admin_support'
  if (h.includes('public admin') || h.includes('(o)')) return 'public_admin'
  if (h.includes('education') || h.includes('(p)')) return 'education'
  if (h.includes('health') || h.includes('(q)')) return 'health_social'
  if (h.includes('arts') || h.includes('(r)')) return 'arts_recreation'
  if (h.includes('other service') || h.includes('(s)')) return 'other_services'
  if (h.includes('household') || h.includes('(t)')) return 'households'
  return null
}

export async function syncMonthlyGDPContributions(): Promise<void> {
  console.log('[ONS GDP Contribs] Starting sync...')

  try {
    // Step 1: Fetch dataset page to find download link
    const pageRes = await fetch(DATASET_PAGE, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' },
    })
    if (!pageRes.ok) {
      console.error(`[ONS GDP Contribs] Failed to fetch dataset page: ${pageRes.status}`)
      return
    }
    const pageHtml = await pageRes.text()
    const xlsxMatch = pageHtml.match(/href="([^"]*\.xlsx[^"]*)"/i)
    if (!xlsxMatch) {
      console.error('[ONS GDP Contribs] Could not find xlsx download link')
      return
    }

    let xlsxUrl = xlsxMatch[1]
    if (xlsxUrl.startsWith('/')) xlsxUrl = 'https://www.ons.gov.uk' + xlsxUrl
    console.log(`[ONS GDP Contribs] Downloading: ${xlsxUrl}`)

    // Step 2: Download
    const xlsxRes = await fetch(xlsxUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' },
    })
    if (!xlsxRes.ok) {
      console.error(`[ONS GDP Contribs] Download failed: ${xlsxRes.status}`)
      return
    }

    const buffer = await xlsxRes.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    console.log(`[ONS GDP Contribs] Sheets: ${workbook.SheetNames.join(', ')}`)

    // Step 3: Find the CONTRIBUTIONS sheet
    const contribSheetName = workbook.SheetNames.find(n => n.toUpperCase().includes('CONTRIB'))
    if (!contribSheetName) {
      console.error('[ONS GDP Contribs] No CONTRIBUTIONS sheet found')
      return
    }

    const sheet = workbook.Sheets[contribSheetName]!
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })
    console.log(`[ONS GDP Contribs] Sheet "${contribSheetName}": ${data.length} rows`)

    // Step 4: Find header row — look for "Time Period" in column A
    let headerRowIdx = -1
    for (let r = 0; r < Math.min(20, data.length); r++) {
      const row = data[r] as unknown[]
      if (row && String(row[0] || '').toLowerCase().includes('time period')) {
        headerRowIdx = r
        break
      }
    }

    if (headerRowIdx === -1) {
      console.error('[ONS GDP Contribs] Could not find header row (looking for "Time Period")')
      return
    }

    // Step 5: Build sector mapping from header row
    const headers = data[headerRowIdx] as string[]
    const sectorMap: Record<number, string> = {}
    for (let col = 2; col < headers.length; col++) {
      const sector = headerToSector(String(headers[col] || ''))
      if (sector) sectorMap[col] = sector
    }

    console.log(`[ONS GDP Contribs] Mapped ${Object.keys(sectorMap).length} sector columns`)

    // Step 6: Parse data rows (skip CDID row after header)
    const results: Array<{ date: string; period_type: string; sector: string; value: number }> = []

    for (let r = headerRowIdx + 2; r < data.length; r++) {
      const row = data[r] as unknown[]
      if (!row || row.length < 3) continue

      const date = parseContribDate(row[0])
      if (!date) continue

      const category = String(row[1] || '')
      const periodType = categoryToPeriodType(category)
      if (!periodType) continue

      for (const [colStr, sector] of Object.entries(sectorMap)) {
        const col = parseInt(colStr)
        const rawVal = row[col]
        if (rawVal === null || rawVal === undefined || rawVal === '' || String(rawVal).includes('no data')) continue
        const value = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal))
        if (isNaN(value)) continue
        results.push({ date, period_type: periodType, sector, value })
      }
    }

    if (results.length > 0) {
      storeGDPContributions(results)
      console.log(`[ONS GDP Contribs] Stored ${results.length} rows`)

      // Log summary by period type
      const summary = new Map<string, number>()
      for (const r of results) summary.set(r.period_type, (summary.get(r.period_type) || 0) + 1)
      for (const [pt, count] of summary) console.log(`[ONS GDP Contribs]   ${pt}: ${count} rows`)
    } else {
      console.warn('[ONS GDP Contribs] No rows parsed')
    }

  } catch (err) {
    console.error('[ONS GDP Contribs] Sync error:', err)
  }
}

// ── SIC section code to sector name mapping (used by old format) ────────────

const SIC_TO_SECTOR: Record<string, string> = {
  'a-t': 'gdp', 'a': 'agriculture', 'b-e': 'production', 'b': 'mining', 'c': 'manufacturing',
  'd': 'electricity_gas', 'e': 'water_waste', 'f': 'construction', 'g-t': 'services',
  'g': 'wholesale_retail', 'h': 'transport_storage', 'i': 'accommodation_food',
  'j': 'info_communication', 'k': 'financial_insurance', 'l': 'real_estate',
  'm': 'professional_scientific', 'n': 'admin_support', 'o': 'public_admin',
  'p': 'education', 'q': 'health_social', 'r': 'arts_recreation', 's': 'other_services', 't': 'households',
}

// ── Old format parser (v1–v56, pre-2024 structure) ──────────────────────────

function parseOldFormatSheet(
  data: unknown[][],
): Array<{ date: string; period_type: string; sector: string; value: number }> {
  const results: Array<{ date: string; period_type: string; sector: string; value: number }> = []

  // Find the "Section" row which has SIC codes like A-T, A, B-E, etc.
  let sectionRowIdx = -1
  let dataColStart = 2 // data columns typically start at col 2 or 3
  const sectorMap: Record<number, string> = {}

  for (let r = 0; r < Math.min(15, data.length); r++) {
    const row = data[r] as unknown[]
    if (!row) continue
    const firstCell = String(row[0] || '').trim().toLowerCase()
    if (firstCell.includes('section')) {
      sectionRowIdx = r
      // Map columns to sectors using SIC codes
      for (let col = 0; col < row.length; col++) {
        const code = String(row[col] || '').trim().toLowerCase()
        const sector = SIC_TO_SECTOR[code]
        if (sector) { sectorMap[col] = sector; if (dataColStart > col) dataColStart = col }
      }
      break
    }
  }

  if (sectionRowIdx === -1 || Object.keys(sectorMap).length === 0) return results

  // Now scan for period type sections and data rows
  let currentPeriodType: string | null = null
  let carryYear = ''  // Year carries forward when subsequent rows have empty/space year

  for (let r = sectionRowIdx + 1; r < data.length; r++) {
    const row = data[r] as unknown[]
    if (!row) continue

    // Check if this row is a section header (period type indicator) — may have only 1 column
    const firstCell = String(row[0] || '').trim()
    if (firstCell.toLowerCase().includes('contribut')) {
      currentPeriodType = categoryToPeriodType(firstCell)
      carryYear = ''  // Reset year on new section
      continue
    }

    if (!currentPeriodType) continue
    if (row.length < 3) continue

    // Parse month from col 1
    const monthRaw = String(row[1] || '').trim()
    const month = MONTH_MAP[monthRaw]
    if (!month) continue

    // Parse year from col 0 — may be a new year or carry forward
    const yearRaw = String(row[0] || '').trim()
    if (/^\d{4}$/.test(yearRaw)) {
      carryYear = yearRaw
    } else if (typeof row[0] === 'number' && row[0] >= 2000 && row[0] <= 2100) {
      carryYear = String(row[0])
    }
    // If yearRaw is empty/spaces, keep carryYear from previous row

    if (!carryYear) continue
    const date = `${carryYear}-${month}-01`

    for (const [colStr, sector] of Object.entries(sectorMap)) {
      const col = parseInt(colStr)
      const rawVal = row[col]
      if (rawVal === null || rawVal === undefined || rawVal === '') continue
      const value = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal))
      if (isNaN(value)) continue
      results.push({ date, period_type: currentPeriodType, sector, value })
    }
  }

  return results
}

// ── Backfill from ONS archive ───────────────────────────────────────────────

const ARCHIVE_BASE = 'https://www.ons.gov.uk/file?uri=/economy/grossdomesticproductgdp/datasets/contributionstomonthlygdp/current/previous'

// Representative subset — oldest for max history, then every ~10th version
const ARCHIVE_VERSIONS = [
  { v: 1, file: 'monthlycontributionstables.xls' },
  { v: 10, file: 'monthlycontributionstablesmay2019.xls' },
  { v: 20, file: 'monthlycontributionstablesmarch2020110520.xls' },
  { v: 30, file: 'monthlycontributionstablesjanuary2021.xls' },
  { v: 40, file: 'monthlycontributionstablesnov2021.xls' },
  { v: 41, file: 'monthlycontributionstablesdec2021.xlsx' },
  { v: 45, file: 'monthlycontributionstablesapril2022.xlsx' },
  { v: 50, file: 'monthlycontributionstablesseptember2022.xlsx' },
  { v: 53, file: 'mgdpcontributionsdec2022.xlsx' },
  { v: 56, file: 'monthlycontributionsmarch2023.xlsx' },
]

function parseWorkbookContribs(workbook: XLSX.WorkBook): Array<{ date: string; period_type: string; sector: string; value: number }> {
  const allResults: Array<{ date: string; period_type: string; sector: string; value: number }> = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const nameLower = sheetName.toLowerCase()
    if (!nameLower.includes('contrib')) continue

    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })
    if (data.length < 10) continue

    // Try new format first (has "Time Period" header)
    const hasTimePeriod = data.some((row, i) => i < 20 && row && String((row as unknown[])[0] || '').toLowerCase().includes('time period'))

    if (hasTimePeriod) {
      // New format — use existing parser logic inline
      let headerRowIdx = -1
      for (let r = 0; r < Math.min(20, data.length); r++) {
        const row = data[r] as unknown[]
        if (row && String(row[0] || '').toLowerCase().includes('time period')) { headerRowIdx = r; break }
      }
      if (headerRowIdx === -1) continue

      const headers = data[headerRowIdx] as string[]
      const sectorMap: Record<number, string> = {}
      for (let col = 2; col < headers.length; col++) {
        const sector = headerToSector(String(headers[col] || ''))
        if (sector) sectorMap[col] = sector
      }

      for (let r = headerRowIdx + 2; r < data.length; r++) {
        const row = data[r] as unknown[]
        if (!row || row.length < 3) continue
        const date = parseContribDate(row[0])
        if (!date) continue
        const category = String(row[1] || '')
        const periodType = categoryToPeriodType(category)
        if (!periodType) continue
        for (const [colStr, sector] of Object.entries(sectorMap)) {
          const col = parseInt(colStr)
          const rawVal = row[col]
          if (rawVal === null || rawVal === undefined || rawVal === '' || String(rawVal).includes('no data')) continue
          const value = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal))
          if (!isNaN(value)) allResults.push({ date, period_type: periodType, sector, value })
        }
      }
    } else {
      // Old format — use SIC section row parser
      const rows = parseOldFormatSheet(data as unknown[][])
      allResults.push(...rows)
    }
  }

  return allResults
}

export async function backfillMonthlyGDPContributions(): Promise<void> {
  const existingCount = (db.prepare(
    "SELECT COUNT(DISTINCT date) as cnt FROM ons_gdp_contributions WHERE period_type='mom'"
  ).get() as { cnt: number }).cnt

  if (existingCount > 100) {
    console.log(`[ONS GDP Contribs Backfill] Already have ${existingCount} months, skipping`)
    return
  }

  console.log('[ONS GDP Contribs Backfill] Starting historical backfill...')
  const start = Date.now()

  for (const { v, file } of ARCHIVE_VERSIONS) {
    const url = `${ARCHIVE_BASE}/v${v}/${file}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' } })
      if (!res.ok) { console.warn(`[ONS GDP Contribs Backfill] v${v}: HTTP ${res.status}, skipping`); continue }

      const buffer = await res.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const rows = parseWorkbookContribs(workbook)

      if (rows.length > 0) {
        storeGDPContributions(rows)
        console.log(`[ONS GDP Contribs Backfill] v${v}: ${rows.length} rows`)
      } else {
        console.warn(`[ONS GDP Contribs Backfill] v${v}: no rows parsed (sheets: ${workbook.SheetNames.join(', ')})`)
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (err) {
      console.error(`[ONS GDP Contribs Backfill] v${v} error:`, err)
    }
  }

  const finalCount = (db.prepare(
    "SELECT COUNT(DISTINCT date) as cnt FROM ons_gdp_contributions WHERE period_type='mom'"
  ).get() as { cnt: number }).cnt
  console.log(`[ONS GDP Contribs Backfill] Complete in ${((Date.now() - start) / 1000).toFixed(1)}s — ${finalCount} months of MoM data`)
}
