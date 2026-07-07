import { Router } from 'express'
import { getUkHpi, getUkHpiLatestDate } from '../db'

// UK House Price Index (HM Land Registry) — /api/uk-hpi
export const ukHpiRouter = Router()

// GET /api/uk-hpi?region=United%20Kingdom
ukHpiRouter.get('/', (req, res) => {
  const region = typeof req.query.region === 'string' && req.query.region !== ''
    ? req.query.region
    : 'United Kingdom'
  const rows = getUkHpi(region)
  res.json({ region, latest: getUkHpiLatestDate(), observations: rows })
})
