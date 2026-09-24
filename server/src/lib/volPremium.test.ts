import { describe, expect, it } from 'vitest'
import {
  PREMIUM_LOOKBACK_DAYS,
  computePremiumSeries,
  contributionBreakdown,
  premiumAndRatio,
  renormalizedRanges,
  type PremiumInput,
} from './volPremium'

function inputs(pairs: Array<[number | null, number | null]>): PremiumInput[] {
  return pairs.map(([move, rvMove], i) => ({
    date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    move, rvMove,
  }))
}

describe('premiumAndRatio', () => {
  it('premium is MOVE − RMOVE, ratio is MOVE / RMOVE', () => {
    expect(premiumAndRatio(120, 100)).toEqual({ premiumBp: 20, ratio: 1.2 })
    expect(premiumAndRatio(80, 100)).toEqual({ premiumBp: -20, ratio: 0.8 })
  })

  it('ratio is null when RMOVE is 0 — never Infinity', () => {
    const r = premiumAndRatio(120, 0)
    expect(r.premiumBp).toBe(120)
    expect(r.ratio).toBeNull()
  })

  it('both null when either side is null', () => {
    expect(premiumAndRatio(null, 100)).toEqual({ premiumBp: null, ratio: null })
    expect(premiumAndRatio(120, null)).toEqual({ premiumBp: null, ratio: null })
  })
})

describe('252-day window requirement', () => {
  it('lookback constant is 252', () => {
    expect(PREMIUM_LOOKBACK_DAYS).toBe(252)
  })

  it('z and percentile are null until the window is full, then populate', () => {
    // 252 observations → only the LAST one has a complete trailing window.
    const series = computePremiumSeries(
      inputs(Array.from({ length: 252 }, (_, i) => [100 + (i % 7), 100] as [number, number])),
    )
    expect(series).toHaveLength(252)
    expect(series.slice(0, 251).every(p => p.premiumZ252 === null)).toBe(true)
    expect(series.slice(0, 251).every(p => p.ratioPct252 === null)).toBe(true)
    expect(series[251].premiumZ252).not.toBeNull()
    expect(series[251].ratioPct252).not.toBeNull()
  })

  it('251 observations produce no z-score at all — not a partial window', () => {
    const series = computePremiumSeries(
      inputs(Array.from({ length: 251 }, (_, i) => [100 + (i % 5), 100] as [number, number])),
    )
    expect(series.every(p => p.premiumZ252 === null)).toBe(true)
    expect(series.every(p => p.premiumMean252 === null)).toBe(true)
  })

  it('a single null inside the trailing window nulls the z-score', () => {
    const pairs = Array.from({ length: 260 }, (_, i) => [100 + (i % 7), 100] as [number | null, number | null])
    pairs[10] = [null, 100]
    const series = computePremiumSeries(inputs(pairs))
    // Index 251's window is [0..251] and contains the hole → null.
    expect(series[251].premiumZ252).toBeNull()
    // Index 259's window is [8..259] and still contains index 10 → null.
    expect(series[259].premiumZ252).toBeNull()
    // Index 262 would clear it, but the series ends at 259; check the mechanism
    // directly with a shorter lookback instead.
    const short = computePremiumSeries(inputs(pairs), 5)
    expect(short[12].premiumZ252).toBeNull()   // window [8..12] contains 10
    expect(short[15].premiumZ252).not.toBeNull() // window [11..15] is clean
  })
})

