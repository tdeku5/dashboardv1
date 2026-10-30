// Pins the red / green direction rule and its two exceptions
// (docs/prompts/acm-revamp-rebase-and-red-green-direction.md + addendum;
// design notes colour rule 6), end to end: the tone a helper picks → the tone
// class → the CSS rule → the token → the colour it resolves to.
//
//   yield / rate / spread up → red      futures price up → green
//   hike → red, cut → green              returns: unchanged (up green)
//   exception 1: heat backgrounds red / blue; heat-cell text primary (contrast)
//   exception 2: VOL premium orange / blue
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { hex, raw, tint } from '../styles/acmTokenReader'
import { toneColor, type SignTone } from '../components/acm'
import { getCellColor } from '../lib/cellColor'
import { policyMoveTone, rateChangeTone, stripMoveTone } from './STIRDashboardPage'

const SRC = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')].find(p => existsSync(path.join(p, 'styles')))!
const RED = '#E16D6D'      // --acm-negative
const GREEN = '#4CC38A'    // --acm-positive
const ORANGE = '#F0954A'   // --acm-vol-premium-up
const BLUE = '#7CC4F2'     // --acm-vol-premium-down, --acm-heat-rate-blue

/** The colour a tone renders: tones.module.css rule → token → hex. */
const tonesCss = readFileSync(path.join(SRC, 'components/acm/tones.module.css'), 'utf8')
function toneHex(tone: SignTone): string {
  const cls = tone.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  const m = tonesCss.match(new RegExp(`\\.${cls}\\.${cls}\\s*\\{\\s*color:\\s*var\\(--(acm-[\\w-]+)\\)`))
  expect(m, `tones.module.css rule for .${cls}`).not.toBeNull()
  expect(toneColor(tone), 'chart colour uses the same token').toBe(`var(--${m![1]})`)
  return hex(m![1])
}

describe('red / green direction rule', () => {
  it('the token pair: red = negative = dir-up, green = positive = dir-down', () => {
    expect(hex('acm-negative')).toBe(RED)
    expect(hex('acm-positive')).toBe(GREEN)
    expect(hex('acm-dir-up')).toBe(RED)
    expect(hex('acm-dir-down')).toBe(GREEN)
  })

  it('yield / rate / spread up → red; down → green', () => {
    expect(toneHex(rateChangeTone(+5)!)).toBe(RED)
    expect(toneHex(rateChangeTone(-5)!)).toBe(GREEN)
    expect(rateChangeTone(0)).toBeUndefined()
  })

  it('futures price up → green; price down → red', () => {
    expect(toneHex(stripMoveTone(+0.05)!)).toBe(GREEN)
    expect(toneHex(stripMoveTone(-0.05)!)).toBe(RED)
  })

  it('hike → red; cut → green', () => {
    expect(toneHex(policyMoveTone('hike'))).toBe(RED)
    expect(toneHex(policyMoveTone('cut'))).toBe(GREEN)
  })

  it('the direction tones themselves are red / green, never blue / orange', () => {
    expect(toneHex('dir-up')).toBe(RED)
    expect(toneHex('dir-down')).toBe(GREEN)
  })
})

describe('exception 1 — yield-change heat cells keep red / blue backgrounds; text stays primary', () => {
  it('a yield-decrease cell → blue background token; text → primary', () => {
    const bg = getCellColor(-5, 10)!
    const step = bg.match(/var\(--(acm-heat-rate-down-\d)\)/)![1]
    expect(tint(step)[0], 'blue base').toBe(BLUE)
    expect(raw['acm-heat-rate-blue']).toBe(BLUE)
    // UST CURVE change grid cells: text is primary (contrast; user decision at the addendum gate)
    const css = readFileSync(path.join(SRC, 'pages/STIRDashboardPage.module.css'), 'utf8')
    const chg = css.match(/\.chgHead,\s*\.chgRowLabel,\s*\.chgCell\s*\{[^}]*\}/)![0]
    expect(chg).toMatch(/color:\s*var\(--acm-text-primary\)/)
  })
  it('a yield-increase cell → red background token', () => {
    const step = getCellColor(+5, 10)!.match(/var\(--(acm-heat-rate-up-\d)\)/)![1]
    expect(tint(step)[0]).toBe(RED)
  })
})

describe('exception 2 — VOL premium keeps orange / blue', () => {
  it('premium tones resolve to their own orange / blue tokens, unchanged', () => {
    expect(toneHex('vol-premium-up')).toBe(ORANGE)
    expect(toneHex('vol-premium-down')).toBe(BLUE)
    expect(raw['acm-vol-premium-up']).toBe(ORANGE)
    expect(raw['acm-vol-premium-down']).toBe(BLUE)
  })
})
