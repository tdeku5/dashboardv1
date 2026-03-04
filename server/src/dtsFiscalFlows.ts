// ── DTS Fiscal Flows: Cumulative Daily Net Fiscal Flows ──────────────────────
// Fetches Operating Cash Balance (Table I) and Public Debt Transactions
// (Table III-A) from the Fiscal Data API, computes (ΔTGA − ΔDebt) / 1000 per
// reporting day, then builds a CALENDAR-DAY series for each fiscal year
// (Oct 1 = day 1 through Sep 30 = day 365/366). Non-reporting days (weekends,
// holidays) get net_fiscal_flow = 0 and carry forward the previous cumulative.

import { db } from './db'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'
const DATA_START = '2005-10-01'

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

// ── Pagination helper ────────────────────────────────────────────────────────

async function fetchAllPages<T>(
  endpoint: string,
  fields: string,
  filter: string,
  label: string,
): Promise<T[]> {
  const all: T[] = []
  const pageSize = 10000

  const firstUrl =
    `${BASE}/${endpoint}?fields=${fields}&filter=${filter}` +
    `&sort=record_date&page[number]=1&page[size]=${pageSize}`
  const firstRes = await fetch(firstUrl)
  if (!firstRes.ok) throw new Error(`Fiscal API ${firstRes.status}: ${firstRes.statusText}`)
  const firstJson = (await firstRes.json()) as {
    data: T[]
    meta: { 'total-pages': number }
  }
  all.push(...firstJson.data)
  const totalPages = firstJson.meta['total-pages'] ?? 1
  console.log(`[dts] Fetching ${label} page 1/${totalPages}...`)

  for (let page = 2; page <= totalPages; page++) {
    if (page % 5 === 0 || page === totalPages)
      console.log(`[dts] Fetching ${label} page ${page}/${totalPages}...`)
    const url =
      `${BASE}/${endpoint}?fields=${fields}&filter=${filter}` +
      `&sort=record_date&page[number]=${page}&page[size]=${pageSize}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fiscal API ${res.status}: ${res.statusText}`)
    const json = (await res.json()) as { data: T[] }
    all.push(...json.data)
  }

  return all
}

// ── ΔTGA computation ─────────────────────────────────────────────────────────
// Period 1 (Oct 3 2005 – Sep 30 2021): "Federal Reserve Account"
//   ΔTGA_i = open(next reporting day) − open(this reporting day)
// Period 2 (Oct 1 2021 – Apr 15 2022): "Treasury General Account (TGA)"
//   ΔTGA_i = open(next reporting day) − open(this reporting day)
// Period 3 (Apr 18 2022 – present): 4-row format
//   ΔTGA_i = close(this day) − open(this day)

const PERIOD3_START = '2022-04-18'

function computeDeltaTGA(rows: OCBRow[]): Map<string, number> {
  const deltaTGA = new Map<string, number>()

  // Group by date
  const byDate = new Map<string, OCBRow[]>()
  for (const r of rows) {
    const arr = byDate.get(r.record_date) ?? []
    arr.push(r)
    byDate.set(r.record_date, arr)
  }

  const sortedDates = [...byDate.keys()].sort()

  // Collect Period 1&2 opening balances for forward differencing
  const openBals = new Map<string, number>()

  for (const [date, dayRows] of byDate) {
    if (date >= PERIOD3_START) {
      // Period 3: Opening Balance and Closing Balance rows
      // Both values are in open_today_bal (close_today_bal is always "null")
      const openRow = dayRows.find(
        (r) => r.account_type === 'Treasury General Account (TGA) Opening Balance',
      )
      const closeRow = dayRows.find(
        (r) => r.account_type === 'Treasury General Account (TGA) Closing Balance',
      )
      if (openRow && closeRow) {
        const closeBal = pf(closeRow.open_today_bal)
        const openBal = pf(openRow.open_today_bal)
        if (closeBal !== null && openBal !== null) {
          deltaTGA.set(date, closeBal - openBal)
        }
      }
    } else {
      // Period 1 & 2: extract TGA opening balance
      const tgaRow = dayRows.find(
        (r) =>
          r.account_type.includes('Federal Reserve Account') ||
          r.account_type.includes('Treasury General Account'),
      )
      if (tgaRow) {
        const val = pf(tgaRow.open_today_bal)
        if (val !== null) openBals.set(date, val)
      }
    }
  }

  // Forward differencing for Period 1 & 2:
  // ΔTGA(day_i) = open(day_{i+1}) − open(day_i)
  const p12Dates = sortedDates.filter((d) => d < PERIOD3_START && openBals.has(d))
  for (let i = 0; i < p12Dates.length - 1; i++) {
    deltaTGA.set(p12Dates[i], openBals.get(p12Dates[i + 1])! - openBals.get(p12Dates[i])!)
  }
  // Bridge last P1/P2 day to first P3 opening balance
  if (p12Dates.length > 0) {
    const lastP12 = p12Dates[p12Dates.length - 1]
    if (!deltaTGA.has(lastP12)) {
      const firstP3Date = sortedDates.find((d) => d >= PERIOD3_START)
      if (firstP3Date) {
        const p3Rows = byDate.get(firstP3Date)!
        const openRow = p3Rows.find(
          (r) => r.account_type === 'Treasury General Account (TGA) Opening Balance',
        )
        if (openRow) {
          const p3Open = pf(openRow.open_today_bal)
          if (p3Open !== null) {
            deltaTGA.set(lastP12, p3Open - openBals.get(lastP12)!)
          }
        }
      }
    }
  }

  return deltaTGA
}

