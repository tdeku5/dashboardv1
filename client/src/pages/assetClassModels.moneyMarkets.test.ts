// MONEY MARKETS (R4 changes 1–2): reference-line colours and the whole-bp y axis.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { mmBpAxis } from './STIRDashboardPage'
import { MONEY_MARKET_COLORS, RESERVE_DEMAND_COLORS } from '../constants/identityColors'

const SRC = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')].find(p => existsSync(path.join(p, 'pages/STIRDashboardPage.tsx')))!
const tsx = readFileSync(path.join(SRC, 'pages/STIRDashboardPage.tsx'), 'utf8')
const mm = tsx.slice(tsx.indexOf("activeView === 'money'"), tsx.indexOf("activeView === 'money'") + 9000)

describe('MONEY MARKETS reference lines', () => {
  it('scarcity threshold is --acm-alert-strong, line + label + legend; extends the domain', () => {
    expect(tsx).toMatch(/const MM_SCARCITY_COLOR = signColor\('acm-alert-strong'\)/)
    expect(mm).toMatch(/stroke=\{MM_SCARCITY_COLOR\}/)
    expect(mm).toMatch(/fill: MM_SCARCITY_COLOR/)
    expect(mm).toMatch(/'Scarcity warning \(0bp\)', color: MM_SCARCITY_COLOR/)
    expect(mm).toMatch(/ifOverflow="extendDomain"/)
  })
  it('RDE median uses the neutral reference style, legend matching (dashed)', () => {
    expect(mm).toMatch(/dataKey="median" \{\.\.\.referenceLines\.level\}/)
    expect(mm).toMatch(/'50th \(median\)', color: String\(referenceLines\.level\.stroke\), dashed: true/)
  })
  it('no red left in the registry entries these came from', () => {
    expect(Object.keys(MONEY_MARKET_COLORS)).toEqual(['sofrIorb', 'effrIorb', 'sofrEffr'])
    expect(Object.keys(RESERVE_DEMAND_COLORS)).toEqual(['outer', 'inner'])
  })
})

describe('mmBpAxis — whole-bp ticks that never repeat', () => {
  const labels = (t: number[]) => t.map(v => `${v.toFixed(0)}bp`)
  it('EFFR − IORB case: all-negative data still includes the 0bp threshold, step 1', () => {
    const a = mmBpAxis([-4.1, -3.5, -2.5, -1], true)
    expect(a).toEqual({ domain: [-5, 0], ticks: [-5, -4, -3, -2, -1, 0] })
  })
  it('wide range keeps a coarse step (SOFR − IORB case)', () => {
    expect(mmBpAxis([-13, 32], true)).toEqual({ domain: [-15, 45], ticks: [-15, 0, 15, 30, 45] })
  })
  it('labels are unique and ticks are integers across many ranges', () => {
    for (let lo = -60; lo <= 5; lo += 1.7) for (const span of [0.3, 1, 2.4, 7, 19, 63, 140]) {
      const { domain, ticks } = mmBpAxis([lo, lo + span], true)
      const l = labels(ticks)
      expect(new Set(l).size, `${lo}..${lo + span}`).toBe(l.length)
      expect(ticks.every(Number.isInteger)).toBe(true)
      expect(ticks.length).toBeLessThanOrEqual(6)
      expect(domain[0]).toBeLessThanOrEqual(Math.min(lo, 0))
      expect(domain[1]).toBeGreaterThanOrEqual(Math.max(lo + span, 0))
    }
  })
  it('without the threshold, 0 is not forced in', () => {
    expect(mmBpAxis([10, 14], false).domain[0]).toBeGreaterThan(0)
  })
})
