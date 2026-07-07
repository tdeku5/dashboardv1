import * as XLSX from 'xlsx'
import { storePayeRti } from './db'

// Earnings and employment from PAYE RTI (HMRC/ONS), UK-level, seasonally
// adjusted. The reference-table xlsx URL changes each release, so we scrape
// the ONS dataset landing page for the current file (same pattern as
// onsMonthlyGDPContribs.ts). Monthly from July 2014.

const DATASET_PAGE =
  'https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/realtimeinformationstatisticsreferencetableseasonallyadjusted'
const ONS_WEB = 'https://www.ons.gov.uk'

// Sheet name → stored metric. Values are monthly, UK, all industries, SA.
const SHEET_METRICS: Array<{ sheet: string; metric: string; valueHeader: string }> = [
  { sheet: '1. Payrolled employees (UK)', metric: 'payrolled_employees', valueHeader: 'Payrolled employees' },
  { sheet: '2. Median pay (UK)',          metric: 'median_pay',          valueHeader: 'Median pay' },
  { sheet: '3. Mean pay (UK)',            metric: 'mean_pay',            valueHeader: 'Mean pay' },
  { sheet: '4. Aggregate pay (UK)',       metric: 'aggregate_pay',       valueHeader: 'Aggregate pay' },
]

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

/** "July 2014" → "2014-07-01" */
function parseMonthYear(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(v.trim())
  if (!m) return null
  const mm = MONTHS[m[1].toLowerCase()]
  if (!mm) return null
  return `${m[2]}-${mm}-01`
}

async function findXlsxUrl(): Promise<string> {
  const res = await fetch(DATASET_PAGE)
  if (!res.ok) throw new Error(`[PAYE-RTI] Dataset page fetch failed: ${res.status}`)
  const html = await res.text()
  // Current release link looks like /file?uri=/employmentandlabourmarket/.../current/rtisajun2026.xlsx
  const m = /href="(\/file\?uri=[^"]*\/current\/[^"]*\.xlsx)"/.exec(html)
  if (!m) throw new Error('[PAYE-RTI] No current .xlsx link found on dataset page — layout may have changed')
  return ONS_WEB + m[1]
}

export async function syncPayeRti(): Promise<void> {
  const url = await findXlsxUrl()
  console.log(`[PAYE-RTI] Downloading ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[PAYE-RTI] xlsx download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })

  const out: Array<{ metric: string; date: string; value: number }> = []

  for (const { sheet, metric, valueHeader } of SHEET_METRICS) {
    const ws = wb.Sheets[sheet]
    if (!ws) {
      throw new Error(`[PAYE-RTI] Sheet "${sheet}" not found (sheets: ${wb.SheetNames.slice(0, 8).join(', ')}…)`)
    }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]

    // Header row: ["Date", "<valueHeader>", ...]
    const headerIdx = rows.findIndex(r => r?.[0] === 'Date' && typeof r?.[1] === 'string')
    if (headerIdx < 0) throw new Error(`[PAYE-RTI] Header row not found in sheet "${sheet}"`)
    const header1 = String(rows[headerIdx][1])
    if (header1 !== valueHeader) {
      console.warn(`[PAYE-RTI] Sheet "${sheet}" value column is "${header1}" (expected "${valueHeader}") — ingesting anyway`)
    }

    let count = 0
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const date = parseMonthYear(rows[i]?.[0])
      const v = rows[i]?.[1]
      if (date && typeof v === 'number' && isFinite(v)) {
        out.push({ metric, date, value: v })
        count++
      }
    }
    if (count === 0) throw new Error(`[PAYE-RTI] Parsed zero observations from sheet "${sheet}"`)
    console.log(`[PAYE-RTI] ${metric}: ${count} months`)
  }

  storePayeRti(out)
  const latest = out.map(o => o.date).sort().pop()
  console.log(`[PAYE-RTI] Stored ${out.length} observations across ${SHEET_METRICS.length} metrics; latest ${latest}`)
}
