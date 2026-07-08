import { Router } from 'express'
import { getEurostatObservations } from '../db'

// Eurostat series — /api/eurostat?code=DE_GDP_R
// Observations include obs_flag (b/p/e/d/u) so the frontend can surface
// break-in-series and estimate markers (Germany permits, unemployment breaks).
export const eurostatRouter = Router()

eurostatRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getEurostatObservations(code) })
})
