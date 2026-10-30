import { describe, it, expect } from 'vitest'
import { cellHeatStep, getCellColor } from './cellColor'

describe('cellColor grid — symmetric red / blue rate heat scale', () => {
  it('increase → rate-up, decrease → rate-down, on an opaque panel base', () => {
    expect(getCellColor(5, 10)).toBe('linear-gradient(var(--acm-heat-rate-up-3), var(--acm-heat-rate-up-3)), var(--acm-surface-panel)')
    expect(getCellColor(-5, 10)).toBe('linear-gradient(var(--acm-heat-rate-down-3), var(--acm-heat-rate-down-3)), var(--acm-surface-panel)')
  })

  it('an equal rise and fall get the same step', () => {
    for (const v of [0.5, 1.4, 2, 3.7, 5, 6.7, 9, 10]) expect(cellHeatStep(v, 10)).toBe(cellHeatStep(-v, 10))
  })

  it('steps are quarters of the 0.7 power curve (edges ≈ 13.8 / 37.1 / 66.3% of max)', () => {
    expect([1, 1.3, 1.4, 3.7, 3.8, 6.6, 6.7, 10].map(v => cellHeatStep(v, 10))).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('no fill for null, zero, non-finite or an empty row', () => {
    for (const [v, m] of [[null, 10], [undefined, 10], [0, 10], [Number.NaN, 10], [5, 0]] as const) {
      expect(getCellColor(v, m)).toBeUndefined()
    }
  })

  it('values beyond the normaliser clamp to step 4', () => {
    expect(cellHeatStep(25, 10)).toBe(4)
  })
})
