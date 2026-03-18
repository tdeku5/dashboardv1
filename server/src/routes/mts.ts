import { Router, Request, Response } from 'express'
import { getMtsFiscalBalance } from '../mtsFiscalBalance'

export const mtsRouter = Router()

// GET /api/mts/cumulative-balance
mtsRouter.get('/cumulative-balance', (_req: Request, res: Response) => {
  try {
    const data = getMtsFiscalBalance()
    res.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[mts] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})
