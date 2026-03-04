import { Router, Request, Response } from 'express'
import { getCumulativeFiscalFlows } from '../fiscalData'

export const fiscalRouter = Router()

// GET /api/fiscal/cumulative-flows
fiscalRouter.get('/cumulative-flows', async (_req: Request, res: Response) => {
  try {
    const result = await getCumulativeFiscalFlows()
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fiscal] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})
