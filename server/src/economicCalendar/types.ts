// Shared types for the Economic Data Log pipeline (scrape → parse → persist →
// classify). One canonical release row, the surprise scale, and the rule shape.

// Watchlist countries, normalized. The parser maps Trading Economics' country
// labels (e.g. "US", "UK", "EA") onto these exact strings — see countries.ts.
export const WATCHLIST_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Eurozone',
  'Germany',
  'France',
  'Japan',
  'China',
  'Australia',
  'Canada',
] as const

export type WatchlistCountry = typeof WATCHLIST_COUNTRIES[number]

// One row per release, matching the persisted economic_releases schema.
// `event` is the *base* event name (with any trailing reference-period suffix
// stripped — see referencePeriod.ts), so the identity stays stable as TE
// appends "APR" / "MAY/23" / "Q1" / etc. The full display name is reconstructed
// as `event + (reference_period ? ' ' + reference_period : '')`.
export interface EconomicRelease {
  release_date: string          // ISO date, YYYY-MM-DD
  day_of_week: string           // e.g. "Monday"
  country: WatchlistCountry
  event: string                 // base event name (no reference-period suffix)
  reference_period: string | null  // e.g. "APR", "MAY/23", "Q1 2026", or null
  expected: string | null       // raw TE string, e.g. "0.2mom, 2.8yoy"
  actual: string | null
  previous: string | null
  importance: number            // 1 (low) – 3 (high)
  scraped_at: string            // ISO timestamp
}

// Event categories (single level, one per event). `Other` is the fallback for
// events no pattern matches — logged so categorize.ts can be extended.
export const CATEGORIES = [
  'Labor', 'Growth', 'Inflation', 'CB Speeches', 'Housing',
  'Production', 'Trade', 'Consumption', 'Surveys', 'Other',
] as const

export type Category = typeof CATEGORIES[number]

// A categorized release: the parsed fields plus the ingestion-time category.
export interface CategorizedRelease extends EconomicRelease {
  category: Category
}

// A persisted release row: scraped fields + category + the classifier's verdict.
// `surprise` is null when a rule exists but the print isn't out yet.
export interface StoredEconomicRelease extends EconomicRelease {
  category: Category
  surprise: SurpriseLabel | null
}

// Surprise classification labels. `unclassified` = no rule matched the event;
// `null` (not in this union) = a rule exists but actual/expected isn't parseable
// yet (e.g. release not yet out) — stored as NULL, distinct from unclassified.
export type SurpriseLabel = 'cold' | 'cool' | 'in line' | 'warm' | 'hot' | 'unclassified'

// Direction-adjusted surprise rule. `direction: -1` inverts indicators where a
// lower-than-expected print is the "hot" outcome (unemployment, jobless claims).
export interface SurpriseRule {
  in_line_threshold: number
  warm_threshold: number
  hot_threshold: number
  direction: 1 | -1
  unit: 'absolute' | 'percent' | 'thousands'
}
