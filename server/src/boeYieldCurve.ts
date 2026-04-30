import * as XLSX from 'xlsx'
import AdmZip from 'adm-zip'
import { storeGiltCurveData, getGiltCurveLatestDate, db } from './db'

// ── URLs ─────────────────────────────────────────────────────────────────────

const YIELD_CURVE_URLS: Record<string, { url: string; spot: string; forward: string }> = {
  nominal: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/GLC Nominal daily data current month.xlsx',
    spot: 'nominal_spot',
    forward: 'nominal_forward',
  },
  real: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/GLC Real daily data current month.xlsx',
    spot: 'real_spot',
    forward: 'real_forward',
  },
  inflation: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/GLC Inflation daily data current month.xlsx',
    spot: 'inflation_spot',
    forward: 'inflation_forward',
  },
  ois: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/OIS daily data current month.xlsx',
    spot: 'ois_spot',
    forward: 'ois_forward',
  },
}

const ARCHIVE_URLS: Record<string, { url: string; spot: string; forward: string }> = {
  nominal: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcnominalddata.zip',
    spot: 'nominal_spot',
    forward: 'nominal_forward',
  },
  real: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcrealddata.zip',
    spot: 'real_spot',
    forward: 'real_forward',
  },
  inflation: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcinflationddata.zip',
    spot: 'inflation_spot',
    forward: 'inflation_forward',
  },
  ois: {
    url: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/oisddata.zip',
    spot: 'ois_spot',
    forward: 'ois_forward',
  },
}

// ── Date / maturity helpers ──────────────────────────────────────────────────

