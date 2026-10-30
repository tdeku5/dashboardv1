// R3b change 3: a value that rounds to zero at its displayed precision renders
// as an unsigned zero with no tone, section-wide. Only display and the tone
// decision use the rounded value; the underlying number is unchanged.
import { describe, it, expect } from 'vitest'
import { fmtSignedFixed, roundForDisplay } from './acmFormat'
import { rateChangeTone, stripMoveTone } from '../../pages/STIRDashboardPage'

describe('near-zero values render as untoned zero', () => {
  it('-0.04 at 1dp → "0.0", untoned', () => {
    expect(fmtSignedFixed(-0.04, 1)).toBe('0.0')
    expect(fmtSignedFixed(+0.04, 1)).toBe('0.0')
    expect(fmtSignedFixed(-0.04, 1, 'bp')).toBe('0.0bp')
    expect(roundForDisplay(-0.04, 1)).toBe(0)
    expect(Object.is(roundForDisplay(-0.04, 1), -0)).toBe(false)
    expect(rateChangeTone(-0.04)).toBeUndefined()
    expect(rateChangeTone(+0.04)).toBeUndefined()
  })

  it('non-zero control: -0.06 at 1dp → "-0.1", toned green (rate down)', () => {
    expect(fmtSignedFixed(-0.06, 1)).toBe('-0.1')
    expect(fmtSignedFixed(+1.25, 1)).toBe('+1.3')
    expect(rateChangeTone(-0.06)).toBe('positive')
    expect(rateChangeTone(+0.06)).toBe('negative')
  })

  it('precision follows the display: 0dp credit Δ, 3dp futures prices', () => {
    expect(fmtSignedFixed(-0.4, 0)).toBe('0')
    expect(rateChangeTone(-0.4, 0)).toBeUndefined()
    expect(rateChangeTone(-0.6, 0)).toBe('positive')
    expect(stripMoveTone(-0.0004)).toBeUndefined()
    expect(stripMoveTone(+0.0006)).toBe('positive')
  })

  it('the underlying value is not mutated', () => {
    const v = -0.04
    fmtSignedFixed(v, 1)
    expect(v).toBe(-0.04)
  })
})
