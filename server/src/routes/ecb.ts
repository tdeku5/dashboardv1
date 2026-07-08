import { Router } from 'express'
import { getEcbObservations } from '../db'

// Generic ECB series getter — /api/ecb?code=DE_HICP
// Serves any series_code in ecb_observations (the EU3 country extension and
// the euro-area rates-model codes). The rates-side euFundamental route is
// separate and untouched.
export const ecbRouter = Router()

ecbRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getEcbObservations(code) })
})
