// PROXY-series disclosures for the Canada Economic Data Models.
// Text sourced from docs/ca-models-mapping.md §1c (Phase 1, approved Phase 2).
// Every Canada panel that renders a PROXY series must show
// <ProxyBadge caveat={CA_PROXY_CAVEATS.key} />.

import type { ProxyCaveat } from './proxyCaveats'

export const CA_PROXY_CAVEATS: Record<string, ProxyCaveat> = {
  ippi_headline: {
    us: 'PPI Final Demand (PPIFIS): prices received for all final-demand goods, services and construction.',
    local: 'Industrial Product Price Index — factory-gate prices of industrial products (v1230995983).',
    caveat: 'No services or final-demand concept; manufacturing products only. NSA.',
    localTag: 'CA',
  },
  ippi_core: {
    us: 'PPI Final Demand ex food & energy (PPIFES).',
    local: 'IPPI excluding energy and petroleum products (v1230995984).',
    caveat: 'Exclusion basket differs from the US core (energy/petroleum only, food remains included).',
    localTag: 'CA',
  },
  seph_payrolls: {
    us: 'Nonfarm Payrolls (CES establishment survey, monthly change in jobs).',
    local: 'SEPH payroll employment — administrative payroll count, all employees (v79310776).',
    caveat: 'Concept-match to NFP but excludes self-employed and is released ~1 month after the LFS.',
    localTag: 'CA',
  },
  lfs_payrolls: {
    us: 'Nonfarm Payrolls (establishment survey).',
    local: 'LFS employment — household survey (v2062811); the market-moving monthly print.',
    caveat: 'Household survey ≠ establishment payroll count; includes self-employment. Not the same measure as SEPH above.',
    localTag: 'CA',
  },
  seph_earnings: {
    us: 'Average Hourly Earnings (CES).',
    local: 'SEPH average weekly earnings including overtime (v79311153).',
    caveat: 'Weekly not hourly earnings; moves with hours-worked composition as well as wages.',
    localTag: 'CA',
  },
  ei_beneficiaries: {
    us: 'Weekly initial/continuing UI claims.',
    local: 'Monthly EI regular-benefit beneficiaries, SA (v64549353).',
    caveat: 'Monthly stock of recipients, not weekly claim flows; ~2-month publication lag; EI eligibility rules shift the level.',
    localTag: 'CA',
  },
  monthly_gdp_ip: {
    us: 'Industrial Production index (Fed G.17, gross output concept).',
    local: 'Monthly real GDP of goods-producing industries / manufacturing (table 36-10-0434).',
    caveat: 'Value-added GDP concept in chained dollars, not a gross-output production index.',
    localTag: 'CA',
  },
  household_credit: {
    us: 'Fed H.8 bank credit by loan category and bank-size cohort (weekly).',
    local: 'Credit liabilities of households — mortgage / non-mortgage / cards, monthly SA (table 36-10-0639).',
    caveat: 'Borrower-side household stock; no bank-asset view (C&I/CRE lending not covered); monthly not weekly.',
    localTag: 'CA',
  },
  boc_core_rates: {
    us: 'Core CPI index (CPILFESL) with rates derived from the index.',
    local: 'BoC preferred core measures CPI-trim / CPI-median / CPI-common, published as YoY % only.',
    caveat: 'No index form exists — published rates are plotted directly; MoM, annualized and level views are impossible.',
    localTag: 'CA',
  },
  merch_trade: {
    us: 'Total goods + services trade balance (BOP basis).',
    local: 'Merchandise (goods-only) trade, BoP basis, SA (table 12-10-0011).',
    caveat: 'Services trade is quarterly and not included; balances differ from the total-trade concept.',
    localTag: 'CA',
  },
}
