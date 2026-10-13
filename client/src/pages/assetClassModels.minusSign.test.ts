// Decision 3 (Asset Class Models revamp): displayed negatives use ASCII '-'.
// U+2212 '−' pastes into Excel as text, so no formatter in the section may
// emit it.
//
// Static scan of every file reachable from STIRDashboardPage (the section's
// single route), comments stripped. Counted as a NUMERIC minus:
//   • a string literal that is exactly the sign: '−' "−" `−`
//   • a UNARY '−' before a digit or a ${…} interpolation  ('−1σ', `−${x}`) —
//     i.e. not preceded by a letter, digit or closing bracket
// NOT counted: '−' as a subtraction operator in label or formula text
// ("VIX − Realized", "t − 5", "y_{t−1}", "N−1") — prose, not a negative number.
//
// RATCHET: files that still emit U+2212 at 7512e85 are pinned below with their
// exact counts. A new occurrence anywhere fails. Converting a file must also
// remove (or lower) its entry, so the list can only shrink; it must be empty
// by the end of Phase 3.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')]
  .find(p => existsSync(path.join(p, 'pages/STIRDashboardPage.tsx')))!

const MINUS = '−'

const PENDING_CONVERSION: Record<string, number> = {
  'components/CrudeSpreadChart.tsx': 2,
  'components/MetalBasisChart.tsx': 1,
  'components/ReturnsHeatmap.tsx': 1,
  'components/SectorContributionChart.tsx': 1,
  'components/SectorStatTiles.tsx': 1,
  'components/VolSummaryTable.tsx': 2,
  'pages/CrossAssetVolPage.tsx': 1,
  'pages/UsRatesVolPage.tsx': 3,
}

/** Transitive relative-import closure from the section's route component. */
function sectionFiles(): string[] {
  const seen = new Set<string>()
  const stack = [path.join(SRC, 'pages/STIRDashboardPage.tsx')]
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(re)) {
      const base = path.resolve(path.dirname(f), m[1])
      const hit = [base + '.tsx', base + '.ts', base].find(c => existsSync(c) && statSync(c).isFile() && /\.tsx?$/.test(c))
      if (hit) stack.push(hit)
    }
  }
  return [...seen].map(f => path.relative(SRC, f).split(path.sep).join('/')).filter(f => !/\.test\.tsx?$/.test(f)).sort()
}

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')       // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '')           // block comments
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')      // line comments (not inside 'http://')
}

function numericMinusCount(src: string): number {
  const code = stripComments(src)
  const standalone = code.match(new RegExp(`(['"\`])${MINUS}\\1`, 'g'))?.length ?? 0
  const beforeNumber = code.match(new RegExp(`(?<![\\w)\\]}])${MINUS}(?=\\d|\\$\\{)`, 'g'))?.length ?? 0
  return standalone + beforeNumber
}

describe('Asset Class Models — no U+2212 in displayed numbers (Decision 3)', () => {
  const files = sectionFiles()
  const counts = Object.fromEntries(files.map(f => [f, numericMinusCount(readFileSync(path.join(SRC, f), 'utf8'))]))

  it('scans the whole section', () => {
    expect(files).toContain('pages/STIRDashboardPage.tsx')
    expect(files).toContain('pages/UsRatesVolPage.tsx')
    expect(files.length).toBeGreaterThan(90)
  })

  it('no file outside the pending list emits a numeric U+2212', () => {
    const offenders = Object.entries(counts).filter(([f, n]) => n > 0 && !(f in PENDING_CONVERSION))
    expect(offenders).toEqual([])
  })

  it('pending files match their pinned counts exactly (the ratchet only shrinks)', () => {
    const drift = Object.entries(PENDING_CONVERSION)
      .filter(([f, n]) => counts[f] !== n)
      .map(([f, n]) => `${f}: pinned ${n}, now ${counts[f] ?? 'not in section'}`)
    expect(drift).toEqual([])
    const total = Object.values(PENDING_CONVERSION).reduce((a, b) => a + b, 0)
    console.log(`section files scanned: ${files.length}; numeric U+2212 still pending conversion: ${total} in ${Object.keys(PENDING_CONVERSION).length} files`)
  })

  it('the classifier counts sign literals and minus-before-number, not operators or comments', () => {
    expect(numericMinusCount(`const sign = v >= 0 ? '+' : '${MINUS}'`)).toBe(1)
    expect(numericMinusCount(`label: '${MINUS}1σ'`)).toBe(1)
    expect(numericMinusCount(`\`${MINUS}\${x}\``)).toBe(1)
    expect(numericMinusCount(`name="VIX ${MINUS} Realized"`)).toBe(0)
    expect(numericMinusCount(`y_{t${MINUS}1} and N${MINUS}1 over [t${MINUS}21, t]`)).toBe(0)
    expect(numericMinusCount(`band: '(${MINUS}2 to +3)'`)).toBe(1)
    expect(numericMinusCount(`// spread ~${MINUS}2 to +3`)).toBe(0)
    expect(numericMinusCount(`const sign = v >= 0 ? '+' : '-'`)).toBe(0)
  })
})
