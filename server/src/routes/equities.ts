import { Router, Request, Response } from 'express'
import { getSectorAttribution } from '../sectorAttribution'
import {
  getSectorContribution,
  type ContribLookbackKey,
  type ContribRangeKey,
} from '../sectorContribution'
import { getCountryReturns } from '../countryReturns'
import { getBreadth, type BreadthRangeKey } from '../breadth'
import {
  getUsIndexLevels,
  getUsIndexReturns,
  type IndexRangeKey,
} from '../usIndices'
import { getVixFuturesCurve } from '../vixCurve'

export const equitiesRouter = Router()

const VALID_INDEX_RANGES: IndexRangeKey[] = [
  '1m', '3m', '6m', 'ytd', '1y', '2y', '5y', '10y', '15y', '20y', 'all',
]

const VALID_CONTRIB_LOOKBACKS: ContribLookbackKey[] = ['1d', '1w', '2w', '1m', '3m', '6m', '1y']
const VALID_CONTRIB_RANGES: ContribRangeKey[] = [
  '1m', '3m', '6m', 'ytd', '1y', '2y', '5y', '10y', '15y', '20y', 'all',
]
const VALID_BREADTH_RANGES: BreadthRangeKey[] = [
  '1m', '3m', '6m', 'ytd', '1y', '2y', '5y', '10y', '15y', '20y', 'all',
]

// ── GET /api/equities/us/index-returns ───────────────────────────────────────

equitiesRouter.get('/us/index-returns', (_req: Request, res: Response) => {
  try {
    res.json(getUsIndexReturns())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected index-returns error'
    console.error('[equities] index-returns error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/us/index-levels ────────────────────────────────────────

equitiesRouter.get('/us/index-levels', (req: Request, res: Response) => {
  try {
    const rawRange = String(req.query.range ?? '1y').toLowerCase() as IndexRangeKey
    const range = VALID_INDEX_RANGES.includes(rawRange) ? rawRange : '1y'
    res.json(getUsIndexLevels(range))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected index-levels error'
    console.error('[equities] index-levels error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/us/sector-attribution ──────────────────────────────────

equitiesRouter.get('/us/sector-attribution', (_req: Request, res: Response) => {
  try {
    res.json(getSectorAttribution())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected sector-attribution error'
    console.error('[equities] sector-attribution error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/global/country-returns ────────────────────────────────

equitiesRouter.get('/global/country-returns', (_req: Request, res: Response) => {
  try {
    res.json(getCountryReturns())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected country-returns error'
    console.error('[equities] country-returns error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/us/breadth ─────────────────────────────────────────────

equitiesRouter.get('/us/breadth', (req: Request, res: Response) => {
  try {
    const rawRange = String(req.query.range ?? '1y').toLowerCase() as BreadthRangeKey
    const range = VALID_BREADTH_RANGES.includes(rawRange) ? rawRange : '1y'
    res.json(getBreadth(range))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected breadth error'
    console.error('[equities] breadth error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/us/vix-futures-curve ───────────────────────────────────
// Spot VIX + dated VX contracts in chronological expiry order, with current
// and t−offset closes. Single offset (the VOL-tab chart shows just one
// benchmark line). Drops contracts that have already expired by as-of date.

equitiesRouter.get('/us/vix-futures-curve', (req: Request, res: Response) => {
  try {
    const offsetRaw = parseInt(String(req.query.offset ?? '5'), 10)
    const offset = Number.isFinite(offsetRaw) ? Math.max(1, Math.min(1260, offsetRaw)) : 5
    res.json(getVixFuturesCurve(offset))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected vix-futures-curve error'
    console.error('[equities] vix-futures-curve error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/equities/us/sector-attribution-contribution ─────────────────────

equitiesRouter.get('/us/sector-attribution-contribution', (req: Request, res: Response) => {
  try {
    const rawLookback = String(req.query.lookback ?? '1m').toLowerCase() as ContribLookbackKey
    const lookback = VALID_CONTRIB_LOOKBACKS.includes(rawLookback) ? rawLookback : '1m'

    const rawRange = String(req.query.range ?? '2y').toLowerCase() as ContribRangeKey
    const range = VALID_CONTRIB_RANGES.includes(rawRange) ? rawRange : '2y'

    res.json(getSectorContribution(lookback, range))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected sector-contribution error'
    console.error('[equities] sector-contribution error:', msg)
    res.status(500).json({ error: msg })
  }
})
