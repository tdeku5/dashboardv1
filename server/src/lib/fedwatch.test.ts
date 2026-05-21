import { describe, expect, it } from 'vitest'
import {
  BPS_STEP,
  bucketRangeLabel,
  computeStepProbabilities,
  expandTree,
  expectedChangeBps,
  impliedMoves,
  solveMeetingScenario2,
  stepProbabilitiesAsDeltas,
} from './fedwatch'

// ── Test 1: CME PDF worked example (canonical sanity check) ─────────────────
//
// Lao & Mirza (2016), p. 4: Sept 17, 2015 FOMC meeting.
//   FFQ5 (Aug 2015, prior month) = 99.8675
//   FFU5 (Sept 2015, meeting)    = 99.8050
//   N = 30, M = 16 (= 17 - 1)
// Expected:
//   FFER(start)  = 100 - 99.8675 = 0.1325%
//   FFER(end)    = 0.26643%    (≈ 13.4 bp move)
//   P(+25 hike)  = 53.6%
//   P(no hike)   = 46.4%
// Tolerance: ±0.1pp on probability, ±0.05bp on rate.

describe('CME PDF Sept 2015 worked example', () => {
  const FFQ5 = 99.8675
  const FFU5 = 99.8050
  const N = 30
  const M = 16

  const priorMonthImplied = (100 - FFQ5) / 100         // 0.001325
  const meetingMonthImplied = (100 - FFU5) / 100       // 0.00195

  const { effrStart, effrEnd } = solveMeetingScenario2({
    priorMonthImplied,
    meetingMonthImplied,
    N,
    M,
  })

  it('reproduces FFER(start) = 0.1325%', () => {
    expect(effrStart * 100).toBeCloseTo(0.1325, 4)
  })

  it('reproduces FFER(end) ≈ 0.26643%', () => {
    expect(effrEnd * 100).toBeCloseTo(0.26643, 3)
  })

  it('reproduces ΔR ≈ 13.4 bp', () => {
    const dr = (effrEnd - effrStart) * 10000
    expect(dr).toBeCloseTo(13.4, 1)
  })

  it('produces P(+25 hike) = 53.6%, P(no hike) = 46.4% within ±0.1pp', () => {
    const probs = computeStepProbabilities({ effrStart, effrEnd })
    // We expect mass at 0.00 (unchanged from 0% grid) and at +0.25.
    // effrStart snaps to grid 0 (since 0.1325% rounds down to 0).
    const p0   = probs.find(p => Math.abs(p.bucketCenter - 0)        < 1e-9)?.prob ?? 0
    const p25  = probs.find(p => Math.abs(p.bucketCenter - BPS_STEP) < 1e-9)?.prob ?? 0
    // Tolerance: ±0.1pp = ±0.001 in fractional form.
    expect(p0 * 100).toBeCloseTo(46.4, 1)
    expect(p25 * 100).toBeCloseTo(53.6, 1)
  })
})

// ── Test 2: Two-meeting tree (hand-constructed) ─────────────────────────────
//
// Construct two meetings with known delta distributions and verify the
// convolution. This proves the tree mechanics are correct.
//
// Setup:
//   starting rate: 4.00%
//   meeting 1: 60% chance of +25bp, 40% unchanged
//   meeting 2: 30% chance of +25bp, 70% unchanged
// Expected after meeting 1:
//   4.00% (unchanged): 0.40
//   4.25% (+25):       0.60
// Expected after meeting 2:
//   4.00% (un, un):    0.40 × 0.70 = 0.28
//   4.25% (un,+25):    0.40 × 0.30 = 0.12
//                +     0.60 × 0.70 = 0.42  → 0.54
//   4.50% (+25,+25):   0.60 × 0.30 = 0.18
//   Total = 0.28 + 0.54 + 0.18 = 1.00 ✓

describe('two-meeting tree convolution', () => {
  const rows = expandTree({
    startingRate: 0.04,
    meetings: [
      {
        impliedEndRate: 0.0415,
        deltas: [
          { delta: 0, prob: 0.4 },
          { delta: BPS_STEP, prob: 0.6 },
        ],
      },
      {
        impliedEndRate: 0.04225,
        deltas: [
          { delta: 0, prob: 0.7 },
          { delta: BPS_STEP, prob: 0.3 },
        ],
      },
    ],
  })

  it('first meeting distribution: 40% at 4.00, 60% at 4.25', () => {
    const r1 = rows[0].bucketProbabilities
    expect(r1.get(0.04) ?? 0).toBeCloseTo(0.40, 6)
    expect(r1.get(0.0425) ?? 0).toBeCloseTo(0.60, 6)
  })

  it('second meeting distribution: 28% / 54% / 18%', () => {
    const r2 = rows[1].bucketProbabilities
    expect(r2.get(0.04) ?? 0).toBeCloseTo(0.28, 6)
    expect(r2.get(0.0425) ?? 0).toBeCloseTo(0.54, 6)
    expect(r2.get(0.045) ?? 0).toBeCloseTo(0.18, 6)
  })

  it('second-meeting row sums to 1', () => {
    const r2 = rows[1].bucketProbabilities
    const sum = Array.from(r2.values()).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
  })
})

