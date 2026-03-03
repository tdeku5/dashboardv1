import * as XLSX from 'xlsx'
import { upsertInvestorClassBatch, getInvestorClassCount, type InvestorClassRow } from './db'

// ── Constants ───────────────────────────────────────────────────────────────

const PAGE_URL = 'https://home.treasury.gov/data/investor-class-auction-allotments'
const BASE_URL = 'https://home.treasury.gov'

const HISTORICAL_COUPONS_URL =
  'https://home.treasury.gov/system/files/276/Website-PDO-4-A-Coupons-Jan-2000-Sep%202009.xls'

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert Excel serial date to YYYY-MM-DD */
function excelDateToISO(serial: number): string {
  // Excel epoch: 1900-01-01 = serial 1, but has the Lotus 123 leap year bug
  const epoch = new Date(Date.UTC(1899, 11, 30))
  const ms = epoch.getTime() + serial * 86_400_000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function normalizeSecType(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (s.includes('TIPS') || s.includes('TIP')) return 'TIPS'
  if (s.includes('FRN')) return 'FRN'
  if (s.includes('BOND')) return 'Bond'
  if (s.includes('NOTE')) return 'Note'
  if (s.includes('BILL')) return 'Bill'
  return raw.trim()
}

/** Find header row index by scanning for a row with "CUSIP" or "Issue" */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i]
    if (!row) continue
    const joined = row.map(c => String(c ?? '').toLowerCase()).join(' ')
    if (joined.includes('cusip') && joined.includes('issue')) return i
  }
  return -1
}

/** Flexible column name matching — returns the index for a target keyword */
function findCol(headerRow: unknown[], ...keywords: string[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] ?? '').replace(/\s+/g, ' ').toLowerCase()
    if (keywords.some(kw => cell.includes(kw))) return i
  }
  return -1
}

// ── Scrape Excel URLs ───────────────────────────────────────────────────────

async function scrapeRecentCouponsUrl(): Promise<string> {
  const res = await fetch(PAGE_URL)
  if (!res.ok) throw new Error(`Failed to fetch Treasury IC page: ${res.status}`)
  const html = await res.text()

  // Find href containing "IC-Coupons.xls" (case-insensitive)
  const match = html.match(/href="([^"]*IC-Coupons\.xls[^"]*)"/i)
  if (!match) throw new Error('Could not find recent coupons XLS link on Treasury page')

  const href = match[1]
  return href.startsWith('http') ? href : BASE_URL + href
}

// ── Download Excel ──────────────────────────────────────────────────────────

