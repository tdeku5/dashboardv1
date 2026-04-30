import { Router, Request, Response } from 'express'
import { getOnsObservations, isOnsSeriesStale, getGDPContributions } from '../db'
import { fetchOnsSeries } from '../onsApi'

export const onsRouter = Router()

// GET /api/ons?cdid=ABMI&dataset=ukea
onsRouter.get('/', async (req: Request, res: Response) => {
  const cdid = (req.query.cdid as string || '').toUpperCase()
  const datasetId = (req.query.dataset as string || '').toLowerCase()

  if (!cdid || !datasetId) {
    res.status(400).json({ error: 'Missing cdid or dataset query parameter' })
    return
  }

  try {
    // Check if we have fresh data in SQLite
    if (!isOnsSeriesStale(cdid, datasetId, 12)) {
      const cached = getOnsObservations(cdid, datasetId)
      if (cached.length > 0) {
        res.json({ cdid, dataset: datasetId, observations: cached })
        return
      }
    }

    // Fetch from ONS API (auto-stores in SQLite)
    const fresh = await fetchOnsSeries(cdid, datasetId)
    res.json({ cdid, dataset: datasetId, observations: fresh })
  } catch (err) {
    console.error(`[ONS route] Error for ${cdid}/${datasetId}:`, err)

    // Fall back to stale cached data if available
    const stale = getOnsObservations(cdid, datasetId)
    if (stale.length > 0) {
      res.json({ cdid, dataset: datasetId, observations: stale, stale: true })
      return
    }

    res.status(500).json({ error: 'Failed to fetch ONS data' })
  }
})

// GET /api/ons/gdp-contributions?type=mom&start=2020-01-01
onsRouter.get('/gdp-contributions', (req: Request, res: Response) => {
  const periodType = (req.query.type as string) || 'mom'
  const start = req.query.start as string | undefined

  const data = getGDPContributions(periodType, start)

  // Pivot into chart-friendly format: array of {date, gdp, services, production, ...}
  const dateMap = new Map<string, Record<string, number>>()
  for (const row of data) {
    if (!dateMap.has(row.date)) dateMap.set(row.date, {})
    dateMap.get(row.date)![row.sector] = row.value
  }

  const result = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sectors]) => ({ date, ...sectors }))

  res.json({ period_type: periodType, data: result })
})
