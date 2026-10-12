import { describe, expect, it } from 'vitest'
import { computeSpreadDelta } from './curveSpreadDelta'
import { EURO_AREA_COUNTRIES, SUMMARY_COUNTRIES } from './globalSummaryCountries'

// Yields in percent; expected bps derived by hand from
//   spreadChange = (longNow − shortNow) − (longPrev − shortPrev)

describe('computeSpreadDelta — hand-built yield paths', () => {
  it('a bear steepener: both legs up, long up more → positive spread Δ', () => {
    // 2Y 4.00 → 4.10 (+10bp), 10Y 4.50 → 4.75 (+25bp)
    // spread 0.50 → 0.65, Δ = +0.15 = +15.00bp  (= 25 − 10)
    const d = computeSpreadDelta({ shortNow: 4.10, shortPrev: 4.00, longNow: 4.75, longPrev: 4.50 })
    expect(d).not.toBeNull()
    expect(d?.spreadBps).toBe(15)
    expect(d?.shortChange).toBeCloseTo(0.10, 12)
    expect(d?.longChange).toBeCloseTo(0.25, 12)
  })

  it('a bull flattener: both legs down, long down more → negative spread Δ', () => {
    // 2Y 4.00 → 3.90 (−10bp), 10Y 4.50 → 4.20 (−30bp)
    // Δ = −30 − (−10) = −20.00bp
    const d = computeSpreadDelta({ shortNow: 3.90, shortPrev: 4.00, longNow: 4.20, longPrev: 4.50 })
    expect(d?.spreadBps).toBe(-20)
  })

  it('a twist: legs move in opposite directions', () => {
    // 2Y 4.00 → 4.20 (+20bp), 10Y 4.50 → 4.40 (−10bp) → Δ = −30.00bp
    const d = computeSpreadDelta({ shortNow: 4.20, shortPrev: 4.00, longNow: 4.40, longPrev: 4.50 })
    expect(d?.spreadBps).toBe(-30)
  })

  it('a parallel shift leaves the spread unchanged → exactly 0, which is a real reading', () => {
    const d = computeSpreadDelta({ shortNow: 4.25, shortPrev: 4.00, longNow: 4.75, longPrev: 4.50 })
    expect(d?.spreadBps).toBe(0)
    expect(d).not.toBeNull()   // 0 is data, not absence
  })

  it('spread Δ always equals longΔ − shortΔ in bps', () => {
    const cases: Array<[number, number, number, number]> = [
      [4.10, 4.00, 4.75, 4.50], [3.90, 4.00, 4.20, 4.50],
      [0.55, 0.52, 1.80, 1.76], [5.121, 5.110, 5.424, 5.397],
    ]
    for (const [sn, sp, ln, lp] of cases) {
      const d = computeSpreadDelta({ shortNow: sn, shortPrev: sp, longNow: ln, longPrev: lp })
      const longBps = (ln - lp) * 100
      const shortBps = (sn - sp) * 100
      expect(d?.spreadBps).toBeCloseTo(longBps - shortBps, 6)
    }
  })

  it('30Y/10Y leg works the same way (10s30s)', () => {
    // 10Y 4.50 → 4.60 (+10bp), 30Y 5.00 → 5.02 (+2bp) → Δ = −8.00bp
    const d = computeSpreadDelta({ shortNow: 4.60, shortPrev: 4.50, longNow: 5.02, longPrev: 5.00 })
    expect(d?.spreadBps).toBe(-8)
  })

  it('rounds to the payload convention (2dp)', () => {
    // 2Y +1.78bp, 10Y +0.69bp → Δ = −1.09bp, matching the live DE row.
    const d = computeSpreadDelta({ shortNow: 3.0713, shortPrev: 3.0535, longNow: 2.7069, longPrev: 2.7000 })
    expect(d?.spreadBps).toBe(-1.09)
  })
})

describe('computeSpreadDelta — a missing leg returns null, never 0', () => {
  const base = { shortNow: 4.10, shortPrev: 4.00, longNow: 4.75, longPrev: 4.50 }
  for (const leg of ['shortNow', 'shortPrev', 'longNow', 'longPrev'] as const) {
    it(`missing ${leg} → null`, () => {
      const input: Record<string, number | undefined> = { ...base }
      delete input[leg]
      const d = computeSpreadDelta(input)
      expect(d).toBeNull()
      expect(d).not.toBe(0)
    })
  }

  it('a NaN leg → null', () => {
    expect(computeSpreadDelta({ ...base, longNow: Number.NaN })).toBeNull()
  })

  it('an all-empty input → null', () => {
    expect(computeSpreadDelta({})).toBeNull()
  })
})

// ── Row registry: the EU → DE/FR/IT change, asserted structurally ───────────

describe('SUMMARY_COUNTRIES registry', () => {
  it('rows are US, UK, DE, FR, IT, CA, JP, AU in that order', () => {
    expect(SUMMARY_COUNTRIES.map(c => c.country)).toEqual(
      ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'],
    )
  })

  it('there is no EU row', () => {
    expect(SUMMARY_COUNTRIES.some(c => (c.country as string) === 'EU')).toBe(false)
  })

  it('DE / FR / IT all share the one EUR strip — one ECB path, three rows', () => {
    const euro = SUMMARY_COUNTRIES.filter(c => EURO_AREA_COUNTRIES.includes(c.country))
    expect(euro.map(c => c.country)).toEqual(['DE', 'FR', 'IT'])
    expect(new Set(euro.map(c => c.stirMarketKey))).toEqual(new Set(['EUR']))
  })

  it('DE / FR / IT carry their OWN sovereign curves, not a shared one', () => {
    expect(SUMMARY_COUNTRIES.find(c => c.country === 'DE')?.yieldPrefix).toBe('DE')
    expect(SUMMARY_COUNTRIES.find(c => c.country === 'FR')?.yieldPrefix).toBe('FR')
    expect(SUMMARY_COUNTRIES.find(c => c.country === 'IT')?.yieldPrefix).toBe('IT')
  })

  it('Germany inherits the retired EU row exactly: DE prefix + EUR strip', () => {
    // The old row was { country: 'EU', yieldPrefix: 'DE', stirMarketKey: 'EUR' }.
    const de = SUMMARY_COUNTRIES.find(c => c.country === 'DE')
    expect(de).toEqual({ country: 'DE', yieldPrefix: 'DE', stirMarketKey: 'EUR' })
  })

  it('the five pre-existing rows keep their exact prior mapping', () => {
    const expected: Record<string, [string, string]> = {
      US: ['US', 'SR3'], UK: ['GB', 'SO3'], CA: ['CA', 'CRA'],
      JP: ['JP', 'TOA3'], AU: ['AU', 'AUS'],
    }
    for (const [country, [prefix, market]] of Object.entries(expected)) {
      const row = SUMMARY_COUNTRIES.find(c => c.country === country)
      expect(row?.yieldPrefix, country).toBe(prefix)
      expect(row?.stirMarketKey, country).toBe(market)
    }
  })

  it('the distinct-strip count is 6, so a request derives 6 strips for 8 rows', () => {
    expect(new Set(SUMMARY_COUNTRIES.map(c => c.stirMarketKey)).size).toBe(6)
    expect(SUMMARY_COUNTRIES.length).toBe(8)
  })
})