// ── ΔDebt computation ────────────────────────────────────────────────────────
// Sum all Issues rows, subtract all Redemptions rows per date.
// Each row is a distinct security type line item (no summary/total rows exist).

function computeDeltaDebt(rows: PDTRow[]): Map<string, number> {
  const deltaDebt = new Map<string, number>()

  for (const r of rows) {
    const amt = pf(r.transaction_today_amt)
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

function pf(s: string): number | null {
  if (!s || s === 'null') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function toFiscalYear(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return m >= 10 ? y + 1 : y
}

/** Format YYYY-MM-DD from a Date using local time */
function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Generate every calendar date from start (inclusive) through end (inclusive) */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T12:00:00') // noon to avoid DST issues
  const last = new Date(end + 'T12:00:00')
  while (cur <= last) {
    dates.push(fmtDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// ── Main sync ────────────────────────────────────────────────────────────────

export async function syncDtsFiscalFlows(): Promise<void> {
  const lastRow = db
    .prepare('SELECT MAX(record_date) AS d FROM dts_fiscal_flows')
    .get() as { d: string | null }
  const isIncremental = lastRow?.d != null

  let fetchFrom = DATA_START
  if (isIncremental) {
    const last = new Date(lastRow.d!)
    last.setDate(last.getDate() - 14)
    fetchFrom = last.toISOString().slice(0, 10)
    console.log(`[dts] Incremental sync from ${fetchFrom} (last record: ${lastRow.d})`)
  } else {
    console.log(`[dts] Full sync from ${DATA_START}`)
    db.exec('DELETE FROM dts_fiscal_flows')
  }

  const t0 = Date.now()
  const filter = `record_date:gte:${fetchFrom}`

  const [ocbRows, pdtRows] = await Promise.all([
    fetchAllPages<OCBRow>(
      'v1/accounting/dts/operating_cash_balance',
      'record_date,account_type,open_today_bal,close_today_bal',
      filter,
      'OCB',
    ),
    fetchAllPages<PDTRow>(
      'v1/accounting/dts/public_debt_transactions',
      'record_date,transaction_type,transaction_today_amt',
      filter,
      'PDT',
    ),
  ])

  console.log(
    `[dts] Fetched ${ocbRows.length} OCB rows, ${pdtRows.length} PDT rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )

  const deltaTGA = computeDeltaTGA(ocbRows)
  const deltaDebt = computeDeltaDebt(pdtRows)

  // Build a set of all reporting dates (present in BOTH datasets)
  const reportingDates = new Set<string>()
  for (const d of deltaTGA.keys()) {
    if (deltaDebt.has(d)) reportingDates.add(d)
  }

  // Determine which fiscal years to build
  const today = fmtDate(new Date())
  const currentFY = toFiscalYear(today)
  const firstFY = 2006 // FY2006 starts Oct 1 2005
  const lastFY = currentFY

  // Build calendar-day series for each FY
  const upsert = db.prepare(`
    INSERT INTO dts_fiscal_flows
      (record_date, fiscal_year, day_index, net_fiscal_flow, cumulative_flow)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(record_date) DO UPDATE SET
      fiscal_year = excluded.fiscal_year,
      day_index = excluded.day_index,
      net_fiscal_flow = excluded.net_fiscal_flow,
      cumulative_flow = excluded.cumulative_flow
  `)

  let totalRows = 0

  db.transaction(() => {
    if (isIncremental) {
      // For incremental, delete the current FY entirely (cumulative depends on all prior days)
      // and any days in the overlap window from other FYs
      db.prepare('DELETE FROM dts_fiscal_flows WHERE fiscal_year = ?').run(currentFY)
      db.prepare(
        'DELETE FROM dts_fiscal_flows WHERE record_date >= ? AND fiscal_year != ?',
      ).run(fetchFrom, currentFY)
    }

    for (let fy = firstFY; fy <= lastFY; fy++) {
      // For incremental, skip completed FYs that aren't in the overlap window
      if (isIncremental && fy !== currentFY) {
        const fyStart = `${fy - 1}-10-01`
        const fyEnd = `${fy}-09-30`
        if (fyEnd < fetchFrom) continue // FY entirely before fetch window
      }

      const fyStart = `${fy - 1}-10-01`
      const fyEnd = fy === currentFY ? today : `${fy}-09-30`
      const days = dateRange(fyStart, fyEnd)

      let cumulative = 0
      let fyRows = 0

      for (let i = 0; i < days.length; i++) {
        const date = days[i]
        const dayIndex = i + 1

        let netFlow = 0
        if (reportingDates.has(date)) {
          const tga = deltaTGA.get(date) ?? 0
          const debt = deltaDebt.get(date) ?? 0
          netFlow = (tga - debt) / 1000 // millions → billions
        }

        cumulative += netFlow
        upsert.run(date, fy, dayIndex, netFlow, cumulative)
        fyRows++
      }

      totalRows += fyRows
      console.log(
        `[dts] FY${fy}: ${fyRows} days, final cumulative = ${cumulative.toFixed(1)}B`,
      )
    }
  })()

  console.log(
    `[dts] Stored ${totalRows} rows (FY${firstFY}–FY${lastFY}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
}
