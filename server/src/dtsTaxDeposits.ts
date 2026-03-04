// ── DTS Tax Deposits: Withheld Income & Employment Tax Receipts ─────────────
// Fetches deposits from Table II of the Daily Treasury Statement via the Fiscal
// Data API, stores daily records in SQLite, then aggregates into 12 rolling
// periods anchored to the last Friday of February.

import { db } from './db'

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service'

// DTS Table II adopted the new category breakdown on 2023-02-14
const DATA_START = '2023-02-14'

// The DTS Table II category name for withheld taxes (new format, 2023-02-14+)
const WITHHELD_CATG = 'Taxes - Withheld Individual/FICA'

// ── Types ────────────────────────────────────────────────────────────────────

interface DepositRow {
  record_date: string
  transaction_type: string
  transaction_catg: string
  transaction_today_amt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url)
    if (res.ok) return res
    if (res.status === 503 && i < retries) {
      const wait = (i + 1) * 15_000
      console.log(`[tax-deposits] 503 — retrying in ${wait / 1000}s (attempt ${i + 2}/${retries + 1})…`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    throw new Error(`Fiscal API ${res.status}: ${res.statusText}`)
  }
  throw new Error('Unreachable')
}

async function fetchAllPages(
  endpoint: string,
  fields: string,
  filter: string,
  label: string,
): Promise<DepositRow[]> {
  const all: DepositRow[] = []
  const pageSize = 10000

  const firstUrl =
    `${BASE}/${endpoint}?fields=${fields}&filter=${filter}` +
    `&sort=record_date&page[number]=1&page[size]=${pageSize}`
  const firstRes = await fetchWithRetry(firstUrl)
  const firstJson = (await firstRes.json()) as {
    data: DepositRow[]
    meta: { 'total-pages': number }
  }
  all.push(...firstJson.data)
  const totalPages = firstJson.meta['total-pages'] ?? 1
  console.log(`[tax-deposits] Fetching ${label} page 1/${totalPages}...`)

  for (let page = 2; page <= totalPages; page++) {
    if (page % 5 === 0 || page === totalPages)
      console.log(`[tax-deposits] Fetching ${label} page ${page}/${totalPages}...`)
    const url =
      `${BASE}/${endpoint}?fields=${fields}&filter=${filter}` +
      `&sort=record_date&page[number]=${page}&page[size]=${pageSize}`
    const res = await fetchWithRetry(url)
    const json = (await res.json()) as { data: DepositRow[] }
    all.push(...json.data)
  }

  return all
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncDtsTaxDeposits(): Promise<void> {
  // Migrate: if the table has rows with wrong deposit types (from the old
  // broad fetch that pulled ALL deposit categories), clear everything so we
  // re-fetch only the withheld category with the tighter filter.
  const otherTypes = db
    .prepare('SELECT COUNT(*) AS n FROM dts_tax_deposits WHERE deposit_type != ?')
    .get(WITHHELD_CATG) as { n: number }
  if (otherTypes.n > 0) {
    console.log(`[tax-deposits] Clearing ${otherTypes.n} stale rows from old broad fetch…`)
    db.prepare('DELETE FROM dts_tax_deposits').run()
  }

  const lastRow = db
    .prepare('SELECT MAX(record_date) AS d FROM dts_tax_deposits')
    .get() as { d: string | null }
  const isIncremental = lastRow?.d != null

  let fetchFrom = DATA_START
  if (isIncremental) {
    const last = new Date(lastRow.d!)
    last.setDate(last.getDate() - 14)
    fetchFrom = last.toISOString().slice(0, 10)
    console.log(`[tax-deposits] Incremental sync from ${fetchFrom} (last record: ${lastRow.d})`)
  } else {
    console.log(`[tax-deposits] Full sync from ${DATA_START}`)
  }

  const t0 = Date.now()

  // Fetch ONLY "Taxes - Withheld Individual/FICA" deposits from DTS Table II
  const filter =
    `record_date:gte:${fetchFrom}` +
    `,transaction_type:eq:Deposits` +
    `,transaction_catg:eq:${WITHHELD_CATG}`

  const rows = await fetchAllPages(
    'v1/accounting/dts/deposits_withdrawals_operating_cash',
    'record_date,transaction_type,transaction_catg,transaction_today_amt',
    filter,
    'WITHHELD',
  )

  console.log(
    `[tax-deposits] Fetched ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )

  const upsert = db.prepare(`
    INSERT INTO dts_tax_deposits (record_date, deposit_type, amount)
    VALUES (?, ?, ?)
    ON CONFLICT(record_date, deposit_type) DO UPDATE SET
      amount = excluded.amount
  `)

  let stored = 0
  db.transaction(() => {
    for (const r of rows) {
      const amt = parseFloat(r.transaction_today_amt)
      if (isNaN(amt)) continue
      upsert.run(r.record_date, r.transaction_catg, amt)
      stored++
    }
  })()

  console.log(
    `[tax-deposits] Stored ${stored} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Last Friday of February for a given year */
function lastFridayOfFeb(year: number): Date {
  const lastDayOfFeb = new Date(year, 2, 0, 12, 0, 0) // month=2, day=0 → last day of Feb
  while (lastDayOfFeb.getDay() !== 5) {
    lastDayOfFeb.setDate(lastDayOfFeb.getDate() - 1)
  }
  return lastDayOfFeb
}

/** Count N business days forward from start (start = day 1, Mon-Fri only) */
function addBusinessDays(start: Date, n: number): Date {
  const d = new Date(start.getTime())
  let count = 1
  while (count < n) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return d
}

/** Count N business days backwards from end (end = day 1, Mon-Fri only) */
function subBusinessDays(end: Date, n: number): Date {
  const d = new Date(end.getTime())
  let count = 1
  while (count < n) {
    d.setDate(d.getDate() - 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return d
}

// ── Period generation ────────────────────────────────────────────────────────

// Fixed business day counts per period (12 periods, 265 total)
const PERIOD_DAYS = [25, 20, 20, 25, 20, 25, 25, 20, 20, 25, 20, 20]

interface Period {
  periodNum: number
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD
  days: number  // business day count from the fixed pattern
}

/**
 * Generate 12 periods for a cycle ending in the given year.
 * Cycle runs from ~late Feb (endYear-1) to last Friday of Feb (endYear).
 */
function generatePeriods(endYear: number): Period[] {
  const lastFri = lastFridayOfFeb(endYear)
  // Cycle spans 265 business days total; start = 265 biz days back (inclusive)
  const cycleStart = subBusinessDays(lastFri, 265)

  const periods: Period[] = []
  let cursor = new Date(cycleStart.getTime())

  for (let i = 0; i < 12; i++) {
    const start = new Date(cursor.getTime())
    const end = addBusinessDays(start, PERIOD_DAYS[i])
    periods.push({
      periodNum: i + 1,
      start: fmtDate(start),
      end: fmtDate(end),
      days: PERIOD_DAYS[i],
    })
    // Next period starts on Monday after this Friday
    cursor = new Date(end.getTime())
    cursor.setDate(cursor.getDate() + 3) // Fri + 3 = Mon
  }

  return periods
}

// ── API data builder ─────────────────────────────────────────────────────────

interface PeriodResult {
  period_end: string
  days: number
  total: number
  daily_avg: number
  growth_vs_ly?: number | null
}

interface CycleResult {
  label: string
  periods: PeriodResult[]
  totals: {
    total: number
    days: number
    daily_avg: number
    growth_vs_ly?: number | null
  } | null
}

export function getTaxReceiptsData(): { currentCycle: CycleResult; priorCycle: CycleResult } | null {
  const today = fmtDate(new Date())
  const currentYear = new Date().getFullYear()

  const currentEndYear = currentYear
  const priorEndYear = currentYear - 1

  const currentPeriods = generatePeriods(currentEndYear)
  const priorPeriods = generatePeriods(priorEndYear)

  // Check that the withheld category exists in the DB
  const typeCheck = db
    .prepare('SELECT COUNT(*) AS n FROM dts_tax_deposits WHERE deposit_type = ?')
    .get(WITHHELD_CATG) as { n: number }

  if (typeCheck.n === 0) {
    // Log available types for debugging
    const types = db
      .prepare('SELECT DISTINCT deposit_type FROM dts_tax_deposits ORDER BY deposit_type')
      .all() as { deposit_type: string }[]
    console.warn(
      `[tax-deposits] No rows for "${WITHHELD_CATG}". Available types:\n` +
      types.map((t) => `  - ${t.deposit_type}`).join('\n'),
    )
    return null
  }

  const sumStmt = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM dts_tax_deposits
    WHERE record_date >= ? AND record_date <= ?
      AND deposit_type = ?
  `)

  function aggregatePeriods(periods: Period[]): PeriodResult[] {
    const results: PeriodResult[] = []
    for (const p of periods) {
      if (p.start > today) break // period hasn't started yet
      const row = sumStmt.get(p.start, p.end, WITHHELD_CATG) as { total: number }
      results.push({
        period_end: p.end,
        days: p.days,
        total: Math.round(row.total),
        daily_avg: Math.round(row.total / p.days),
      })
    }
    return results
  }

  const priorAgg = aggregatePeriods(priorPeriods)
  const currentAgg = aggregatePeriods(currentPeriods)

  // Add growth rates to current cycle (compare daily averages)
  const currentWithGrowth: PeriodResult[] = currentAgg.map((p, i) => {
    const prior = priorAgg[i]
    let growth_vs_ly: number | null = null
    if (prior && prior.daily_avg !== 0) {
      growth_vs_ly = Math.round(((p.daily_avg / prior.daily_avg) - 1) * 1000) / 10
    }
    return { ...p, growth_vs_ly }
  })

  function computeTotals(periods: PeriodResult[]) {
    if (!periods.length) return null
    const totalAmt = periods.reduce((s, p) => s + p.total, 0)
    const totalDays = periods.reduce((s, p) => s + p.days, 0)
    return {
      total: totalAmt,
      days: totalDays,
      daily_avg: Math.round(totalAmt / totalDays),
    }
  }

  const currentTotals = computeTotals(currentWithGrowth)
  const priorTotals = computeTotals(priorAgg)

  let totalsGrowth: number | null = null
  if (currentTotals && priorTotals && priorTotals.daily_avg !== 0) {
    totalsGrowth = Math.round(((currentTotals.daily_avg / priorTotals.daily_avg) - 1) * 1000) / 10
  }

  return {
    currentCycle: {
      label: `${currentEndYear - 1} - ${currentEndYear} TTM`,
      periods: currentWithGrowth,
      totals: currentTotals ? { ...currentTotals, growth_vs_ly: totalsGrowth } : null,
    },
    priorCycle: {
      label: `${priorEndYear - 1} - ${priorEndYear} TTM`,
      periods: priorAgg,
      totals: priorTotals,
    },
  }
}
