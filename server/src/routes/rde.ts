import { Router, Request, Response } from 'express'
import { getRDEEstimates } from '../db'
import { syncRDE } from '../rdeData'

export const rdeRouter = Router()

rdeRouter.get('/', (_req: Request, res: Response) => {
  try {
    const rows = getRDEEstimates()
    res.json(rows)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rde] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})

rdeRouter.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncRDE()
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[rde] Sync error:', msg)
    res.status(500).json({ error: msg })
  }
})
