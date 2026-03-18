// ── MTS Fiscal Balance: Cumulative Monthly Surplus/Deficit by Fiscal Year ────
// Fetches the Surplus (+) or Deficit (-) row from MTS Table 9, computes
// month_index (Oct=1 thru Sep=12), and stores cumulative sums per fiscal year.

import { db } from './db'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'
const DATA_START = '2015-10-01'

interface MtsRow {
  record_date: string
  current_month_rcpt_outly_amt: string
  record_fiscal_year: string
  record_calendar_month: string
  classification_desc?: string
  line_code_nbr: string
}

// ── Pagination helper ────────────────────────────────────────────────────────

async function fetchAllPages(
  filter: string,
): Promise<MtsRow[]> {
  const fields = [
    'record_date',
    'classification_desc',
    'line_code_nbr',
    'current_month_rcpt_outly_amt',
    'record_fiscal_year',
    'record_calendar_month',
  ].join(',')
  const all: MtsRow[] = []
  const pageSize = 10000

  const buildUrl = (page: number): string => {
    const url = new URL(`${BASE}/v1/accounting/mts/mts_table_9`)
    url.searchParams.set('fields', fields)
    url.searchParams.set('filter', filter)
    url.searchParams.set('sort', 'record_date')
    url.searchParams.set('page[number]', String(page))
    url.searchParams.set('page[size]', String(pageSize))
    return url.toString()
  }

  const firstRes = await fetch(buildUrl(1))
  if (!firstRes.ok) throw new Error(`MTS API ${firstRes.status}: ${firstRes.statusText}`)
  const firstJson = (await firstRes.json()) as {
    data: MtsRow[]
    meta: { 'total-pages': number }
  }
  all.push(...firstJson.data)
  const totalPages = firstJson.meta['total-pages'] ?? 1
  console.log(`[mts] Fetching page 1/${totalPages}...`)

  for (let page = 2; page <= totalPages; page++) {
    console.log(`[mts] Fetching page ${page}/${totalPages}...`)
    const res = await fetch(buildUrl(page))
    if (!res.ok) throw new Error(`MTS API ${res.status}: ${res.statusText}`)
    const json = (await res.json()) as { data: MtsRow[] }
    all.push(...json.data)
  }

  return all
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Calendar month (1-12) → fiscal month index (Oct=1 .. Sep=12) */
function calMonthToFiscalIndex(calMonth: number): number {
  return calMonth >= 10 ? calMonth - 9 : calMonth + 3
}

function fiscalYearStart(date: Date): string {
  const year = date.getUTCMonth() >= 9 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
  return `${year}-10-01`
}

// ── Main sync ────────────────────────────────────────────────────────────────

export async function syncMtsFiscalBalance(): Promise<void> {
  const lastRow = db
    .prepare('SELECT MAX(record_date) AS d FROM mts_fiscal_balance')
    .get() as { d: string | null }
  const isIncremental = lastRow?.d != null

  let fetchFrom = DATA_START
  if (isIncremental) {
    fetchFrom = fiscalYearStart(new Date(lastRow.d!))
    console.log(`[mts] Incremental sync from FY start ${fetchFrom} (last record: ${lastRow.d})`)
  } else {
    console.log(`[mts] Full sync from ${DATA_START}`)
  }

  const t0 = Date.now()
  const filter = `record_date:gte:${fetchFrom}`
  const rows = await fetchAllPages(filter)
  console.log(`[mts] Fetched ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const byFY = new Map<number, { record_date: string; amount: number; calMonth: number }[]>()

  const surplusRows = rows.filter(
    (r) => r.classification_desc === 'Surplus (+) or Deficit (-)',
  )

  if (surplusRows.length > 0) {
    console.log(`[mts] Using direct surplus/deficit rows (${surplusRows.length})`)
    for (const r of surplusRows) {
      const fy = parseInt(r.record_fiscal_year, 10)
      const calMonth = parseInt(r.record_calendar_month, 10)
      const amount = parseFloat(r.current_month_rcpt_outly_amt)
      if (isNaN(fy) || isNaN(calMonth) || isNaN(amount)) continue
      if (!byFY.has(fy)) byFY.set(fy, [])
      byFY.get(fy)!.push({
        record_date: r.record_date,
        amount,
        calMonth,
      })
    }
  } else {
    console.warn('[mts] Direct surplus/deficit rows not returned by API; falling back to receipts minus outlays totals')
    const byDate = new Map<string, {
      fiscalYear: number
      calMonth: number
      receipts?: number
      outlays?: number
    }>()

    for (const r of rows) {
      const fy = parseInt(r.record_fiscal_year, 10)
      const calMonth = parseInt(r.record_calendar_month, 10)
      const amount = parseFloat(r.current_month_rcpt_outly_amt)
      if (isNaN(fy) || isNaN(calMonth) || isNaN(amount)) continue
      if (r.classification_desc !== 'Total') continue
      if (r.line_code_nbr !== '120' && r.line_code_nbr !== '340') continue

      const existing = byDate.get(r.record_date) ?? { fiscalYear: fy, calMonth }
      if (r.line_code_nbr === '120') existing.receipts = amount
      if (r.line_code_nbr === '340') existing.outlays = amount
      byDate.set(r.record_date, existing)
    }

    for (const [recordDate, totals] of byDate) {
      if (totals.receipts == null || totals.outlays == null) continue
      if (!byFY.has(totals.fiscalYear)) byFY.set(totals.fiscalYear, [])
      byFY.get(totals.fiscalYear)!.push({
        record_date: recordDate,
        amount: totals.receipts - totals.outlays,
        calMonth: totals.calMonth,
      })
    }
  }

  // Sort each FY's entries by record_date
  for (const entries of byFY.values()) {
    entries.sort((a, b) => a.record_date.localeCompare(b.record_date))
  }

  const upsert = db.prepare(`
    INSERT INTO mts_fiscal_balance
      (record_date, fiscal_year, month_index, monthly_amount, cumulative)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(record_date) DO UPDATE SET
      fiscal_year = excluded.fiscal_year,
      month_index = excluded.month_index,
      monthly_amount = excluded.monthly_amount,
      cumulative = excluded.cumulative
  `)

  let totalRows = 0

  db.transaction(() => {
    if (isIncremental) {
      // Delete FYs that overlap with fetched data so cumulative sums are correct
      const fetchedFYs = [...byFY.keys()]
      for (const fy of fetchedFYs) {
        db.prepare('DELETE FROM mts_fiscal_balance WHERE fiscal_year = ?').run(fy)
      }
    }

    for (const [fy, entries] of byFY) {
      let cumulative = 0
      for (const e of entries) {
        const monthIndex = calMonthToFiscalIndex(e.calMonth)
        cumulative += e.amount
        upsert.run(e.record_date, fy, monthIndex, e.amount, cumulative)
        totalRows++
      }
      console.log(`[mts] FY${fy}: ${entries.length} months, final cumulative = ${(cumulative / 1e6).toFixed(1)}M`)
    }
  })()

  console.log(`[mts] Stored ${totalRows} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

// ── Getter ───────────────────────────────────────────────────────────────────

interface BalanceRow {
  record_date: string
  fiscal_year: number
  month_index: number
  monthly_amount: number
  cumulative: number
}

export function getMtsFiscalBalance(): {
  fiscalYears: Record<string, { record_date: string; month_index: number; monthly_amount: number; cumulative: number }[]>
  lastUpdated: string | null
} {
  const rows = db
    .prepare(
      `SELECT record_date, fiscal_year, month_index, monthly_amount, cumulative
       FROM mts_fiscal_balance
       ORDER BY fiscal_year, month_index`,
    )
    .all() as BalanceRow[]

  const fiscalYears: Record<
    string,
    { record_date: string; month_index: number; monthly_amount: number; cumulative: number }[]
  > = {}

  for (const r of rows) {
    const fy = String(r.fiscal_year)
    if (!fiscalYears[fy]) fiscalYears[fy] = []
    fiscalYears[fy].push({
      record_date: r.record_date,
      month_index: r.month_index,
      monthly_amount: r.monthly_amount,
      cumulative: r.cumulative,
    })
  }

  const lastUpdated =
    (db.prepare('SELECT MAX(record_date) AS d FROM mts_fiscal_balance').get() as { d: string | null }).d

  return { fiscalYears, lastUpdated }
}
