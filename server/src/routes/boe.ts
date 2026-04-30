import { Router, Request, Response } from 'express'
import { getBoeObservations, isBoeSeriesStale } from '../db'
import { fetchBoeSeries } from '../boeApi'

export const boeRouter = Router()

// GET /api/boe?series=IUDBEDR
// GET /api/boe?series=IUDBEDR,IUDSOIA,XUDLUSS (comma-separated for batch)
boeRouter.get('/', async (req: Request, res: Response) => {
  const rawSeries = (req.query.series as string || '').toUpperCase()
  if (!rawSeries) {
    res.status(400).json({ error: 'Missing series query parameter' })
    return
  }

  const codes = rawSeries.split(',').map(c => c.trim()).filter(Boolean)
  if (codes.length === 0) {
    res.status(400).json({ error: 'No valid series codes provided' })
    return
  }

  try {
    // Check which series are stale
    const staleCodes = codes.filter(c => isBoeSeriesStale(c, 12))

    if (staleCodes.length > 0) {
      await fetchBoeSeries(staleCodes)
    }

    // Return all requested series from cache
    const result: Record<string, Array<{ date: string; value: number }>> = {}
    for (const code of codes) {
      result[code] = getBoeObservations(code)
    }

    res.json({ series: result })
  } catch (err) {
    console.error('[BoE route] Error:', err)

    // Fall back to cached data
    const result: Record<string, Array<{ date: string; value: number }>> = {}
    for (const code of codes) {
      result[code] = getBoeObservations(code)
    }

    if (Object.values(result).some(obs => obs.length > 0)) {
      res.json({ series: result, stale: true })
      return
    }

    res.status(500).json({ error: 'Failed to fetch BoE data' })
  }
})
