import { Router, Request, Response } from 'express'
import {
  getObservations, getDbStatus, isSeriesStale,
  registerKnownSeries, getAllKnownSeriesIds,
  getNegativeCacheEntry, setNegativeCacheEntry,
} from '../db'
import { fetchAllSeries, fetchOneSeries, getApiKey, ALL_SERIES, STALE_HOURS } from '../fetchAllSeries'

export const fredRouter = Router()

const VALID_FREQUENCIES         = new Set(['d', 'w', 'bw', 'm', 'q', 'sa', 'a'])
const VALID_AGGREGATION_METHODS = new Set(['avg', 'sum', 'eop'])
const DATE_RE                   = /^\d{4}-\d{2}-\d{2}$/

// ── Per-series fetch lock ────────────────────────────────────────────────────

const fetchLocks = new Map<string, Promise<void>>()

// Exported for the Hephaestus render engine, which reuses the same
// staleness/lock/negative-cache path for FRED-backed catalog entries.
export async function ensureFresh(seriesId: string): Promise<void> {
  // Already fresh — nothing to do
  if (!isSeriesStale(seriesId, STALE_HOURS)) return

  // Check negative cache (invalid FRED IDs)
  const negMsg = getNegativeCacheEntry(seriesId)
  if (negMsg) throw new Error(negMsg)

  // If another request is already fetching this series, piggyback on it
  const existing = fetchLocks.get(seriesId)
  if (existing) { await existing; return }

  const apiKey = getApiKey()

  const promise = (async () => {
    try {
      await fetchOneSeries(seriesId, apiKey)
      registerKnownSeries(seriesId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Cache 4xx-style FRED errors (bad series ID) so we don't re-hit
      if (msg.includes('FRED 400') || msg.includes('Bad Request')) {
        setNegativeCacheEntry(seriesId, msg)
      }
      throw err
    } finally {
      fetchLocks.delete(seriesId)
    }
  })()

  fetchLocks.set(seriesId, promise)
  await promise
}

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

// ── GET /api/fred — auto-fetch, cache, and serve any FRED series ─────────────

fredRouter.get('/', async (req: Request, res: Response) => {
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

  const sid = series_id.trim().toUpperCase()

  // Ensure data is fresh (fetches from FRED if stale/missing, uses lock + negative cache)
  try {
    await ensureFresh(sid)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FRED API fetch failed'
    res.status(502).json({ error: msg })
    return
  }

  // Read from SQLite
  let rows = getObservations(sid, {
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

// ── POST /api/fred/refresh — force re-fetch all series (incl. on-demand ones) ─

let refreshInProgress = false

fredRouter.post('/refresh', async (_req: Request, res: Response) => {
  if (refreshInProgress) {
    res.status(409).json({ error: 'A refresh is already in progress' })
    return
  }

  refreshInProgress = true
  try {
    // Merge static list with any on-demand series the server has learned about
    const known = getAllKnownSeriesIds()
    const merged = [...new Set([...ALL_SERIES, ...known])]
    await fetchAllSeries({ force: true, seriesList: merged })
    res.json({ success: true, ...getDbStatus() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Refresh failed'
    res.status(500).json({ error: msg })
  } finally {
    refreshInProgress = false
  }
})
