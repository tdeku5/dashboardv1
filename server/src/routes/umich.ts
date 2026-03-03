import { Router, Request, Response } from 'express'
import { getUMichInflationExpectations } from '../umichData'

export const umichRouter = Router()

// GET /api/umich/inflation-expectations
umichRouter.get('/inflation-expectations', (_req: Request, res: Response) => {
  const rows = getUMichInflationExpectations()
  res.json(rows)
})
