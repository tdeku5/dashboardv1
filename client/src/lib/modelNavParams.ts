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
