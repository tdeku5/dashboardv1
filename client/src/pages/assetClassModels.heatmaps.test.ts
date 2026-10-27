// Named heatmap components (Rule 2 exception; docs/asset-class-models-design-notes.md).
// Valence and direction colour text only, EXCEPT inside these named heatmaps,
// which may fill cells from the --acm-heat-* scales (rates colour rule 6):
//   • the cellColor grid            — RED / BLUE, symmetric (rule 6 exception
//                                     b): increase = --acm-heat-rate-up-*,
//                                     decrease = --acm-heat-rate-down-*.
//   • ReturnsHeatmap                — returns: up = --acm-heat-positive-*
//   • STIR strip move cells         — implied-rate Δ columns + FF price-change
//     (.stripHeat*)                   cells: price down / rate up = negative
//
// Static scan of every file reachable from STIRDashboardPage (TS, TSX and the
// CSS they import), comments stripped. Any --acm-heat-* reference outside the
// list — or a named component using the wrong scale — fails.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')]
  .find(p => existsSync(path.join(p, 'pages/STIRDashboardPage.tsx')))!

type Scale = 'dir' | 'valence' | 'rate'
interface Named {
  name: string
  file: string
  scale: Scale
  /** CSS files: every rule that references a heat token must match this selector. */
  selector?: RegExp
}

const NAMED: Named[] = [
  { name: 'cellColor grid', file: 'lib/cellColor.ts', scale: 'rate' },
  { name: 'ReturnsHeatmap', file: 'components/ReturnsHeatmap.tsx', scale: 'valence' },
  { name: 'ReturnsHeatmap', file: 'components/ReturnsHeatmap.module.css', scale: 'valence' },
  // one set of 8 classes serves both the SR3 implied-rate Δ columns and the FF price-change cells
  { name: 'STIR strip move cells', file: 'pages/STIRDashboardPage.module.css', scale: 'valence', selector: /^\.stripHeat(Positive|Negative)[1-4]$/ },
]
/** The token definitions themselves. */
const TOKEN_FILE = 'styles/acm-tokens.css'

function sectionFiles(): string[] {
  const seen = new Set<string>()
  const stack = [path.join(SRC, 'pages/STIRDashboardPage.tsx')]
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s*|export\s[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    if (f.endsWith('.css')) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(re)) {
      const base = path.resolve(path.dirname(f), m[1])
      const hit = [base + '.tsx', base + '.ts', base, base + '/index.ts', base + '/index.tsx'].find(c => existsSync(c) && statSync(c).isFile() && /\.(tsx?|css)$/.test(c))
      if (hit) stack.push(hit)
    }
  }
  return [...seen].map(f => path.relative(SRC, f).split(path.sep).join('/')).filter(f => !/\.test\.tsx?$/.test(f)).sort()
}

const stripComments = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const HEAT = /--acm-heat-(positive|negative|dir-up|dir-down|rate-up|rate-down|[a-z]+)-/g
/** The heat sides each scale may use. */
const SIDES: Record<Scale, string[]> = {
  dir: ['dir-up', 'dir-down'],
  valence: ['positive', 'negative'],
  rate: ['rate-up', 'rate-down'],
}

describe('Asset Class Models — heat fills only in the named heatmap components', () => {
  const files = sectionFiles()
  const uses = Object.fromEntries(files.map(f => {
    const code = stripComments(readFileSync(path.join(SRC, f), 'utf8'))
    return [f, [...code.matchAll(HEAT)].map(m => m[1])]
  }))

  it('scans the whole section, CSS included', () => {
    expect(files).toContain('pages/STIRDashboardPage.module.css')
    expect(files).toContain(TOKEN_FILE)
    expect(files.length).toBeGreaterThan(100)
  })

  it('no file outside the named list references a heat token', () => {
    const allowed = new Set([TOKEN_FILE, ...NAMED.map(n => n.file)])
    const offenders = Object.entries(uses).filter(([f, u]) => u.length > 0 && !allowed.has(f)).map(([f]) => f)
    expect(offenders).toEqual([])
  })

  it('each named component uses only its own scale', () => {
    const wrong = NAMED.flatMap(n => (uses[n.file] ?? []).filter(s => !SIDES[n.scale].includes(s)).map(s => `${n.name} (${n.file}) uses heat-${s}`))
    expect(wrong).toEqual([])
  })

  it('in a shared CSS module, only the named selectors carry heat fills', () => {
    for (const n of NAMED.filter(x => x.selector)) {
      const css = stripComments(readFileSync(path.join(SRC, n.file), 'utf8'))
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /--acm-heat-/.test(m[2]))
      const bad = rules.map(m => m[1].trim()).filter(sel => sel.split(',').some(s => !n.selector!.test(s.trim())))
      expect(bad, n.name).toEqual([])
      expect(rules.length, `${n.name}: 4 steps per side`).toBe(8)
    }
  })
})
