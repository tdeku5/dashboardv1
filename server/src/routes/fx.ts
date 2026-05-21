import { Router, Request, Response } from 'express'
import { getFxPairReturns } from '../fxPairReturns'

export const fxRouter = Router()

// ── GET /api/fx/global/pair-returns ──────────────────────────────────────────

fxRouter.get('/global/pair-returns', (_req: Request, res: Response) => {
  try {
    res.json(getFxPairReturns())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected pair-returns error'
    console.error('[fx] pair-returns error:', msg)
    res.status(500).json({ error: msg })
  }
})
