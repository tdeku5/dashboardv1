import { Router, Request, Response } from 'express'
import { getUsRatesVol, refreshUsRatesVol, type VolRangeKey } from '../usRatesVol'

export const ratesRouter = Router()

const VALID_RANGES: ReadonlyArray<VolRangeKey> = ['1m', '3m', '6m', 'ytd', '1y', '2y', '5y', '10y', 'all']

// GET /api/rates/us/vol?range=2y
ratesRouter.get('/us/vol', (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.range === 'string' ? req.query.range : '2y'
    const range = (VALID_RANGES as ReadonlyArray<string>).includes(raw)
      ? (raw as VolRangeKey)
      : '2y'
    res.json(getUsRatesVol(range))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rates] /us/vol route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// POST /api/rates/us/vol/refresh — recompute the trailing window on demand.
ratesRouter.post('/us/vol/refresh', (_req: Request, res: Response) => {
  try {
    const result = refreshUsRatesVol()
    res.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rates] /us/vol/refresh error:', msg)
    res.status(500).json({ success: false, error: msg })
  }
})
