import { describe, expect, it } from 'vitest'
import {
  BP_PER_YIELD_UNIT,
  MOVE_WEIGHTS,
  RV_WINDOW_DAYS,
  TENORS,
  TRADING_DAYS_PER_YEAR,
  YIELD_QUOTE_CONVENTION,
  blendMove,
  computeRealizedMoveSeries,
  realizedVolFromDeltas,
  rollingRealizedVol,
  toBasisPoints,
  type TenorKey,
  type YieldPoint,
} from './realizedMove'

// Hand-checkable fixtures. Every expected value below is derived from the
// published construction, not from a previous run of this code:
//
//   σ = sqrt( (252 / 21) × Σ Δy² )          Δy in bp, zero-mean
//   RMOVE = 0.20·σ_2y + 0.20·σ_5y + 0.40·σ_10y + 0.20·σ_30y
//
// √252 = 15.874507866387544 — the value a 1bp/day window annualizes to, since
// (252/21) × (21 × 1²) = 252.

const SQRT_252 = Math.sqrt(252)

/** Yield points in percent, labelled sequentially — labels are inert here. */
function seriesFromDailyStepPct(start: number, stepPct: number, n: number): YieldPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `D${String(i).padStart(3, '0')}`,
    value: start + i * stepPct,
  }))
}

function flatTenors(sigmas: Partial<Record<TenorKey, number | null>>): Record<TenorKey, number | null> {
  return {
    '2y': sigmas['2y'] ?? null,
    '5y': sigmas['5y'] ?? null,
    '10y': sigmas['10y'] ?? null,
    '30y': sigmas['30y'] ?? null,
  }
}

// ── Constants are what the spec says ─────────────────────────────────────────

describe('constants', () => {
  it('window is 21 trading days and annualization is 252', () => {
    expect(RV_WINDOW_DAYS).toBe(21)
    expect(TRADING_DAYS_PER_YEAR).toBe(252)
  })

  it('weights are 20/20/40/20 and sum to 1', () => {
    expect(MOVE_WEIGHTS).toEqual({ '2y': 0.20, '5y': 0.20, '10y': 0.40, '30y': 0.20 })
    expect(TENORS.reduce((s, t) => s + MOVE_WEIGHTS[t], 0)).toBeCloseTo(1, 12)
  })

  it('asserts percent quoting per Phase 0-B', () => {
    expect(YIELD_QUOTE_CONVENTION).toBe('percent')
    expect(BP_PER_YIELD_UNIT).toBe(100)
  })
})

// ── Test 1 — the zero-mean guard ─────────────────────────────────────────────

describe('test 1: constant +1bp daily change for 21 days', () => {
  it('returns sqrt(252) ≈ 15.87 bp', () => {
    // Σ Δy² = 21 × 1² = 21  →  σ = sqrt((252/21) × 21) = sqrt(252)
    const deltas = Array<number>(21).fill(1)
    const sigma = realizedVolFromDeltas(deltas)
    expect(sigma).not.toBeNull()
    expect(sigma as number).toBeCloseTo(SQRT_252, 12)
    expect(sigma as number).toBeCloseTo(15.8745078664, 9)
  })

  it('is NOT the centered estimator — a centered implementation returns ~0 here', () => {
    // Every change equals the window mean, so centered variance is identically
    // zero. This assertion is what fails if someone "corrects" the module to
    // textbook sample variance. See the header note in realizedMove.ts.
    const deltas = Array<number>(21).fill(1)
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
    const centered = Math.sqrt(
      (TRADING_DAYS_PER_YEAR / (deltas.length - 1)) *
        deltas.reduce((s, d) => s + (d - mean) ** 2, 0),
    )
    expect(centered).toBeCloseTo(0, 12)
    expect(realizedVolFromDeltas(deltas) as number).toBeGreaterThan(15)
  })
})

// ── Test 2 ───────────────────────────────────────────────────────────────────

