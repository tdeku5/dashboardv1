import { Router } from 'express'
import { getPayeRti, getPayeRtiMetrics } from '../db'

// PAYE RTI earnings & employment (UK, SA) — /api/paye-rti
export const payeRtiRouter = Router()

// GET /api/paye-rti/metrics
payeRtiRouter.get('/metrics', (_req, res) => {
  res.json({ metrics: getPayeRtiMetrics() })
})

// GET /api/paye-rti?metric=payrolled_employees
payeRtiRouter.get('/', (req, res) => {
  const metric = typeof req.query.metric === 'string' && req.query.metric !== ''
    ? req.query.metric
    : 'payrolled_employees'
  res.json({ metric, observations: getPayeRti(metric) })
})
