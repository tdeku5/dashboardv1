// URL-param navigation state for the Economic Data Models hubs (2026-07 fix:
// category-tab clicks previously lost the selected country because `country`
// lived in per-page useState). The selected country and sub-tab now live in
// query params on the existing paths — strictly additive, so every pre-fix
// URL (no params) renders US exactly as before.
//
//   ?country=<key>   validated against modelNav COUNTRIES; invalid/missing → 'us'
//   ?tab=<sectionKey> validated by each hub against the active country's
//                     section list; invalid/missing → that list's first/default
//                     section. Written with replace:true so sub-tab clicks
//                     don't spam browser history.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { COUNTRIES } from '../pages/modelNav'

const COUNTRY_KEYS = new Set<string>(COUNTRIES.map(c => c.key))

/** Selected country from ?country=, normalized to 'us' when absent/invalid. */
export function useCountryParam(): [string, (c: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('country')
  const country = raw && COUNTRY_KEYS.has(raw) ? raw : 'us'

  const setCountry = useCallback((c: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (c === 'us') next.delete('country')
      else next.set('country', c)
      // Section lists differ per country — a carried-over tab key would be
      // meaningless (and is normalized away on read anyway).
      next.delete('tab')
      return next
    })
  }, [setSearchParams])

  return [country, setCountry]
}

/**
 * Sub-tab (third bar) from ?tab=, validated against the active section list.
 * US and UK section hooks in one hub share the single `tab` param — only the
 * rendered country branch's setter is ever invoked, and an off-country value
 * simply normalizes to `defaultKey` on read.
 */
export function useTabParam<K extends string>(
  validKeys: readonly K[],
  defaultKey: K,
): [K, (t: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab = raw && (validKeys as readonly string[]).includes(raw) ? raw as K : defaultKey

  // Setter accepts plain string (values normalize against validKeys on read) so
  // one nav component can drive section lists with different key unions.
  const setTab = useCallback((t: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', t)
      return next
    }, { replace: true })
  }, [setSearchParams])

  return [tab, setTab]
}

/** Category-tab target: same path, carrying the current country when non-US. */
export function categoryPath(path: string, country: string): string {
  return country === 'us' ? path : `${path}?country=${encodeURIComponent(country)}`
}

// ── Country→sections map (2026-07, Japan Phase 0) ───────────────────────────
// Extracted per the Canada Phase 3 addendum: hub section wiring had grown into
// 3-way country ternaries. Hubs now declare one country-keyed config and read
// everything from this hook. One shared `tab` param serves all countries (it
// is deleted on country switch and re-validated against the active country's
// section list on read), so a single useTabParam call replaces the previous
// per-country calls with identical rendered behavior.

export interface CountrySections {
  sections: ReadonlyArray<{ key: string; label: string }>
  defaultKey: string
  /** Active-section border color for this country's bar */
  accent: string
}

export function useCountrySections(
  byCountry: Record<string, CountrySections>,
  /** cfg used when the country has no entry (HousingPage shows the US bar for
   *  content-less countries; other hubs hide the bar — pass nothing). */
  fallback?: CountrySections,
): {
  country: string
  setCountry: (c: string) => void
  cfg: CountrySections | undefined
  section: string
  setSection: (t: string) => void
} {
  const [country, setCountry] = useCountryParam()
  const cfg = byCountry[country] ?? fallback
  const [section, setSection] = useTabParam(
    cfg?.sections.map(s => s.key) ?? [],
    cfg?.defaultKey ?? '',
  )
  return { country, setCountry, cfg, section, setSection }
}
