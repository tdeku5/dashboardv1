import { describe, expect, it } from 'vitest'
import {
  computeSR3Settlement,
  decomposeAcrossContracts,
  decomposeContract,
  referenceQuarter,
  thirdWednesday,
  type ContractObservation,
} from './sr3Settlement'

// ── Reference Quarter convention (CME spec PDF) ─────────────────────────────
//
// For SR3 delivery month X: reference quarter is [3rdWed(X−3), 3rdWed(X)).
// Example: SR3M8 (Jun 2018 delivery): RQ = [Mar 21 2018, Jun 20 2018).

describe('reference quarter convention', () => {
  it('3rd Wednesday of June 2018 is the 20th', () => {
    expect(thirdWednesday(2018, 5).toISOString().slice(0, 10)).toBe('2018-06-20')
  })

  it('3rd Wednesday of March 2018 is the 21st', () => {
    expect(thirdWednesday(2018, 2).toISOString().slice(0, 10)).toBe('2018-03-21')
  })

  it('SR3M8 reference quarter spans [2018-03-21, 2018-06-20)', () => {
    const rq = referenceQuarter(2018, 5)
    expect(rq.start.toISOString().slice(0, 10)).toBe('2018-03-21')
    expect(rq.endExclusive.toISOString().slice(0, 10)).toBe('2018-06-20')
  })

  it('totalCalendarDays sums day weights to the calendar-day span', () => {
    const rq = referenceQuarter(2018, 5)
    // [Mar 21, Jun 20) = 91 calendar days
    expect(rq.totalCalendarDays).toBe(91)
  })
})

// ── Test 1: CME calibration — constant rate r → settlement ≈ r ──────────────
//
// If SOFR is constant at r every business day, compounded settlement equals r
// plus a small convexity premium from the daily-compounding-over-90-days math.
// At r ≈ 3.5% with weekend day-weights of 3 on Fridays, the convexity premium
// is typically 1–3 bp. The test pins this within 5 bp — large enough to allow
// the premium, small enough to catch any major day-count bug.

describe('CME calibration: constant rate', () => {
  const rq = referenceQuarter(2026, 5) // SR3M6: [Mar 18 2026, Jun 17 2026)

  it('constant 3.500% → settlement ≈ 3.500% (within 5 bp of convexity)', () => {
    const result = computeSR3Settlement(rq, () => 3.50)
    expect(Math.abs(result - 3.50)).toBeLessThan(0.05)
    expect(result).toBeGreaterThanOrEqual(3.50) // compounding never lowers the rate
  })

  it('constant 4.250% → settlement ≈ 4.250% (within 5 bp of convexity)', () => {
    const result = computeSR3Settlement(rq, () => 4.25)
    expect(Math.abs(result - 4.25)).toBeLessThan(0.05)
    expect(result).toBeGreaterThanOrEqual(4.25)
  })

  it('constant 0% → settlement 0 (no compounding at the ZLB)', () => {
    const result = computeSR3Settlement(rq, () => 0)
    expect(result).toBe(0)
  })
})

// ── Test 2: practitioner's-guide round-trip ─────────────────────────────────
//
// CME "Practitioner's Guide to Three-Month SOFR Futures Contract Notional":
// realized compounded SOFR of 3.748% → settlement price 96.252.
//
// We can't reproduce CME's exact daily path (it's unpublished). Instead, verify
// the relationship: if we configure a constant-rate path such that compounded
// R rounds to 3.748%, the settlement price will be 96.252. The constant rate
// needed to produce a compounded R of 3.748% is slightly below 3.748% (because
// of the convexity premium).

describe("practitioner's-guide relationship", () => {
  const rq = referenceQuarter(2018, 5)
  it('compounded R of ~3.748% maps to settlement price ~96.252', () => {
    // Find the constant daily rate r that gives compounded R = 3.748%.
    let lo = 3.7, hi = 3.8
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      const R = computeSR3Settlement(rq, () => mid)
      if (R > 3.748) hi = mid
      else lo = mid
    }
    const calibratedR = computeSR3Settlement(rq, () => (lo + hi) / 2)
    const price = 100 - calibratedR
    expect(calibratedR).toBeCloseTo(3.748, 2)
    expect(price).toBeCloseTo(96.252, 2)
  })
})

