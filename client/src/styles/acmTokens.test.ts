// Contrast + distinctness gate for the Asset Class Models token layer.
//
// Reads acm-tokens.css itself (the single source of truth), so any later edit
// to a token value is re-checked here. Thresholds and the reference numbers
// come from docs/prompts/asset-class-models-design-revamp-phase1-resume.md.
import { describe, it, expect } from 'vitest'
import { contrast, deltaE, composite, DEUT, PROT } from '../lib/paletteCheck'
import { css, raw, hex, tint, SURFACES } from './acmTokenReader'

const AA = 4.5
const FAINT = 3

/** [token, minimum ratio on every surface, role]. */
const TEXT_ON_SURFACE: Array<[string, number, string]> = [
  ['acm-text-primary', AA, 'text'],
  ['acm-text-secondary', AA, 'text'],
  ['acm-text-tertiary', FAINT, 'text'],
  ['acm-text-disabled', FAINT, 'text'],
  ['acm-accent', AA, 'accent text'],
  ['acm-accent-hover', AA, 'accent text'],
  ['acm-positive', AA, 'valence text'],
  ['acm-negative', AA, 'valence text'],
  ['acm-dir-up', AA, 'direction text'],
  ['acm-dir-down', AA, 'direction text'],
  ['acm-alert-mild', AA, 'alert (as text)'],
  ['acm-alert-strong', AA, 'alert (as text)'],
  ['acm-status-warning', AA, 'status (as text)'],
]

/** Non-text UI colours (WCAG 1.4.11 — 3:1). */
const NON_TEXT: Array<[string, string]> = [
  ['acm-accent-active', 'pressed fill / border'],
  ['acm-focus-ring-color', 'focus ring'],
  ['acm-bar-fill', 'inline magnitude bar'],
]

/** Tints are used only on these surfaces (data cells, banners, nav rows). */
const TINT_SURFACES = ['acm-surface-bg', 'acm-surface-panel'] as const

/**
 * Text that actually sits over each tint (Rule 2): an alert tint sits behind a
 * value, so every value-text colour — primary, valence, direction — must
 * clear AA on it; banners carry primary/secondary prose; nav rows carry
 * accent labels on accent-muted.
 */
const VALUE_TEXT = ['acm-text-primary', 'acm-positive', 'acm-negative', 'acm-dir-up', 'acm-dir-down']
const TEXT_ON_TINT: Array<[string, string, number]> = [
  ...VALUE_TEXT.map(t => [t, 'acm-alert-mild-tint', AA] as [string, string, number]),
  ...VALUE_TEXT.map(t => [t, 'acm-alert-strong-tint', AA] as [string, string, number]),
  ['acm-text-primary', 'acm-status-warning-tint', AA],
  ['acm-text-secondary', 'acm-status-warning-tint', AA],
  ['acm-text-primary', 'acm-accent-muted', AA],
  ['acm-accent', 'acm-accent-muted', AA],
  ['acm-accent-hover', 'acm-accent-muted', AA],
]

/**
 * Sign seeds from the phase-1-resume prompt. A token may differ from its seed
 * only via the one-pass stopping rule, declared here with the reason.
 */
const SEEDS: Record<string, string> = {
  'acm-dir-up': '#F0954A', 'acm-dir-down': '#7CC4F2', 'acm-positive': '#4CC38A',
  'acm-negative': '#E06C6C', 'acm-alert-mild': '#E8C547', 'acm-alert-strong': '#F05BA0',
  'acm-status-warning': '#E8C547',
}
const SEED_ADJUSTMENTS: Record<string, { value: string; reason: string }> = {
  'acm-negative': { value: '#E16D6D', reason: 'seed is 4.49907:1 on overlay; +1 per channel → 4.553' },
}

function hexForColorToken(name: string): string {
  return name === 'acm-focus-ring-color' ? hex(raw[name].replace(/^var\(--|\)$/g, '')) : hex(name)
}

const fmt = (n: number) => n.toFixed(2).padStart(6)