const BOE_MONTHS: Record<string, string> = {
  'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
  'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
  'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}

function parseExcelDate(raw: unknown): string | null {
  if (!raw) return null

  if (typeof raw === 'number') {
    const epoch = new Date(1899, 11, 30)
    const d = new Date(epoch.getTime() + raw * 86400000)
    const year = d.getFullYear()
    if (year < 1900 || year > 2100) return null
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  if (typeof raw === 'string') {
    const parts = raw.trim().split(/[\s-\/]+/)
    if (parts.length === 3 && BOE_MONTHS[parts[1]]) {
      return `${parts[2]}-${BOE_MONTHS[parts[1]]}-${parts[0].padStart(2, '0')}`
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10)
  }

  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`
  }

  return null
}

function parseMaturity(header: unknown): number | null {
  if (header === null || header === undefined) return null
  if (typeof header === 'number' && header > 0 && header <= 50) return header
  if (typeof header === 'string') {
    const numMatch = header.trim().match(/^(\d+\.?\d*)$/)
    if (numMatch) { const v = parseFloat(numMatch[1]); if (v > 0 && v <= 50) return v }
    const ymMatch = header.match(/(\d+)\s*year/i)
    const moMatch = header.match(/(\d+)\s*month/i)
    if (ymMatch || moMatch) {
      return (ymMatch ? parseInt(ymMatch[1]) : 0) + (moMatch ? parseInt(moMatch[1]) / 12 : 0)
    }
  }
  return null
}

// ── Core workbook parser (shared by current-month and backfill) ──────────────

type CurveRow = { date: string; curve_type: string; maturity: number; value: number | null }

function parseWorkbook(workbook: XLSX.WorkBook, spotType: string, forwardType: string): CurveRow[] {
  const results: CurveRow[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const nameLower = sheetName.toLowerCase()
    const isSpot = nameLower.includes('spot')
    const isForward = nameLower.includes('forward')
    if (!isSpot && !isForward) continue

    const curveType = isSpot ? spotType : forwardType
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })
    if (data.length < 2) continue

    // Find header row
    let headerRowIdx = -1
    let maturities: Array<{ col: number; years: number }> = []

    for (let r = 0; r < Math.min(10, data.length); r++) {
      const row = data[r] as unknown[]
      if (!row || row.length < 3) continue
      const candidates: Array<{ col: number; years: number }> = []
      for (let c = 1; c < row.length; c++) {
        const m = parseMaturity(row[c])
        if (m !== null) candidates.push({ col: c, years: m })
      }
      if (candidates.length >= 3 && candidates.length > maturities.length) {
        headerRowIdx = r
        maturities = candidates
      }
    }

    if (headerRowIdx === -1 || maturities.length === 0) continue

    let rowCount = 0
    for (let r = headerRowIdx + 1; r < data.length; r++) {
      const row = data[r] as unknown[]
      if (!row || row.length < 2) continue
      const date = parseExcelDate(row[0])
      if (!date) continue

      for (const { col, years } of maturities) {
        if (col >= row.length) continue
        const rawVal = row[col]
        if (rawVal === null || rawVal === undefined || rawVal === '' || rawVal === '..') continue
        const value = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal))
        if (isNaN(value)) continue
        results.push({ date, curve_type: curveType, maturity: years, value })
        rowCount++
      }
    }

    if (rowCount > 0) {
      console.log(`[BoE YC] Parsed ${rowCount} points from "${sheetName}" → ${curveType}`)
    }
  }

  return results
}

// ── Current-month sync ───────────────────────────────────────────────────────

async function fetchAndParseYieldCurve(url: string, spotType: string, forwardType: string): Promise<number> {
  console.log(`[BoE YC] Fetching ${spotType}/${forwardType}...`)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' },
    })
  } catch (err) {
    console.error(`[BoE YC] Network error for ${spotType}: ${err instanceof Error ? err.message : err}`)
    return 0
  }

  if (!res.ok) {
    console.warn(`[BoE YC] HTTP ${res.status} for ${spotType} — URL may have changed. Skipping.`)
    return 0
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('spreadsheet') && !contentType.includes('excel') && !contentType.includes('octet-stream')) {
    console.warn(`[BoE YC] Unexpected content-type "${contentType}" for ${spotType}. Skipping.`)
    return 0
  }

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength < 1000) {
    console.warn(`[BoE YC] Response too small (${buffer.byteLength}B) for ${spotType}. Skipping.`)
    return 0
  }

  let rows: CurveRow[]
  try {
    const workbook = XLSX.read(buffer, { type: 'array' })
    rows = parseWorkbook(workbook, spotType, forwardType)
  } catch (err) {
    console.error(`[BoE YC] Parse error for ${spotType}: ${err instanceof Error ? err.message : err}`)
    return 0
  }

  if (rows.length > 0) {
    storeGiltCurveData(rows)
    console.log(`[BoE YC] Stored ${rows.length} points for ${spotType}/${forwardType}`)
  }

  return rows.length
}

export async function syncGiltYieldCurves(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const latestNominal = getGiltCurveLatestDate('nominal_spot')
  if (latestNominal && latestNominal >= today) {
    console.log(`[BoE YC] Yield curves are current (latest: ${latestNominal}). Skipping sync.`)
    return
  }

  console.log('[BoE YC] Starting yield curve sync...')
  const start = Date.now()
  let totalRows = 0

  for (const config of Object.values(YIELD_CURVE_URLS)) {
    try {
      totalRows += await fetchAndParseYieldCurve(config.url, config.spot, config.forward)
    } catch (err) {
      console.error(`[BoE YC] Error fetching ${config.spot}:`, err)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`[BoE YC] Sync complete: ${totalRows} points in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

// ── Historical backfill from archive ZIPs ────────────────────────────────────

function hasSubstantialHistory(): boolean {
  try {
    const row = db.prepare(
      `SELECT COUNT(DISTINCT date) as cnt FROM gilt_yield_curve WHERE curve_type = 'nominal_spot'`
    ).get() as { cnt: number }
    return row.cnt > 250
  } catch {
    return false
  }
}

async function downloadAndParseArchive(url: string, spotType: string, forwardType: string): Promise<number> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' },
  })

  if (!res.ok) {
    console.error(`[BoE YC Backfill] Failed to download: HTTP ${res.status}`)
    return 0
  }

  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  console.log(`[BoE YC Backfill] Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)}MB, extracting...`)

  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()

  let totalRows = 0
  const BATCH_SIZE = 50000

  for (const entry of entries) {
    const filename = entry.entryName
    if (!filename.match(/\.xlsx?$/i)) continue
    if (filename.startsWith('~') || filename.startsWith('.')) continue
    // Skip macOS resource fork files
    if (filename.includes('__MACOSX')) continue

    console.log(`[BoE YC Backfill] Parsing ${filename}...`)

    try {
      const fileBuffer = entry.getData()
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
      const rows = parseWorkbook(workbook, spotType, forwardType)

      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          storeGiltCurveData(rows.slice(i, i + BATCH_SIZE))
        }
        totalRows += rows.length
        console.log(`[BoE YC Backfill]   Stored ${rows.length} points from ${filename}`)
      }
    } catch (err) {
      console.error(`[BoE YC Backfill]   Error parsing ${filename}: ${err instanceof Error ? err.message : err}`)
    }
  }

  return totalRows
}

export async function backfillGiltYieldCurves(): Promise<void> {
  if (hasSubstantialHistory()) {
    console.log('[BoE YC Backfill] Historical data already present. Skipping. To force, clear gilt_yield_curve table.')
    return
  }

  console.log('[BoE YC Backfill] Starting historical backfill from BoE archive ZIPs...')
  console.log('[BoE YC Backfill] This will download ~100MB and may take several minutes.')
  const start = Date.now()

  let grandTotal = 0
  for (const [name, config] of Object.entries(ARCHIVE_URLS)) {
    try {
      console.log(`[BoE YC Backfill] Downloading ${name} archive...`)
      const count = await downloadAndParseArchive(config.url, config.spot, config.forward)
      grandTotal += count
    } catch (err) {
      console.error(`[BoE YC Backfill] Error processing ${name}:`, err)
    }
  }

  console.log(`[BoE YC Backfill] Complete: ${grandTotal} total points in ${((Date.now() - start) / 1000).toFixed(1)}s`)
}
