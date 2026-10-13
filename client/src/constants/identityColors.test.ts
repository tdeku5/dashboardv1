// Identity-colour registry checks (Asset Class Models revamp, Phase 1 Turn 2).
import { describe, it, expect } from 'vitest'
import { contrast, deltaE } from '../lib/paletteCheck'
import { hex, SIGN_TOKENS, SURFACES } from '../styles/acmTokenReader'
import {
  COUNTRY_COLORS, countryColor, canonicalCountry, FX_CURRENCY_COLORS, TENOR_COLORS,
  SECTOR_COLORS, US_INDEX_COLORS, BREADTH_MA_COLORS, VOL_INDEX_COLORS, CURVE_REGIME_COLORS,
  STIR_PACK_COLORS, INVESTOR_CLASS_COLORS, GDPNOW_COMPONENT_COLORS, LABOR_SCENARIO_COLORS,
  CREDIT_SPREAD_COLORS, IDENTITY_ADJUSTMENTS, allIdentityColors, gdpnowQuarterColor, ffYearBandColor,
} from './identityColors'

const lc = (s: string) => s.toLowerCase()
const adjusted = new Set(IDENTITY_ADJUSTMENTS.map(a => `${a.map}.${a.key}`))

// ── Source maps as they stood at 7512e85 (copied verbatim) ──────────────────
const SRC_GLOBAL_RATES_COUNTRY = { US: '#60a5fa', UK: '#a78bfa', DE: '#facc15', FR: '#fb923c', IT: '#34d399', CA: '#f87171', JP: '#f472b6', AU: '#22d3ee' }
const SRC_GLOBAL_RATES_FORWARD = { US: '#60a5fa', UK: '#a78bfa', EU: '#facc15', CA: '#f87171', JP: '#f472b6', AU: '#22d3ee' }
const SRC_SPREAD_MARKET = { SR3: '#60a5fa', SO3: '#a78bfa', EUR: '#facc15', CRA: '#f87171', TOA3: '#f472b6', AUS: '#22d3ee' }
const SRC_POLICY_PATH = { US: '#60a5fa', UK: '#a78bfa', EU: '#facc15', CAD: '#f87171', JPY: '#f472b6', AUS: '#22d3ee' }
/** FX page crosses → counter-currency colour (DmCrosses + UK/EU/CAD/JPY/AUS pages). */
const SRC_FX: Array<[string, string]> = [
  ['EUR', '#60a5fa'], ['GBP', '#a78bfa'], ['AUD', '#22d3ee'], ['NZD', '#34d399'], ['CAD', '#f87171'],
  ['JPY', '#f472b6'], ['CHF', '#fbbf24'], ['NOK', '#fb923c'], ['SEK', '#4ade80'], ['CNH', '#e2e8f0'],
  ['USD', '#facc15'], ['HUF', '#c084fc'], ['PLN', '#fb7185'],
]
const SRC_TENOR = { '2Y': '#60a5fa', '5Y': '#a78bfa', '10Y': '#34d399', '30Y': '#f87171' }
const SRC_SECTOR = { XLK: '#3b82f6', XLE: '#f97316', XLV: '#06b6d4', XLF: '#10b981', XLY: '#ec4899', XLP: '#84cc16', XLI: '#64748b', XLC: '#6366f1', XLB: '#a16207', XLU: '#eab308', XLRE: '#14b8a6' }
const SRC_REGIME = { 'Bull Steepener': '#66bb6a', 'Bear Steepener': '#c62828', 'Steepener Twist': '#ffee58', 'Bull Flattener': '#42a5f5', 'Bear Flattener': '#ab47bc', 'Flattener Twist': '#ff9100', Neutral: '#728197' }
const SRC_PACK = { Whites: '#e5e7eb', Reds: '#ef4444', Greens: '#22c55e', Blues: '#3b82f6', Golds: '#facc15' }