describe('acm-tokens.css — reference reproduction (palette_check_reference.py)', () => {
  // Exact tables from the phase-1-resume prompt; the port must match to ±0.1.
  const S = ['#0E1621', '#121A27', '#1B2637', '#1E2A3C']
  const minContrast = (c: string) => Math.min(...S.map(s => contrast(c, s)))
  const SEED_MIN: Array<[string, number]> = [
    ['#F0954A', 6.27], ['#7CC4F2', 7.60], ['#4CC38A', 6.53], ['#E06C6C', 4.50],
    ['#E8C547', 8.62], ['#F05BA0', 4.62],
  ]
  for (const [c, want] of SEED_MIN) {
    it(`min contrast ${c} = ${want}`, () => expect(Math.abs(minContrast(c) - want)).toBeLessThanOrEqual(0.1))
  }
  const PAIRS: Array<[string, string, number, number | null, number | null]> = [
    ['#F0954A', '#7CC4F2', 45.6, 48.2, 45.4],
    ['#E06C6C', '#F05BA0', 16.2, 17.3, 25.3],
    ['#F0954A', '#E8C547', 21.5, 7.0, 11.3],
    ['#7CC4F2', '#5B9DD9', 11.3, null, null],
    ['#4CC38A', '#E06C6C', 63.1, 7.7, 18.0],
    ['#60a5fa', '#5B9DD9', 4.2, null, null],  // the spec-defect example
    ['#fb923c', '#f59e0b', 9.4, null, null],  // the spec-defect example
  ]
  for (const [a, b, n, d, p] of PAIRS) {
    it(`ΔE2000 ${a} vs ${b}`, () => {
      expect(Math.abs(deltaE(a, b) - n)).toBeLessThanOrEqual(0.1)
      if (d !== null) expect(Math.abs(deltaE(a, b, DEUT) - d)).toBeLessThanOrEqual(0.1)
      if (p !== null) expect(Math.abs(deltaE(a, b, PROT) - p)).toBeLessThanOrEqual(0.1)
    })
  }
})

describe('acm-tokens.css — contrast matrix', () => {
  it('every text / sign / alert token meets its floor on every surface', () => {
    const rows: string[] = []
    const failures: string[] = []
    rows.push(`${'token'.padEnd(22)}${'value'.padEnd(9)}${SURFACES.map(s => s.replace('acm-surface-', '').padStart(8)).join('')}   min  floor  role`)
    for (const [t, floor, role] of TEXT_ON_SURFACE) {
      const c = hex(t)
      const r = SURFACES.map(s => contrast(c, hex(s)))
      const min = Math.min(...r)
      rows.push(`${t.padEnd(22)}${c.padEnd(9)}${r.map(x => fmt(x).padStart(8)).join('')} ${fmt(min)}  ${floor.toFixed(1).padStart(4)}  ${role}`)
      if (min < floor) failures.push(`${t} min ${min.toFixed(2)} < ${floor}`)
    }
    rows.push('', '— non-text (floor 3.0) —')
    for (const [t, role] of NON_TEXT) {
      const c = hexForColorToken(t)
      const r = SURFACES.map(s => contrast(c, hex(s)))
      const min = Math.min(...r)
      rows.push(`${t.padEnd(22)}${c.padEnd(9)}${r.map(x => fmt(x).padStart(8)).join('')} ${fmt(min)}   3.0  ${role}`)
      if (min < FAINT) failures.push(`${t} min ${min.toFixed(2)} < 3`)
    }
    rows.push('', '— text over tint, composited on bg / panel (where tints are used) —')
    for (const [t, tk, floor] of TEXT_ON_TINT) {
      const [tc, a] = tint(tk)
      const r = TINT_SURFACES.map(s => contrast(hex(t), composite(tc, a, hex(s))))
      const min = Math.min(...r)
      const label = `${t.replace('acm-', '')} / ${tk.replace('acm-', '')}`
      rows.push(`${label.padEnd(38)}${r.map(x => fmt(x).padStart(8)).join('')} ${fmt(min)}  ${floor.toFixed(1).padStart(4)}  ${Math.round(a * 100)}% tint`)
      if (min < floor) failures.push(`${label} min ${min.toFixed(2)} < ${floor}`)
    }
    console.log('\n' + rows.join('\n') + '\n')
    expect(failures).toEqual([])
  })

  it('sign tokens equal the prompt seeds, except declared one-pass adjustments', () => {
    for (const [t, seed] of Object.entries(SEEDS)) {
      const adj = SEED_ADJUSTMENTS[t]
      expect(hex(t), t).toBe(adj ? adj.value : seed)
      if (adj) console.log(`${t}: seed ${seed} → ${adj.value} (${adj.reason}); ΔE2000 ${deltaE(seed, adj.value).toFixed(2)}`)
    }
  })

  it('the old global --text-secondary #4e6070 is not used as any acm token', () => {
    expect(Object.values(raw).map(v => v.toLowerCase())).not.toContain('#4e6070')
  })
})

