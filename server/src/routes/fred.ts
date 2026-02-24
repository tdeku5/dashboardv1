import { Router, Request, Response } from 'express'
import { getObservations, getDbStatus } from '../db'
import { fetchAllSeries, ALL_SERIES } from '../fetchAllSeries'

export const fredRouter = Router()

const VALID_FREQUENCIES         = new Set(['d', 'w', 'bw', 'm', 'q', 'sa', 'a'])
const VALID_AGGREGATION_METHODS = new Set(['avg', 'sum', 'eop'])
const DATE_RE                   = /^\d{4}-\d{2}-\d{2}$/

// ── Monthly aggregation ───────────────────────────────────────────────────────

function aggregateMonthly(
  rows:   { date: string; value: number }[],
  method: string
): { date: string; value: number }[] {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const key = row.date.slice(0, 7) + '-01'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row.value)
  }
  const result: { date: string; value: number }[] = []
  for (const [date, vals] of [...groups.entries()].sort()) {
    let value: number
    if (method === 'sum') {
      value = vals.reduce((a, b) => a + b, 0)
    } else if (method === 'eop') {
      value = vals[vals.length - 1]
    } else {
      // avg (default)
      value = vals.reduce((a, b) => a + b, 0) / vals.length
    }
    result.push({ date, value })
  }
  return result
}

// ── GET /api/fred — serve from SQLite ─────────────────────────────────────────

fredRouter.get('/', (req: Request, res: Response) => {
  const {
    series_id, observation_start, observation_end,
    frequency, aggregation_method,
  } = req.query

  // Validate
  if (!series_id || typeof series_id !== 'string' || !series_id.trim()) {
    res.status(400).json({ error: 'series_id is required' })
    return
  }
  if (observation_start && !DATE_RE.test(String(observation_start))) {
    res.status(400).json({ error: 'observation_start must be YYYY-MM-DD' })
    return
  }
  if (observation_end && !DATE_RE.test(String(observation_end))) {
    res.status(400).json({ error: 'observation_end must be YYYY-MM-DD' })
    return
  }
  if (frequency && !VALID_FREQUENCIES.has(String(frequency))) {
    res.status(400).json({ error: `Invalid frequency "${frequency}"` })
    return
  }
  if (aggregation_method && !VALID_AGGREGATION_METHODS.has(String(aggregation_method))) {
    res.status(400).json({ error: `Invalid aggregation_method "${aggregation_method}"` })
    return
  }

  let rows = getObservations(series_id.trim(), {
    observationStart: observation_start ? String(observation_start) : undefined,
    observationEnd:   observation_end   ? String(observation_end)   : undefined,
  })

  // Downsample to monthly if requested (handles daily/weekly stored data)
  if (frequency === 'm' && rows.length > 0) {
    rows = aggregateMonthly(rows, aggregation_method ? String(aggregation_method) : 'avg')
  }

  // Return in the same shape as the FRED API so the client needs no changes
  res.json({
    observations: rows.map(r => ({ date: r.date, value: String(r.value) })),
  })
})

// ── GET /api/fred/status — database health ────────────────────────────────────

fredRouter.get('/status', (_req: Request, res: Response) => {
  res.json(getDbStatus())
})

// ── POST /api/fred/refresh — force re-fetch all series from FRED ──────────────

let refreshInProgress = false

fredRouter.post('/refresh', async (_req: Request, res: Response) => {
  if (refreshInProgress) {
    res.status(409).json({ error: 'A refresh is already in progress' })
    return
  }

  refreshInProgress = true
  try {
    await fetchAllSeries({ force: true, seriesList: ALL_SERIES })
    res.json({ success: true, ...getDbStatus() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Refresh failed'
    res.status(500).json({ error: msg })
  } finally {
    refreshInProgress = false
  }
})
