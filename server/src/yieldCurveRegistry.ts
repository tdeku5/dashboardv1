export type YieldCurvePageKey = 'gilt' | 'bund' | 'oat' | 'btp' | 'cad' | 'jgb' | 'agb' | 'egb'

export interface TenorConfig {
  key: string       // tv_series symbol, e.g. 'GB10Y'
  label: string     // display label, e.g. '10Y'
  years: number     // maturity in years for compressed axis
}

export interface YieldCurveCountry {
  country: string
  pageKey: YieldCurvePageKey
  displayName: string
  prefix: string
  tenors: TenorConfig[]
}

function buildTenors(prefix: string, specs: Array<{ suffix: string; label: string; years: number }>): TenorConfig[] {
  return specs.map(s => ({ key: `${prefix}${s.suffix}`, label: s.label, years: s.years }))
}

const FULL_TENORS: Array<{ suffix: string; label: string; years: number }> = [
  { suffix: '01MY', label: '1M', years: 1 / 12 },
  { suffix: '03MY', label: '3M', years: 0.25 },
  { suffix: '01Y', label: '1Y', years: 1 },
  { suffix: '02Y', label: '2Y', years: 2 },
  { suffix: '03Y', label: '3Y', years: 3 },
  { suffix: '05Y', label: '5Y', years: 5 },
  { suffix: '07Y', label: '7Y', years: 7 },
  { suffix: '10Y', label: '10Y', years: 10 },
  { suffix: '20Y', label: '20Y', years: 20 },
  { suffix: '30Y', label: '30Y', years: 30 },
]

export const YIELD_CURVE_COUNTRIES: YieldCurveCountry[] = [
  {
    country: 'UK',
    pageKey: 'gilt',
    displayName: 'UK Gilt Yield Curve',
    prefix: 'GB',
    tenors: buildTenors('GB', FULL_TENORS),
  },
  {
    country: 'DE',
    pageKey: 'bund',
    displayName: 'German Bund Yield Curve',
    prefix: 'DE',
    tenors: buildTenors('DE', FULL_TENORS),
  },
  {
    country: 'FR',
    pageKey: 'oat',
    displayName: 'French OAT Yield Curve',
    prefix: 'FR',
    tenors: buildTenors('FR', FULL_TENORS),
  },
  {
    country: 'IT',
    pageKey: 'btp',
    displayName: 'Italian BTP Yield Curve',
    prefix: 'IT',
    tenors: buildTenors('IT', FULL_TENORS),
  },
  {
    country: 'CA',
    pageKey: 'cad',
    displayName: 'Canadian Yield Curve',
    prefix: 'CA',
    tenors: buildTenors('CA', FULL_TENORS),
  },
  {
    country: 'JP',
    pageKey: 'jgb',
    displayName: 'JGB Yield Curve',
    prefix: 'JP',
    tenors: buildTenors('JP', [
      { suffix: '03MY', label: '3M', years: 0.25 },
      { suffix: '01Y', label: '1Y', years: 1 },
      { suffix: '02Y', label: '2Y', years: 2 },
      { suffix: '03Y', label: '3Y', years: 3 },
      { suffix: '05Y', label: '5Y', years: 5 },
      { suffix: '07Y', label: '7Y', years: 7 },
      { suffix: '10Y', label: '10Y', years: 10 },
      { suffix: '20Y', label: '20Y', years: 20 },
      { suffix: '30Y', label: '30Y', years: 30 },
      { suffix: '40Y', label: '40Y', years: 40 },
    ]),
  },
  {
    country: 'AU',
    pageKey: 'agb',
    displayName: 'AGB Yield Curve',
    prefix: 'AU',
    tenors: buildTenors('AU', [
      { suffix: '01Y', label: '1Y', years: 1 },
      { suffix: '02Y', label: '2Y', years: 2 },
      { suffix: '03Y', label: '3Y', years: 3 },
      { suffix: '05Y', label: '5Y', years: 5 },
      { suffix: '07Y', label: '7Y', years: 7 },
      { suffix: '10Y', label: '10Y', years: 10 },
      { suffix: '20Y', label: '20Y', years: 20 },
      { suffix: '30Y', label: '30Y', years: 30 },
    ]),
  },
  // EU aggregate European Government Bond (EGB) curve — composite synthetic
  // tenors ingested from TradingView under the EU prefix. Used by the EU
  // POLICY RATE tab (the existing EU rates section keeps its country-specific
  // BUND / OAT / BTP tabs separately).
  {
    country: 'EU',
    pageKey: 'egb',
    displayName: 'EGB Yield Curve',
    prefix: 'EU',
    tenors: buildTenors('EU', FULL_TENORS),
  },
]

const pageKeyMap = new Map(YIELD_CURVE_COUNTRIES.map(c => [c.pageKey, c]))

export function getYieldCurveCountry(pageKey: string): YieldCurveCountry | undefined {
  return pageKeyMap.get(pageKey as YieldCurvePageKey)
}