describe('acm-tokens.css — distinctness (ΔE2000)', () => {
  const RULES: Array<[string, string, number, Array<'normal' | 'deut' | 'prot'>]> = [
    ['acm-dir-up', 'acm-dir-down', 30, ['normal', 'deut', 'prot']],
    ['acm-negative', 'acm-alert-strong', 15, ['normal']],
    ['acm-dir-up', 'acm-alert-mild', 15, ['normal']],
    ['acm-dir-down', 'acm-accent', 10, ['normal']],
  ]
  it('every distinctness threshold holds', () => {
    const rows: string[] = []
    const failures: string[] = []
    const M = { normal: undefined, deut: DEUT, prot: PROT } as const
    rows.push(`${'pair'.padEnd(34)}${'normal'.padStart(8)}${'deut'.padStart(8)}${'prot'.padStart(8)}   floor`)
    for (const [a, b, floor, modes] of RULES) {
      const d = (['normal', 'deut', 'prot'] as const).map(k => deltaE(hex(a), hex(b), M[k]))
      rows.push(`${`${a.replace('acm-', '')} vs ${b.replace('acm-', '')}`.padEnd(34)}${d.map(x => x.toFixed(1).padStart(8)).join('')}   ≥${floor} (${modes.join('/')})`)
      modes.forEach(k => {
        const v = d[['normal', 'deut', 'prot'].indexOf(k)]
        if (v < floor) failures.push(`${a} vs ${b} ${k} ${v.toFixed(1)} < ${floor}`)
      })
    }
    // Reported, not gated: the two deuteranopia-weak pairs handled by the
    // never-colour-only + separate-channel rules.
    for (const [a, b] of [['acm-positive', 'acm-negative'], ['acm-negative', 'acm-dir-up']] as const) {
      const d = (['normal', 'deut', 'prot'] as const).map(k => deltaE(hex(a), hex(b), M[k]))
      rows.push(`${`${a.replace('acm-', '')} vs ${b.replace('acm-', '')}`.padEnd(34)}${d.map(x => x.toFixed(1).padStart(8)).join('')}   (info)`)
    }
    rows.push('', `contrast alert-strong vs negative: ${contrast(hex('acm-alert-strong'), hex('acm-negative')).toFixed(2)}`)
    console.log('\n' + rows.join('\n') + '\n')
    expect(failures).toEqual([])
  })

  it('status-warning shares the alert-mild value (spec)', () => {
    expect(hex('acm-status-warning')).toBe(hex('acm-alert-mild'))
  })
})

