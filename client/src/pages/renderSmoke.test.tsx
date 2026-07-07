// SSR smoke-render regression test (UK models Phase 3).
// Renders the US pages refactored onto the shared chart components, plus every
// new UK content component, to static markup. Effects don't run (no network),
// so this exercises initial render paths: imports, hooks order, JSX, and the
// shared component integration. Run: npx vitest run src/pages/renderSmoke.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

import { RetailSalesDashboardPage } from './RetailSalesDashboardPage'
import { MtsPage } from './MtsPage'

import { UKCPIContent } from './UKCPIContent'
import { UKCPIProjectionsContent } from './UKCPIProjectionsContent'
import { UKPPIContent } from './UKPPIContent'
import { UKOtherInflationContent } from './UKOtherInflationContent'
import { UKLFSContent } from './UKLFSContent'
import { UKClaimantContent } from './UKClaimantContent'
import { UKEarningsContent } from './UKEarningsContent'
import { UKVacanciesContent } from './UKVacanciesContent'
import { UKProductivityContent } from './UKProductivityContent'
import { UKLaborProjectionContent } from './UKLaborProjectionContent'
import { UKConsumptionContent } from './UKConsumptionContent'
import { UKHouseholdIncomeContent } from './UKHouseholdIncomeContent'
import { UKGDPIncomeContent } from './UKGDPIncomeContent'
import { UKConsumerHealthContent } from './UKConsumerHealthContent'
import { UKHousingContent } from './UKHousingContent'
import { UKMoneyCreditContent } from './UKMoneyCreditContent'
import { UKIoPContent } from './UKIoPContent'
import { UKFiscalPSFContent } from './UKFiscalPSFContent'
import { UKHMRCReceiptsContent } from './UKHMRCReceiptsContent'

describe('US pages consuming refactored shared components', () => {
  it('RetailSalesDashboardPage renders', () => {
    const html = renderToStaticMarkup(<MemoryRouter><RetailSalesDashboardPage /></MemoryRouter>)
    expect(html).toContain('Retail Sales Dashboard')
  })
  it('MtsPage renders', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MtsPage /></MemoryRouter>)
    expect(html).toContain('CUMULATIVE FISCAL BALANCE')
  })
})

describe('UK content components render', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['UKCPIContent', () => <UKCPIContent />],
    ['UKCPIProjectionsContent', () => <UKCPIProjectionsContent />],
    ['UKPPIContent', () => <UKPPIContent />],
    ['UKOtherInflationContent', () => <UKOtherInflationContent />],
    ['UKLFSContent', () => <UKLFSContent />],
    ['UKClaimantContent', () => <UKClaimantContent />],
    ['UKEarningsContent', () => <UKEarningsContent />],
    ['UKVacanciesContent', () => <UKVacanciesContent />],
    ['UKProductivityContent', () => <UKProductivityContent />],
    ['UKLaborProjectionContent', () => <UKLaborProjectionContent />],
    ['UKConsumptionContent', () => <UKConsumptionContent />],
    ['UKHouseholdIncomeContent', () => <UKHouseholdIncomeContent />],
    ['UKGDPIncomeContent', () => <UKGDPIncomeContent />],
    ['UKConsumerHealthContent', () => <UKConsumerHealthContent />],
    ['UKHousingContent (demand)', () => <UKHousingContent section="demand" />],
    ['UKHousingContent (prices)', () => <UKHousingContent section="prices" />],
    ['UKHousingContent (credit)', () => <UKHousingContent section="credit" />],
    ['UKMoneyCreditContent', () => <UKMoneyCreditContent />],
    ['UKIoPContent', () => <UKIoPContent />],
    ['UKFiscalPSFContent', () => <UKFiscalPSFContent />],
    ['UKHMRCReceiptsContent', () => <UKHMRCReceiptsContent />],
  ]
  for (const [name, make] of cases) {
    it(`${name} renders`, () => {
      const html = renderToStaticMarkup(<MemoryRouter>{make()}</MemoryRouter>)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})