describe('test 2: alternating +1 / −1 bp', () => {
  it('also returns sqrt(252) ≈ 15.87 bp', () => {
    // Σ Δy² = 21 × 1² = 21 again — squaring is sign-blind.
    const deltas = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 1 : -1))
    const sigma = realizedVolFromDeltas(deltas)
    expect(sigma as number).toBeCloseTo(SQRT_252, 12)
  })

  it('matches test 1 exactly, since only the squares enter', () => {
    const constant = realizedVolFromDeltas(Array<number>(21).fill(1))
    const alternating = realizedVolFromDeltas(Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 1 : -1)))
    expect(alternating).toBe(constant)
  })
})

// ── Test 3 ───────────────────────────────────────────────────────────────────

describe('test 3: all four tenors at 100 bp', () => {
  it('blends to 100 — the weights sum to 1', () => {
    // 0.20(100) + 0.20(100) + 0.40(100) + 0.20(100) = 100
    const blend = blendMove(flatTenors({ '2y': 100, '5y': 100, '10y': 100, '30y': 100 }))
    expect(blend.rvMove).toBeCloseTo(100, 12)
    expect(blend.weightsRenormalized).toBe(false)
    expect(blend.contributing).toEqual(['2y', '5y', '10y', '30y'])
  })
})

// ── Test 4 ───────────────────────────────────────────────────────────────────
//
// SPEC DEVIATION (flagged at the Phase 1 gate). docs/prompts/…-realized-move.md
// states this case expects 75. The stock weights give:
//
//   0.20(50) + 0.20(50) + 0.40(100) + 0.20(50) = 10 + 10 + 40 + 10 = 70
//
// 75 is the correct answer to test 5 (see below), so the two expectations look
// transposed in the spec. The 20/20/40/20 weighting is stated three separate
// times in the spec and is the authority here, so the formula wins and the
// expected value is 70.

describe('test 4: tenors at 50 / 50 / 100 / 50', () => {
  it('blends to 70 bp (spec says 75 — spec arithmetic error, see comment)', () => {
    const blend = blendMove(flatTenors({ '2y': 50, '5y': 50, '10y': 100, '30y': 50 }))
    expect(blend.rvMove).toBeCloseTo(70, 12)
    expect(blend.weightsRenormalized).toBe(false)
  })

  it('the 10y dominates: it contributes 40 of the 70', () => {
    // Exactly the asymmetry the Phase 2 contribution table is meant to surface.
    const blend = blendMove(flatTenors({ '2y': 50, '5y': 50, '10y': 100, '30y': 50 }))
    expect((blend.appliedWeights['10y'] as number) * 100).toBeCloseTo(40, 12)
    expect((blend.appliedWeights['2y'] as number) * 50).toBeCloseTo(10, 12)
  })
})

// ── Test 5 ───────────────────────────────────────────────────────────────────
//
// SPEC DEVIATION (flagged at the Phase 1 gate). The spec states 62.5 for this
// case, but also states — twice, explicitly — that a missing 30y renormalizes
// to 0.25 / 0.25 / 0.50. Applying those stated weights:
//
//   0.25(50) + 0.25(50) + 0.50(100) = 12.5 + 12.5 + 50 = 75
//
// The renormalized weights are stated verbatim in the spec, so they are the
// authority. 62.5 IS reachable, but only for a different case — a missing 2y
// with 5y/10y/30y at 50/50/100 — which is covered separately below.

