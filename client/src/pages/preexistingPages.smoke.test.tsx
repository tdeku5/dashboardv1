// @vitest-environment happy-dom
//
// Gate-3 regression check: one page from every pre-existing dropdown section
// (plus the new Portfolio Analytics hub) still mounts after the PORTFOLIO
// ANALYTICS addition. Fetches are stubbed to stay pending, so pages render
// their loading states — this proves the routes/imports/render paths are
// intact without needing live data or a browser.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Dashboard } from '../Dashboard'
import { ModelsPage } from './ModelsPage'
import { STIRDashboardPage } from './STIRDashboardPage'
import { NewsAggregatorPage } from './NewsAggregatorPage'
import { EconomicDataLogPage } from './EconomicDataLogPage'
import { HephaestusPage } from './HephaestusPage'
import { MiscChartsPage } from './MiscChartsPage'
import { PortfolioAnalyticsPage } from './PortfolioAnalyticsPage'

const PAGES: Array<{ section: string; name: string; element: () => React.ReactElement }> = [
  { section: 'US MACRO SNAPSHOT', name: 'Dashboard', element: () => <Dashboard /> },
  { section: 'ECONOMIC DATA MODELS', name: 'ModelsPage', element: () => <ModelsPage /> },
  { section: 'ASSET CLASS MODELS', name: 'STIRDashboardPage', element: () => <STIRDashboardPage /> },
  { section: 'NEWS AGGREGATOR', name: 'NewsAggregatorPage', element: () => <NewsAggregatorPage /> },
  { section: 'ECONOMIC CALENDAR', name: 'EconomicDataLogPage', element: () => <EconomicDataLogPage /> },
  { section: 'HEPHAESTUS', name: 'HephaestusPage', element: () => <HephaestusPage /> },
  { section: 'MISC. CHARTS', name: 'MiscChartsPage', element: () => <MiscChartsPage /> },
  { section: 'PORTFOLIO ANALYTICS (new hub)', name: 'PortfolioAnalyticsPage', element: () => <PortfolioAnalyticsPage /> },
]

beforeEach(() => {
  // Hold every request pending — pages must sit in their loading states.
  vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('pre-existing dropdown sections still mount', () => {
  for (const page of PAGES) {
    it(`${page.section} — ${page.name} renders without throwing`, () => {
      const { container } = render(<MemoryRouter>{page.element()}</MemoryRouter>)
      expect(container.innerHTML.length).toBeGreaterThan(0)
    })
  }
})
