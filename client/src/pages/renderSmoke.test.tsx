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

import { CACPIContent } from './CACPIContent'
import { CACPIProjectionsContent } from './CACPIProjectionsContent'
import { CAIPPIContent } from './CAIPPIContent'
import { CAOtherInflationContent } from './CAOtherInflationContent'
import { CALFSContent } from './CALFSContent'
import { CAEIContent } from './CAEIContent'
import { CAPayrollsContent } from './CAPayrollsContent'
import { CAVacanciesContent } from './CAVacanciesContent'
import { CAProductivityContent } from './CAProductivityContent'
import { CALaborProjectionContent } from './CALaborProjectionContent'
import { CAGDPContent } from './CAGDPContent'
import { CAMonthlyGDPContent } from './CAMonthlyGDPContent'
import { CARetailContent } from './CARetailContent'
import { CATradeContent } from './CATradeContent'
import { CAConsumptionContent } from './CAConsumptionContent'
import { CAHouseholdIncomeContent } from './CAHouseholdIncomeContent'
import { CAGDPIncomeContent } from './CAGDPIncomeContent'
import { CAConsumerHealthContent } from './CAConsumerHealthContent'
import { CAHousingContent } from './CAHousingContent'
import { CAHouseholdCreditContent } from './CAHouseholdCreditContent'
import { CAIndustrialContent } from './CAIndustrialContent'
import { CAFiscalGFSContent } from './CAFiscalGFSContent'
import { CAFiscalDebtContent } from './CAFiscalDebtContent'

import { JPCPIContent } from './JPCPIContent'
import { JPCPIProjectionsContent } from './JPCPIProjectionsContent'
import { JPTokyoCPIContent } from './JPTokyoCPIContent'
import { JPOtherInflationContent } from './JPOtherInflationContent'
import { JPGDPContent } from './JPGDPContent'
import { JPConsumptionContent } from './JPConsumptionContent'
import { JPTradeContent } from './JPTradeContent'
import { JPLFSContent } from './JPLFSContent'
import { JPJobOffersContent } from './JPJobOffersContent'
import { JPWagesContent } from './JPWagesContent'
import { JPLaborProjectionContent } from './JPLaborProjectionContent'
import { JPIIPContent } from './JPIIPContent'
import { JPPPIContent } from './JPPPIContent'
import { JPBankLendingContent } from './JPBankLendingContent'

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

describe('Canada content components render', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['CACPIContent', () => <CACPIContent />],
    ['CACPIProjectionsContent', () => <CACPIProjectionsContent />],
    ['CAIPPIContent', () => <CAIPPIContent />],
    ['CAOtherInflationContent', () => <CAOtherInflationContent />],
    ['CALFSContent', () => <CALFSContent />],
    ['CAEIContent', () => <CAEIContent />],
    ['CAPayrollsContent', () => <CAPayrollsContent />],
    ['CAVacanciesContent', () => <CAVacanciesContent />],
    ['CAProductivityContent', () => <CAProductivityContent />],
    ['CALaborProjectionContent', () => <CALaborProjectionContent />],
    ['CAGDPContent', () => <CAGDPContent />],
    ['CAMonthlyGDPContent', () => <CAMonthlyGDPContent />],
    ['CARetailContent', () => <CARetailContent />],
    ['CATradeContent', () => <CATradeContent />],
    ['CAConsumptionContent', () => <CAConsumptionContent />],
    ['CAHouseholdIncomeContent', () => <CAHouseholdIncomeContent />],
    ['CAGDPIncomeContent', () => <CAGDPIncomeContent />],
    ['CAConsumerHealthContent', () => <CAConsumerHealthContent />],
    ['CAHousingContent (supply)', () => <CAHousingContent section="supply" />],
    ['CAHousingContent (prices)', () => <CAHousingContent section="prices" />],
    ['CAHousingContent (credit)', () => <CAHousingContent section="credit" />],
    ['CAHouseholdCreditContent', () => <CAHouseholdCreditContent />],
    ['CAIndustrialContent', () => <CAIndustrialContent />],
    ['CAFiscalGFSContent', () => <CAFiscalGFSContent />],
    ['CAFiscalDebtContent', () => <CAFiscalDebtContent />],
  ]
  for (const [name, make] of cases) {
    it(`${name} renders`, () => {
      const html = renderToStaticMarkup(<MemoryRouter>{make()}</MemoryRouter>)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})

describe('Japan content components render', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['JPCPIContent', () => <JPCPIContent />],
    ['JPCPIProjectionsContent', () => <JPCPIProjectionsContent />],
    ['JPTokyoCPIContent', () => <JPTokyoCPIContent />],
    ['JPOtherInflationContent', () => <JPOtherInflationContent />],
    ['JPGDPContent', () => <JPGDPContent />],
    ['JPConsumptionContent', () => <JPConsumptionContent />],
    ['JPTradeContent', () => <JPTradeContent />],
    ['JPLFSContent', () => <JPLFSContent />],
    ['JPJobOffersContent', () => <JPJobOffersContent />],
    ['JPWagesContent', () => <JPWagesContent />],
    ['JPLaborProjectionContent', () => <JPLaborProjectionContent />],
    ['JPIIPContent', () => <JPIIPContent />],
    ['JPPPIContent', () => <JPPPIContent />],
    ['JPBankLendingContent', () => <JPBankLendingContent />],
  ]
  for (const [name, make] of cases) {
    it(`${name} renders`, () => {
      const html = renderToStaticMarkup(<MemoryRouter>{make()}</MemoryRouter>)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})