describe('test 5: 30y null, remaining tenors at 50 / 50 / 100', () => {
  it('renormalizes to 0.25 / 0.25 / 0.50 and sets the flag', () => {
    const blend = blendMove(flatTenors({ '2y': 50, '5y': 50, '10y': 100, '30y': null }))
    expect(blend.weightsRenormalized).toBe(true)
    expect(blend.contributing).toEqual(['2y', '5y', '10y'])
    expect(blend.appliedWeights['2y']).toBeCloseTo(0.25, 12)
    expect(blend.appliedWeights['5y']).toBeCloseTo(0.25, 12)
    expect(blend.appliedWeights['10y']).toBeCloseTo(0.50, 12)
    expect(blend.appliedWeights['30y']).toBeUndefined()
  })

  it('blends to 75 bp (spec says 62.5 — spec arithmetic error, see comment)', () => {
    const blend = blendMove(flatTenors({ '2y': 50, '5y': 50, '10y': 100, '30y': null }))
    expect(blend.rvMove).toBeCloseTo(75, 12)
  })

  it('renormalized weights always sum to 1, whichever tenor is missing', () => {
    for (const missing of TENORS) {
      const sigmas = flatTenors({ '2y': 10, '5y': 10, '10y': 10, '30y': 10 })
      sigmas[missing] = null
      const blend = blendMove(sigmas)
      const sum = TENORS.reduce((s, t) => s + (blend.appliedWeights[t] ?? 0), 0)
      expect(sum).toBeCloseTo(1, 12)
      expect(blend.weightsRenormalized).toBe(true)
      // All survivors at 10 ⇒ any convex combination is 10.
      expect(blend.rvMove).toBeCloseTo(10, 12)
    }
  })

  it('the 62.5 case: 2y null with 5y / 10y / 30y at 50 / 50 / 100', () => {
    // Surviving weights 0.20 / 0.40 / 0.20 sum to 0.80 → 0.25 / 0.50 / 0.25.
    // 0.25(50) + 0.50(50) + 0.25(100) = 12.5 + 25 + 25 = 62.5
    const blend = blendMove(flatTenors({ '2y': null, '5y': 50, '10y': 50, '30y': 100 }))
    expect(blend.rvMove).toBeCloseTo(62.5, 12)
    expect(blend.weightsRenormalized).toBe(true)
  })
})

// ── Test 6 ───────────────────────────────────────────────────────────────────

describe('test 6: two tenors null', () => {
  it('returns null with the flag NOT set', () => {
    const blend = blendMove(flatTenors({ '2y': 50, '5y': 50, '10y': null, '30y': null }))
    expect(blend.rvMove).toBeNull()
    expect(blend.weightsRenormalized).toBe(false)
    expect(blend.contributing).toEqual([])
  })

  it('holds for three and four missing too', () => {
    expect(blendMove(flatTenors({ '10y': 50 })).rvMove).toBeNull()
    expect(blendMove(flatTenors({})).rvMove).toBeNull()
    expect(blendMove(flatTenors({})).weightsRenormalized).toBe(false)
  })
})

// ── Test 7 ───────────────────────────────────────────────────────────────────

describe('test 7: short window', () => {
  it('20 valid observations returns null, not a scaled partial', () => {
    const twenty = Array<number>(20).fill(1)
    expect(realizedVolFromDeltas(twenty)).toBeNull()
    // The scaled-partial answer would have been sqrt((252/21) × 20) ≈ 15.49 —
    // a plausible-looking number, which is exactly why it must not be returned.
    expect(Math.sqrt((252 / 21) * 20)).toBeCloseTo(15.4919333848, 9)
  })

  it('22 observations also returns null — the window is exactly 21', () => {
    expect(realizedVolFromDeltas(Array<number>(22).fill(1))).toBeNull()
  })

  it('a 21-point yield series yields only 20 deltas, so every date is null', () => {
    // 21 observations → 20 changes → never a full window.
    const points = seriesFromDailyStepPct(4.0, 0.01, 21)
    const rolled = rollingRealizedVol(points)
    expect(rolled).toHaveLength(21)
    expect(rolled.every(p => p.sigma === null)).toBe(true)
    expect(rolled[20].nObs).toBe(20)
  })

  it('the 22nd observation is the first with a full window', () => {
    const points = seriesFromDailyStepPct(4.0, 0.01, 22)
    const rolled = rollingRealizedVol(points)
    expect(rolled[20].sigma).toBeNull()
    expect(rolled[21].sigma).not.toBeNull()
    expect(rolled[21].nObs).toBe(21)
  })

  it('a non-finite change nulls the window rather than dropping the observation', () => {
    const deltas = Array<number>(21).fill(1)
    deltas[7] = Number.NaN
    expect(realizedVolFromDeltas(deltas)).toBeNull()
  })
})

