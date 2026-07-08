// Navigation-param regression tests for the country/category tab fix.
// Renders hub pages at concrete URLs and asserts which country branch and
// active sub-tab the params produce. (Click/history interactions need a
// browser; the URL→render mapping tested here is the load-bearing logic.)
// Run: npx vitest run src/pages/navParams.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import { InflationPage } from './InflationPage'
import { FiscalPage } from './FiscalPage'
import { GrowthPage } from './GrowthPage'
import { HousingPage } from './HousingPage'
import { LaborMarketPage } from './LaborMarketPage'
import { IndustrialProductionPage } from './IndustrialProductionPage'
import { ModelsPage } from './ModelsPage'
import { categoryPath } from '../lib/modelNavParams'

function renderAt(url: string, path: string, el: JSX.Element): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path={path} element={el} /></Routes>
    </MemoryRouter>
  )
}

/** The label of the section button carrying the active class. */
function activeSections(html: string): string[] {
  const out: string[] = []
  const re = /<button[^>]*class="[^"]*sectionBtnActive[^"]*"[^>]*>([^<]+)<\/button>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out
}

describe('categoryPath', () => {
  it('US stays param-free (pre-fix URLs unchanged)', () => {
    expect(categoryPath('/models/inflation', 'us')).toBe('/models/inflation')
  })
  it('non-US carries the country', () => {
    expect(categoryPath('/models/inflation', 'uk')).toBe('/models/inflation?country=uk')
  })
})

describe('?country= selects the country branch', () => {
  it('no params renders US (existing URLs/bookmarks unchanged)', () => {
    const html = renderAt('/models/inflation', '/models/inflation', <InflationPage />)
    expect(html).toContain('PCE PROJECTIONS') // US-only section
  })
  it('country=uk renders the UK branch', () => {
    const html = renderAt('/models/inflation?country=uk', '/models/inflation', <InflationPage />)
    expect(html).not.toContain('PCE PROJECTIONS') // UK bar has no PCE
    expect(html).toContain('CPI PROJECTIONS')
  })
  it('invalid country normalizes to US', () => {
    const html = renderAt('/models/inflation?country=xx', '/models/inflation', <InflationPage />)
    expect(html).toContain('PCE PROJECTIONS')
  })
  it('country without content shows coming-soon with country bar intact', () => {
    const html = renderAt('/models/fiscal?country=au', '/models/fiscal', <FiscalPage />)
    expect(html).toContain('AUSTRALIA fiscal models coming soon')
    expect(html).toContain('>AUSTRALIA<') // country bar still rendered
  })
})

