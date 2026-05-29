// Country normalization for the Economic Data Log. Trading Economics labels
// countries inconsistently across its calendar markup ("US", "United States",
// "EA", "Euro Area", etc.). The Claude parse step is told to emit the canonical
// watchlist string directly, but this map is the deterministic safety net: it
// re-normalizes whatever comes back and lets us drop off-watchlist rows.

import { WATCHLIST_COUNTRIES, type WatchlistCountry } from './types'

// Alias → canonical. Keys are matched case-insensitively after trimming.
const ALIASES: Record<string, WatchlistCountry> = {
  'us': 'United States',
  'usa': 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'united states': 'United States',
  'united states of america': 'United States',
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'ea': 'Eurozone',
  'ez': 'Eurozone',
  'euro area': 'Eurozone',
  'euro zone': 'Eurozone',
  'eurozone': 'Eurozone',
  'european union': 'Eurozone',
  'eu': 'Eurozone',
  'de': 'Germany',
  'ger': 'Germany',
  'germany': 'Germany',
  'fr': 'France',
  'france': 'France',
  'jp': 'Japan',
  'jpn': 'Japan',
  'japan': 'Japan',
  'cn': 'China',
  'chn': 'China',
  'china': 'China',
  'au': 'Australia',
  'aus': 'Australia',
  'australia': 'Australia',
  'ca': 'Canada',
  'can': 'Canada',
  'canada': 'Canada',
}

// The watchlist the scraper requests by default and the parser normalizes onto.
export const DEFAULT_WATCHLIST: WatchlistCountry[] = [...WATCHLIST_COUNTRIES]

// Returns the canonical watchlist country for a raw TE label, or null if the
// label isn't on our watchlist (caller drops the row).
export function normalizeCountry(raw: string | null | undefined): WatchlistCountry | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (key in ALIASES) return ALIASES[key]
  // Exact canonical match (already normalized) as a final check.
  const exact = WATCHLIST_COUNTRIES.find(c => c.toLowerCase() === key)
  return exact ?? null
}