// ── Test 8 ───────────────────────────────────────────────────────────────────

describe('test 8: unit conversion', () => {
  it('a 0.01 move in the 10y registers as 1 bp, not 0.01', () => {
    expect(toBasisPoints(0.01)).toBeCloseTo(1, 12)
    expect(toBasisPoints(4.26 - 4.25)).toBeCloseTo(1, 12)
  })

  it('a percent-quoted series stepping 0.01/day annualizes to sqrt(252)', () => {
    // If the module treated 0.01 as 0.01bp, this would come out 100× smaller.
    const points = seriesFromDailyStepPct(4.25, 0.01, 22)
    const rolled = rollingRealizedVol(points)
    const sigma = rolled[21].sigma as number
    expect(sigma).toBeCloseTo(SQRT_252, 9)
    expect(sigma).toBeGreaterThan(15)
  })

  it('a decimal-quoted series would come out 100× too small — the trap this guards', () => {
    const decimalQuoted = seriesFromDailyStepPct(0.0425, 0.0001, 22)
    const sigma = rollingRealizedVol(decimalQuoted)[21].sigma as number
    expect(sigma).toBeCloseTo(SQRT_252 / 100, 9)
  })
})

// ── Ordering-only: the raw-UTC date-label trap ───────────────────────────────
//
// tv_series bars carry Europe/London midnight epochs, and the terminal's plain
// UTC truncation labels BST sessions with the PREVIOUS calendar date — Monday
// sessions appear as Sunday, Fridays are undercounted (Sun 123 / Fri 64 over
// three years of US10Y). Any weekday filter would silently drop real sessions.
// See docs/tradingview-date-convention.md.

describe('date labels are inert — ordering only, never weekday filtering', () => {
  const VALUES = Array.from({ length: 22 }, (_, i) => 4.0 + i * 0.013)

  it('a Sunday-labelled fixture gives the same vol as a Monday-labelled one', () => {
    // 2026-09-20 is a Sunday; 2026-09-21 is the Monday session it really is.
    // Both fixtures hold identical values in identical order.
    const sundayLabelled: YieldPoint[] = VALUES.map((v, i) => ({
      date: new Date(Date.UTC(2026, 8, 20) + i * 86_400_000).toISOString().slice(0, 10),
      value: v,
    }))
    const mondayLabelled: YieldPoint[] = VALUES.map((v, i) => ({
      date: new Date(Date.UTC(2026, 8, 21) + i * 86_400_000).toISOString().slice(0, 10),
      value: v,
    }))

    expect(new Date(sundayLabelled[0].date + 'T00:00:00Z').getUTCDay()).toBe(0)
    expect(new Date(mondayLabelled[0].date + 'T00:00:00Z').getUTCDay()).toBe(1)

    const a = rollingRealizedVol(sundayLabelled)
    const b = rollingRealizedVol(mondayLabelled)
    expect(a.map(p => p.sigma)).toEqual(b.map(p => p.sigma))
    expect(a.map(p => p.nObs)).toEqual(b.map(p => p.nObs))
    expect(a[21].sigma).not.toBeNull()
  })

  it('an all-weekend-labelled fixture still computes — nothing is excluded', () => {
    // Every label is a Saturday or Sunday. A business-day filter would empty
    // this and return null; ordering-only returns a real number.
    const weekendOnly: YieldPoint[] = VALUES.map((v, i) => {
      const base = Date.UTC(2026, 8, 19) + Math.floor(i / 2) * 7 * 86_400_000 + (i % 2) * 86_400_000
      return { date: new Date(base).toISOString().slice(0, 10), value: v }
    })
    for (const p of weekendOnly) {
      const dow = new Date(p.date + 'T00:00:00Z').getUTCDay()
      expect(dow === 0 || dow === 6).toBe(true)
    }
    expect(rollingRealizedVol(weekendOnly)[21].sigma).not.toBeNull()
  })

  it('consecutive observations are differenced across a calendar gap, not through it', () => {
    // A 3-day weekend gap is one observation-to-observation change, not three.
    const withGap: YieldPoint[] = VALUES.map((v, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 3 * 86_400_000).toISOString().slice(0, 10),
      value: v,
    }))
    const contiguous: YieldPoint[] = VALUES.map((v, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      value: v,
    }))
    expect(rollingRealizedVol(withGap)[21].sigma).toBeCloseTo(
      rollingRealizedVol(contiguous)[21].sigma as number, 12,
    )
  })
})

