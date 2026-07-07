import { Router } from 'express'
import { getStatcanObservations } from '../db'

// Generic StatCan series getter — /api/statcan?code=CA_CPI_FOOD
// Serves every series_code in statcan_observations (both the Canada econ-model
// codes from fetchAllStatcanSeries.ts and the rates-side CPI_*/UNRATE_CA codes).
export const statcanRouter = Router()

statcanRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getStatcanObservations(code) })
})
