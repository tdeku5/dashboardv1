import { Router, Request, Response } from 'express'
import { getGiltCurve, getGiltCurveTimeSeries, getGiltCurveAvailableDates, getGiltCurveLatestDate, db } from '../db'
import { backfillGiltYieldCurves } from '../boeYieldCurve'

export const boeYieldCurveRouter = Router()

// GET /api/boe/yield-curve?date=2024-03-20&type=nominal_spot
boeYieldCurveRouter.get('/', (req: Request, res: Response) => {
  const curveType = (req.query.type as string) || 'nominal_spot'
  let date = req.query.date as string | undefined

  if (!date) {
    date = getGiltCurveLatestDate(curveType) || undefined
    if (!date) {
      res.status(404).json({ error: 'No yield curve data available' })
      return
    }
  }

  const curve = getGiltCurve(date, curveType)
  res.json({ date, curve_type: curveType, curve })
})

// GET /api/boe/yield-curve/timeseries?type=nominal_spot&maturity=10&start=2020-01-01
boeYieldCurveRouter.get('/timeseries', (req: Request, res: Response) => {
  const curveType = (req.query.type as string) || 'nominal_spot'
  const maturity = parseFloat(req.query.maturity as string)
  const start = req.query.start as string | undefined
  const end = req.query.end as string | undefined

  if (isNaN(maturity)) {
    res.status(400).json({ error: 'Invalid maturity parameter' })
    return
  }

  const data = getGiltCurveTimeSeries(curveType, maturity, start, end)
  res.json({ curve_type: curveType, maturity, observations: data })
})

// GET /api/boe/yield-curve/dates?type=nominal_spot
boeYieldCurveRouter.get('/dates', (req: Request, res: Response) => {
  const curveType = (req.query.type as string) || 'nominal_spot'
  const dates = getGiltCurveAvailableDates(curveType)
  res.json({ curve_type: curveType, dates })
})

// POST /api/boe/yield-curve/backfill?force=true
boeYieldCurveRouter.post('/backfill', (req: Request, res: Response) => {
  if (req.query.force === 'true') {
    db.prepare('DELETE FROM gilt_yield_curve').run()
    console.log('[BoE YC] Cleared gilt_yield_curve table for forced backfill')
  }

  backfillGiltYieldCurves().catch(err =>
    console.error('[BoE YC Backfill] Error:', err)
  )

  res.json({ status: 'Backfill started. Check server logs for progress.' })
})
