import { Router, Request, Response } from 'express'
import { getTvCurve, getTvContractHistory, getTvAvailableRoots } from '../tvFutures'
import { getTvFedWatch } from '../tvFedWatch'
import { getMarket, resolveMarketKey } from '../stirRegistry'

export const tvFuturesRouter = Router()

// ── GET /api/futures/curve/:rootSymbol ───────────────────────────────────────

tvFuturesRouter.get('/curve/:rootSymbol', (req: Request, res: Response) => {
  try {
    const raw = String(req.params.rootSymbol).toUpperCase()
    const key = resolveMarketKey(raw)
    if (!key) {
      res.status(400).json({ error: `Unknown market key: ${raw}` })
      return
    }

    const lookbackDays = Math.max(1, parseInt(String(req.query.lookbackDays ?? '1'), 10) || 1)
    const date = req.query.date ? String(req.query.date) : undefined

    const result = getTvCurve(key, lookbackDays, date)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected curve error'
    console.error('[tv-futures] Curve error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/futures/strip/:rootSymbol ───────────────────────────────────────

tvFuturesRouter.get('/strip/:rootSymbol', (req: Request, res: Response) => {
  try {
    const raw = String(req.params.rootSymbol).toUpperCase()
    const key = resolveMarketKey(raw)
    if (!key) {
      res.status(400).json({ error: `Unknown market key: ${raw}` })
      return
    }

    // Build strip from curve data with 1d/5d/1m lookbacks
    const current = getTvCurve(key, 1)
    const d5 = getTvCurve(key, 5)
    const d1m = getTvCurve(key, 22)

    if (current.currentCurve.length === 0) {
      res.status(404).json({ error: `No strip data found for ${raw}` })
      return
    }

    const map1d = new Map(current.lookbackCurve.map(c => [c.symbol, c]))
    const map5d = new Map(d5.lookbackCurve.map(c => [c.symbol, c]))
    const map1m = new Map(d1m.lookbackCurve.map(c => [c.symbol, c]))

    const contracts = current.currentCurve.map(c => {
      const lastPrice = c.lastPrice ?? 0
      const one = map1d.get(c.symbol)
      const five = map5d.get(c.symbol)
      const month = map1m.get(c.symbol)

      return {
        symbol: c.symbol,
        monthCode: c.monthCode,
        year: c.year,
        expiryLabel: c.expiryLabel,
        lastPrice,
        impliedRate: c.impliedRate ?? 0,
        volume: 0,
        openInterest: 0,
        pxChg1d: one?.lastPrice != null ? lastPrice - one.lastPrice : null,
        pxChg5d: five?.lastPrice != null ? lastPrice - five.lastPrice : null,
        pxChg1m: month?.lastPrice != null ? lastPrice - month.lastPrice : null,
        oiChg: null,
      }
    })

    res.json({
      rootSymbol: key,
      latestDate: current.currentDate,
      lookbackDates: {
        '1d': current.lookbackDate || null,
        '5d': d5.lookbackDate || null,
        '1m': d1m.lookbackDate || null,
      },
      contracts,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected strip error'
    console.error('[tv-futures] Strip error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/futures/contract-history/:symbol ────────────────────────────────

tvFuturesRouter.get('/contract-history/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = decodeURIComponent(String(req.params.symbol || ''))
    const days = Math.max(1, parseInt(String(req.query.days ?? '60'), 10) || 60)

    const result = getTvContractHistory(symbol, days)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected contract history error'
    console.error('[tv-futures] Contract history error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/futures/fedwatch ────────────────────────────────────────────────

tvFuturesRouter.get('/fedwatch', (req: Request, res: Response) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined
    // market param defaults to FF for backwards compatibility
    const market = req.query.market ? String(req.query.market).toUpperCase() : 'FF'
    const key = resolveMarketKey(market)
    if (!key) {
      res.status(400).json({ error: `Unknown market key: ${market}` })
      return
    }
    const result = getTvFedWatch(key, date)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected fedwatch error'
    console.error('[tv-futures] FedWatch error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/futures/available-roots ─────────────────────────────────────────

tvFuturesRouter.get('/available-roots', (_req: Request, res: Response) => {
  res.json(getTvAvailableRoots())
})
