import { Router, Request, Response } from 'express'
import { getCrudeCurve, getCrudeSpread, type CrudeProduct, type SpreadLookback } from '../crudeCurves'
import {
  getMetalsReturns,
  getMetalCurves,
  getMetalBasis,
  getEnergyReturns,
  type CurveMetal,
  type BasisLookback,
} from '../metalsData'

const VALID_LOOKBACKS: SpreadLookback[] = ['1m', '3m', '6m', '1y', '2y', '5y', 'max']
const VALID_BASIS_LOOKBACKS: BasisLookback[] = ['1m', '3m', '6m', '1y', '2y', '5y', 'max']

export const commoditiesRouter = Router()

function parseOffset(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw ?? fallback), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1260, Math.max(1, n))
}

function parseProduct(raw: unknown): CrudeProduct | null {
  const v = String(raw ?? '').toLowerCase()
  return v === 'wti' || v === 'brent' ? v : null
}

// ── GET /api/commodities/crude/curve ─────────────────────────────────────────

commoditiesRouter.get('/crude/curve', (req: Request, res: Response) => {
  try {
    const product = parseProduct(req.query.product)
    if (!product) {
      res.status(400).json({ error: `Invalid product. Expected 'wti' or 'brent'.` })
      return
    }
    const offset1 = parseOffset(req.query.offset1, 5)
    const offset2 = parseOffset(req.query.offset2, 30)
    res.json(getCrudeCurve(product, offset1, offset2))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected curve error'
    console.error('[commodities] crude/curve error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/commodities/crude/curves ────────────────────────────────────────

commoditiesRouter.get('/crude/curves', (req: Request, res: Response) => {
  try {
    const offset1 = parseOffset(req.query.offset1, 5)
    const offset2 = parseOffset(req.query.offset2, 30)
    res.json({
      wti:   getCrudeCurve('wti',   offset1, offset2),
      brent: getCrudeCurve('brent', offset1, offset2),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected curves error'
    console.error('[commodities] crude/curves error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/commodities/crude/spread ────────────────────────────────────────

commoditiesRouter.get('/crude/spread', (req: Request, res: Response) => {
  try {
    const raw = String(req.query.lookback ?? '1y').toLowerCase() as SpreadLookback
    const lookback = VALID_LOOKBACKS.includes(raw) ? raw : '1y'
    res.json(getCrudeSpread(lookback))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected spread error'
    console.error('[commodities] crude/spread error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── Metals ────────────────────────────────────────────────────────────────

function parseMetal(raw: unknown): CurveMetal | null {
  const v = String(raw ?? '').toLowerCase()
  return v === 'gold' || v === 'silver' ? v : null
}

// GET /api/commodities/metals/returns
commoditiesRouter.get('/metals/returns', (_req: Request, res: Response) => {
  try {
    res.json(getMetalsReturns())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected metals returns error'
    console.error('[commodities] metals/returns error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/commodities/energy/returns
commoditiesRouter.get('/energy/returns', (_req: Request, res: Response) => {
  try {
    res.json(getEnergyReturns())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected energy returns error'
    console.error('[commodities] energy/returns error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/commodities/metals/curves?offset1=&offset2=
commoditiesRouter.get('/metals/curves', (req: Request, res: Response) => {
  try {
    const offset1 = parseOffset(req.query.offset1, 5)
    const offset2 = parseOffset(req.query.offset2, 30)
    res.json(getMetalCurves(offset1, offset2))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected metals curves error'
    console.error('[commodities] metals/curves error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/commodities/metals/basis/:metal?lookback=
commoditiesRouter.get('/metals/basis/:metal', (req: Request, res: Response) => {
  try {
    const metal = parseMetal(req.params.metal)
    if (!metal) {
      res.status(400).json({ error: `Invalid metal. Expected 'gold' or 'silver'.` })
      return
    }
    const raw = String(req.query.lookback ?? '1y').toLowerCase() as BasisLookback
    const lookback = VALID_BASIS_LOOKBACKS.includes(raw) ? raw : '1y'
    res.json(getMetalBasis(metal, lookback))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected metals basis error'
    console.error('[commodities] metals/basis error:', msg)
    res.status(500).json({ error: msg })
  }
})
