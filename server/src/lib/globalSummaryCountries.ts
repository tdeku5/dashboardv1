// Single source of truth for the Global Rates Summary's rows and their order.
//
// Lives apart from routes/global.ts so the list can be asserted in tests
// without pulling express and the DB in, and so a future consumer reads the
// same definition rather than copying it.
//
// DE / FR / IT replace the retired single EU row. Each carries its own
// sovereign curve (Bund / OAT / BTP, symbols confirmed present and current in
// Phase 0) but they share one ECB policy path, so all three point at the same
// EUR strip — the route derives each distinct strip once per request rather
// than once per row.
//
// The retired EU row already used the DE prefix, so Germany inherits its yield
// and regime values unchanged; France and Italy are the genuinely new data.

export type SummaryCountryCode = 'US' | 'UK' | 'DE' | 'FR' | 'IT' | 'CA' | 'JP' | 'AU'

export interface SummaryCountry {
  country: SummaryCountryCode
  /** tv_series prefix for the country's sovereign curve, e.g. 'DE' → DE02Y. */
  yieldPrefix: string
  /** STIR market key in stirRegistry — the policy-path source. */
  stirMarketKey: string
}

export const SUMMARY_COUNTRIES: readonly SummaryCountry[] = [
  { country: 'US', yieldPrefix: 'US', stirMarketKey: 'SR3' },
  { country: 'UK', yieldPrefix: 'GB', stirMarketKey: 'SO3' },
  { country: 'DE', yieldPrefix: 'DE', stirMarketKey: 'EUR' },
  { country: 'FR', yieldPrefix: 'FR', stirMarketKey: 'EUR' },
  { country: 'IT', yieldPrefix: 'IT', stirMarketKey: 'EUR' },
  { country: 'CA', yieldPrefix: 'CA', stirMarketKey: 'CRA' },
  { country: 'JP', yieldPrefix: 'JP', stirMarketKey: 'TOA3' },
  { country: 'AU', yieldPrefix: 'AU', stirMarketKey: 'AUS' },
] as const

/** Countries sharing the euro-area policy path. */
export const EURO_AREA_COUNTRIES: readonly SummaryCountryCode[] = ['DE', 'FR', 'IT'] as const
