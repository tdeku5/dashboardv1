import { Router, Request, Response } from 'express'
import {
  getCavLevels,
  getCavZscores,
  getCavSummary,
  type CavRangeKey,
  type CavLookbackKey,
} from '../crossAssetVol'

export const macroRouter = Router()

const VALID_RANGES: CavRangeKey[] = [
  '1m', '3m', '6m', 'ytd', '1y', '2y', '5y', '10y', '15y', '20y', 'all',
]
const VALID_LOOKBACKS: CavLookbackKey[] = ['6m', '1y', '2y', '5y', '10y']

// ── GET /api/macro/cross-asset-vol/levels ────────────────────────────────────

macroRouter.get('/cross-asset-vol/levels', (req: Request, res: Response) => {
  try {
    const rawRange = String(req.query.range ?? '1y').toLowerCase() as CavRangeKey
    const range = VALID_RANGES.includes(rawRange) ? rawRange : '1y'
    res.json(getCavLevels(range))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected cross-asset-vol/levels error'
    console.error('[macro] cross-asset-vol/levels error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/macro/cross-asset-vol/zscores ───────────────────────────────────

macroRouter.get('/cross-asset-vol/zscores', (req: Request, res: Response) => {
  try {
    const rawRange = String(req.query.range ?? '1y').toLowerCase() as CavRangeKey
    const range = VALID_RANGES.includes(rawRange) ? rawRange : '1y'
    const rawLb = String(req.query.lookback ?? '1y').toLowerCase() as CavLookbackKey
    const lookback = VALID_LOOKBACKS.includes(rawLb) ? rawLb : '1y'
    res.json(getCavZscores(range, lookback))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected cross-asset-vol/zscores error'
    console.error('[macro] cross-asset-vol/zscores error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/macro/cross-asset-vol/summary ───────────────────────────────────

macroRouter.get('/cross-asset-vol/summary', (_req: Request, res: Response) => {
  try {
    res.json(getCavSummary())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected cross-asset-vol/summary error'
    console.error('[macro] cross-asset-vol/summary error:', msg)
    res.status(500).json({ error: msg })
  }
})
