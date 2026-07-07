// PROXY-series disclosures for the UK Economic Data Models.
// Text sourced from the caveat columns of docs/uk-models-mapping.md (Phase 1).
// Consumed by <ProxyBadge tooltip={UK_PROXY_CAVEATS[key]} /> in Phase 3 —
// every panel that renders a PROXY series (rather than a DIRECT equivalent)
// must show the badge with this text.

export interface ProxyCaveat {
  /** What the US series measures */
  us: string
  /** What the UK substitute measures */
  uk: string
  /** The key difference the reader must know */
  caveat: string
}

export const UK_PROXY_CAVEATS: Record<string, ProxyCaveat> = {
  ppi_headline: {
    us: 'PPI Final Demand (PPIFIS): prices received for all final-demand goods, services and construction.',
    uk: 'Output PPI, net sector output of manufactured products (JVZ7).',
    caveat: 'UK PPI covers manufacturing output only — no services or final-demand concept. NSA.',
  },
  ppi_core: {
    us: 'PPI Final Demand ex food & energy (PPIFES).',
    uk: 'Output PPI, core manufactured products ex food, beverages, tobacco & petroleum (GBBV).',
    caveat: 'Manufacturing scope only; exclusion basket differs (also excludes beverages/tobacco). NSA.',
  },
  payrolled_employees: {
    us: 'Nonfarm Payrolls (establishment survey, monthly change in jobs).',
    uk: 'PAYE RTI payrolled employees (administrative tax data, monthly level).',
    caveat: 'Differs in coverage (excludes self-employed) and methodology (admin data vs survey); latest month provisional.',
  },
  claimant_count: {
    us: 'Weekly initial/continuing jobless claims (UI administrative filings).',
    uk: 'Monthly claimant count — people claiming unemployment-related benefits (BCJD/BCJE).',
    caveat: 'Monthly not weekly; no initial/continuing split; Universal Credit policy changes distort the level over time.',
  },
  lfs_rolling: {
    us: 'CPS household survey, single-month estimates.',
    uk: 'LFS rolling three-month averages published monthly.',
    caveat: 'Each "month" is a 3-month window average — month-on-month moves overlap two-thirds of their sample.',
  },
  vacancies: {
    us: 'JOLTS job openings (single-month, with hires/quits/layoffs flows).',
    uk: 'ONS vacancy survey, rolling 3-month average (AP2Y).',
    caveat: 'No UK hires/quits/layoffs flows exist; redundancies (BEAO) proxy layoffs only.',
  },
  consumption_quarterly: {
    us: 'Monthly nominal/real PCE by category (BEA).',
    uk: 'Quarterly Consumer Trends household spending by durability (UTID/UTIT/UTIL/UTIP).',
    caveat: 'Quarterly not monthly; national-accounts basis; real (CVM) splits are not additive.',
  },
  household_income: {
    us: 'Monthly Personal Income & Outlays (BEA Table 2.1).',
    uk: 'Quarterly real household disposable income, saving ratio and compensation (NRJR/DGD8/DTWM).',
    caveat: 'Quarterly only — no UK monthly personal-income release exists.',
  },
  gdp_income: {
    us: 'Gross Domestic Income, 24-line quarterly decomposition (NIPA 1.10).',
    uk: 'GDP(income approach): compensation, gross operating surplus, mixed income, taxes less subsidies.',
    caveat: 'Slimmer decomposition; no UK real GDI equivalent is published.',
  },
  bank_credit: {
    us: 'Fed H.8 bank credit by loan category and bank-size cohort (weekly).',
    uk: 'BoE Money & Credit / Bankstats monthly aggregates (M4, secured & consumer lending).',
    caveat: 'Monthly not weekly; no large/small-bank cohort split; sector definitions differ from H.8 categories.',
  },
  housing_transactions: {
    us: 'New home sales (HSN1F) and months\' supply.',
    uk: 'Mortgage approvals for house purchase (LPMVTVX) as the demand-flow indicator.',
    caveat: 'Approvals lead completed transactions; no UK new-home-sales or months\'-supply series exists.',
  },
  hmrc_receipts: {
    us: 'DTS daily withheld employment tax deposits (business-day cycle tables).',
    uk: 'HMRC monthly cash receipts by tax head.',
    caveat: 'Monthly not business-day; cash-receipt timing differs from accrual measures in PSF.',
  },
  trade_categories: {
    us: 'Census goods trade by end-use category (monthly).',
    uk: 'UK trade in goods by SITC section.',
    caveat: 'Category taxonomies differ (SITC sections vs end-use); not yet ingested — deferred.',
  },
  effective_mortgage_rate: {
    us: '30-year fixed mortgage rate, weekly (MORTGAGE30US).',
    uk: 'BoE quoted 2y/5y fixed 75% LTV rates and effective secured-lending rates.',
    caveat: 'UK mortgages fix for 2–5 years, not 30; "effective" series mix new business and outstanding stock.',
  },
  inflation_expectations: {
    us: 'UMich 1y/5y and NY Fed SCE 1y/3y/5y expectations (monthly).',
    uk: 'BoE/Ipsos Inflation Attitudes Survey medians (quarterly).',
    caveat: 'Quarterly not monthly; survey methodology differs. Not yet ingested — deferred.',
  },
  consumer_credit: {
    us: 'Revolving credit card balances (RCCCBBALTOT, quarterly bank data).',
    uk: 'BoE sterling consumer credit to individuals ex Student Loans Company (LPMBI2O outstanding / LPMB3PS flow / LPMB4TC growth), monthly SA.',
    caveat: 'Covers all unsecured consumer credit (cards + loans + overdrafts), not credit cards alone.',
  },
  hours_worked: {
    us: 'Average weekly hours by sector (CES establishment survey).',
    uk: 'LFS total actual weekly hours worked, whole economy (YBUS).',
    caveat: 'Aggregate hours level, not per-worker sector averages; LFS rolling 3-month basis.',
  },
  vacancy_rate: {
    us: 'JOLTS job-openings rate: openings / (openings + employment).',
    uk: 'Computed from ONS vacancies (AP2Y) and LFS employment (MGRZ) using the same formula.',
    caveat: 'Vacancy survey is a rolling 3-month average and excludes agriculture; not an official published rate.',
  },
  retail_contribution: {
    us: 'Retail sales store-type contributions weighted from published dollar levels.',
    uk: 'Retail Sales Index sector volume/value indices; official weights live in the bulletin, not the API.',
    caveat: 'Contributions computed from value shares are approximate; volume indices are chain-linked.',
  },
}
