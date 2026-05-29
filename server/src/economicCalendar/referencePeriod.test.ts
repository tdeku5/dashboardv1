import { describe, it, expect } from 'vitest'
import { splitReferencePeriod } from './referencePeriod'

describe('splitReferencePeriod', () => {
  // ── The observed bug cases from the duplicate audit ─────────────────────────
  it('strips a trailing month abbreviation', () => {
    expect(splitReferencePeriod('Core PCE Price Index MoM APR')).toEqual({
      baseEvent: 'Core PCE Price Index MoM', referencePeriod: 'APR',
    })
    expect(splitReferencePeriod('Economic Sentiment MAY')).toEqual({
      baseEvent: 'Economic Sentiment', referencePeriod: 'MAY',
    })
    expect(splitReferencePeriod('Unemployment Rate MAY')).toEqual({
      baseEvent: 'Unemployment Rate', referencePeriod: 'MAY',
    })
  })

  it('strips a trailing MONTH/DD week-ending token', () => {
    expect(splitReferencePeriod('Initial Jobless Claims MAY/23')).toEqual({
      baseEvent: 'Initial Jobless Claims', referencePeriod: 'MAY/23',
    })
    expect(splitReferencePeriod('MBA 30-Year Mortgage Rate MAY/22')).toEqual({
      baseEvent: 'MBA 30-Year Mortgage Rate', referencePeriod: 'MAY/22',
    })
  })

  it('strips a trailing quarter marker, optionally with a year', () => {
    expect(splitReferencePeriod('Current Account Q1')).toEqual({
      baseEvent: 'Current Account', referencePeriod: 'Q1',
    })
    expect(splitReferencePeriod('GDP Growth Rate QoQ 2nd Est Q1')).toEqual({
      baseEvent: 'GDP Growth Rate QoQ 2nd Est', referencePeriod: 'Q1',
    })
    expect(splitReferencePeriod('GDP YoY Q1 2026')).toEqual({
      baseEvent: 'GDP YoY', referencePeriod: 'Q1 2026',
    })
  })

  it('leaves names without a trailing reference period alone', () => {
    for (const e of ['Core CPI MoM', 'Manufacturing PMI', 'GDP Growth Rate QoQ 2nd Est', 'ECB Financial Stability Review']) {
      expect(splitReferencePeriod(e)).toEqual({ baseEvent: e, referencePeriod: null })
    }
  })

  // ── False-merge guards (the "conservative" part) ────────────────────────────
  it('does NOT strip uppercase 3-letter abbreviations that are not months', () => {
    // PMI, ISM, GDP, GfK (mixed case anyway) — none are months. Must not strip.
    for (const e of ['Manufacturing PMI', 'ISM Services PMI', 'S&P GSCI', 'OECD CLI']) {
      expect(splitReferencePeriod(e).referencePeriod).toBeNull()
    }
  })

  it('does NOT strip lowercase or mixed-case tokens (e.g. "MoM", "YoY")', () => {
    expect(splitReferencePeriod('Inflation Rate YoY').referencePeriod).toBeNull()
    expect(splitReferencePeriod('Inflation Rate MoM').referencePeriod).toBeNull()
  })

  it('does NOT strip a month-like token that is not at the very end', () => {
    expect(splitReferencePeriod('MAY Day Holiday').referencePeriod).toBeNull()
  })
})
