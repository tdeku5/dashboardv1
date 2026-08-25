import { Router, Request, Response } from 'express'
import {
  getPsSettings, updatePsSettings,
  getPsInstruments, updatePsInstrumentMargin,
  getPsLadders, replacePsStopLadder, replacePsContractLadder,
} from '../db'

// Position Sizing (Portfolio Analytics) — serves the model's INPUTS only.
// All grid computation happens client-side in client/src/lib/positionSizing.ts.
export const positionSizingRouter = Router()

const MAX_LADDER_ROWS = 20

// Fields expressed as fractions in [0, 1]
const PCT_FIELDS = ['market_money_pct', 'max_drawdown_pct', 'unit_risk_pct', 'max_units_risk_pct'] as const
// Dollar fields, must be >= 0
const DOLLAR_FIELDS = ['principle', 'current_portfolio_value'] as const

// Tick specs are exchange contract terms — read-only via the API.
const READ_ONLY_INSTRUMENT_FIELDS = [
  'symbol', 'group_name', 'tick_size_display', 'tick_size_decimal', 'tick_value', 'sort_order',
] as const

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// GET /api/portfolio/position-sizing/settings
positionSizingRouter.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json(getPsSettings())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] settings route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// PUT /api/portfolio/position-sizing/settings — full update of the six inputs.
positionSizingRouter.put('/settings', (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const parsed: Record<string, number> = {}

    for (const field of DOLLAR_FIELDS) {
      const n = asFiniteNumber(body[field])
      if (n === null || n < 0) {
        res.status(400).json({ error: `${field} must be a finite number >= 0` })
        return
      }
      parsed[field] = n
    }
    for (const field of PCT_FIELDS) {
      const n = asFiniteNumber(body[field])
      if (n === null || n < 0 || n > 1) {
        res.status(400).json({ error: `${field} must be a fraction between 0 and 1` })
        return
      }
      parsed[field] = n
    }
    // unit_risk_pct divides the ladder-length derivation — zero is not a
    // meaningful input. (max_units_risk_pct < unit_risk_pct IS valid: it
    // simply yields a zero-unit ladder, so it is deliberately not rejected.)
    if (parsed.unit_risk_pct <= 0) {
      res.status(400).json({ error: 'unit_risk_pct must be greater than 0' })
      return
    }

    res.json(updatePsSettings({
      principle: parsed.principle,
      current_portfolio_value: parsed.current_portfolio_value,
      market_money_pct: parsed.market_money_pct,
      max_drawdown_pct: parsed.max_drawdown_pct,
      unit_risk_pct: parsed.unit_risk_pct,
      max_units_risk_pct: parsed.max_units_risk_pct,
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] settings update error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/portfolio/position-sizing/instruments
positionSizingRouter.get('/instruments', (_req: Request, res: Response) => {
  try {
    res.json(getPsInstruments())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] instruments route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// PUT /api/portfolio/position-sizing/instruments/:symbol — initial_margin ONLY.
positionSizingRouter.put('/instruments/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      res.status(400).json({ error: 'symbol must be a single path segment' })
      return
    }
    const body = req.body as Record<string, unknown>

    const attempted = READ_ONLY_INSTRUMENT_FIELDS.filter(f => f in body)
    if (attempted.length > 0) {
      res.status(400).json({
        error: `Tick specs are exchange contract terms and are read-only: ${attempted.join(', ')}`,
      })
      return
    }

    const margin = asFiniteNumber(body.initial_margin)
    if (margin === null || margin < 0) {
      res.status(400).json({ error: 'initial_margin must be a finite number >= 0' })
      return
    }

    const updated = updatePsInstrumentMargin(symbol, margin)
    if (!updated) {
      res.status(404).json({ error: `Unknown instrument: ${symbol}` })
      return
    }
    res.json(updated)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] instrument update error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/portfolio/position-sizing/ladders
positionSizingRouter.get('/ladders', (_req: Request, res: Response) => {
  try {
    res.json(getPsLadders())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] ladders route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// Validates a ladder payload: positive integers, deduplicated, sorted ascending,
// capped at MAX_LADDER_ROWS so the grids stay readable. Returns null on invalid.
// An EMPTY ladder is valid: the UI renders an add-rows empty state, and the
// only-when-empty seeding repopulates the defaults on next server restart.
function parseLadder(raw: unknown, name: string): { values: number[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: `${name} must be an array of positive integers` }
  const values: number[] = []
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return { error: `${name} entries must be positive integers (got ${JSON.stringify(v)})` }
    }
    values.push(v)
  }
  const deduped = [...new Set(values)].sort((a, b) => a - b)
  if (deduped.length > MAX_LADDER_ROWS) {
    return { error: `${name} may hold at most ${MAX_LADDER_ROWS} rows` }
  }
  return { values: deduped }
}

// PUT /api/portfolio/position-sizing/ladders — replace either or both ladders.
positionSizingRouter.put('/ladders', (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    if (!('stopLadder' in body) && !('contractLadder' in body)) {
      res.status(400).json({ error: 'Provide stopLadder and/or contractLadder' })
      return
    }

    let stop: number[] | null = null
    let contract: number[] | null = null

    if ('stopLadder' in body) {
      const parsed = parseLadder(body.stopLadder, 'stopLadder')
      if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
      stop = parsed.values
    }
    if ('contractLadder' in body) {
      const parsed = parseLadder(body.contractLadder, 'contractLadder')
      if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
      contract = parsed.values
    }

    if (stop) replacePsStopLadder(stop)
    if (contract) replacePsContractLadder(contract)
    res.json(getPsLadders())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected position-sizing error'
    console.error('[position-sizing] ladders update error:', msg)
    res.status(500).json({ error: msg })
  }
})
