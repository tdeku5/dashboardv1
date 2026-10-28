// @vitest-environment happy-dom
//
// Component-level root rule (Asset Class Models revamp, Turn 2 approval):
// a component that renders on a route OUTSIDE the section must carry
// `acm-root` on its own outermost element, so every var(--acm-*) it uses
// resolves even with no `.acm-root` ancestor.
//
// Cross-route components found in Phase 0-H:
//   • TreasuryAuctionContent — RATES → US → TREASURY AUCTIONS and the standalone
//     /treasury route. Converted at R4 — test below is live.
//   • NavDropdown, FredRefreshButton — cross-route but NOT converted
//     (Decision 4), so they never reference --acm-* tokens. Guarded below so a
//     future edit that starts using the tokens without the root class fails.
//
// happy-dom has no cascade, so the checks are structural: the outermost
// element carries `acm-root`, every inline var(--acm-*) sits inside an
// `.acm-root` element, and every referenced token is defined in acm-tokens.css.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { raw } from '../styles/acmTokenReader'
import { TreasuryAuctionContent } from './TreasuryAuctionPage'

beforeEach(() => { vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function assertSelfContained(container: HTMLElement) {
  expect(container.closest('.acm-root'), 'test must mount with no .acm-root ancestor').toBeNull()
  const root = container.firstElementChild
  expect(root?.classList.contains('acm-root'), 'outermost element carries acm-root').toBe(true)
  const unresolved: string[] = []
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
    const style = el.getAttribute('style') ?? ''
    for (const m of style.matchAll(/var\(--(acm-[\w-]+)\)/g)) {
      if (!el.closest('.acm-root')) unresolved.push(`${m[1]} outside .acm-root`)
      if (!(m[1] in raw)) unresolved.push(`${m[1]} not defined in acm-tokens.css`)
    }
  }
  expect(unresolved).toEqual([])
}

describe('component-level acm-root rule — cross-route components', () => {
  it('TreasuryAuctionContent resolves every var(--acm-*) with no .acm-root ancestor (converted at R4)', () => {
    const { container } = render(<MemoryRouter><div data-testid="no-acm-ancestor"><TreasuryAuctionContent /></div></MemoryRouter>)
    const host = container.querySelector<HTMLElement>('[data-testid="no-acm-ancestor"]')!
    assertSelfContained(host)
  })

  it('unconverted cross-route components (NavDropdown, FredRefreshButton) reference no --acm-* token', () => {
    const src = [path.resolve(process.cwd(), 'src'), path.resolve(process.cwd(), 'client/src')]
      .find(p => { try { readFileSync(path.join(p, 'App.tsx')); return true } catch { return false } })!
    for (const f of ['components/NavDropdown.tsx', 'components/NavDropdown.module.css', 'components/FredRefreshButton.tsx']) {
      expect(readFileSync(path.join(src, f), 'utf8'), f).not.toMatch(/--acm-/)
    }
  })
})
