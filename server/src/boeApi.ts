import { storeBoeObservations, upsertBoeSeriesMeta } from './db'

const BOE_BASE = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp'

const MONTH_MAP: Record<string, string> = {
  'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
  'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
  'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
}

// Parse BoE date "DD Mon YYYY" → "YYYY-MM-DD"
function parseBoeDate(dateStr: string): string | null {
  const parts = dateStr.trim().split(' ')
  if (parts.length !== 3) return null
  const [day, mon, year] = parts
  const m = MONTH_MAP[mon]
  if (!m) return null
  return `${year}-${m}-${day.padStart(2, '0')}`
}

/**
 * Fetch one or more BoE IADB series via the CSV endpoint.
 * Can batch up to ~300 codes in a single request.
 * Daily series are fetched from 2000; monthly from 1960.
 */
export async function fetchBoeSeries(
  seriesCodes: string[],
  opts: { dateFrom?: string } = {}
): Promise<Record<string, Array<{ date: string; value: number }>>> {
  const codes = seriesCodes.map(c => c.toUpperCase())
  const dateFrom = opts.dateFrom || '01/Jan/2000'

  const params = new URLSearchParams({
    'csv.x': 'yes',
    'Datefrom': dateFrom,
    'Dateto': '01/Dec/2026',
    'SeriesCodes': codes.join(','),
    'CSVF': 'TN',
    'UsingCodes': 'Y',
    'VPD': 'Y',
    'VFD': 'N',
  })

  const url = `${BOE_BASE}?${params.toString()}`
  console.log(`[BoE] Fetching ${codes.length} series: ${codes.slice(0, 5).join(',')}${codes.length > 5 ? '...' : ''}`)

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)',
    },
  })

  if (!res.ok) {
    console.error(`[BoE] Failed: ${res.status} ${res.statusText}`)
    return {}
  }

  const csvText = await res.text()
  const lines = csvText.split('\n').filter(l => l.trim().length > 0)

  if (lines.length < 2) {
    console.warn('[BoE] No data rows returned')
    return {}
  }

  // Parse header row — first column is DATE, rest are series codes
  const headerLine = lines[0]
  const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, '').toUpperCase())

  // Determine if first row is a header or data
  // If first cell parses as a date, there's no header — use request codes as headers
  let dataStartIdx = 1
  let columnCodes: string[]

  const firstCellDate = parseBoeDate(headers[0])
  if (firstCellDate) {
    // No header row — first row is data. Use request codes as column names.
    dataStartIdx = 0
    columnCodes = codes
  } else {
    // Header row present — extract column codes (skip DATE column)
    columnCodes = headers.slice(1)
    dataStartIdx = 1
  }

  const results: Record<string, Array<{ date: string; value: number }>> = {}
  for (const code of columnCodes) {
    results[code] = []
  }

  for (let i = dataStartIdx; i < lines.length; i++) {
    // Handle CSV cells that might be quoted
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''))
    if (cols.length < 2) continue

    const date = parseBoeDate(cols[0])
    if (!date) continue

    for (let j = 1; j < cols.length && j - 1 < columnCodes.length; j++) {
      const code = columnCodes[j - 1]
      const rawVal = cols[j]

      if (rawVal === '' || rawVal === '..' || rawVal === 'null' || !rawVal) continue

      const num = parseFloat(rawVal.replace(/,/g, ''))
      if (isNaN(num)) continue

      if (results[code]) {
        results[code].push({ date, value: num })
      }
    }
  }

  // Store in SQLite
  for (const [code, obs] of Object.entries(results)) {
    if (obs.length > 0) {
      storeBoeObservations(code, obs)
      upsertBoeSeriesMeta(code, { frequency: 'auto' })
      console.log(`[BoE] Stored ${obs.length} observations for ${code}`)
    }
  }

  return results
}
