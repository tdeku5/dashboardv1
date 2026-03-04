// ── Fiscal Data: Cumulative Daily Net Fiscal Flows ──────────────────────────
// Uses the Fiscal Data API (api.fiscaldata.treasury.gov) to fetch:
//   1. Operating Cash Balance (OCB) — TGA balances
//   2. Public Debt Transactions (PDT) — debt issues & redemptions
// Computes daily ΔTGA - ΔDebt = net fiscal flow, then cumulative by fiscal year.

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'

// Start from FY2016 (Oct 1, 2015)
const START_DATE = '2015-10-01'
// OCB needs a few days earlier so the open-open formula has a "previous day" for 10/1/2015
const OCB_START_DATE = '2015-09-28'

// ── Types ────────────────────────────────────────────────────────────────────

interface OCBRow {
  record_date: string
  account_type: string
  open_today_bal: string
  close_today_bal: string
}

interface PDTRow {
  record_date: string
  transaction_type: string
  transaction_today_amt: string
}

interface DayFlow {
  date: string
  dayOfFY: number
  dailyFlow: number
  cumulative: number
}

export interface FiscalResult {
  data: Record<string, DayFlow[]>
}

// ── In-memory cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

let cachedResult: FiscalResult | null = null
let cachedAt = 0

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchAllPages<T>(endpoint: string, fields: string, filter: string): Promise<T[]> {
  const all: T[] = []
  let page = 1
  const pageSize = 10000

  while (true) {
    const url = `${BASE}/${endpoint}?fields=${fields}&filter=${filter}&sort=record_date&page[number]=${page}&page[size]=${pageSize}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fiscal API ${res.status}: ${res.statusText}`)
    const json = await res.json() as { data: T[]; meta: { 'total-pages': number } }
    all.push(...json.data)

    const totalPages = json.meta['total-pages'] ?? 1
    if (page >= totalPages) break
    page++
  }

  return all
}

// ── OCB → daily ΔTGA ────────────────────────────────────────────────────────
// Era 1 & 2 (pre-Apr 18, 2022): ΔTGA_i = Opening_Balance_i - Opening_Balance_(i-1)
// Era 3 (Apr 18, 2022+): ΔTGA_i = Closing_Balance_i - Opening_Balance_i (same day)

function computeDeltaTGA(rows: OCBRow[]): Map<string, number> {
  const deltaTGA = new Map<string, number>()

  // Group rows by date
  const byDate = new Map<string, OCBRow[]>()
  for (const r of rows) {
    const arr = byDate.get(r.record_date) ?? []
    arr.push(r)
    byDate.set(r.record_date, arr)
  }

  // Sort dates for consecutive-day iteration (needed for Era 1 & 2)
  const sortedDates = [...byDate.keys()].sort()

  // First pass: handle Era 3 and collect Era 1/2 opening balances
  const era12OpenBals = new Map<string, number>()

  for (const [date, dayRows] of byDate) {
    // Era 3: separate Opening/Closing Balance rows
    const openingRow = dayRows.find(r => r.account_type === 'Treasury General Account (TGA) Opening Balance')
    const closingRow = dayRows.find(r => r.account_type === 'Treasury General Account (TGA) Closing Balance')
    if (openingRow && closingRow) {
      const closeBal = parseNum(closingRow.open_today_bal)
      const openBal = parseNum(openingRow.open_today_bal)
      if (closeBal !== null && openBal !== null) {
        deltaTGA.set(date, closeBal - openBal)
      }
      continue
    }

    // Era 1 & 2: store opening balance for day-over-day computation
    const tgaRow = dayRows.find(r =>
      r.account_type === 'Federal Reserve Account' ||
      r.account_type === 'Treasury General Account (TGA)'
    )
    if (tgaRow) {
      const openVal = parseNum(tgaRow.open_today_bal)
      if (openVal !== null) {
        era12OpenBals.set(date, openVal)
      }
    }
  }

  // Second pass: compute ΔTGA for Era 1 & 2 using consecutive opening balances
  for (let i = 1; i < sortedDates.length; i++) {
    const date = sortedDates[i]
    if (deltaTGA.has(date)) continue // Already computed (Era 3)

    const prevDate = sortedDates[i - 1]
    const todayOpen = era12OpenBals.get(date)
    const prevOpen = era12OpenBals.get(prevDate)

    if (todayOpen !== undefined && prevOpen !== undefined) {
      deltaTGA.set(date, todayOpen - prevOpen)
    }
  }

  return deltaTGA
}

