import * as XLSX from 'xlsx'
import { db } from './db'

// The NY Fed RDE page loads data via a JavaScript framework (pilot).
// The direct download URL is not discoverable from the HTML.
// We try known medialibrary patterns and the page's script-loaded data endpoints.
const CANDIDATE_URLS = [
  // Direct medialibrary patterns (case-sensitive)
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/RDE-chart-data.xlsx',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/chart-data.xlsx',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/data.xlsx',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/rde_data.xlsx',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/RDE_data.xlsx',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/data.csv',
  'https://www.newyorkfed.org/medialibrary/Research/Interactives/Data/elasticity/rde.csv',
]

async function findDownloadUrl(): Promise<string | null> {
  // First try: scan the page HTML for any download links we might have missed
  try {
    const pageResp = await fetch('https://www.newyorkfed.org/research/reserve-demand-elasticity')
    if (pageResp.ok) {
      const html = await pageResp.text()
      const fileLinks = [...html.matchAll(/href="([^"]*\.(?:xlsx|csv|xls))"/gi)]
      if (fileLinks.length > 0) {
        const rawUrl = fileLinks[0][1]
        const url = rawUrl.startsWith('http') ? rawUrl : `https://www.newyorkfed.org${rawUrl}`
        console.log('[rde] Found download link on page:', url)
        return url
      }
    }
  } catch (err) {
    console.log('[rde] Could not fetch page:', err instanceof Error ? err.message : String(err))
  }

  // Second try: probe candidate URLs
  for (const url of CANDIDATE_URLS) {
    try {
      const resp = await fetch(url)
      const ct = resp.headers.get('content-type') || ''
      if (resp.ok && !ct.includes('text/html')) {
        console.log('[rde] Found working URL:', url, 'Content-Type:', ct)
        return url
      }
      // NY Fed returns 200 + text/html for 404 pages, so check content-type
    } catch {
      // skip
    }
  }

  return null
}

interface RDERecord {
  date: string
  median: number | null
  p16: number | null
  p84: number | null
  p2_5: number | null
  p97_5: number | null
}

function parseExcel(buffer: ArrayBuffer): RDERecord[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  console.log('[rde] Excel sheets:', workbook.SheetNames.join(', '))

  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  if (rows.length < 2) return []
  console.log('[rde] Headers:', rows[0])
  if (rows.length > 1) console.log('[rde] Row 1:', rows[1])
  if (rows.length > 2) console.log('[rde] Row 2:', rows[2])

  const toNum = (v: unknown): number | null => (typeof v === 'number' && !isNaN(v)) ? v : null

  const records: RDERecord[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row[0]) continue

    let date: string
    if (typeof row[0] === 'number') {
      const d = XLSX.SSF.parse_date_code(row[0])
      date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    } else {
      const d = new Date(String(row[0]))
      if (isNaN(d.getTime())) continue
      date = d.toISOString().slice(0, 10)
    }

    records.push({
      date,
      median: toNum(row[1]),
      p16: toNum(row[2]),
      p84: toNum(row[3]),
      p2_5: toNum(row[4]),
      p97_5: toNum(row[5]),
    })
  }
  return records
}

function parseCsv(text: string): RDERecord[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  console.log('[rde] CSV headers:', headers)

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim())
    const parseNum = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : n }
    return {
      date: cols[0] || '',
      median: parseNum(cols[1]),
      p16: parseNum(cols[2]),
      p84: parseNum(cols[3]),
      p2_5: parseNum(cols[4]),
      p97_5: parseNum(cols[5]),
    }
  }).filter((r) => r.date)
}

export async function syncRDE(): Promise<{ total: number; newRows: number }> {
  console.log('[rde] Starting sync...')

  const downloadUrl = await findDownloadUrl()
  if (!downloadUrl) {
    console.log('[rde] No download URL found. The NY Fed RDE data is loaded via JavaScript and')
    console.log('[rde] may not have a static download link. The chart will show "No data" until')
    console.log('[rde] a working download URL is identified.')
    return { total: 0, newRows: 0 }
  }

  console.log('[rde] Downloading from:', downloadUrl)
  const fileResponse = await fetch(downloadUrl)
  if (!fileResponse.ok) throw new Error(`Failed to download RDE data: ${fileResponse.status}`)

  const buffer = await fileResponse.arrayBuffer()
  const ct = fileResponse.headers.get('content-type') || ''

  let records: RDERecord[]
  if (ct.includes('csv') || downloadUrl.endsWith('.csv')) {
    records = parseCsv(new TextDecoder().decode(buffer))
  } else {
    records = parseExcel(buffer)
  }

  console.log(`[rde] Parsed ${records.length} records`)
  if (records.length > 0) {
    console.log('[rde] Sample:', records[0])
    console.log('[rde] Latest:', records[records.length - 1])
  }

  if (records.length === 0) {
    console.log('[rde] No valid records parsed from the file')
    return { total: 0, newRows: 0 }
  }

  const latestBefore = db.prepare('SELECT MAX(date) as latest FROM rde_estimates').get() as { latest: string | null } | undefined

  const stmt = db.prepare(`
    INSERT INTO rde_estimates (date, median, p16, p84, p2_5, p97_5)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      median = excluded.median, p16 = excluded.p16, p84 = excluded.p84,
      p2_5 = excluded.p2_5, p97_5 = excluded.p97_5
  `)

  db.transaction(() => {
    for (const r of records) {
      if (r.date && r.median != null) {
        stmt.run(r.date, r.median, r.p16, r.p84, r.p2_5, r.p97_5)
      }
    }
  })()

  const newRows = latestBefore?.latest
    ? records.filter((r) => r.date > latestBefore.latest!).length
    : records.length

  console.log(`[rde] Sync complete. ${records.length} total upserted, ~${newRows} new`)
  return { total: records.length, newRows }
}
