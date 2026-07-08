// PROXY-series disclosures for the DE/FR/IT (EU3) economic models.
// Text sourced from docs/eu3-models-mapping.md §1c (Phase 1, approved Phase 2).
// Structure per the job spec: shared text is stored ONCE; countries that
// genuinely differ (vacancies coverage, employment s_adj, break dates) carry
// overrides. Panels call eu3Caveat('key', 'DE') and get a ProxyCaveat with the
// country's tag and any country-specific caveat text merged in.

import type { ProxyCaveat } from './proxyCaveats'

export type Eu3Country = 'DE' | 'FR' | 'IT'

const SHARED: Record<string, Omit<ProxyCaveat, 'localTag'>> = {
  employment_proxy: {
    us: 'Nonfarm Payrolls — monthly establishment-survey jobs count.',
    local: 'National-accounts employees (Eurostat namq_10_a10_e, SAL_DC): quarterly, domestic concept, seasonally adjusted.',
    caveat: 'Quarterly not monthly; domestic concept counts cross-border workers at the workplace; national-accounts sourced, not a survey print. Chosen over the LFS series for longer history and no survey breaks.',
  },
  lci_wages: {
    us: 'Average Hourly Earnings — monthly, private employees.',
    local: 'Labour Cost Index (Eurostat lc_lci_r2_q, NACE B-S): quarterly index of hourly labour costs, with published YoY.',
    caveat: 'Quarterly; includes taxes minus subsidies on labour (D1_D4_MD5), not pure wages; business economy only.',
  },
  fiscal_quarterly: {
    us: 'Daily (DTS) and monthly (MTS) cash-basis Treasury flows.',
    local: 'Eurostat quarterly general-government accounts (ESA accrual): net lending, revenue, expenditure, Maastricht debt.',
    caveat: 'Quarterly accrual accounting, not cash flows; strong within-year seasonality — use the trailing-4Q view for trend. No daily/monthly analog exists.',
  },
  permits_index: {
    us: 'Building permits — absolute monthly counts (SAAR).',
    local: 'Eurostat building-permits index for residential dwellings (2021=100), quarterly.',
    caveat: 'Index form only — no absolute dwelling counts exist in the dataset; quarterly cadence.',
  },
  sentiment_survey: {
    us: 'Conference Board / U-Mich consumer surveys; ISM business surveys.',
    local: 'DG-ECFIN harmonized EU business & consumer surveys (ESI, consumer & industry confidence).',
    caveat: 'Harmonized EU panels — not the national market-movers (ifo/ZEW, INSEE climat, ISTAT fiducia), which are separate surveys with different panels and timing.',
  },
  hicp_projection_nsa: {
    us: 'Seasonally adjusted CPI enables clean sequential paces.',
    local: 'Country HICP has no seasonally adjusted variant on the ECB portal — projections use same-calendar-month prior-year MoM paces.',
    caveat: 'NSA method (UK precedent): projected months inherit last year\'s seasonal pattern; short-run paces carry seasonality.',
  },
  vacancies: {
    us: 'JOLTS — monthly openings, hires, quits, layoffs.',
    local: 'Eurostat job-vacancy rate (jvs_q_nace2, NACE B-S), quarterly, SA.',
    caveat: 'Quarterly, ~2-quarter publication lag, no hires/quits flows.',
  },
  bsi_lending: {
    us: 'Fed H.8 — weekly bank credit by loan category and bank cohort.',
    local: 'ECB BSI: MFI loans outstanding to households and to non-financial corporations, monthly, with published annual growth rates.',
    caveat: 'Two borrower sectors only (households / NFCs); outstanding stocks are NSA; growth rates are the ECB\'s adjusted (flows-based) measures.',
  },
}

// Country-specific caveat overrides (appended to — not replacing — the shared caveat).
const OVERRIDES: Partial<Record<`${Eu3Country}:${string}`, string>> = {
  'FR:vacancies': 'France: series starts 2011-Q2 and carries a definition-differs flag on every observation (coverage: establishments with 10+ employees).',
  'IT:vacancies': 'Italy: rate only — no vacancy levels are published; series starts 2016.',
  'DE:vacancies': 'Germany: cleanest of the three — levels also published, history from 2006.',
  'FR:employment_proxy': 'France: seasonally adjusted only (no calendar adjustment) where Germany/Italy are SCA.',
  'DE:permits_index': 'Germany: 24 observations are Eurostat estimates (e-flag) — marked on the chart.',
  'DE:fiscal_quarterly': 'Germany: quarterly accounts are provisional (p-flag) for recent years.',
  'IT:fiscal_quarterly': 'Italy: NSA only — no seasonally adjusted variant exists; the trailing-4Q view is the primary read.',
}

/** Resolve a caveat for a country — shared text + any country override, tagged. */
export function eu3Caveat(key: keyof typeof SHARED, cc: Eu3Country): ProxyCaveat {
  const base = SHARED[key]
  const extra = OVERRIDES[`${cc}:${String(key)}`]
  return {
    ...base,
    caveat: extra ? `${base.caveat} ${extra}` : base.caveat,
    localTag: cc,
  }
}