describe('acm-tokens.css — heatmap scales (named exception to Rule 2)', () => {
  // Valence scale → ReturnsHeatmap and the STIR strip move cells. Red / blue
  // (negative for increase, dir-down for decrease) → the cellColor grid from
  // R2d / R5 (rule 6 exception b). See assetClassModels.heatmaps.test.ts.
  const SCALES: Array<[string, string, string]> = [
    // [scale, token for the "down" side, token for the "up" side]
    ['dir', 'acm-dir-down', 'acm-dir-up'],
    ['valence', 'acm-negative', 'acm-positive'],
    ['red-blue: cellColor', 'acm-dir-down', 'acm-negative'],
  ]
  const sideSteps = (prefix: string) =>
    Object.keys(raw).filter(k => k.startsWith(prefix)).sort()

  it('neutral midpoint is no fill', () => expect(raw['acm-heat-neutral']).toBe('transparent'))

  it('each side has ≤ 4 steps, built on its own sign token, strictly increasing', () => {
    const sides: Array<[string, string]> = [
      ['acm-heat-dir-up-', 'acm-dir-up'], ['acm-heat-dir-down-', 'acm-dir-down'],
      ['acm-heat-positive-', 'acm-positive'], ['acm-heat-negative-', 'acm-negative'],
    ]
    for (const [prefix, base] of sides) {
      const steps = sideSteps(prefix)
      expect(steps.length, prefix).toBeGreaterThan(0)
      expect(steps.length, prefix).toBeLessThanOrEqual(4)
      const alphas = steps.map(s => { const [c, a] = tint(s); expect(c).toBe(hex(base)); return a })
      alphas.forEach((a, i) => i > 0 && expect(a).toBeGreaterThan(alphas[i - 1]))
    }
  })

  it('both sides of a scale mirror each other (equal magnitude → equal intensity)', () => {
    const alphas = (prefix: string) => sideSteps(prefix).map(s => tint(s)[1])
    expect(alphas('acm-heat-dir-up-')).toEqual(alphas('acm-heat-dir-down-'))
    expect(alphas('acm-heat-positive-')).toEqual(alphas('acm-heat-negative-'))
  })

  it('primary text clears 4.5:1 over every step, on bg and panel', () => {
    const rows: string[] = []
    const failures: string[] = []
    rows.push(`${'step'.padEnd(24)}${'alpha'.padStart(6)}${'bg'.padStart(8)}${'panel'.padStart(8)}   min`)
    for (const [scale, down, up] of SCALES) {
      for (const side of [down, up]) {
        const prefix = `acm-heat-${side.replace('acm-', '')}-`
        for (const step of sideSteps(prefix)) {
          const [c, a] = tint(step)
          const r = TINT_SURFACES.map(s => contrast(hex('acm-text-primary'), composite(c, a, hex(s))))
          const min = Math.min(...r)
          rows.push(`${step.replace('acm-', '').padEnd(24)}${`${Math.round(a * 100)}%`.padStart(6)}${r.map(fmt).map(x => x.padStart(8)).join('')} ${fmt(min)}  [${scale}]`)
          if (min < AA) failures.push(`${step} ${min.toFixed(2)}`)
        }
      }
    }
    console.log('\n' + rows.join('\n') + '\n')
    expect(failures).toEqual([])
  })
})

describe('acm-tokens.css — scale constraints', () => {
  const vals = (prefix: string) => Object.entries(raw).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
  it('type scale has ≤ 6 sizes, all px', () => {
    const fs = vals('acm-fs-')
    expect(fs.length).toBeLessThanOrEqual(6)
    fs.forEach(v => expect(v).toMatch(/^\d+px$/))
  })
  it('≤ 3 font weights', () => expect(vals('acm-fw-').length).toBeLessThanOrEqual(3))
  it('spacing is on the 4px grid (one 2px half-step allowed)', () => {
    const px = vals('acm-space-').map(v => (v === '0' ? 0 : Number(v.replace('px', ''))))
    px.forEach(n => expect(n % 4 === 0 || n === 2).toBe(true))
  })
  it('line heights: tight ∈ [1.2, 1.35], prose ≈ 1.5', () => {
    expect(Number(raw['acm-lh-tight'])).toBeGreaterThanOrEqual(1.2)
    expect(Number(raw['acm-lh-tight'])).toBeLessThanOrEqual(1.35)
    expect(Number(raw['acm-lh-prose'])).toBe(1.5)
  })
  it('section mono token is Plex Mono; global --font-mono is only a fallback', () => {
    expect(raw['acm-font-mono']).toBe("'IBM Plex Mono', var(--font-mono)")
    expect(raw['acm-font-sans']).toBe("'IBM Plex Sans', var(--font-sans)")
  })
  it('declares @font-face for Plex Sans and both Plex Mono weights, sourced from /fonts', () => {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1])
    const has = (fam: string, w: string, file: string) =>
      faces.some(f => f.includes(`'${fam}'`) && new RegExp(`font-weight:\\s*${w};`).test(f) && f.includes(`/fonts/${file}`))
    expect(has('IBM Plex Sans', '100 700', 'ibm-plex-sans-latin.woff2')).toBe(true)
    expect(has('IBM Plex Mono', '400', 'ibm-plex-mono-latin-400.woff2')).toBe(true)
    expect(has('IBM Plex Mono', '500', 'ibm-plex-mono-latin-500.woff2')).toBe(true)
  })
  it('every token is scoped to .acm-root — no :root block', () => {
    expect(css).not.toMatch(/:root/)
  })
})