// ── PDT → daily ΔDebt ───────────────────────────────────────────────────────

function computeDeltaDebt(rows: PDTRow[]): Map<string, number> {
  const deltaDebt = new Map<string, number>()

  for (const r of rows) {
    const amt = parseNum(r.transaction_today_amt)
    if (amt === null) continue

    const prev = deltaDebt.get(r.record_date) ?? 0

    if (r.transaction_type === 'Issues') {
      deltaDebt.set(r.record_date, prev + amt)
    } else if (r.transaction_type === 'Redemptions') {
      deltaDebt.set(r.record_date, prev - amt)
    }
  }

  return deltaDebt
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(s: string): number | null {
  if (!s || s === 'null') return null
  const n = Number(s)
  return isNaN(n) ? null : n
}

/** Fiscal year for a given date: Oct-Dec → next year, Jan-Sep → same year */
function fiscalYear(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return m >= 10 ? y + 1 : y
}

/** Day-of-fiscal-year (1-indexed). Oct 1 = day 1. */
function dayOfFiscalYear(dateStr: string): number {
  const [y, m, day] = dateStr.split('-').map(Number)
  const fy = m >= 10 ? y + 1 : y
  // Both dates in local time to avoid UTC vs local mismatch
  const fyStart = new Date(fy - 1, 9, 1) // Oct 1 of previous calendar year
  const d = new Date(y, m - 1, day)
  return Math.round((d.getTime() - fyStart.getTime()) / 86400000) + 1
}

// ── Main computation ─────────────────────────────────────────────────────────

export async function getCumulativeFiscalFlows(): Promise<FiscalResult> {
  // Check cache
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult
  }

  try {
    console.log('[fiscal] Fetching OCB and PDT data from Fiscal Data API…')
    const t0 = Date.now()

    const ocbFilter = `record_date:gte:${OCB_START_DATE}`
    const pdtFilter = `record_date:gte:${START_DATE}`

    const [ocbRows, pdtRows] = await Promise.all([
      fetchAllPages<OCBRow>(
        'v1/accounting/dts/operating_cash_balance',
        'record_date,account_type,open_today_bal,close_today_bal',
        ocbFilter
      ),
      fetchAllPages<PDTRow>(
        'v1/accounting/dts/public_debt_transactions',
        'record_date,transaction_type,transaction_today_amt',
        pdtFilter
      ),
    ])

    console.log(`[fiscal] Fetched ${ocbRows.length} OCB rows, ${pdtRows.length} PDT rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

    const deltaTGA = computeDeltaTGA(ocbRows)
    const deltaDebt = computeDeltaDebt(pdtRows)

    // Collect all unique dates, sorted — exclude pre-FY2016 dates from OCB lookback
    const allDates = [...new Set([...deltaTGA.keys(), ...deltaDebt.keys()])]
      .filter(d => d >= START_DATE)
      .sort()

    // Group by fiscal year and compute cumulative
    const fyData: Record<string, DayFlow[]> = {}

    for (const date of allDates) {
      const tga = deltaTGA.get(date) ?? 0
      const debt = deltaDebt.get(date) ?? 0
      const dailyFlow = tga - debt // positive = surplus, negative = deficit

      const fy = String(fiscalYear(date))
      if (!fyData[fy]) fyData[fy] = []

      const arr = fyData[fy]
      const prevCum = arr.length > 0 ? arr[arr.length - 1].cumulative : 0

      arr.push({
        date,
        dayOfFY: dayOfFiscalYear(date),
        dailyFlow,
        cumulative: prevCum + dailyFlow,
      })
    }

    const result: FiscalResult = { data: fyData }
    cachedResult = result
    cachedAt = Date.now()

    console.log(`[fiscal] Computed cumulative flows for FYs: ${Object.keys(fyData).join(', ')}`)
    return result
  } catch (err) {
    // If we have stale cache, serve it rather than failing
    if (cachedResult) {
      console.warn('[fiscal] Fetch failed, serving stale cache:', err instanceof Error ? err.message : err)
      return cachedResult
    }
    throw err
  }
}
