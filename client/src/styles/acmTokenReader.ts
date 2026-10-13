// Test-side reader for acm-tokens.css — the token file is the single source
// of truth, so tests parse it rather than mirroring values in TypeScript.
// Node-only (fs); never imported by app code.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const cssPath = [
  path.resolve(process.cwd(), 'src/styles/acm-tokens.css'),        // cwd = client/
  path.resolve(process.cwd(), 'client/src/styles/acm-tokens.css'), // cwd = repo root
].find(p => existsSync(p))

if (!cssPath) throw new Error('acm-tokens.css not found from ' + process.cwd())

/** File contents with comments stripped. */
export const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `--acm-*` declaration, raw value. */
export const raw: Record<string, string> = {}
for (const m of css.matchAll(/--(acm-[\w-]+)\s*:\s*([^;]+);/g)) raw[m[1]] = m[2].trim()

/** Resolve a colour token (following var() references) to an opaque hex. */
export function hex(name: string): string {
  const v = raw[name]
  if (v === undefined) throw new Error(`token --${name} not defined`)
  const ref = v.match(/^var\(--(acm-[\w-]+)\)$/)
  if (ref) return hex(ref[1])
  if (!/^#[0-9A-Fa-f]{6}$/.test(v)) throw new Error(`--${name} is not an opaque hex: ${v}`)
  return v.toUpperCase()
}

/** Resolve a `color-mix(in srgb, var(--x) N%, transparent)` tint → [hex, alpha]. */
export function tint(name: string): [string, number] {
  const m = raw[name]?.match(/^color-mix\(in srgb, var\(--(acm-[\w-]+)\) (\d+(?:\.\d+)?)%, transparent\)$/)
  if (!m) throw new Error(`--${name} is not a color-mix tint: ${raw[name]}`)
  return [hex(m[1]), Number(m[2]) / 100]
}

/** globals.css `:root` custom properties (read-only; the revamp never edits them). */
export const globalRoot: Record<string, string> = (() => {
  const g = readFileSync(path.join(path.dirname(cssPath), 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const block = g.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
})()

/**
 * A token's value with every var() expanded — acm tokens first, then the
 * global :root — i.e. what the browser resolves inside .acm-root.
 */
export function resolved(name: string): string {
  const v = raw[name] ?? globalRoot[name]
  if (v === undefined) throw new Error(`--${name} not defined`)
  return v.replace(/var\(--([\w-]+)\)/g, (_, n: string) => resolved(n))
}

/** The seven sign-family tokens — one list, owned by the app-side module. */
export { SIGN_TOKENS } from '../components/acm/chartColors'

export const SURFACES = ['acm-surface-bg', 'acm-surface-panel', 'acm-surface-raised', 'acm-surface-overlay'] as const
