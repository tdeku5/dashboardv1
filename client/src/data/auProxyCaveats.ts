// PROXY-series and transition disclosures for the Australia Economic Data
// Models. Text sourced from docs/au-models-mapping.md §1c (Phase 1, approved
// Phase 2). Panels render <ProxyBadge caveat={AU_PROXY_CAVEATS.key} />.

import type { ProxyCaveat } from './proxyCaveats'

export const AU_PROXY_CAVEATS: Record<string, ProxyCaveat> = {
  dual_freq_cpi: {
    us: 'One monthly CPI.',
    local: 'The complete Monthly CPI is Australia\'s primary headline measure since Nov-2025, while the QUARTERLY trimmed mean remains the RBA\'s stated primary underlying-inflation reference during the transition (through ~mid-2027).',
    caveat: 'Two frequencies, two base periods (monthly ~2023-24=100 vs quarterly 2011-12=100), never spliced; monthly history begins Apr-2024.',
    localTag: 'AU',
  },
  monthly_cpi_floor: {
    us: 'CPI history from 1913.',
    local: 'Complete Monthly CPI index from Apr-2024; YoY readable from Apr-2025.',
    caveat: 'Short history — long-run panels (explorer, distribution, projections) run on the quarterly series.',
    localTag: 'AU',
  },
  interim_sa: {
    us: 'Mature X-13 seasonal adjustment.',
    local: 'Monthly SA, trimmed mean, and weighted median use interim seasonal-adjustment methods on under two years of data.',
    caveat: 'Interim factors will revise as history accrues — read monthly SA paces with extra care.',
    localTag: 'AU',
  },
  trimmed_mean_reference: {
    us: 'Core CPI (ex food & energy) as the underlying gauge.',
    local: 'The quarterly trimmed mean (1982→) is the RBA\'s stated primary underlying-inflation reference during the monthly transition; the monthly trimmed mean is the timely analogue.',
    caveat: 'Watch the quarterly print for policy; the monthly line has <2 years of history and interim SA.',
    localTag: 'AU',
  },
  hsi_consumption: {
    us: 'Retail sales (Census) and monthly PCE.',
    local: 'Monthly Household Spending Indicator — bank-transaction and administrative data; the successor to the Retail Trade survey (discontinued mid-2025).',
    caveat: 'Current prices only at monthly frequency (volumes are quarterly); methodology differs before Dec-2018.',
    localTag: 'AU',
  },
  lf_jobs: {
    us: 'Nonfarm Payrolls (establishment survey).',
    local: 'LFS employed persons (household survey, monthly SA + trend).',
    caveat: 'The STP Weekly Payroll Jobs series was discontinued Jul-2025 (its MEEI successor is spreadsheet-only) — the two-source payrolls pattern used elsewhere does not apply; no establishment jobs count is API-available.',
    localTag: 'AU',
  },
  jv_vacancies: {
    us: 'JOLTS — monthly openings with hires/quits/layoffs flows.',
    local: 'ABS Job Vacancies survey — quarterly vacancy levels, 1979→.',
    caveat: 'No hires/quits flows; the survey was suspended 2008-09 (a real gap in the series); ~2-month publication lag.',
    localTag: 'AU',
  },
  tvd_prices: {
    us: 'Case-Shiller / FHFA constant-quality price indices.',
    local: 'ABS mean dwelling price (Total Value of Dwellings, quarterly level in A$k, 2011→).',
    caveat: 'A mean price LEVEL, not a constant-quality index — composition shifts move it. The official RPPI was discontinued 2022 (frozen at 2021-Q4); daily/monthly indices (CoreLogic) are private.',
    localTag: 'AU',
  },
  approvals_nsa: {
    us: 'Building permits, SAAR.',
    local: 'ABS building approvals — published original (NSA) only on the API despite codelists advertising SA/Trend.',
    caveat: 'NSA — compare same months; the 12-month-sum view is the trend read.',
    localTag: 'AU',
  },
  trend_vs_sa: {
    us: 'Seasonally adjusted headline rates.',
    local: 'ABS explicitly recommends TREND estimates over SA for Labour Force headline rates (the SA series carries a ±0.2pp standard error).',
    caveat: 'Panels emphasize the trend line with SA alongside — monthly SA surprises often wash out in trend.',
    localTag: 'AU',
  },
}
