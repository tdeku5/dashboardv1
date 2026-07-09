// Hephaestus frontend smoke tests — static-markup renders (same convention as
// renderSmoke.test.tsx: no DOM, no fetch; useEffect does not run, so initial
// states are what render).
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { HephaestusPage } from './HephaestusPage'
import { MiscChartsPage } from './MiscChartsPage'
import { SpecChart } from '../components/charts/SpecChart'
import { NavDropdown } from '../components/NavDropdown'
import { getStoredModel, DEFAULT_MODEL, type ChartSpecV1 } from '../lib/hephaestus'

describe('Hephaestus frontend', () => {
  it('HephaestusPage renders the empty state with model selector and input', () => {
    const html = renderToStaticMarkup(<MemoryRouter><HephaestusPage /></MemoryRouter>)
    expect(html).toContain('HEPHAESTUS')
    expect(html).toContain('Ask for a chart in plain language.')
    expect(html).toContain('Sonnet 5')
    expect(html).toContain('Opus 4.8')
    expect(html).toContain('FORGE')
  })

  it('SpecChart initial render shows the themed loading state', () => {
    const spec: ChartSpecV1 = {
      version: 1, title: 'US 10Y', series: [{ kind: 'direct', id: 'DGS10' }],
    }
    const html = renderToStaticMarkup(<SpecChart spec={spec} />)
    expect(html).toContain('US 10Y')
    expect(html).toContain('Forging…')
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