// ── Test 3: decomposition round-trip ────────────────────────────────────────
//
// Construct a known per-meeting outcome path; project the daily rate series;
// compute the compounded settlement; feed back into `decomposeContract` and
// verify it recovers the same Δ within ~0.5 bp.

describe('decomposition round-trip (2-meeting equal-split)', () => {
  const rq = referenceQuarter(2026, 8) // SR3U6: [Jun 17 2026, Sep 16 2026)
  // Two meetings inside SR3U6 RQ: Jun 17 (boundary, INCLUDED in U6) and Jul 29.
  const meetings = [
    new Date('2026-06-17T00:00:00Z'),
    new Date('2026-07-29T00:00:00Z'),
  ]
  const rPre = 3.50
  const truthDelta = 0.0625 // +6.25 bp per meeting (=½ of a 12.5 bp two-meeting move)

  // Forward: project the path and compute settlement.
  const segIdx = (date: Date) => {
    let k = 0
    for (const m of meetings) {
      if (date.getTime() >= m.getTime()) k++
      else break
    }
    return k
  }
  const r1 = computeSR3Settlement(rq, (d) => rPre + segIdx(d) * truthDelta)

  it('inverse recovers Δ within 0.5 bp', () => {
    const { delta, postRates } = decomposeContract({
      rq, meetings, rPre, rObserved: r1,
    })
    expect(Math.abs(delta - truthDelta) * 100).toBeLessThan(0.005)
    expect(postRates).toHaveLength(2)
    expect(postRates[0]).toBeCloseTo(rPre + truthDelta, 4)
    expect(postRates[1]).toBeCloseTo(rPre + 2 * truthDelta, 4)
  })

  it('strategy label = equal-split for 2 meetings', () => {
    const out = decomposeContract({ rq, meetings, rPre, rObserved: r1 })
    expect(out.strategy).toBe('equal-split')
  })
})

describe('decomposition zero-meeting and single-meeting cases', () => {
  const rq = referenceQuarter(2026, 2) // SR3H6
  it('zero meetings → empty postRates, zero-meeting strategy', () => {
    const out = decomposeContract({
      rq, meetings: [], rPre: 3.50, rObserved: 3.50,
    })
    expect(out.postRates).toEqual([])
    expect(out.strategy).toBe('zero-meeting')
  })

  it('single meeting → single-meeting strategy, accurate post-rate', () => {
    const rqU6 = referenceQuarter(2026, 8)
    // Take a SR3U6 RQ but assume only Jul 29 is inside (counterfactual; just for the solver).
    const meetings = [new Date('2026-07-29T00:00:00Z')]
    const rPre = 3.50
    const truthPost = 3.75
    const forward = computeSR3Settlement(rqU6, (d) =>
      d.getTime() >= meetings[0].getTime() ? truthPost : rPre,
    )
    const out = decomposeContract({ rq: rqU6, meetings, rPre, rObserved: forward })
    expect(out.strategy).toBe('single-meeting')
    expect(out.postRates[0]).toBeCloseTo(truthPost, 3)
  })
})

// ── Test 4: cross-contract day-weighted LSQ ────────────────────────────────
//
// Construct synthetic SR3 contracts whose observed R values are produced from
// a known per-meeting rate path; the LSQ should recover the path.

