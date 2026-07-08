// PROXY-series disclosures for the Japan Economic Data Models.
// Text sourced from docs/jp-models-mapping.md §1c (Phase 1, approved Phase 2).
// Every Japan panel that renders a PROXY series must show
// <ProxyBadge caveat={JP_PROXY_CAVEATS.key} />.

import type { ProxyCaveat } from './proxyCaveats'

export const JP_PROXY_CAVEATS: Record<string, ProxyCaveat> = {
  core_nomenclature: {
    us: 'Core CPI = all items excluding food AND energy.',
    local: 'Japan "core" (生鮮食品を除く総合) = ex FRESH FOOD ONLY — energy is included; it is the BoJ\'s policy reference. "Core-core" (ex fresh food & energy) is the US-core analog.',
    caveat: 'Energy swings move Japan\'s "core" — never read it as US core. Use the core-core line for the US-comparable measure.',
    localTag: 'JP',
  },
  tokyo_advance: {
    us: '(No analog — the national CPI is the earliest print.)',
    local: 'Ku-area-of-Tokyo CPI publishes ~3–4 weeks before the national index and is the market-moving release.',
    caveat: 'Tokyo only (~7% of national weights); the national print can diverge from the Tokyo advance.',
    localTag: 'JP',
  },
  fies_consumption: {
    us: 'Monthly PCE — economy-wide consumption, BEA-deflated.',
    local: 'FIES household-survey spending per two-or-more-person household, nominal yen (0002070001).',
    caveat: 'Survey of ~9k households, NSA and volatile; the "real" line shown is CPI-deflated by the terminal (official real series is file-only).',
    localTag: 'JP',
  },
  lfs_payrolls_jp: {
    us: 'Nonfarm Payrolls (establishment survey, monthly change in jobs).',
    local: 'LFS employed persons — household-survey level, ten-thousands (0002060001).',
    caveat: 'Household survey includes self-employed; no establishment jobs count is API-available in Japan.',
    localTag: 'JP',
  },
  regemp_mls: {
    us: 'Nonfarm Payrolls.',
    local: 'Index of Regular Workers Employment, year-over-year % — derived from the Monthly Labour Survey via the Cabinet Office composite indicators.',
    caveat: 'A derived MLS series (2020 base): YoY rate only, no level; full MLS employment data is file-only and deferred.',
    localTag: 'JP',
  },
  job_offers: {
    us: 'JOLTS job openings with hires/quits/layoffs flows.',
    local: 'Active job-offers-to-applicants ratio, SA (有効求人倍率) — Japan\'s own market-moving labor-demand gauge.',
    caveat: 'Ratio of Hello-Work postings to applicants — excludes new graduates and much white-collar hiring; no hires/quits flows exist.',
    localTag: 'JP',
  },
  mfg_earnings: {
    us: 'Average Hourly Earnings, all private employees (CES).',
    local: 'Contractual cash earnings index, MANUFACTURING only, 2020=100 (via the Cabinet Office composite indicators).',
    caveat: 'Manufacturing subset; excludes overtime and bonuses — summer/winter bonus months (Jun–Jul, Dec) dominate total pay and are invisible here. Full Monthly Labour Survey wages are file-only and deferred.',
    localTag: 'JP',
  },
  boj_lending: {
    us: 'Fed H.8 bank credit by loan category and bank cohort (weekly).',
    local: 'BoJ loans & discounts outstanding — major + regional + shinkin banks, monthly (¥100M units).',
    caveat: 'Aggregate lending stock only, no borrower-category split. Data via the BoJ Time-Series Data Search API; content not guaranteed by the Bank of Japan.',
    localTag: 'JP',
  },
  trade_customs: {
    us: 'BOP-basis goods + services trade balance.',
    local: 'Customs-clearance goods totals (world), NSA, thousand yen, from the Customs long-series CSV.',
    caveat: 'Customs basis ≠ BOP basis; services excluded; strongly seasonal (NSA) — compare like months.',
    localTag: 'JP',
  },
  unemployment_nsa: {
    us: 'Seasonally adjusted unemployment rate.',
    local: 'LFS detail rates are NSA on the API; the SA headline comes from the Cabinet Office composite-indicator table (3060).',
    caveat: 'NSA panels carry seasonal patterns — compare Decembers with Decembers; the SA overlay is the headline number.',
    localTag: 'JP',
  },
}