describe('identity registry — faithful to source', () => {
  it('one country map reproduces all four rates maps through canonical keys', () => {
    for (const src of [SRC_GLOBAL_RATES_COUNTRY, SRC_GLOBAL_RATES_FORWARD, SRC_SPREAD_MARKET, SRC_POLICY_PATH]) {
      for (const [k, v] of Object.entries(src)) expect(lc(countryColor(k) ?? ''), k).toBe(v)
    }
  })

  it('every key spelling in use normalises to one canonical country', () => {
    const groups: Record<string, string[]> = {
      CA: ['CA', 'CAD', 'CRA', 'Canada'], JP: ['JP', 'JPY', 'TOA3', 'Japan'], AU: ['AU', 'AUS'],
      UK: ['UK', 'SO3', 'GB'], EU: ['EU', 'EUR'], US: ['US', 'SR3'], DE: ['DE', 'Germany'], FR: ['FR', 'France'], IT: ['IT', 'Italy'],
    }
    for (const [canon, spellings] of Object.entries(groups)) spellings.forEach(s => expect(canonicalCountry(s), s).toBe(canon))
    expect(canonicalCountry('Global')).toBeUndefined()
  })

  it('FX counter-currency colours match all six FX pages', () => {
    for (const [ccy, v] of SRC_FX) expect(lc(FX_CURRENCY_COLORS[ccy as keyof typeof FX_CURRENCY_COLORS])).toBe(v)
  })

  it('tenor, sector, regime and pack maps match source except declared adjustments', () => {
    const check = (name: string, reg: Record<string, string>, src: Record<string, string>) => {
      for (const [k, v] of Object.entries(src)) {
        if (adjusted.has(`${name}.${k}`)) expect(lc(reg[k]), `${name}.${k} adjusted`).not.toBe(v)
        else expect(lc(reg[k]), `${name}.${k}`).toBe(v)
      }
    }
    check('TENOR_COLORS', TENOR_COLORS, SRC_TENOR)
    check('SECTOR_COLORS', SECTOR_COLORS, SRC_SECTOR)
    check('CURVE_REGIME_COLORS', CURVE_REGIME_COLORS, SRC_REGIME)
    check('STIR_PACK_COLORS', STIR_PACK_COLORS, SRC_PACK)
  })

  it('every declared adjustment is actually in the registry', () => {
    for (const a of IDENTITY_ADJUSTMENTS) {
      if (a.key.includes('/')) continue // multi-key tenor merge, checked above
      const value = allIdentityColors().find(([p]) => p === `${a.map}.${a.key}`)?.[1]
      expect(value, `${a.map}.${a.key}`).toBe(a.to)
    }
  })

  it('VIX has one colour, the Cross Asset Vol value', () => {
    expect(VOL_INDEX_COLORS.vix).toBe('#ef4444')
  })
})

describe('identity registry — contrast and sign collisions', () => {
  const all = allIdentityColors()

  it('every identity colour clears 3:1 on all four surfaces', () => {
    const fails = all
      .map(([p, v]) => [p, v, Math.min(...SURFACES.map(s => contrast(v, hex(s))))] as const)
      .filter(([, , m]) => m < 3)
      .map(([p, v, m]) => `${p} ${v} ${m.toFixed(2)}`)
    console.log(`identity colours checked: ${all.length} entries, ${new Set(all.map(([, v]) => lc(v))).size} distinct values`)
    expect(fails).toEqual([])
  })

  it('no identity colour is identical to any sign-family token', () => {
    const sign = new Map(SIGN_TOKENS.map(t => [lc(hex(t)), t]))
    const hits = all.filter(([, v]) => sign.has(lc(v))).map(([p, v]) => `${p} ${v} = --${sign.get(lc(v))}`)
    expect(hits).toEqual([])
  })

  it('no STIR pack colour equals a valence or direction token', () => {
    const vd = ['acm-positive', 'acm-negative', 'acm-dir-up', 'acm-dir-down'].map(t => lc(hex(t)))
    Object.values(STIR_PACK_COLORS).forEach(v => expect(vd).not.toContain(lc(v)))
  })

  it('reports the nearest identity colours to each sign token (info, ΔE2000 < 5)', () => {
    const near: string[] = []
    for (const t of SIGN_TOKENS) {
      for (const [p, v] of all) {
        const d = deltaE(hex(t), v)
        if (d < 5) near.push(`${t.padEnd(19)} ~ ${p.padEnd(42)} ${v}  ΔE ${d.toFixed(1)}`)
      }
    }
    console.log('\nnear sign-token identity colours (ΔE2000 < 5):\n' + (near.length ? near.join('\n') : '(none)') + '\n')
  })

  it('investor class: option B — Individuals #868D9B, Other #687385, Other stays darker', () => {
    expect(INVESTOR_CLASS_COLORS.individuals).toBe('#868D9B')
    expect(INVESTOR_CLASS_COLORS.other).toBe('#687385')
    const d = deltaE(INVESTOR_CLASS_COLORS.individuals, INVESTOR_CLASS_COLORS.other)
    expect(d).toBeGreaterThanOrEqual(10)
    const lum = (h: string) => contrast(h, '#000000')
    expect(lum(INVESTOR_CLASS_COLORS.other)).toBeLessThan(lum(INVESTOR_CLASS_COLORS.individuals))
    console.log(`investor class individuals ${INVESTOR_CLASS_COLORS.individuals} vs other ${INVESTOR_CLASS_COLORS.other}: ΔE2000 ${d.toFixed(2)}`)
  })
})