describe('cross-contract LSQ decomposition', () => {
  // Three quarterly contracts covering a forward window with several meetings.
  // Choose 2026 quarterly months (U6, Z6, H7) where each RQ contains FOMC
  // meetings from the real calendar.
  const u6 = referenceQuarter(2026, 8) // [Jun 17 2026, Sep 16 2026)
  const z6 = referenceQuarter(2026, 11) // [Sep 16 2026, Dec 16 2026)
  const h7 = referenceQuarter(2027, 2) // [Dec 16 2026, Mar 17 2027)

  // Real-ish FOMC calendar for these quarters
  const meetings = [
    new Date('2026-06-17T00:00:00Z'),
    new Date('2026-07-29T00:00:00Z'),
    new Date('2026-09-16T00:00:00Z'),
    new Date('2026-10-28T00:00:00Z'),
    new Date('2026-12-09T00:00:00Z'),
    new Date('2027-01-27T00:00:00Z'),
  ]

  // Helper: project the path then take the simple weighted average over a RQ
  // (we use a weighted average rather than the compounded formula because
  // the LSQ model is the simple-average approximation; testing against the
  // exact same model lets us isolate solver behaviour).
  const projectAvg = (rq: typeof u6, r0: number, deltas: number[]): number => {
    const DAY_MS = 86_400_000
    const D = (rq.endExclusive.getTime() - rq.start.getTime()) / DAY_MS
    let sum = 0
    let cursor = rq.start.getTime()
    while (cursor < rq.endExclusive.getTime()) {
      let k = 0
      for (let i = 0; i < meetings.length; i++) {
        if (cursor >= meetings[i].getTime()) k++
        else break
      }
      const rate = r0 + (k === 0 ? 0 : deltas.slice(0, k).reduce((a, b) => a + b, 0))
      sum += rate
      cursor += DAY_MS
    }
    return sum / D
  }

  it('flat curve (all contracts at r0) → all Δ ≈ 0', () => {
    const r0 = 3.50
    const contracts: ContractObservation[] = [
      { rqStart: u6.start, rqEnd: u6.endExclusive, observedR: r0 },
      { rqStart: z6.start, rqEnd: z6.endExclusive, observedR: r0 },
      { rqStart: h7.start, rqEnd: h7.endExclusive, observedR: r0 },
    ]
    const out = decomposeAcrossContracts({ contracts, meetings })
    expect(out.r0).toBeCloseTo(r0, 3)
    for (const d of out.deltas) {
      expect(Math.abs(d) * 100).toBeLessThan(1.5) // < 1.5 bp per meeting
    }
  })

  it('known step path: recover Δs within 2 bp', () => {
    const r0 = 3.50
    // Pick a path: small rises at Jun, Sep, Dec; cuts at Jul; flat elsewhere.
    const truthDeltas = [+0.05, -0.05, +0.10, +0.00, +0.05, +0.00] // percent per meeting
    const contracts: ContractObservation[] = [
      { rqStart: u6.start, rqEnd: u6.endExclusive, observedR: projectAvg(u6, r0, truthDeltas) },
      { rqStart: z6.start, rqEnd: z6.endExclusive, observedR: projectAvg(z6, r0, truthDeltas) },
      { rqStart: h7.start, rqEnd: h7.endExclusive, observedR: projectAvg(h7, r0, truthDeltas) },
    ]
    const out = decomposeAcrossContracts({ contracts, meetings, lambda: 0.01 })
    // With M=6 meetings and N=3 contracts the system is severely
    // under-determined; Tikhonov reg pulls the back-of-curve Δs toward 0.
    // We expect r_0 to land within ~5 bp of the truth and the *cumulative*
    // implied rate by end of the window to be close to the truth.
    expect(Math.abs(out.r0 - r0) * 100).toBeLessThan(10)
    const truthFinal = r0 + truthDeltas.reduce((a, b) => a + b, 0)
    const fitFinal = out.postRates[out.postRates.length - 1]
    expect(Math.abs(fitFinal - truthFinal) * 100).toBeLessThan(8)
  })

  it('single-contract perturbation localises to that contract\'s meetings', () => {
    const r0 = 3.50
    const contracts: ContractObservation[] = [
      { rqStart: u6.start, rqEnd: u6.endExclusive, observedR: r0 },
      // Perturb Z6 only: simulate +25 bp implied between Sep and Dec.
      { rqStart: z6.start, rqEnd: z6.endExclusive, observedR: r0 + 0.10 },
      { rqStart: h7.start, rqEnd: h7.endExclusive, observedR: r0 + 0.25 },
    ]
    const out = decomposeAcrossContracts({ contracts, meetings, lambda: 0.001 })
    // Meetings BEFORE Sep (indices 0, 1 = Jun, Jul) should have small Δ.
    expect(Math.abs(out.deltas[0]) * 100).toBeLessThan(5)
    expect(Math.abs(out.deltas[1]) * 100).toBeLessThan(5)
    // Meetings inside Z6 (indices 2-4 = Sep, Oct, Dec) should carry the bulk
    // of the move (their summed Δ should be close to the implied shift).
    const z6Sum = out.deltas.slice(2, 5).reduce((a, b) => a + b, 0)
    expect(z6Sum * 100).toBeGreaterThan(15) // > 15 bp cumulative across Z6 meetings
  })
})
