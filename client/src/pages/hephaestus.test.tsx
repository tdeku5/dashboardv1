// Hephaestus frontend smoke tests — static-markup renders (same convention as
// renderSmoke.test.tsx: no DOM, no fetch; useEffect does not run, so initial
// states are what render). Interaction tests live in hephaestusComposer.test.tsx.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { HephaestusPage, EXAMPLE_PROMPTS } from './HephaestusPage'
import { MiscChartsPage } from './MiscChartsPage'
import { SpecChart } from '../components/charts/SpecChart'
import { NavDropdown } from '../components/NavDropdown'
import { getStoredModel, DEFAULT_MODEL, type ChartSpecV1 } from '../lib/hephaestus'

describe('Hephaestus frontend', () => {
  it('HephaestusPage renders the empty state, example chips, model selector, and a disabled send', () => {
    const html = renderToStaticMarkup(<MemoryRouter><HephaestusPage /></MemoryRouter>)
    expect(html).toContain('Ask Hephaestus for a chart.')
    for (const p of EXAMPLE_PROMPTS) expect(html).toContain(p)
    expect(html).toContain('Sonnet 5')
    expect(html).toContain('Opus 4.8')
    // Send is disabled while the composer is empty (initial state) —
    // attribute order is React's, so extract the tag and check it.
    const sendTag = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendTag).toContain('disabled')
  })

  it('SpecChart initial render keeps the ChartKit card chrome (Misc. Charts protection)', () => {
    const spec: ChartSpecV1 = {
      version: 1, title: 'US 10Y', series: [{ kind: 'direct', id: 'DGS10' }],
    }
    const html = renderToStaticMarkup(<SpecChart spec={spec} />)
    expect(html).toContain('US 10Y')
    expect(html).toContain('Forging…')
    // The Misc. Charts framing must remain the ChartKit classes — the
    // Hephaestus page supplies its own card, but this wrapper must not change.
    expect(html).toMatch(/_section_/)
    expect(html).toMatch(/_sectionHeader_/)
    expect(html).toMatch(/_sectionTitle_/)
    expect(html).toMatch(/_statusBlock_/)
  })

  it('MiscChartsPage still renders its existing content (Saved Charts section is empty-silent)', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MiscChartsPage /></MemoryRouter>)
    expect(html).toContain('MISC. CHARTS')
    expect(html).toContain('Standalone charts')
    // Saved Charts renders nothing before data arrives — existing page unchanged.
    expect(html).not.toContain('SAVED CHARTS')
  })

  it('NavDropdown resolves /hephaestus to the Hephaestus entry', () => {
    // The dropdown panel isn't open in static render; the trigger label
    // resolves from NAV_OPTIONS by route, so this asserts the entry exists.
    const onPage = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/hephaestus']}><NavDropdown /></MemoryRouter>
    )
    expect(onPage).toContain('Hephaestus')
  })

  it('getStoredModel falls back to the default without localStorage', () => {
    expect(getStoredModel()).toBe(DEFAULT_MODEL)
  })
})