describe('?tab= selects the sub-tab (refresh/deep-link restore)', () => {
  it('UK Fiscal defaults to PSF BORROWING', () => {
    const html = renderAt('/models/fiscal?country=uk', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('PSF BORROWING')
  })
  it('tab=receipts restores HMRC RECEIPTS', () => {
    const html = renderAt('/models/fiscal?country=uk&tab=receipts', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('HMRC RECEIPTS')
  })
  it('invalid tab falls back to the first/default section', () => {
    const html = renderAt('/models/fiscal?country=uk&tab=zzz', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('PSF BORROWING')
  })
  it('US tab deep-link works too (tab=mts)', () => {
    const html = renderAt('/models/fiscal?tab=mts', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('MTS BALANCE')
  })
  it('UK Growth tab=gdpi restores GDP(I)', () => {
    const html = renderAt('/models/growth?country=uk&tab=gdpi', '/models/growth', <GrowthPage />)
    expect(activeSections(html)).toContain('GDP(I)')
  })
})

describe('Canada country param (Phase 3)', () => {
  it('country=ca renders the Canada inflation branch (IPPI, no PCE)', () => {
    const html = renderAt('/models/inflation?country=ca', '/models/inflation', <InflationPage />)
    expect(html).toContain('IPPI')
    expect(html).not.toContain('PCE PROJECTIONS')
  })
  it('categoryPath carries country=ca', () => {
    expect(categoryPath('/models/fiscal', 'ca')).toBe('/models/fiscal?country=ca')
  })
  it('CA fiscal defaults to GFS BALANCE (invalid tab falls back)', () => {
    const html = renderAt('/models/fiscal?country=ca&tab=zzz', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('GFS BALANCE')
  })
  it('CA fiscal tab=debt restores FEDERAL DEBT', () => {
    const html = renderAt('/models/fiscal?country=ca&tab=debt', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('FEDERAL DEBT')
  })
  it('CA growth tab=gdpi restores GDP(I)', () => {
    const html = renderAt('/models/growth?country=ca&tab=gdpi', '/models/growth', <GrowthPage />)
    expect(activeSections(html)).toContain('GDP(I)')
  })
})

describe('Japan country param (Phase 3)', () => {
  it('country=jp renders the Japan inflation branch (TOKYO ADVANCE, no PCE)', () => {
    const html = renderAt('/models/inflation?country=jp', '/models/inflation', <InflationPage />)
    expect(html).toContain('TOKYO ADVANCE')
    expect(html).not.toContain('PCE PROJECTIONS')
  })
  it('categoryPath carries country=jp', () => {
    expect(categoryPath('/models/labor', 'jp')).toBe('/models/labor?country=jp')
  })
  it('JP labor defaults to LFS (invalid tab falls back)', () => {
    const html = renderAt('/models/labor?country=jp&tab=zzz', '/models/labor', <LaborMarketPage />)
    expect(activeSections(html)).toContain('LFS')
  })
  it('JP labor tab=wages restores WAGES', () => {
    const html = renderAt('/models/labor?country=jp&tab=wages', '/models/labor', <LaborMarketPage />)
    expect(activeSections(html)).toContain('WAGES')
  })
  it('JP industrial tab=ppi restores PPI (BOJ)', () => {
    const html = renderAt('/models/industrial?country=jp&tab=ppi', '/models/industrial', <IndustrialProductionPage />)
    expect(activeSections(html)).toContain('PPI (BOJ)')
  })
  it('JP has no Fiscal — coming-soon with country bar intact (GAP by design)', () => {
    const html = renderAt('/models/fiscal?country=jp', '/models/fiscal', <FiscalPage />)
    expect(html).toContain('JAPAN fiscal models coming soon')
    expect(html).toContain('>JAPAN<')
  })
  it('JP has no Housing — coming-soon with the fallback (US) section bar (deferred by design)', () => {
    const html = renderAt('/models/housing?country=jp', '/models/housing', <HousingPage />)
    expect(html).toContain('JAPAN housing models coming soon')
  })
})

describe('ModelsPage landing', () => {
  it('shows category bar for UK (navigable) without coming-soon', () => {
    const html = renderAt('/models?country=uk', '/models', <ModelsPage />)
    expect(html).toContain('INFLATION')
    expect(html).not.toContain('models coming soon')
  })
  it('shows no coming-soon for JP (live country as of Japan Phase 3)', () => {
    const html = renderAt('/models?country=jp', '/models', <ModelsPage />)
    expect(html).not.toContain('models coming soon')
  })
  it('shows coming-soon for countries without content', () => {
    const html = renderAt('/models?country=au', '/models', <ModelsPage />)
    expect(html).toContain('AUSTRALIA models coming soon')
  })
})

describe('EU3 country params (DE/FR/IT Phase 3)', () => {
  it('country=de renders the EU3 inflation branch (HICP, no PCE)', () => {
    const html = renderAt('/models/inflation?country=de', '/models/inflation', <InflationPage />)
    expect(html).toContain('HICP PROJECTIONS')
    expect(html).not.toContain('PCE PROJECTIONS')
  })
  it('country=fr and country=it share the EU3 structure', () => {
    for (const cc of ['fr', 'it']) {
      const html = renderAt(`/models/growth?country=${cc}`, '/models/growth', <GrowthPage />)
      expect(html).toContain('SENTIMENT')
      expect(activeSections(html)).toContain('GDP')
    }
  })
  it('categoryPath carries country=de', () => {
    expect(categoryPath('/models/labor', 'de')).toBe('/models/labor?country=de')
  })
  it('DE fiscal defaults to BALANCE (invalid tab falls back)', () => {
    const html = renderAt('/models/fiscal?country=de&tab=zzz', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('BALANCE')
  })
  it('IT fiscal tab=debt deep link restores DEBT', () => {
    const html = renderAt('/models/fiscal?country=it&tab=debt', '/models/fiscal', <FiscalPage />)
    expect(activeSections(html)).toContain('DEBT')
  })
  it('FR labor tab=labour-costs deep link restores LABOUR COSTS', () => {
    const html = renderAt('/models/labor?country=fr&tab=labour-costs', '/models/labor', <LaborMarketPage />)
    expect(activeSections(html)).toContain('LABOUR COSTS')
  })
  it('IT industrial tab=construction deep link restores CONSTRUCTION', () => {
    const html = renderAt('/models/industrial?country=it&tab=construction', '/models/industrial', <IndustrialProductionPage />)
    expect(activeSections(html)).toContain('CONSTRUCTION')
  })
  it('DE housing renders the EU3 sections (PRICES/PERMITS), not the US bar', () => {
    const html = renderAt('/models/housing?country=de', '/models/housing', <HousingPage />)
    expect(html).toContain('PERMITS')
    expect(html).not.toContain('DEMAND')
  })
})
