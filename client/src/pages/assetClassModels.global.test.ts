// GLOBAL regime cells (R5d ruling 2): a uniform tint of each regime's identity
// colour over an opaque base, primary text ≥ 4.5:1 on every regime, over both
// surfaces; 0.36 is the highest such alpha. Identity colours are unchanged.
import { describe, it, expect } from 'vitest'
import { composite, contrast } from '../lib/paletteCheck'
import { hex } from '../styles/acmTokenReader'
import { CURVE_REGIME_COLORS } from '../constants/identityColors'
import { REGIME_TINT_ALPHA, regimeColor, regimeTintBackground } from './ratesShared'

const TEXT = hex('acm-text-primary')
const BASES = { bg: hex('acm-surface-bg'), panel: hex('acm-surface-panel') }
const minContrast = (alpha: number) => Math.min(...Object.values(CURVE_REGIME_COLORS).flatMap(c => Object.values(BASES).map(b => contrast(TEXT, composite(c, alpha, b)))))

describe('GLOBAL regime cells — tinted fill, primary text', () => {
  it('all seven regimes', () => {
    expect(Object.keys(CURVE_REGIME_COLORS)).toHaveLength(7)
  })

  it.each(Object.entries(CURVE_REGIME_COLORS))('%s: primary text ≥ 4.5:1 over the tint on bg and panel', (_name, color) => {
    for (const [base, b] of Object.entries(BASES)) {
      expect(contrast(TEXT, composite(color, REGIME_TINT_ALPHA, b)), base).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the alpha is the highest uniform value that passes (0.36 passes, 0.37 fails)', () => {
    expect(REGIME_TINT_ALPHA).toBe(0.36)
    expect(minContrast(REGIME_TINT_ALPHA)).toBeGreaterThanOrEqual(4.5)
    expect(minContrast(REGIME_TINT_ALPHA + 0.01)).toBeLessThan(4.5)
  })

  it('cells use the tint over an opaque panel base; chart marks keep the full identity colour', () => {
    const bg = regimeTintBackground('Bear Steepener')!
    expect(bg).toContain(`color-mix(in srgb, ${CURVE_REGIME_COLORS['Bear Steepener']} 36%, transparent)`)
    expect(bg).toMatch(/var\(--acm-surface-panel\)$/)
    expect(regimeTintBackground(null)).toBeUndefined()
    expect(regimeColor('Bear Steepener')).toBe(CURVE_REGIME_COLORS['Bear Steepener'])
  })
})
