import { Router, Request, Response } from 'express'
import { getGDPNowForecasts, getGDPNowContributions } from '../db'
import { syncGDPNow } from '../gdpnowData'

export const gdpnowRouter = Router()

gdpnowRouter.get('/', (_req: Request, res: Response) => {
  try {
    const rows = getGDPNowForecasts()
    const quarterMap = new Map<string, Array<{ forecastDate: string; value: number }>>()

    for (const row of rows) {
      if (!quarterMap.has(row.quarter)) quarterMap.set(row.quarter, [])
      quarterMap.get(row.quarter)!.push({
        forecastDate: row.forecast_date,
        value: row.value,
      })
    }

    res.json(
      [...quarterMap.entries()].map(([quarter, forecasts]) => ({
        quarter,
        forecasts,
      }))
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gdpnow] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})

gdpnowRouter.get('/contributions', (_req: Request, res: Response) => {
  try {
    const rows = getGDPNowContributions()
    res.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gdpnow] Contributions error:', msg)
    res.status(500).json({ error: msg })
  }
})

gdpnowRouter.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncGDPNow()
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gdpnow] Sync error:', msg)
    res.status(500).json({ error: msg })
  }
})
