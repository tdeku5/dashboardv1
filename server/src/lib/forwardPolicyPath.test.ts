import { describe, expect, it } from 'vitest'
import {
  FORWARD_HORIZON_MONTHS,
  addCalendarMonths,
  forwardMinusTerminal,
  interpolateRateAtDate,
  toBpsRounded,
  type StripContract,
} from './forwardPolicyPath'

// Every expected number below is hand-derived from the published definition:
//   value  = lower + w × (upper − lower),  w = (t − t_lower) / (t_upper − t_lower)
//   bps    = (value − terminal) × 100, rounded to 2dp
//
// Quarterly strip anchored the way the real ones are: contract months are the
// first of Mar / Jun / Sep / Dec.
function strip(rates: Array<number | null>, startYear = 2026, startMonth = 12): StripContract[] {
  const MONTH_CODE = ['H', 'M', 'U', 'Z']
  return rates.map((r, i) => {
    const monthsOut = i * 3
    const d = new Date(Date.UTC(startYear, startMonth - 1 + monthsOut, 1))
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    return {
      symbol: `XX${MONTH_CODE[Math.floor((m - 3) / 3)] ?? 'Z'}${y % 10}`,
      expiryDate: `${y}-${String(m).padStart(2, '0')}-01`,
      impliedRate: r,
    }
  })
}

describe('addCalendarMonths', () => {
  it('shifts by whole calendar months, preserving day-of-month', () => {
    expect(addCalendarMonths('2026-10-08', 6)).toBe('2027-04-08')
    expect(addCalendarMonths('2026-10-08', 12)).toBe('2027-10-08')
    expect(addCalendarMonths('2026-01-15', 12)).toBe('2027-01-15')
  })

  it('normalizes a day that does not exist in the target month', () => {
    // 31 Jan + 1 month has no 31 Feb; JS rolls into March. Acceptable at these
    // horizons — documented in the module header.
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-03-03')
  })

  it('horizon constants are 6 and 12', () => {
    expect(FORWARD_HORIZON_MONTHS).toEqual({ '6m': 6, '12m': 12 })
  })
})

describe('interpolateRateAtDate — target between two contracts', () => {
  // Contracts: 2026-12-01 @ 4.00, 2027-03-01 @ 4.50, 2027-06-01 @ 5.00
  const cs = strip([4.00, 4.50, 5.00])

  it('brackets correctly and interpolates by hand arithmetic', () => {
    // Target 2027-04-10. Lower 2027-03-01, upper 2027-06-01.
    //   span = Mar 1 → Jun 1 = 92 days;  t − lower = Mar 1 → Apr 10 = 40 days
    //   w = 40/92 = 0.434782…
    //   value = 4.50 + 0.434782… × (5.00 − 4.50) = 4.50 + 0.2173913… = 4.7173913…
    const r = interpolateRateAtDate(cs, '2027-04-10')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.lower.expiryDate).toBe('2027-03-01')
    expect(r.rate.upper.expiryDate).toBe('2027-06-01')
    expect(r.rate.weight).toBeCloseTo(40 / 92, 12)
    expect(r.rate.value).toBeCloseTo(4.5 + (40 / 92) * 0.5, 12)
    expect(r.rate.value).toBeCloseTo(4.717391304348, 10)
  })

  it('the midpoint of a span is the mean of its endpoints', () => {
    // 2026-12-01 → 2027-03-01 is 90 days; +45 days = 2027-01-15.
    const r = interpolateRateAtDate(cs, '2027-01-15')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.weight).toBeCloseTo(0.5, 12)
    expect(r.rate.value).toBeCloseTo(4.25, 12)
  })
})

describe('interpolateRateAtDate — target exactly on a contract date', () => {
  const cs = strip([4.00, 4.50, 5.00])

  it('returns that contract rate with weight 0 on the first contract', () => {
    const r = interpolateRateAtDate(cs, '2026-12-01')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.value).toBe(4.00)
    expect(r.rate.weight).toBe(0)
    expect(r.rate.lower.expiryDate).toBe('2026-12-01')
    expect(r.rate.upper.expiryDate).toBe('2026-12-01')
  })

  it('returns that contract rate with weight 1 on an interior contract', () => {
    const r = interpolateRateAtDate(cs, '2027-03-01')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.value).toBeCloseTo(4.50, 12)
    expect(r.rate.weight).toBeCloseTo(1, 12)
  })

  it('returns the last contract rate on the final contract date', () => {
    const r = interpolateRateAtDate(cs, '2027-06-01')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.value).toBeCloseTo(5.00, 12)
  })
})

