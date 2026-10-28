import { describe, it, expect } from 'vitest'
import { niceAxis } from './niceTicks'

const labels = (t: number[], dp: number) => t.map(v => v.toFixed(dp))
const steps = (t: number[]) => t.slice(1).map((v, i) => +(v - t[i]).toFixed(9))

describe('niceAxis — evenly spaced, non-repeating ticks at the displayed precision', () => {
  it('POLICY RATE EFFR − inflation (2Y): 0.45-step auto ticks → even 0.5 steps', () => {
    // auto ticks were 0.0, 0.45, 0.9, 1.35, 1.8 → labels 0.0 / 0.5 / 0.9 / 1.4 / 1.8
    const a = niceAxis([0.52, 1.1, 1.78], { dp: 1, includeZero: true })
    expect(a).toEqual({ domain: [0, 2], ticks: [0, 0.5, 1, 1.5, 2] })
  })
  it('1Y case: 0.0–1.4 range → 0.5 steps (never 0.25, unrepresentable at 1dp)', () => {
    expect(niceAxis([0.2, 1.42], { dp: 1, includeZero: true }).ticks).toEqual([0, 0.5, 1, 1.5])
  })
  it('steps are only 1, 2, 2.5, 5 × 10ⁿ', () => {
    expect(niceAxis([-8.3, 7.9], { dp: 1 }).ticks).toEqual([-10, -5, 0, 5, 10])
    expect(niceAxis([0, 11], { dp: 1 }).ticks).toEqual([0, 2.5, 5, 7.5, 10, 12.5])
    expect(niceAxis([0, 0.9], { dp: 2 }).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(niceAxis([0, 1.1], { dp: 2 }).ticks).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25])
  })
  it('includeZero keeps 0 for all-negative data; off, it does not force 0', () => {
    expect(niceAxis([-4.1, -1], { dp: 0, includeZero: true }).domain).toEqual([-5, 0])
    expect(niceAxis([10, 14], { dp: 0 }).domain[0]).toBeGreaterThan(0)
  })
  it('flat or empty input still gives a valid axis', () => {
    expect(niceAxis([3, 3], { dp: 1 }).ticks.length).toBeGreaterThan(1)
    expect(niceAxis([], { dp: 1 }).ticks).toContain(0)
  })
  it('fuzz: even, unique labels, ≤ 6 ticks, domain covers the data, no -0', () => {
    for (const dp of [0, 1, 2]) for (let lo = -47.3; lo < 20; lo += 3.17) for (const span of [0.07, 0.4, 1.3, 4.6, 18, 77, 340]) {
      const vals = [lo, lo + span]
      const { domain, ticks } = niceAxis(vals, { dp, includeZero: lo < 0 })
      const l = labels(ticks, dp)
      const ctx = `dp${dp} ${lo}..${lo + span}`
      expect(new Set(l).size, ctx).toBe(l.length)
      expect(new Set(steps(ticks)).size, ctx).toBe(1)
      expect(new Set(steps(ticks.map(t => Number(t.toFixed(dp))))).size, `${ctx} at display precision`).toBe(1)
      expect(ticks.length, ctx).toBeLessThanOrEqual(6)
      // tolerance: the fuzz inputs carry float drift (13.000000000000018) the helper rounds away
      expect(domain[0], ctx).toBeLessThanOrEqual(Math.min(...vals) + 1e-9)
      expect(domain[1], ctx).toBeGreaterThanOrEqual(Math.max(...vals) - 1e-9)
      expect(ticks.some(t => Object.is(t, -0)), ctx).toBe(false)
    }
  })
})