async function downloadExcel(url: string): Promise<Buffer> {
  console.log(`[investor-class] Downloading ${url.split('/').pop()}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

// ── Parse recent coupons file (Oct 2009–present) ───────────────────────────
// Columns: Issue date | Security type | Coupon rate | Cusip | Maturity date |
//          Total issue | Fed Reserve | Depository | Individuals | Dealers |
//          Pension | Investment | Foreign | Other
// Amounts in BILLIONS

function parseRecentCoupons(buf: Buffer, sourceFile: string): InvestorClassRow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]

  const hIdx = findHeaderRow(rows)
  if (hIdx < 0) throw new Error('Cannot find header row in recent coupons file')
  const hdr = rows[hIdx]

  const cIssue    = findCol(hdr, 'issue')
  const cType     = findCol(hdr, 'security type')
  const cCoupon   = findCol(hdr, 'coupon', 'spread')
  const cCusip    = findCol(hdr, 'cusip')
  const cMaturity = findCol(hdr, 'maturity')
  const cTotal    = findCol(hdr, 'total')
  const cFed      = findCol(hdr, 'federal', 'soma')
  const cDepo     = findCol(hdr, 'depository', 'depos')
  const cIndiv    = findCol(hdr, 'individ')
  const cDealers  = findCol(hdr, 'dealer')
  const cPension  = findCol(hdr, 'pension')
  const cInvest   = findCol(hdr, 'invest')
  const cForeign  = findCol(hdr, 'foreign')
  const cOther    = findCol(hdr, 'other')

  const results: InvestorClassRow[] = []

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r.length) continue

    const issueDateRaw = r[cIssue]
    const cusip = String(r[cCusip] ?? '').trim()
    if (!cusip || cusip.length < 5) continue  // skip blanks/footers
    if (typeof issueDateRaw !== 'number') continue  // skip non-date rows

    const issueDate = excelDateToISO(issueDateRaw)
    const matRaw = r[cMaturity]
    const maturityDate = typeof matRaw === 'number' ? excelDateToISO(matRaw) : null
    const secType = normalizeSecType(String(r[cType] ?? ''))

    // Amounts are in billions — convert to dollars
    const toBucks = (v: unknown) => {
      const n = parseNum(v)
      return n != null ? n * 1e9 : null
    }

    results.push({
      cusip,
      issueDate,
      securityType: secType,
      couponRate: parseNum(r[cCoupon]),
      maturityDate,
      totalIssueAmount:        toBucks(r[cTotal]),
      federalReserve:          toBucks(r[cFed]),
      depositoryInstitutions:  toBucks(r[cDepo]),
      individuals:             toBucks(r[cIndiv]),
      dealersAndBrokers:       toBucks(r[cDealers]),
      pensionAndRetirement:    toBucks(r[cPension]),
      investmentFunds:         toBucks(r[cInvest]),
      foreignAndInternational: toBucks(r[cForeign]),
      other:                   cOther >= 0 ? toBucks(r[cOther]) : null,
      sourceFile,
    })
  }

  return results
}

// ── Parse historical coupons file (Jan 2000–Sep 2009) ──────────────────────
// Columns: Issue date | Security type | Security term | Coupon rate | Cusip |
//          Maturity date | Total issue | Fed Reserve | Depository | Individuals |
//          Dealers | Pension | Investment | Foreign
// NOTE: amounts in MILLIONS, has extra "Security term" column, no "Other" column

function parseHistoricalCoupons(buf: Buffer, sourceFile: string): InvestorClassRow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]

  const hIdx = findHeaderRow(rows)
  if (hIdx < 0) throw new Error('Cannot find header row in historical coupons file')
  const hdr = rows[hIdx]

  const cIssue    = findCol(hdr, 'issue')
  const cType     = findCol(hdr, 'security type')
  const cCoupon   = findCol(hdr, 'coupon')
  const cCusip    = findCol(hdr, 'cusip')
  const cMaturity = findCol(hdr, 'maturity')
  const cTotal    = findCol(hdr, 'total')
  const cFed      = findCol(hdr, 'federal', 'soma')
  const cDepo     = findCol(hdr, 'depository', 'depos')
  const cIndiv    = findCol(hdr, 'individ')
  const cDealers  = findCol(hdr, 'dealer')
  const cPension  = findCol(hdr, 'pension')
  const cInvest   = findCol(hdr, 'invest')
  const cForeign  = findCol(hdr, 'foreign')

  const results: InvestorClassRow[] = []

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r.length) continue

    const issueDateRaw = r[cIssue]
    const cusip = String(r[cCusip] ?? '').trim()
    if (!cusip || cusip.length < 5) continue
    if (typeof issueDateRaw !== 'number') continue

    const issueDate = excelDateToISO(issueDateRaw)
    const matRaw = r[cMaturity]
    const maturityDate = typeof matRaw === 'number' ? excelDateToISO(matRaw) : null
    const secType = normalizeSecType(String(r[cType] ?? ''))

    // Amounts are in millions — convert to dollars
    const toBucks = (v: unknown) => {
      const n = parseNum(v)
      return n != null ? n * 1e6 : null
    }

    results.push({
      cusip,
      issueDate,
      securityType: secType,
      couponRate: parseNum(r[cCoupon]),
      maturityDate,
      totalIssueAmount:        toBucks(r[cTotal]),
      federalReserve:          toBucks(r[cFed]),
      depositoryInstitutions:  toBucks(r[cDepo]),
      individuals:             toBucks(r[cIndiv]),
      dealersAndBrokers:       toBucks(r[cDealers]),
      pensionAndRetirement:    toBucks(r[cPension]),
      investmentFunds:         toBucks(r[cInvest]),
      foreignAndInternational: toBucks(r[cForeign]),
      other:                   null,  // historical file has no "Other" column
      sourceFile,
    })
  }

  return results
}

// ── Public sync ─────────────────────────────────────────────────────────────

export async function syncInvestorClassData(): Promise<void> {
  console.log('[investor-class] Syncing investor class data…')
  let totalRecords = 0

  // 1. Historical coupons (Jan 2000–Sep 2009) — only if table is mostly empty
  const existingCount = getInvestorClassCount()
  if (existingCount < 100) {
    try {
      const buf = await downloadExcel(HISTORICAL_COUPONS_URL)
      const records = parseHistoricalCoupons(buf, 'historical-coupons-2000-2009')
      upsertInvestorClassBatch(records)
      totalRecords += records.length
      console.log(`[investor-class] Historical coupons: ${records.length} records`)
    } catch (err) {
      console.error(`[investor-class] Historical coupons ERROR: ${err instanceof Error ? err.message : err}`)
    }
  } else {
    console.log(`[investor-class] Skipping historical file (${existingCount} records already in DB)`)
  }

  // 2. Recent coupons (Oct 2009–present) — always fetch for latest data
  try {
    const recentUrl = await scrapeRecentCouponsUrl()
    const buf = await downloadExcel(recentUrl)
    const filename = recentUrl.split('/').pop() ?? 'recent-coupons'
    const records = parseRecentCoupons(buf, filename)
    upsertInvestorClassBatch(records)
    totalRecords += records.length
    console.log(`[investor-class] Recent coupons: ${records.length} records`)
  } catch (err) {
    console.error(`[investor-class] Recent coupons ERROR: ${err instanceof Error ? err.message : err}`)
  }

  const finalCount = getInvestorClassCount()
  console.log(`[investor-class] Sync complete — ${totalRecords} processed, ${finalCount} total in DB`)
}
