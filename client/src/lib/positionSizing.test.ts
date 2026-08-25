import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  roundDownToInt,
  deriveSetup,
  deriveUnitCount,
  riskBudgetLadder,
  dollarPerPoint,
  maxContractsOnCapital,
  computeContractsGrid,
  computeMarginGrid,
  computeActualRiskGrid,
  computeInverseGrid,
  type PsSettingsValues,
} from './positionSizing'

// The oracle for every figure below is the workbook's own computed output
// (transcribed into the acceptance criteria of the port spec) — any divergence
// is a port bug, not a test to adjust.

const SEED_SETTINGS: PsSettingsValues = {
  principle: 500_000,
  currentPortfolioValue: 500_000,
  marketMoneyPct: 0.25,
  maxDrawdownPct: 0.05,
  unitRiskPct: 0.0025,
  maxUnitsRiskPct: 0.02,
}

const ES = { tickSizeDecimal: 0.25, tickValue: 12.5, initialMargin: 22_980.1 }
const STOP_LADDER = [20, 40, 60, 80, 100, 120, 160, 200]
const CONTRACT_LADDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function seedBudgets(): number[] {
  const setup = deriveSetup(SEED_SETTINGS)
  const n = deriveUnitCount(SEED_SETTINGS.unitRiskPct, SEED_SETTINGS.maxUnitsRiskPct)
  return riskBudgetLadder(setup.dollarBudgetPerUnit, n)
}

