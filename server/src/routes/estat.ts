import { Router } from 'express'
import { getEstatObservations } from '../db'

// Generic e-Stat series getter — /api/estat?code=JP_CPI_FOOD
// Serves every series_code in estat_observations (Japan econ-model codes from
// fetchAllEstatSeries.ts, the customs trade codes, and the rates-side
// CPI_*_JP / UNRATE_JP codes).
export const estatRouter = Router()

estatRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getEstatObservations(code) })
})
