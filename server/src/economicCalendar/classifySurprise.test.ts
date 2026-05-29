import { describe, it, expect } from 'vitest'
import { parseSurpriseValue, classifySurprise, classifyRelease } from './classifySurprise'
import { ECONOMIC_SURPRISE_RULES } from '../config/economicSurpriseRules'
import type { EconomicRelease } from './types'

const CPI = ECONOMIC_SURPRISE_RULES['CPI']                       // ±0.1/0.2/0.3, +1, percent
const UNEMP = ECONOMIC_SURPRISE_RULES['Unemployment Rate']       // ±0.1/0.2/0.3, -1, percent
const NFP = ECONOMIC_SURPRISE_RULES['Nonfarm Payrolls']          // ±20/50/100, +1, thousands
const CLAIMS = ECONOMIC_SURPRISE_RULES['Initial Claims']         // ±10/25/50, -1, thousands
const PMI = ECONOMIC_SURPRISE_RULES['Manufacturing PMI']         // ±0.5/1.5/3, +1, absolute

describe('parseSurpriseValue', () => {
  it('parses percent strings, stripping %', () => {
    expect(parseSurpriseValue('2.8%', 'percent')).toBe(2.8)
    expect(parseSurpriseValue('-0.1', 'percent')).toBe(-0.1)
  })

  it('takes the first/headline figure from multi-horizon strings', () => {
    expect(parseSurpriseValue('0.2% MoM, 2.8% YoY', 'percent')).toBe(0.2)
    expect(parseSurpriseValue('0.2mom, 2.8yoy', 'percent')).toBe(0.2)
  })

  it('normalizes thousands: K as-is, M ×1000, bare number assumed thousands', () => {
    expect(parseSurpriseValue('200K', 'thousands')).toBe(200)
    expect(parseSurpriseValue('200', 'thousands')).toBe(200)
    expect(parseSurpriseValue('1.2M', 'thousands')).toBe(1200)
    expect(parseSurpriseValue('-50K', 'thousands')).toBe(-50)
  })

  it('parses absolute values as-is', () => {
    expect(parseSurpriseValue('52.3', 'absolute')).toBe(52.3)
  })

  it('returns null for blanks / placeholders / missing', () => {
    expect(parseSurpriseValue(null, 'percent')).toBeNull()
    expect(parseSurpriseValue('', 'percent')).toBeNull()
    expect(parseSurpriseValue('-', 'percent')).toBeNull()
    expect(parseSurpriseValue('—', 'thousands')).toBeNull()
    expect(parseSurpriseValue('N/A', 'absolute')).toBeNull()
  })
})

describe('classifySurprise — direction +1 (CPI, percent)', () => {
  it('in line when within the deadzone', () => {
    expect(classifySurprise(2.8, 2.8, CPI)).toBe('in line')
    expect(classifySurprise(2.85, 2.8, CPI)).toBe('in line')   // 0.05 ≤ 0.1
  })
  it('warm on a moderate upside beat, hot on a large one', () => {
    expect(classifySurprise(2.95, 2.8, CPI)).toBe('warm')      // +0.15
    expect(classifySurprise(3.2, 2.8, CPI)).toBe('hot')        // +0.4 ≥ 0.3
  })
  it('cool on a moderate miss, cold on a large one', () => {
    expect(classifySurprise(2.65, 2.8, CPI)).toBe('cool')      // -0.15
    expect(classifySurprise(2.4, 2.8, CPI)).toBe('cold')       // -0.4
  })
  it('hot exactly at the hot threshold', () => {
    expect(classifySurprise(3.1, 2.8, CPI)).toBe('hot')        // +0.3 == hot
  })
})

describe('classifySurprise — inverted direction -1 (Unemployment, percent)', () => {
  it('higher-than-expected unemployment is cool/cold (weak)', () => {
    expect(classifySurprise(4.2, 4.0, UNEMP)).toBe('cool')     // +0.2 actual → s=-0.2
    expect(classifySurprise(4.4, 4.0, UNEMP)).toBe('cold')     // +0.4 actual → s=-0.4
  })
  it('lower-than-expected unemployment is warm/hot (strong)', () => {
    expect(classifySurprise(3.85, 4.0, UNEMP)).toBe('warm')    // -0.15 → s=+0.15
    expect(classifySurprise(3.7, 4.0, UNEMP)).toBe('hot')      // -0.3 → s=+0.3
  })
  it('in line at consensus', () => {
    expect(classifySurprise(4.0, 4.0, UNEMP)).toBe('in line')
  })
})

describe('classifySurprise — inverted direction -1 (Initial Claims, thousands)', () => {
  it('more claims than expected is cool (weak labor)', () => {
    expect(classifySurprise(260, 230, CLAIMS)).toBe('cool')    // +30 → s=-30
  })
  it('far fewer claims is hot (strong labor)', () => {
    expect(classifySurprise(180, 230, CLAIMS)).toBe('hot')     // -50 → s=+50 ≥ 50
  })
})

describe('classifySurprise — direction +1 thousands (NFP) and absolute (PMI)', () => {
  it('NFP big beat = hot, small = in line, big miss = cold', () => {
    expect(classifySurprise(350, 200, NFP)).toBe('hot')        // +150
    expect(classifySurprise(210, 200, NFP)).toBe('in line')    // +10 ≤ 20
    expect(classifySurprise(120, 200, NFP)).toBe('cool')       // -80 (<100)
    expect(classifySurprise(50, 200, NFP)).toBe('cold')        // -150 ≥ 100
  })
  it('PMI moderate beat = warm, large = hot', () => {
    expect(classifySurprise(52.0, 50.0, PMI)).toBe('warm')     // +2.0 (<3)
    expect(classifySurprise(54.0, 50.0, PMI)).toBe('hot')      // +4.0 ≥ 3
  })
})

describe('classifyRelease — rule lookup + missing-data handling', () => {
  const base: EconomicRelease = {
    release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'United States',
    event: 'Core CPI', reference_period: null, expected: '0.2% MoM', actual: '0.5% MoM', previous: '0.3% MoM',
    importance: 3, scraped_at: '2026-05-27T23:00:00Z',
  }

  it('classifies a known event with both values', () => {
    expect(classifyRelease(base)).toBe('hot')   // 0.5-0.2 = +0.3 ≥ hot
  })
  it('returns null when the rule exists but actual has not printed', () => {
    expect(classifyRelease({ ...base, actual: null })).toBeNull()
  })
  it('returns unclassified for an event with no rule', () => {
    expect(classifyRelease({ ...base, event: 'Widget Shipments' })).toBe('unclassified')
  })
  it('matches rule names case/punctuation-insensitively', () => {
    expect(classifyRelease({ ...base, event: 'core cpi' })).toBe('hot')
  })
})
