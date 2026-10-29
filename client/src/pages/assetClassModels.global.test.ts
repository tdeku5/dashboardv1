// GLOBAL (R5c): the regime cells pick dark or light text by contrast, using the
// two text tokens' relative luminance as constants — pin them to the tokens.
import { describe, it, expect } from 'vitest'
import { luminance } from '../lib/paletteCheck'
import { hex } from '../styles/acmTokenReader'
import { DARK_TEXT_LUMINANCE, LIGHT_TEXT_LUMINANCE } from './GlobalRatesPage'

describe('GLOBAL regime-cell text luminance constants', () => {
  it('match --acm-surface-bg and --acm-text-primary', () => {
    expect(DARK_TEXT_LUMINANCE).toBeCloseTo(luminance(hex('acm-surface-bg')), 3)
    expect(LIGHT_TEXT_LUMINANCE).toBeCloseTo(luminance(hex('acm-text-primary')), 3)
  })
})