describe('GDPNow quarter colours are keyed to the quarter, not the list position', () => {
  // A 44-quarter window, Q1 2015 … Q4 2025 (generated, not read from the DB).
  const QUARTERS = Array.from({ length: 44 }, (_, i) => `Q${(i % 4) + 1} ${2015 + Math.floor(i / 4)}`)
  // The page's old behaviour: colour by index in the (range-filtered) list.
  const OLD = ['#90CAF9', '#F48FB1', '#CE93D8', '#80CBC4', '#FFE082', '#81C784', '#FFCC80', '#9FA8DA', '#ef9a9a', '#4FC3F7', '#A1887F', '#B39DDB', '#FF8A65', '#4DD0E1', '#AED581', '#DCE775', '#FFB74D', '#4DB6AC', '#81D4FA', '#C5E1A5']
  const oldColor = (list: string[], q: string) => OLD[list.indexOf(q) % OLD.length]

  it('a quarter keeps its colour under every range window', () => {
    const windows = [QUARTERS, QUARTERS.slice(-8), QUARTERS.slice(-4), QUARTERS.slice(10, 30)]
    for (const q of QUARTERS) {
      const seen = new Set(windows.filter(w => w.includes(q)).map(() => gdpnowQuarterColor(q)))
      expect(seen.size, q).toBe(1)
    }
  })

  it('the old index-keyed colour DID drift (the bug being fixed)', () => {
    const q = 'Q4 2025'
    expect(oldColor(QUARTERS, q)).not.toBe(oldColor(QUARTERS.slice(-8), q))
  })

  it('consecutive quarters always differ; parsing is strict', () => {
    for (let i = 1; i < QUARTERS.length; i++) expect(gdpnowQuarterColor(QUARTERS[i])).not.toBe(gdpnowQuarterColor(QUARTERS[i - 1]))
    expect(gdpnowQuarterColor('2025Q3')).toBeUndefined()
    expect(gdpnowQuarterColor(' Q3 2025 ')).toBe(gdpnowQuarterColor('Q3 2025'))
  })
})

describe('FF contract-year bands are keyed to the year', () => {
  it('2026–2030 keep their source colours; later years cycle by year, not list position', () => {
    expect(ffYearBandColor(2026)).toBe('rgba(200, 210, 220, 0.08)')
    expect(ffYearBandColor(2027)).toBe('rgba(239, 83, 80, 0.12)')
    expect(ffYearBandColor(2030)).toBe('rgba(255, 215, 0, 0.12)')
    expect(ffYearBandColor(2031)).toBe(ffYearBandColor(2026))
    expect(ffYearBandColor(2035)).toBe(ffYearBandColor(2030))
  })
})

describe('registry shape', () => {
  it('maps the Phase 0-G arrays exist exactly once each', () => {
    expect(Object.keys(COUNTRY_COLORS)).toHaveLength(9)
    expect(Object.keys(FX_CURRENCY_COLORS)).toHaveLength(13)
    expect(Object.keys(SECTOR_COLORS)).toHaveLength(11)
    expect(Object.keys(US_INDEX_COLORS)).toHaveLength(5)
    expect(Object.keys(BREADTH_MA_COLORS)).toHaveLength(3)
    expect(Object.keys(GDPNOW_COMPONENT_COLORS)).toHaveLength(7)
    expect(LABOR_SCENARIO_COLORS).toHaveLength(4)
    expect(Object.keys(CREDIT_SPREAD_COLORS)).toHaveLength(5)
    expect(Object.keys(INVESTOR_CLASS_COLORS)).toHaveLength(8)
  })
})
