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

import { EU3HICPContent } from './EU3HICPContent'
import { EU3HICPProjectionsContent } from './EU3HICPProjectionsContent'
import { EU3OtherInflationContent } from './EU3OtherInflationContent'
import { EU3GDPContent } from './EU3GDPContent'
import { EU3RetailContent } from './EU3RetailContent'
import { EU3TradeContent } from './EU3TradeContent'
import { EU3SentimentContent } from './EU3SentimentContent'
import { EU3UnemploymentContent } from './EU3UnemploymentContent'
import { EU3EmploymentContent } from './EU3EmploymentContent'
import { EU3VacanciesContent } from './EU3VacanciesContent'
import { EU3LabourCostsContent } from './EU3LabourCostsContent'
import { EU3IndustrialContent } from './EU3IndustrialContent'
import { EU3HousingContent } from './EU3HousingContent'
import { EU3FiscalContent } from './EU3FiscalContent'
import { EU3LendingContent } from './EU3LendingContent'

import { AUCPIContent } from './AUCPIContent'
import { AUCPIProjectionsContent } from './AUCPIProjectionsContent'
import { AUPPIContent } from './AUPPIContent'
import { AUOtherInflationContent } from './AUOtherInflationContent'
import { AUGDPContent } from './AUGDPContent'
import { AUSpendingContent } from './AUSpendingContent'
import { AUTradeContent } from './AUTradeContent'
import { AUBusinessContent } from './AUBusinessContent'
import { AULabourForceContent } from './AULabourForceContent'
import { AUEmploymentContent } from './AUEmploymentContent'
import { AUUnderutilisationContent } from './AUUnderutilisationContent'
import { AUVacanciesContent } from './AUVacanciesContent'
import { AUWagesContent } from './AUWagesContent'
import { AULaborProjectionContent } from './AULaborProjectionContent'
import { AUHousingContent } from './AUHousingContent'

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

describe('EU3 content components render (parameterized, all three countries)', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['EU3HICPContent (DE)', () => <EU3HICPContent cc="DE" />],
    ['EU3HICPContent (FR)', () => <EU3HICPContent cc="FR" />],
    ['EU3HICPContent (IT)', () => <EU3HICPContent cc="IT" />],
    ['EU3HICPProjectionsContent (DE)', () => <EU3HICPProjectionsContent cc="DE" />],
    ['EU3HICPProjectionsContent (IT)', () => <EU3HICPProjectionsContent cc="IT" />],
    ['EU3OtherInflationContent (DE)', () => <EU3OtherInflationContent cc="DE" />],
    ['EU3OtherInflationContent (FR)', () => <EU3OtherInflationContent cc="FR" />],
    ['EU3GDPContent (DE)', () => <EU3GDPContent cc="DE" />],
    ['EU3GDPContent (FR)', () => <EU3GDPContent cc="FR" />],
    ['EU3GDPContent (IT)', () => <EU3GDPContent cc="IT" />],
    ['EU3RetailContent (DE)', () => <EU3RetailContent cc="DE" />],
    ['EU3TradeContent (FR)', () => <EU3TradeContent cc="FR" />],
    ['EU3SentimentContent (IT)', () => <EU3SentimentContent cc="IT" />],
    ['EU3UnemploymentContent (DE)', () => <EU3UnemploymentContent cc="DE" />],
    ['EU3UnemploymentContent (FR)', () => <EU3UnemploymentContent cc="FR" />],
    ['EU3UnemploymentContent (IT)', () => <EU3UnemploymentContent cc="IT" />],
    ['EU3EmploymentContent (FR)', () => <EU3EmploymentContent cc="FR" />],
    ['EU3VacanciesContent (DE)', () => <EU3VacanciesContent cc="DE" />],
    ['EU3VacanciesContent (FR)', () => <EU3VacanciesContent cc="FR" />],
    ['EU3VacanciesContent (IT)', () => <EU3VacanciesContent cc="IT" />],
    ['EU3LabourCostsContent (DE)', () => <EU3LabourCostsContent cc="DE" />],
    ['EU3IndustrialContent (DE ip)', () => <EU3IndustrialContent cc="DE" section="ip" />],
    ['EU3IndustrialContent (IT construction)', () => <EU3IndustrialContent cc="IT" section="construction" />],
    ['EU3HousingContent (DE prices)', () => <EU3HousingContent cc="DE" section="prices" />],
    ['EU3HousingContent (DE permits)', () => <EU3HousingContent cc="DE" section="permits" />],
    ['EU3HousingContent (IT permits)', () => <EU3HousingContent cc="IT" section="permits" />],
    ['EU3FiscalContent (IT balance)', () => <EU3FiscalContent cc="IT" section="balance" />],
    ['EU3FiscalContent (DE debt)', () => <EU3FiscalContent cc="DE" section="debt" />],
    ['EU3LendingContent (DE)', () => <EU3LendingContent cc="DE" />],
    ['EU3LendingContent (FR)', () => <EU3LendingContent cc="FR" />],
  ]
  for (const [name, make] of cases) {
    it(`${name} renders`, () => {
      const html = renderToStaticMarkup(<MemoryRouter>{make()}</MemoryRouter>)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})

describe('Australia content components render (final country)', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['AUCPIContent', () => <AUCPIContent />],
    ['AUCPIProjectionsContent', () => <AUCPIProjectionsContent />],
    ['AUPPIContent', () => <AUPPIContent />],
    ['AUOtherInflationContent', () => <AUOtherInflationContent />],
    ['AUGDPContent', () => <AUGDPContent />],
    ['AUSpendingContent', () => <AUSpendingContent />],
    ['AUTradeContent', () => <AUTradeContent />],
    ['AUBusinessContent', () => <AUBusinessContent />],
    ['AULabourForceContent', () => <AULabourForceContent />],
    ['AUEmploymentContent', () => <AUEmploymentContent />],
    ['AUUnderutilisationContent', () => <AUUnderutilisationContent />],
    ['AUVacanciesContent', () => <AUVacanciesContent />],
    ['AUWagesContent', () => <AUWagesContent />],
    ['AULaborProjectionContent', () => <AULaborProjectionContent />],
    ['AUHousingContent (approvals)', () => <AUHousingContent section="approvals" />],
    ['AUHousingContent (prices-lending)', () => <AUHousingContent section="prices-lending" />],
  ]
  for (const [name, make] of cases) {
    it(`${name} renders`, () => {
      const html = renderToStaticMarkup(<MemoryRouter>{make()}</MemoryRouter>)
      expect(html.length).toBeGreaterThan(0)
    })
  }
})
