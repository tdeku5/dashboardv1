import { Router } from 'express'
import { db } from '../db'
import XLSX from 'xlsx'

export const censusTradeRouter = Router()

// ── Table setup ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS census_trade_observations (
    series_id  TEXT NOT NULL,
    date       TEXT NOT NULL,
    value      REAL NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (series_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_census_trade_series
    ON census_trade_observations(series_id);
`)

// ── Constants ────────────────────────────────────────────────────────────────

const CENSUS_STALE_HOURS = 168 // 7 days

const SAEXP_URL = 'https://www.census.gov/foreign-trade/statistics/historical/SAEXP.xlsx'
const SAIMP_URL = 'https://www.census.gov/foreign-trade/statistics/historical/SAIMP.xlsx'

// Column indices (0-based) in both SAEXP and SAIMP sheets
// Col 0 = Period, Col 1 = Total, Cols 2–7 = 6 end-use categories
const CATEGORY_COLS = [
  { col: 2, suffix: 'FOODS'    },  // Foods, Feeds, Beverages
  { col: 3, suffix: 'INDUS'    },  // Industrial Supplies & Materials
  { col: 4, suffix: 'CAPITAL'  },  // Capital Goods (ex Autos)
  { col: 5, suffix: 'AUTOS'    },  // Autos, Vehicles, Parts
  { col: 6, suffix: 'CONSUMER' },  // Consumer Goods (ex Food & Autos)
  { col: 7, suffix: 'OTHER'    },  // Other Goods
] as const

const MONTH_NAMES: Record<string, string> = {
  'January': '01', 'February': '02', 'March': '03', 'April': '04',
  'May': '05', 'June': '06', 'July': '07', 'August': '08',
  'September': '09', 'October': '10', 'November': '11', 'December': '12',
}

// ── Staleness check ──────────────────────────────────────────────────────────

export function isCensusTradeStale(): boolean {
  const row = db.prepare(
    `SELECT fetched_at FROM census_trade_observations
     ORDER BY fetched_at DESC LIMIT 1`
  ).get() as { fetched_at: string } | undefined
  if (!row) return true
  const age = (Date.now() - new Date(row.fetched_at).getTime()) / 3600000
  return age > CENSUS_STALE_HOURS
}

// ── XLSX parser ──────────────────────────────────────────────────────────────

function parseEndUseSheet(
  buf: Buffer,
  prefix: 'CENSUS_EXP' | 'CENSUS_IMP',
): { seriesId: string; date: string; value: number }[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

  const results: { seriesId: string; date: string; value: number }[] = []
  let currentYear: number | null = null

  // Data starts at row 5 (row 0–4 are headers)
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row) || row.length < 8) continue

    const cell0 = row[0]

    // Annual total row: cell0 is a number (the year)
    if (typeof cell0 === 'number' && cell0 >= 1900 && cell0 <= 2100) {
      currentYear = cell0
      continue // skip annual totals
    }

    // Monthly row: cell0 is a month name string
    if (typeof cell0 !== 'string') continue
    const trimmed = cell0.trim()
    const monthNum = MONTH_NAMES[trimmed]
    if (!monthNum || currentYear == null) continue

    const date = `${currentYear}-${monthNum}-01`

    // Total goods (col 1)
    const totalVal = row[1]
    const totalNum = typeof totalVal === 'number' ? totalVal : typeof totalVal === 'string' ? parseFloat(totalVal) : NaN
    if (!isNaN(totalNum)) {
      const totalSeriesId = prefix === 'CENSUS_EXP' ? 'CENSUS_GOODS_EXP_TOTAL' : 'CENSUS_GOODS_IMP_TOTAL'
      results.push({ seriesId: totalSeriesId, date, value: totalNum })
    }

    for (const { col, suffix } of CATEGORY_COLS) {
      const val = row[col]
      const num = typeof val === 'number' ? val : typeof val === 'string' ? parseFloat(val) : NaN
      if (!isNaN(num)) {
        results.push({ seriesId: `${prefix}_${suffix}`, date, value: num })
      }
    }
  }

  return results
}

// ── Fetch and store ──────────────────────────────────────────────────────────

let fetchInProgress: Promise<void> | null = null

export async function fetchAndStoreCensusTrade(): Promise<void> {
  // Deduplicate concurrent calls
  if (fetchInProgress) return fetchInProgress
  fetchInProgress = _doFetchAndStore()
  try { await fetchInProgress } finally { fetchInProgress = null }
}

async function _doFetchAndStore(): Promise<void> {
  console.log('[census-trade] Downloading SAEXP.xlsx and SAIMP.xlsx…')

  const [expRes, impRes] = await Promise.all([
    fetch(SAEXP_URL),
    fetch(SAIMP_URL),
  ])

  if (!expRes.ok) throw new Error(`SAEXP download failed: HTTP ${expRes.status}`)
  if (!impRes.ok) throw new Error(`SAIMP download failed: HTTP ${impRes.status}`)

  const [expBuf, impBuf] = await Promise.all([
    expRes.arrayBuffer().then(ab => Buffer.from(ab)),
    impRes.arrayBuffer().then(ab => Buffer.from(ab)),
  ])

  const expRows = parseEndUseSheet(expBuf, 'CENSUS_EXP')
  const impRows = parseEndUseSheet(impBuf, 'CENSUS_IMP')
  const allRows = [...expRows, ...impRows]

  console.log(`[census-trade] Parsed ${expRows.length} export rows, ${impRows.length} import rows`)

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO census_trade_observations(series_id, date, value, fetched_at)
     VALUES (?, ?, ?, datetime('now'))`
  )

  const counts: Record<string, number> = {}
  db.transaction(() => {
    for (const r of allRows) {
      stmt.run(r.seriesId, r.date, r.value)
      counts[r.seriesId] = (counts[r.seriesId] ?? 0) + 1
    }
  })()

  for (const [id, count] of Object.entries(counts).sort()) {
    console.log(`[census-trade]   ${id}: ${count} obs`)
  }
  console.log(`[census-trade] Done — ${allRows.length} total rows upserted`)
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Status endpoint (must be before /:seriesId to avoid matching "status" as a seriesId)
censusTradeRouter.get('/status', (_req, res) => {
  const rows = db.prepare(
    `SELECT series_id, COUNT(*) as count, MIN(date) as earliest,
     MAX(date) as latest, MAX(fetched_at) as last_fetched
     FROM census_trade_observations
     GROUP BY series_id
     ORDER BY series_id`
  ).all()
  res.json({ series: rows })
})

// Force refresh
censusTradeRouter.post('/refresh', async (_req, res) => {
  try {
    await fetchAndStoreCensusTrade()
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[census-trade] Refresh error:', msg)
    res.status(500).json({ error: msg })
  }
})

// Get observations for a series
censusTradeRouter.get('/:seriesId', async (req, res) => {
  const { seriesId } = req.params

  try {
    if (isCensusTradeStale()) {
      await fetchAndStoreCensusTrade()
    }
  } catch (err) {
    console.error('[census-trade] Background fetch error:', err)
    // Continue — serve whatever is in the DB
  }

  const rows = db.prepare(
    `SELECT date, CAST(value AS TEXT) as value
     FROM census_trade_observations
     WHERE series_id = ?
     ORDER BY date ASC`
  ).all(seriesId) as { date: string; value: string }[]

  res.json({ observations: rows })
})