describe('interpolateRateAtDate — no extrapolation', () => {
  const cs = strip([4.00, 4.50, 5.00])   // 2026-12-01 … 2027-06-01

  it('a target before the strip returns before-strip, not the front rate', () => {
    const r = interpolateRateAtDate(cs, '2026-11-30')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('before-strip')
    expect(r.targetDate).toBe('2026-11-30')
  })

  it('a target after the strip returns after-strip, not clamped to the last rate', () => {
    const r = interpolateRateAtDate(cs, '2027-06-02')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('after-strip')
  })

  it('an empty strip returns no-contracts', () => {
    const r = interpolateRateAtDate([], '2027-04-10')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-contracts')
  })

  it('contracts with a null rate are skipped, not read as zero', () => {
    // Null at index 1 → the 2027-04-10 target now brackets 2026-12-01 / 2027-06-01.
    const holed = strip([4.00, null, 5.00])
    const r = interpolateRateAtDate(holed, '2027-04-10')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rate.lower.expiryDate).toBe('2026-12-01')
    expect(r.rate.upper.expiryDate).toBe('2027-06-01')
    // Dec 1 → Jun 1 = 182 days; Dec 1 → Apr 10 = 130 days.
    expect(r.rate.weight).toBeCloseTo(130 / 182, 12)
    expect(r.rate.value).toBeCloseTo(4 + (130 / 182) * 1, 12)
    // If null had been read as 0 the value would have collapsed well below 4.
    expect(r.rate.value).toBeGreaterThan(4)
  })
})

describe('forwardMinusTerminal — a rising (hiking) path', () => {
  // 2026-12-01 4.00 | 2027-03-01 4.50 | 2027-06-01 5.00 | 2027-09-01 5.20
  // | 2027-12-01 5.25 | 2028-03-01 5.25 — terminal is the plateau at 5.25.
  const cs = strip([4.00, 4.50, 5.00, 5.20, 5.25, 5.25])
  const TERMINAL = 5.25
  const ANCHOR = '2026-10-08'

  it('+6M sits below terminal → negative bps', () => {
    // Target 2027-04-08. Lower 2027-03-01 (4.50), upper 2027-06-01 (5.00).
    //   span = 92 days, offset = 38 days, w = 38/92 = 0.413043…
    //   value = 4.50 + 0.413043… × 0.50 = 4.706521…
    //   bps = (4.706521… − 5.25) × 100 = −54.35
    const r = forwardMinusTerminal(cs, ANCHOR, 6, TERMINAL)
    expect(r.targetDate).toBe('2027-04-08')
    expect(r.failure).toBeNull()
    expect(r.detail?.weight).toBeCloseTo(38 / 92, 12)
    expect(r.detail?.value).toBeCloseTo(4.5 + (38 / 92) * 0.5, 12)
    expect(r.bps).toBe(-54.35)
    expect(r.bps as number).toBeLessThan(0)
  })

  it('+12M sits closer to terminal → still negative but smaller', () => {
    // Target 2027-10-08. Lower 2027-09-01 (5.20), upper 2027-12-01 (5.25).
    //   span = 91 days, offset = 37 days, w = 37/91 = 0.406593…
    //   value = 5.20 + 0.406593… × 0.05 = 5.22033…
    //   bps = (5.22033… − 5.25) × 100 = −2.97
    const r = forwardMinusTerminal(cs, ANCHOR, 12, TERMINAL)
    expect(r.targetDate).toBe('2027-10-08')
    expect(r.bps).toBe(-2.97)
    const six = forwardMinusTerminal(cs, ANCHOR, 6, TERMINAL).bps as number
    expect(Math.abs(r.bps as number)).toBeLessThan(Math.abs(six))
  })
})

