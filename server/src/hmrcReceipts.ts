import * as XLSX from 'xlsx'
import { storeHmrcReceipts } from './db'

// HMRC tax receipts and National Insurance contributions for the UK.
// Monthly cash receipts by tax head (£ million), monthly rows from April 2017.
// The ODS asset URL changes each release, so we scrape the stable landing page
// for the current attachment (same pattern as onsMonthlyGDPContribs.ts).

const LANDING_PAGE = 'https://www.gov.uk/government/statistics/hmrc-tax-and-nics-receipts-for-the-uk'
const RECEIPTS_SHEET = 'Receipts_Monthly'

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

/** "June 2017" → "2017-06-01" */
function parseMonthYear(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(v.trim())
  if (!m) return null
  const mm = MONTHS[m[1].toLowerCase()]
  if (!mm) return null
  return `${m[2]}-${mm}-01`
}

async function findOdsUrl(): Promise<string> {
  const res = await fetch(LANDING_PAGE)
  if (!res.ok) throw new Error(`[HMRC] Landing page fetch failed: ${res.status}`)
  const html = await res.text()
  const m = /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.ods)"/.exec(html)
  if (!m) throw new Error('[HMRC] No .ods attachment found on landing page — layout may have changed')
  return m[1]
}

export async function syncHmrcReceipts(): Promise<void> {
  const url = await findOdsUrl()
  console.log(`[HMRC] Downloading ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[HMRC] ODS download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[RECEIPTS_SHEET]
  if (!ws) {
    throw new Error(`[HMRC] Sheet "${RECEIPTS_SHEET}" not found (sheets: ${wb.SheetNames.join(', ')})`)
  }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]

  // Header row: first cell starts "Table 1 HMRC Receipts by month", rest are tax heads.
  const headerIdx = rows.findIndex(r =>
    typeof r?.[0] === 'string' && (r[0] as string).startsWith('Table 1 HMRC Receipts by month')
  )
  if (headerIdx < 0) throw new Error('[HMRC] Header row not found in Receipts_Monthly — layout may have changed')

  const taxHeads = (rows[headerIdx].slice(1) as unknown[]).map(h => String(h ?? '').trim())
  const out: Array<{ taxHead: string; date: string; value: number }> = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const date = parseMonthYear(row?.[0])
    if (!date) continue // skips blank rows and the "End of worksheet" marker
    for (let c = 0; c < taxHeads.length; c++) {
      const head = taxHeads[c]
      if (!head) continue
      const v = row[c + 1]
      if (typeof v === 'number' && isFinite(v)) {
        out.push({ taxHead: head, date, value: v })
      }
      // non-numeric cells ([X] markers etc.) are intentionally dropped
    }
  }

  if (out.length === 0) throw new Error('[HMRC] Parsed zero observations from Receipts_Monthly')

  storeHmrcReceipts(out)
  const months = new Set(out.map(o => o.date))
  const latest = [...months].sort().pop()
  console.log(`[HMRC] Stored ${out.length} observations across ${taxHeads.filter(Boolean).length} tax heads, ${months.size} months; latest ${latest}`)
}
