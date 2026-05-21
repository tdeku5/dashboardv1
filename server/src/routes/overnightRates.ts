import { Router, Request, Response } from 'express'
import { db } from '../db'

export const overnightRatesRouter = Router()

interface LatestRow { date: string; value: number; source: string }

const KNOWN_CODES = new Set([
  'SONIA', 'ECBDFR', 'CORRA', 'CA_TARGET', 'TONA', 'AONIA', 'AU_CASH_RATE_TARGET',
])

// ── GET /api/overnight-rates/latest?series=SONIA,CORRA,... ──────────────────
//
// Returns the most recent row per requested series_code:
//   {
//     SONIA:  { date: '2026-05-20', value: 3.73, source: 'FRED', stale_days: 1 },
//     CORRA:  { date: '2026-05-20', value: 2.75, source: 'BoC',  stale_days: 1 },
//     ...
//     unknown_series_or_missing: null
//   }
//
// stale_days = whole calendar days between latest stored date and today (UTC).
// The frontend treats >3 as stale and shows it in the subtitle.

overnightRatesRouter.get('/latest', (req: Request, res: Response) => {
  const rawList = String(req.query.series ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
  const list = rawList.length > 0
    ? rawList
    : Array.from(KNOWN_CODES)

  const stmt = db.prepare(`
    SELECT date, value, source FROM overnight_rates
    WHERE series_code = ? ORDER BY date DESC LIMIT 1
  `)

  const today = new Date()
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(),
  )

  const out: Record<string, { date: string; value: number; source: string; stale_days: number } | null> = {}
  for (const code of list) {
    if (!KNOWN_CODES.has(code)) {
      out[code] = null
      continue
    }
    const row = stmt.get(code) as LatestRow | undefined
    if (!row || row.value == null) {
      out[code] = null
      continue
    }
    const rowMs = new Date(row.date + 'T00:00:00Z').getTime()
    const staleDays = Math.max(0, Math.floor((todayUtcMs - rowMs) / 86_400_000))
    out[code] = { date: row.date, value: row.value, source: row.source, stale_days: staleDays }
  }

  res.json(out)
})