describe('forwardMinusTerminal — an inverted (cutting) path, terminal is a trough', () => {
  // Falling then flat: terminal is the trough at 2.00, so points before it sit
  // ABOVE terminal and the column must come out POSITIVE.
  const cs = strip([4.00, 3.40, 2.80, 2.30, 2.00, 2.00])
  const TERMINAL = 2.00
  const ANCHOR = '2026-10-08'

  it('+6M is above the trough → positive bps', () => {
    // Target 2027-04-08: lower 2027-03-01 (3.40), upper 2027-06-01 (2.80).
    //   w = 38/92; value = 3.40 + (38/92) × (2.80 − 3.40) = 3.40 − 0.247826… = 3.152173…
    //   bps = (3.152173… − 2.00) × 100 = +115.22
    const r = forwardMinusTerminal(cs, ANCHOR, 6, TERMINAL)
    expect(r.bps).toBe(115.22)
    expect(r.bps as number).toBeGreaterThan(0)
  })

  it('+12M is also above the trough, but nearer it', () => {
    // Target 2027-10-08: lower 2027-09-01 (2.30), upper 2027-12-01 (2.00).
    //   w = 37/91; value = 2.30 + (37/91) × (−0.30) = 2.17802…
    //   bps = +17.80
    const r = forwardMinusTerminal(cs, ANCHOR, 12, TERMINAL)
    expect(r.bps).toBe(17.8)
    expect(r.bps as number).toBeGreaterThan(0)
  })
})

describe('forwardMinusTerminal — target past the terminal contract (the AU shape)', () => {
  // AU's live shape: terminal early (a hump at index 2), then the path drifts
  // back down. A target beyond the terminal must come out NEGATIVE.
  const cs = strip([4.84, 4.94, 4.98, 4.97, 4.94, 4.90])
  const TERMINAL = 4.98   // index 2, 2027-06-01 — the hump
  const ANCHOR = '2026-10-08'

  it('+12M lands past the terminal contract and is negative', () => {
    // Target 2027-10-08: lower 2027-09-01 (4.97), upper 2027-12-01 (4.94).
    //   w = 37/91; value = 4.97 + (37/91) × (−0.03) = 4.957802…
    //   bps = (4.957802… − 4.98) × 100 = −2.22
    const r = forwardMinusTerminal(cs, ANCHOR, 12, TERMINAL)
    expect(r.bps).toBe(-2.22)
    expect(r.bps as number).toBeLessThan(0)
    expect(r.detail?.lower.expiryDate).toBe('2027-09-01')
    expect(r.detail?.upper.expiryDate).toBe('2027-12-01')
  })
})

describe('forwardMinusTerminal — out of range returns null with a reason', () => {
  // The Canada shape after the December roll: a 5-contract strip ending
  // 2027-12-01, read from a 2027-01-05 curveDate → +12M = 2028-01-05.
  const cs = strip([2.60, 2.88, 3.09, 3.25, 3.37])   // 2026-12-01 … 2027-12-01

  it('+12M beyond the last contract is null, flagged after-strip', () => {
    const r = forwardMinusTerminal(cs, '2027-01-05', 12, 3.37)
    expect(r.targetDate).toBe('2028-01-05')
    expect(r.bps).toBeNull()
    expect(r.failure).toBe('after-strip')
    expect(r.detail).toBeNull()
  })

  it('from the current curveDate the same strip DOES reach +12M', () => {
    const r = forwardMinusTerminal(cs, '2026-10-08', 12, 3.37)
    expect(r.targetDate).toBe('2027-10-08')
    expect(r.failure).toBeNull()
    expect(r.bps).not.toBeNull()
  })

  it('a null terminal yields null bps but keeps the interpolation detail', () => {
    const r = forwardMinusTerminal(cs, '2026-10-08', 6, null)
    expect(r.bps).toBeNull()
    expect(r.failure).toBeNull()
    expect(r.detail).not.toBeNull()
  })

  it('null is returned, never 0', () => {
    const r = forwardMinusTerminal(cs, '2027-01-05', 12, 3.37)
    expect(r.bps).not.toBe(0)
    expect(r.bps).toBeNull()
  })
})

describe('toBpsRounded matches the existing payload convention', () => {
  it('rounds to 2dp', () => {
    expect(toBpsRounded(0.0543478)).toBe(5.43)
    expect(toBpsRounded(-0.0297)).toBe(-2.97)
    expect(toBpsRounded(0)).toBe(0)
  })
})
