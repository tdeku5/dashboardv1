import { Router, Request, Response } from 'express'
import { getSCEInflationExpectations } from '../sceData'

export const sceRouter = Router()

// GET /api/sce/inflation-expectations
sceRouter.get('/inflation-expectations', (_req: Request, res: Response) => {
  const rows = getSCEInflationExpectations()
  res.json(rows)
})