describe('z-score arithmetic (centered, Bessel-corrected — correct for a level)', () => {
  it('a constant premium gives sd 0 and therefore a null z, not a divide-by-zero', () => {
    const series = computePremiumSeries(inputs(Array.from({ length: 252 }, () => [120, 100] as [number, number])))
    expect(series[251].premiumBp).toBe(20)
    expect(series[251].premiumSd252).toBe(0)
    expect(series[251].premiumZ252).toBeNull()
  })

  it('hand-checkable: window of 4 values 0,0,0,4 with lookback 4', () => {
    // premium values 0,0,0,4 → mean 1, sse = 1+1+1+9 = 12, var = 12/3 = 4, sd = 2
    // z at the last point = (4 − 1) / 2 = 1.5
    const series = computePremiumSeries(inputs([[100, 100], [100, 100], [100, 100], [104, 100]]), 4)
    expect(series[3].premiumMean252).toBeCloseTo(1, 12)
    expect(series[3].premiumSd252).toBeCloseTo(2, 12)
    expect(series[3].premiumZ252).toBeCloseTo(1.5, 12)
  })

  it('is centered — the premium level, not its second moment, is what is standardised', () => {
    // A steadily drifting premium: zero-mean would be large, centered is modest.
    // This asserts the CENTERED behaviour deliberately (see module header).
    const series = computePremiumSeries(inputs([[101, 100], [102, 100], [103, 100], [104, 100]]), 4)
    // values 1,2,3,4 → mean 2.5, var = (2.25+0.25+0.25+2.25)/3 = 5/3, sd ≈ 1.2910
    expect(series[3].premiumMean252).toBeCloseTo(2.5, 12)
    expect(series[3].premiumSd252).toBeCloseTo(Math.sqrt(5 / 3), 12)
    expect(series[3].premiumZ252).toBeCloseTo((4 - 2.5) / Math.sqrt(5 / 3), 12)
  })
})

describe('percentile rank', () => {
  it('the maximum of its window ranks at (n−1)/n × 100', () => {
    // ratios strictly increasing → last value beats the other 3 of 4.
    const series = computePremiumSeries(inputs([[100, 100], [110, 100], [120, 100], [130, 100]]), 4)
    expect(series[3].ratioPct252).toBeCloseTo(75, 12)
  })

  it('the minimum of its window ranks at 0', () => {
    const series = computePremiumSeries(inputs([[130, 100], [120, 100], [110, 100], [100, 100]]), 4)
    expect(series[3].ratioPct252).toBeCloseTo(0, 12)
  })

  it('ties count as not-below, so a flat window ranks 0', () => {
    const series = computePremiumSeries(inputs([[120, 100], [120, 100], [120, 100], [120, 100]]), 4)
    expect(series[3].ratioPct252).toBe(0)
  })
})

describe('contributionBreakdown', () => {
  it('weights × vols, with shares summing to 100', () => {
    const rows = contributionBreakdown([
      { tenor: '2y', weight: 0.20, rv: 100 },
      { tenor: '5y', weight: 0.20, rv: 100 },
      { tenor: '10y', weight: 0.40, rv: 50 },
      { tenor: '30y', weight: 0.20, rv: 100 },
    ])
    expect(rows.map(r => r.contribution)).toEqual([20, 20, 20, 20])
    expect(rows.reduce((s, r) => s + (r.sharePct ?? 0), 0)).toBeCloseTo(100, 10)
    expect(rows[2].sharePct).toBeCloseTo(25, 10)
  })

  it('shares still total 100 under renormalized weights', () => {
    const rows = contributionBreakdown([
      { tenor: '2y', weight: 0.25, rv: 50 },
      { tenor: '5y', weight: 0.25, rv: 50 },
      { tenor: '10y', weight: 0.50, rv: 100 },
      { tenor: '30y', weight: 0, rv: null },
    ])
    expect(rows[3].contribution).toBeNull()
    expect(rows.reduce((s, r) => s + (r.sharePct ?? 0), 0)).toBeCloseTo(100, 10)
  })

  it('a null tenor contributes null, not zero', () => {
    const rows = contributionBreakdown([{ tenor: '2y', weight: 0.2, rv: null }])
    expect(rows[0].contribution).toBeNull()
    expect(rows[0].sharePct).toBeNull()
  })
})

describe('renormalizedRanges', () => {
  const d = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString().slice(0, 10)

  it('collapses contiguous flagged dates into runs', () => {
    const rows = [false, true, true, true, false, false, true, false]
      .map((f, i) => ({ date: d(i), weightsRenormalized: f }))
    expect(renormalizedRanges(rows)).toEqual([
      { from: d(1), to: d(3), days: 3 },
      { from: d(6), to: d(6), days: 1 },
    ])
  })

  it('closes a run that reaches the end of the series', () => {
    const rows = [false, true, true].map((f, i) => ({ date: d(i), weightsRenormalized: f }))
    expect(renormalizedRanges(rows)).toEqual([{ from: d(1), to: d(2), days: 2 }])
  })

  it('returns nothing when no date is flagged — the real-data case', () => {
    const rows = [false, false, false].map((f, i) => ({ date: d(i), weightsRenormalized: f }))
    expect(renormalizedRanges(rows)).toEqual([])
  })
})