describe('roundDownToInt (Excel ROUNDDOWN semantics)', () => {
  it('truncates toward zero', () => {
    expect(roundDownToInt(2.9)).toBe(2)
    expect(roundDownToInt(2.0)).toBe(2)
    expect(roundDownToInt(0.9)).toBe(0)
    expect(roundDownToInt(-2.9)).toBe(-2) // toward zero, not floor
  })
  it('reproduces Excel across binary-FP near-integers', () => {
    // 0.003/0.001 is 2.9999999999999996 as a raw double; the sheet shows 3.
    expect(roundDownToInt(0.003 / 0.001)).toBe(3)
  })
  it('matches Excel at exactly 15 significant digits, no stricter', () => {
    // A genuine near-integer (not a float artifact) survives 15-digit
    // normalization and truncates DOWN, exactly as Excel would.
    expect(roundDownToInt(4.9999999999)).toBe(4)
  })
  it('returns 0 for non-finite input', () => {
    expect(roundDownToInt(Number.NaN)).toBe(0)
    expect(roundDownToInt(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('Setup derivations', () => {
  it('reproduces the workbook at seed values', () => {
    const s = deriveSetup(SEED_SETTINGS)
    expect(s.additionalRiskFromMarketMoney).toBe(0)
    expect(s.additionalRiskBudget).toBe(0)
    expect(s.currentRiskBudget).toBe(500_000)
    expect(s.maxDrawdownDollars).toBe(25_000)
    expect(s.dollarBudgetPerUnit).toBe(1_250)
    expect(s.maxRiskBudget).toBe(10_000)
  })

  it('counts market money at 25% above Principle', () => {
    const s = deriveSetup({ ...SEED_SETTINGS, currentPortfolioValue: 600_000 })
    expect(s.additionalRiskFromMarketMoney).toBe(100_000)
    expect(s.additionalRiskBudget).toBe(25_000)
    expect(s.currentRiskBudget).toBe(525_000)
  })

  it('does NOT clamp negative market money (drawdown shrinks the budget)', () => {
    const s = deriveSetup({ ...SEED_SETTINGS, currentPortfolioValue: 400_000 })
    expect(s.additionalRiskFromMarketMoney).toBe(-100_000)
    expect(s.additionalRiskBudget).toBe(-25_000)
    expect(s.currentRiskBudget).toBe(475_000)
  })
})

describe('deriveUnitCount (ladder length)', () => {
  it('is derived, not hardcoded: 0.25%/2.00% -> 8, 0.50%/2.00% -> 4, 0.25%/3.00% -> 12', () => {
    expect(deriveUnitCount(0.0025, 0.02)).toBe(8)
    expect(deriveUnitCount(0.005, 0.02)).toBe(4)
    expect(deriveUnitCount(0.0025, 0.03)).toBe(12)
  })
  it('guards unitRiskPct <= 0 (no divide-by-zero)', () => {
    expect(deriveUnitCount(0, 0.02)).toBe(0)
    expect(deriveUnitCount(-0.01, 0.02)).toBe(0)
  })
  it('maxUnitsRiskPct below unitRiskPct is valid and yields 0', () => {
    expect(deriveUnitCount(0.0025, 0.001)).toBe(0)
  })
})

describe('riskBudgetLadder', () => {
  it('runs 1..8 at seed: $1,250 .. $10,000', () => {
    expect(seedBudgets()).toEqual([1250, 2500, 3750, 5000, 6250, 7500, 8750, 10000])
  })
  it('unitCount 0 -> empty ladder', () => {
    expect(riskBudgetLadder(1250, 0)).toEqual([])
  })
})

describe('instrument lookups', () => {
  it('$ per Point: ES 50, 6J 12,500,000', () => {
    expect(dollarPerPoint(12.5, 0.25)).toBe(50)
    expect(dollarPerPoint(6.25, 0.0000005)).toBe(12_500_000)
  })
  it('$ per Point null tick value or non-positive tick size -> null', () => {
    expect(dollarPerPoint(null, 0.25)).toBeNull()
    expect(dollarPerPoint(12.5, 0)).toBeNull()
  })
  it('Max Contracts on Capital: ES at seed capital', () => {
    expect(maxContractsOnCapital(500_000, 22_980.1)).toBe(21)
  })
  it('Max Contracts on Capital: null or 0 margin -> null (never 0)', () => {
    expect(maxContractsOnCapital(500_000, null)).toBeNull()
    expect(maxContractsOnCapital(500_000, 0)).toBeNull()
  })
})

describe('Grid 1 — Contracts (ES, seed)', () => {
  const grid = computeContractsGrid(STOP_LADDER, ES.tickSizeDecimal, ES.tickValue, seedBudgets())
  const row = (ticks: number) => grid.find(r => r.stopTicks === ticks)!

  it('reproduces every acceptance-criteria row', () => {
    expect(row(20).contracts).toEqual([5, 10, 15, 20, 25, 30, 35, 40])
    expect(row(40).contracts).toEqual([2, 5, 7, 10, 12, 15, 17, 20])
    expect(row(60).contracts).toEqual([1, 3, 5, 6, 8, 10, 11, 13])
    expect(row(120).contracts).toEqual([0, 1, 2, 3, 4, 5, 5, 6])
    expect(row(200).contracts).toEqual([0, 1, 1, 2, 2, 3, 3, 4])
  })

  it('row headers: stop price and $ risk/contract', () => {
    expect(row(20).stopPrice).toBe(5) // 20 * 0.25
    expect(row(20).riskPerContract).toBe(250) // 20 * 12.5
  })

  it('MES (tick value 1.25) gives 10x the ES contract counts', () => {
    const mes = computeContractsGrid(STOP_LADDER, 0.25, 1.25, seedBudgets())
    expect(mes.find(r => r.stopTicks === 20)!.contracts).toEqual([50, 100, 150, 200, 250, 300, 350, 400])
  })

  it('riskPerContract <= 0 guard: tick value 0 or null -> 0 contracts, no throw', () => {
    for (const tv of [0, null]) {
      const g = computeContractsGrid(STOP_LADDER, 0.25, tv, seedBudgets())
      expect(g.every(r => r.riskPerContract === 0)).toBe(true)
      expect(g.every(r => r.contracts.every(c => c === 0))).toBe(true)
    }
  })

  it('empty stop ladder -> empty grid, no throw', () => {
    expect(computeContractsGrid([], 0.25, 12.5, seedBudgets())).toEqual([])
  })

  it('unitCount 0 -> rows with zero unit columns, no throw', () => {
    const g = computeContractsGrid(STOP_LADDER, 0.25, 12.5, [])
    expect(g).toHaveLength(STOP_LADDER.length)
    expect(g.every(r => r.contracts.length === 0)).toBe(true)
  })
})

describe('Grid 2 — Initial margin required (ES, seed)', () => {
  const contracts = computeContractsGrid(STOP_LADDER, ES.tickSizeDecimal, ES.tickValue, seedBudgets())

  it('stop 20, 1 unit -> $114,901 (5 x 22,980.1)', () => {
    const g = computeMarginGrid(contracts, ES.initialMargin)
    const cell = g.find(r => r.stopTicks === 20)!.marginRequired[0]
    expect(cell).toBeCloseTo(114_900.5, 6) // renders as $114,901 under $#,##0
  })

  it('null margin -> every cell null, never 0', () => {
    const g = computeMarginGrid(contracts, null)
    expect(g.every(r => r.marginRequired.every(c => c === null))).toBe(true)
  })

  it('null margin leaves grids 1 and 3 untouched', () => {
    const g3 = computeActualRiskGrid(contracts)
    expect(contracts.find(r => r.stopTicks === 20)!.contracts[0]).toBe(5)
    expect(g3.find(r => r.stopTicks === 40)!.actualRisk[0]).toBe(1000)
  })
})

describe('Grid 3 — Actual $ at risk (ES, seed)', () => {
  it('stop 40, 1 unit -> $1,000 (2 x 500): $250 rounding slack vs the $1,250 budget', () => {
    const contracts = computeContractsGrid(STOP_LADDER, ES.tickSizeDecimal, ES.tickValue, seedBudgets())
    const g = computeActualRiskGrid(contracts)
    expect(g.find(r => r.stopTicks === 40)!.actualRisk[0]).toBe(1000)
  })
})

describe('Grid 4 — Inverse (ES, seed)', () => {
  const grid = computeInverseGrid(CONTRACT_LADDER, ES.tickValue, ES.initialMargin, seedBudgets())
  const row = (c: number) => grid.find(r => r.contracts === c)!

  it('3 contracts, 4 units -> 133 ticks', () => {
    expect(row(3).maxStopTicks[3]).toBe(133) // 5000 / 37.5 = 133.33 -> 133
  })

  it('margin used and $ risk/tick row headers', () => {
    expect(row(3).marginUsed).toBeCloseTo(68_940.3, 6) // 3 x 22,980.1
    expect(row(3).riskPerTick).toBe(37.5)
  })

  it('null margin -> marginUsed null, but maxStopTicks still computed', () => {
    const g = computeInverseGrid(CONTRACT_LADDER, ES.tickValue, null, seedBudgets())
    expect(g.every(r => r.marginUsed === null)).toBe(true)
    expect(g.find(r => r.contracts === 3)!.maxStopTicks[3]).toBe(133)
  })

  it('riskPerTick <= 0 guard: tick value 0 or null -> 0 ticks, no throw', () => {
    for (const tv of [0, null]) {
      const g = computeInverseGrid(CONTRACT_LADDER, tv, ES.initialMargin, seedBudgets())
      expect(g.every(r => r.maxStopTicks.every(t => t === 0))).toBe(true)
    }
  })

  it('empty contract ladder -> empty grid, no throw', () => {
    expect(computeInverseGrid([], ES.tickValue, ES.initialMargin, seedBudgets())).toEqual([])
  })
})

// ── End-to-end against the actual seeded database ───────────────────────────
// Everything above passes inputs directly, which validates the arithmetic but
// is blind to a bad seed. This test pulls ps_settings and the ES row out of
// the real SQLite file and must reproduce the workbook's ES grid-1 columns —
// a transposed digit in the seed fails here even though every unit test passes.

interface StatementLike {
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}
interface DatabaseLike {
  prepare(sql: string): StatementLike
  close(): void
}
type DatabaseCtor = new (path: string, opts?: { readonly?: boolean }) => DatabaseLike

describe('end-to-end from seeded SQLite', () => {
  // better-sqlite3 is a server dependency hoisted to the workspace root —
  // resolution walks up from this file and finds it there.
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3') as DatabaseCtor
  const dbPath = fileURLToPath(new URL('../../../fred_data.db', import.meta.url))

  it('ps_settings + ES row reproduce the workbook grid-1 columns', () => {
    const db = new Database(dbPath, { readonly: true })
    try {
      const settings = db.prepare('SELECT * FROM ps_settings WHERE id = 1').get() as {
        principle: number
        current_portfolio_value: number
        market_money_pct: number
        max_drawdown_pct: number
        unit_risk_pct: number
        max_units_risk_pct: number
      }
      const es = db.prepare('SELECT * FROM ps_instruments WHERE symbol = ?').get('ES') as {
        tick_size_decimal: number
        tick_value: number
        initial_margin: number | null
      }
      const stopLadder = (db.prepare('SELECT stop_ticks FROM ps_stop_ladder ORDER BY sort_order').all() as Array<{ stop_ticks: number }>).map(r => r.stop_ticks)

      const setup = deriveSetup({
        principle: settings.principle,
        currentPortfolioValue: settings.current_portfolio_value,
        marketMoneyPct: settings.market_money_pct,
        maxDrawdownPct: settings.max_drawdown_pct,
        unitRiskPct: settings.unit_risk_pct,
        maxUnitsRiskPct: settings.max_units_risk_pct,
      })
      expect(setup.currentRiskBudget).toBe(500_000)
      expect(setup.dollarBudgetPerUnit).toBe(1_250)
      expect(setup.maxRiskBudget).toBe(10_000)
      expect(setup.maxDrawdownDollars).toBe(25_000)

      const unitCount = deriveUnitCount(settings.unit_risk_pct, settings.max_units_risk_pct)
      expect(unitCount).toBe(8)
      const budgets = riskBudgetLadder(setup.dollarBudgetPerUnit, unitCount)
      expect(budgets).toEqual([1250, 2500, 3750, 5000, 6250, 7500, 8750, 10000])

      const grid = computeContractsGrid(stopLadder, es.tick_size_decimal, es.tick_value, budgets)
      const byTicks = (t: number) => grid.find(r => r.stopTicks === t)!
      expect(byTicks(20).contracts).toEqual([5, 10, 15, 20, 25, 30, 35, 40])
      expect(byTicks(40).contracts).toEqual([2, 5, 7, 10, 12, 15, 17, 20])
      expect(byTicks(60).contracts).toEqual([1, 3, 5, 6, 8, 10, 11, 13])
      expect(byTicks(120).contracts).toEqual([0, 1, 2, 3, 4, 5, 5, 6])
      expect(byTicks(200).contracts).toEqual([0, 1, 1, 2, 2, 3, 3, 4])

      // Grid 2 / 3 / 4 acceptance figures from the same seeded rows
      const margin = computeMarginGrid(grid, es.initial_margin)
      expect(margin.find(r => r.stopTicks === 20)!.marginRequired[0]).toBeCloseTo(114_900.5, 6)
      const actual = computeActualRiskGrid(grid)
      expect(actual.find(r => r.stopTicks === 40)!.actualRisk[0]).toBe(1000)
      const inverse = computeInverseGrid([3], es.tick_value, es.initial_margin, budgets)
      expect(inverse[0].maxStopTicks[3]).toBe(133)
    } finally {
      db.close()
    }
  })
})