// ── Test 3: ZLB edge case ───────────────────────────────────────────────────
//
// Setup:
//   starting rate: 0.00%
//   meeting 1: 30% chance of -25bp (would push below ZLB → redirect to
//              unchanged), 50% unchanged, 20% +25bp
// Expected: P(0%) = 30% + 50% = 80%, P(+25bp) = 20%
//
// The "decrease" branch is fully absorbed into "unchanged" because the
// path's pre-meeting rate is already at ZLB.

describe('ZLB redirect at zero', () => {
  const rows = expandTree({
    startingRate: 0,
    meetings: [
      {
        impliedEndRate: 0,
        deltas: [
          { delta: -BPS_STEP, prob: 0.30 },
          { delta: 0,         prob: 0.50 },
          { delta: BPS_STEP,  prob: 0.20 },
        ],
      },
    ],
  })

  it('absorbs the -25 mass into 0%', () => {
    const r = rows[0].bucketProbabilities
    expect(r.get(0) ?? 0).toBeCloseTo(0.80, 6)
    expect(r.get(BPS_STEP) ?? 0).toBeCloseTo(0.20, 6)
    expect(r.get(-BPS_STEP) ?? 0).toBe(0)
  })

  it('also redirects mass when effrEnd dips slightly below ZLB in computeStepProbabilities', () => {
    // effrStart at 0, effrEnd at -0.001 (-10bp). Should collapse to all
    // probability at the 0% bucket (the lower bound).
    const probs = computeStepProbabilities({ effrStart: 0, effrEnd: -0.001 })
    expect(probs).toHaveLength(1)
    expect(probs[0].bucketCenter).toBe(0)
    expect(probs[0].prob).toBe(1)
  })
})

// ── Test 4: Non-USD with proxy-to-policy spread ─────────────────────────────
//
// Replicate the ECB pattern: the underlying proxy rate (ESTR) sits ~10 bp
// below the policy rate (DFR). The methodology is applied on the proxy
// rate brackets; the spread is added only when forming display range labels.
//
// Setup:
//   proxy effrStart = 2.40% (representing ESTR), proxy effrEnd = 2.50%
//   proxyToPolicySpread = +10bp (ECB DFR is 10bp above ESTR)
// Expected:
//   ΔR (proxy) = 0.50 - 0.40 = 10bp
//   P(unchanged proxy bucket 2.50-2.75) = 60%
//   P(+25 proxy bucket 2.75-3.00)       = 40%
// After adding the +10bp spread for display labels:
//   "2.50-2.75" proxy → labelled as 2.60-2.85 policy range, etc.

describe('non-USD proxy-to-policy spread', () => {
  const effrStart = 0.0240
  const effrEnd = 0.0250
  const spread = 0.0010 // +10bp

  it('computes probabilities on the proxy grid independent of the spread', () => {
    const probs = computeStepProbabilities({ effrStart, effrEnd })
    // effrStart = 2.40% sits in [2.25, 2.50] bucket (floor). effrEnd = 2.50%
    // implies ΔR = 10bp = 0.4 × 25bp → 60% chance of "stay in current bucket"
    // (2.25), 40% chance of "+25 bp" (2.50). Same delta-fraction shape as the
    // CME methodology, on the proxy grid; the spread is added only at labeling.
    expect(probs).toHaveLength(2)
    const p225 = probs.find(p => Math.abs(p.bucketCenter - 0.0225) < 1e-9)?.prob ?? 0
    const p250 = probs.find(p => Math.abs(p.bucketCenter - 0.0250) < 1e-9)?.prob ?? 0
    expect(p225).toBeCloseTo(0.60, 6)
    expect(p250).toBeCloseTo(0.40, 6)
  })

  it('renders display labels with the policy spread applied', () => {
    expect(bucketRangeLabel(0.025, spread)).toBe('2.60-2.85')
    expect(bucketRangeLabel(0.0275, spread)).toBe('2.85-3.10')
  })

  it('does not affect zero-spread (US) labels', () => {
    expect(bucketRangeLabel(0.04, 0)).toBe('4.00-4.25')
  })
})

// ── Bonus: derived utility checks ───────────────────────────────────────────

describe('utility derivations', () => {
  it('expectedChangeBps rounds to 1 dp', () => {
    expect(expectedChangeBps(0.04, 0.0413)).toBe(13.0)
    expect(expectedChangeBps(0.04, 0.04125)).toBe(12.5)
  })

  it('impliedMoves rounds to 1 dp', () => {
    expect(impliedMoves(12.5)).toBe(0.5)
    expect(impliedMoves(-37.5)).toBe(-1.5)
    expect(impliedMoves(2.4)).toBe(0.1)
  })

  it('stepProbabilitiesAsDeltas matches stepProbabilities up to translation', () => {
    const start = 0.04
    const end = 0.0413  // +13bp from start, but snapped start grid is 4.00, so delta = +13bp / 25bp = 0.52
    const deltas = stepProbabilitiesAsDeltas({ effrStart: start, effrEnd: end })
    const sum = deltas.reduce((a, b) => a + b.prob, 0)
    expect(sum).toBeCloseTo(1, 6)
    const pPlus = deltas.find(d => Math.abs(d.delta - BPS_STEP) < 1e-9)?.prob ?? 0
    const p0 = deltas.find(d => Math.abs(d.delta) < 1e-9)?.prob ?? 0
    expect(pPlus).toBeCloseTo(0.52, 6)
    expect(p0).toBeCloseTo(0.48, 6)
  })
})
