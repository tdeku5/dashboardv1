import { Router } from 'express'
import { getBojTsObservations } from '../db'

// BoJ Time-Series API data — /api/boj-ts?code=JP_LOANS
// UI note: panels consuming this data must render the BoJ attribution line.
export const bojTsRouter = Router()

bojTsRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getBojTsObservations(code) })
})
