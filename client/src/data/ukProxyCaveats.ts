// PROXY-series disclosures for the UK Economic Data Models.
// Text sourced from the caveat columns of docs/uk-models-mapping.md (Phase 1).
// Consumed by <ProxyBadge tooltip={UK_PROXY_CAVEATS[key]} /> in Phase 3 —
// every panel that renders a PROXY series (rather than a DIRECT equivalent)
// must show the badge with this text.

import type { ProxyCaveat } from './proxyCaveats'

export type { ProxyCaveat }

export const UK_PROXY_CAVEATS: Record<string, ProxyCaveat> = {
  ppi_headline: {
    us: 'PPI Final Demand (PPIFIS): prices received for all final-demand goods, services and construction.',
    local: 'Output PPI, net sector output of manufactured products (JVZ7).',
    caveat: 'UK PPI covers manufacturing output only — no services or final-demand concept. NSA.',
    localTag: 'UK',
  },
  ppi_core: {
    us: 'PPI Final Demand ex food & energy (PPIFES).',
    local: 'Output PPI, core manufactured products ex food, beverages, tobacco & petroleum (GBBV).',
    caveat: 'Manufacturing scope only; exclusion basket differs (also excludes beverages/tobacco). NSA.',
    localTag: 'UK',
  },
  payrolled_employees: {
    us: 'Nonfarm Payrolls (establishment survey, monthly change in jobs).',
    local: 'PAYE RTI payrolled employees (administrative tax data, monthly level).',
    caveat: 'Differs in coverage (excludes self-employed) and methodology (admin data vs survey); latest month provisional.',
    localTag: 'UK',
  },
  claimant_count: {
    us: 'Weekly initial/continuing jobless claims (UI administrative filings).',
    local: 'Monthly claimant count — people claiming unemployment-related benefits (BCJD/BCJE).',
    caveat: 'Monthly not weekly; no initial/continuing split; Universal Credit policy changes distort the level over time.',
    localTag: 'UK',
  },
  lfs_rolling: {
    us: 'CPS household survey, single-month estimates.',
    local: 'LFS rolling three-month averages published monthly.',
    caveat: 'Each "month" is a 3-month window average — month-on-month moves overlap two-thirds of their sample.',
    localTag: 'UK',
  },
  vacancies: {
    us: 'JOLTS job openings (single-month, with hires/quits/layoffs flows).',
    local: 'ONS vacancy survey, rolling 3-month average (AP2Y).',
    caveat: 'No UK hires/quits/layoffs flows exist; redundancies (BEAO) proxy layoffs only.',
    localTag: 'UK',
  },
  consumption_quarterly: {
    us: 'Monthly nominal/real PCE by category (BEA).',
    local: 'Quarterly Consumer Trends household spending by durability (UTID/UTIT/UTIL/UTIP).',
    caveat: 'Quarterly not monthly; national-accounts basis; real (CVM) splits are not additive.',
    localTag: 'UK',
  },
  household_income: {
    us: 'Monthly Personal Income & Outlays (BEA Table 2.1).',
    local: 'Quarterly real household disposable income, saving ratio and compensation (NRJR/DGD8/DTWM).',
    caveat: 'Quarterly only — no UK monthly personal-income release exists.',
    localTag: 'UK',
  },
  gdp_income: {
    us: 'Gross Domestic Income, 24-line quarterly decomposition (NIPA 1.10).',
    local: 'GDP(income approach): compensation, gross operating surplus, mixed income, taxes less subsidies.',
    caveat: 'Slimmer decomposition; no UK real GDI equivalent is published.',
    localTag: 'UK',
  },
  bank_credit: {
    us: 'Fed H.8 bank credit by loan category and bank-size cohort (weekly).',
    local: 'BoE Money & Credit / Bankstats monthly aggregates (M4, secured & consumer lending).',
    caveat: 'Monthly not weekly; no large/small-bank cohort split; sector definitions differ from H.8 categories.',
    localTag: 'UK',
  },
  housing_transactions: {
    us: 'New home sales (HSN1F) and months\' supply.',
    local: 'Mortgage approvals for house purchase (LPMVTVX) as the demand-flow indicator.',
    caveat: 'Approvals lead completed transactions; no UK new-home-sales or months\'-supply series exists.',
    localTag: 'UK',
  },
  hmrc_receipts: {
    us: 'DTS daily withheld employment tax deposits (business-day cycle tables).',
    local: 'HMRC monthly cash receipts by tax head.',
    caveat: 'Monthly not business-day; cash-receipt timing differs from accrual measures in PSF.',
    localTag: 'UK',
  },
  trade_categories: {
    us: 'Census goods trade by end-use category (monthly).',
    local: 'UK trade in goods by SITC section.',
    caveat: 'Category taxonomies differ (SITC sections vs end-use); not yet ingested — deferred.',
    localTag: 'UK',
  },
  effective_mortgage_rate: {
    us: '30-year fixed mortgage rate, weekly (MORTGAGE30US).',
    local: 'BoE quoted 2y/5y fixed 75% LTV rates and effective secured-lending rates.',
    caveat: 'UK mortgages fix for 2–5 years, not 30; "effective" series mix new business and outstanding stock.',
    localTag: 'UK',
  },
  inflation_expectations: {
    us: 'UMich 1y/5y and NY Fed SCE 1y/3y/5y expectations (monthly).',
    local: 'BoE/Ipsos Inflation Attitudes Survey medians (quarterly).',
    caveat: 'Quarterly not monthly; survey methodology differs. Not yet ingested — deferred.',
    localTag: 'UK',
  },
  consumer_credit: {
    us: 'Revolving credit card balances (RCCCBBALTOT, quarterly bank data).',
    local: 'BoE sterling consumer credit to individuals ex Student Loans Company (LPMBI2O outstanding / LPMB3PS flow / LPMB4TC growth), monthly SA.',
    caveat: 'Covers all unsecured consumer credit (cards + loans + overdrafts), not credit cards alone.',
    localTag: 'UK',
  },
  hours_worked: {
    us: 'Average weekly hours by sector (CES establishment survey).',
    local: 'LFS total actual weekly hours worked, whole economy (YBUS).',
    caveat: 'Aggregate hours level, not per-worker sector averages; LFS rolling 3-month basis.',
    localTag: 'UK',
  },
  vacancy_rate: {
    us: 'JOLTS job-openings rate: openings / (openings + employment).',
    local: 'Computed from ONS vacancies (AP2Y) and LFS employment (MGRZ) using the same formula.',
    caveat: 'Vacancy survey is a rolling 3-month average and excludes agriculture; not an official published rate.',
    localTag: 'UK',
  },
  retail_contribution: {
    us: 'Retail sales store-type contributions weighted from published dollar levels.',
    local: 'Retail Sales Index sector volume/value indices; official weights live in the bulletin, not the API.',
    caveat: 'Contributions computed from value shares are approximate; volume indices are chain-linked.',
    localTag: 'UK',
  },
}
