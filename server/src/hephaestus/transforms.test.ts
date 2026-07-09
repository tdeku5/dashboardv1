import { describe, it, expect } from 'vitest'
import { applyTransform, computeDerived, frequencyBucket } from './transforms'
import type { Point } from './render'

const pts = (pairs: Array<[string, number]>): Point[] => pairs.map(([date, value]) => ({ date, value }))

describe('applyTransform', () => {
  const monthly = pts([
    ['2024-01-01', 100], ['2024-02-01', 102], ['2024-03-01', 104],
    ['2025-01-01', 110], ['2025-02-01', 112], ['2025-03-01', 108],
  ])

  it('level / undefined are identity', () => {
    expect(applyTransform(monthly, undefined)).toEqual(monthly)
    expect(applyTransform(monthly, { type: 'level' })).toEqual(monthly)
  })

  it('rebase100 bases on the first point', () => {
    const r = applyTransform(pts([['2024-01-01', 50], ['2024-02-01', 75]]), { type: 'rebase100' })
    expect(r).toEqual(pts([['2024-01-01', 100], ['2024-02-01', 150]]))
  })

  it('rebase100 throws on a zero base', () => {
    expect(() => applyTransform(pts([['2024-01-01', 0], ['2024-02-01', 1]]), { type: 'rebase100' }))
      .toThrow('cannot rebase')
  })

  it('yoy_pct compares to the observation one year back (calendar lookback)', () => {
    const r = applyTransform(monthly, { type: 'yoy_pct' })
    // Only 2025 points have a base 12 months earlier.
    expect(r.map(p => p.date)).toEqual(['2025-01-01', '2025-02-01', '2025-03-01'])
    expect(r[0].value).toBeCloseTo(10)                    // 110/100
    expect(r[1].value).toBeCloseTo((112 / 102 - 1) * 100)
  })

  it('yoy_pct skips points whose base is out of tolerance', () => {
    // Gap: nothing within 45 days of 1 year before 2025-06-01.
    const gappy = pts([['2024-01-01', 100], ['2025-06-01', 120]])
    expect(applyTransform(gappy, { type: 'yoy_pct' })).toEqual([])
  })

  it('mom_pct compares to the prior month', () => {
    const r = applyTransform(monthly, { type: 'mom_pct' })
    expect(r[0].date).toBe('2024-02-01')
    expect(r[0].value).toBeCloseTo(2)  // 102/100
  })

  it('diff subtracts N periods back (index-based)', () => {
    const r = applyTransform(pts([['a', 1], ['b', 3], ['c', 6]]), { type: 'diff', periods: 1 })
    expect(r).toEqual(pts([['b', 2], ['c', 3]]))
  })

  it('rolling_mean averages the trailing window', () => {
    const r = applyTransform(pts([['a', 1], ['b', 2], ['c', 3], ['d', 4]]), { type: 'rolling_mean', window: 2 })
    expect(r).toEqual(pts([['b', 1.5], ['c', 2.5], ['d', 3.5]]))
  })

  it('zscore standardizes within the rolling window', () => {
    const r = applyTransform(pts([['a', 1], ['b', 3], ['c', 5]]), { type: 'zscore', window: 2 })
    // window [1,3]: mean 2, std 1 → z(3)=1; window [3,5]: z(5)=1
    expect(r).toEqual(pts([['b', 1], ['c', 1]]))
  })

  it('zscore skips zero-variance windows', () => {
    const r = applyTransform(pts([['a', 2], ['b', 2], ['c', 4]]), { type: 'zscore', window: 2 })
    expect(r.map(p => p.date)).toEqual(['c'])
  })
})

describe('computeDerived — no-fill alignment (canonical rule)', () => {
  it('daily ⊖ daily aligns fully on shared dates', () => {
    const a = pts([['2026-01-01', 5], ['2026-01-02', 6]])
    const b = pts([['2026-01-01', 2], ['2026-01-02', 1]])
    expect(computeDerived('subtract', a, b)).toEqual(pts([['2026-01-01', 3], ['2026-01-02', 5]]))
  })

  it('daily ⊖ monthly yields at most monthly points — sparse-but-honest, no fill', () => {
    const daily = pts([
      ['2026-01-01', 10], ['2026-01-02', 11], ['2026-01-03', 12],
      ['2026-02-01', 13], ['2026-02-02', 14],
    ])
    const monthlyB = pts([['2026-01-01', 1], ['2026-02-01', 2]])
    const r = computeDerived('subtract', daily, monthlyB)
    // Only the two exact shared dates — the monthly gaps are NOT filled.
    expect(r).toEqual(pts([['2026-01-01', 9], ['2026-02-01', 11]]))
  })

  it('add and ratio compute correctly; ratio skips b=0', () => {
    const a = pts([['d1', 6], ['d2', 8]])
    const b = pts([['d1', 2], ['d2', 0]])
    expect(computeDerived('add', a, b)).toEqual(pts([['d1', 8], ['d2', 8]]))
    expect(computeDerived('ratio', a, b)).toEqual(pts([['d1', 3]]))
  })
})

describe('frequencyBucket', () => {
  it('normalizes catalog frequency strings', () => {
    expect(frequencyBucket('daily, close')).toBe('daily')
    expect(frequencyBucket('weekly, ending wednesday')).toBe('weekly')
    expect(frequencyBucket('quarterly, end of period')).toBe('quarterly')
    expect(frequencyBucket(null)).toBeNull()
  })
})