// ── Series assembly ──────────────────────────────────────────────────────────

describe('computeRealizedMoveSeries', () => {
  function constantStep(step: number, n = 30): YieldPoint[] {
    return Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      value: 4 + i * step,
    }))
  }

  it('emits one row per union date, nulls before the window fills', () => {
    const rows = computeRealizedMoveSeries({
      '2y': constantStep(0.01), '5y': constantStep(0.01),
      '10y': constantStep(0.01), '30y': constantStep(0.01),
    })
    expect(rows).toHaveLength(30)
    expect(rows.slice(0, 21).every(r => r.rvMove === null)).toBe(true)
    expect(rows[21].rvMove).toBeCloseTo(SQRT_252, 9)
    expect(rows[21].nObs).toBe(21)
    expect(rows[21].weightsRenormalized).toBe(false)
  })

  it('rows are sorted ascending by date', () => {
    const rows = computeRealizedMoveSeries({
      '2y': constantStep(0.01), '5y': constantStep(0.02),
      '10y': constantStep(0.03), '30y': constantStep(0.04),
    })
    const dates = rows.map(r => r.date)
    expect(dates).toEqual([...dates].sort())
  })

  it('weights the blend correctly across differing tenor vols', () => {
    // Steps of 1/1/2/1 bp per day → σ of 1/1/2/1 × sqrt(252).
    // 0.20(1) + 0.20(1) + 0.40(2) + 0.20(1) = 1.4 × sqrt(252)
    const rows = computeRealizedMoveSeries({
      '2y': constantStep(0.01), '5y': constantStep(0.01),
      '10y': constantStep(0.02), '30y': constantStep(0.01),
    })
    expect(rows[21].rvMove).toBeCloseTo(1.4 * SQRT_252, 9)
    expect(rows[21].rv['10y'] as number).toBeCloseTo(2 * SQRT_252, 9)
  })

  it('a tenor short of history renormalizes on the affected dates only', () => {
    // The 30y starts 5 observations late, so its window fills 5 rows later.
    const full = constantStep(0.01, 30)
    const short = full.slice(5)
    const rows = computeRealizedMoveSeries({
      '2y': full, '5y': full, '10y': full, '30y': short,
    })
    // Rows 21..25: 2s/5s/10s have full windows, the 30y does not → renormalized.
    for (let i = 21; i <= 25; i++) {
      expect(rows[i].rv['30y']).toBeNull()
      expect(rows[i].weightsRenormalized).toBe(true)
      expect(rows[i].rvMove).toBeCloseTo(SQRT_252, 9)
    }
    // Row 26 onward: all four present, no renormalization.
    expect(rows[26].rv['30y']).not.toBeNull()
    expect(rows[26].weightsRenormalized).toBe(false)
  })

  it('never fabricates: a date missing from a tenor stays null for that tenor', () => {
    const full = constantStep(0.01, 30)
    const holed = full.filter((_, i) => i !== 25)
    const rows = computeRealizedMoveSeries({
      '2y': full, '5y': full, '10y': full, '30y': holed,
    })
    const row = rows.find(r => r.date === full[25].date)
    expect(row).toBeDefined()
    expect((row as { rv: Record<TenorKey, number | null> }).rv['30y']).toBeNull()
  })

  it('returns an empty series for empty input', () => {
    expect(computeRealizedMoveSeries({ '2y': [], '5y': [], '10y': [], '30y': [] })).toEqual([])
  })
})
