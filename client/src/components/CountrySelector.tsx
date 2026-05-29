import { AssetSubRibbon } from './AssetSubRibbon'

export type CountryCode = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS' | 'Global'

const COUNTRIES: ReadonlyArray<{ key: CountryCode; label: string }> = [
  { key: 'US', label: 'US' },
  { key: 'UK', label: 'UK' },
  { key: 'EU', label: 'EU' },
  { key: 'CAD', label: 'CAD' },
  { key: 'JPY', label: 'JPY' },
  { key: 'AUS', label: 'AUS' },
  { key: 'Global', label: 'GLOBAL' },
]

interface Props {
  value: CountryCode
  onChange: (country: CountryCode) => void
  // Optional whitelist of countries to hide from the strip. The FX asset class
  // uses this to drop 'Global' (after the Pair Returns dashboards moved to US).
  // Other asset classes that still want the Global tab pass nothing.
  exclude?: CountryCode[]
}

export function CountrySelector({ value, onChange, exclude }: Props) {
  const items = exclude && exclude.length > 0
    ? COUNTRIES.filter(c => !exclude.includes(c.key))
    : COUNTRIES
  return <AssetSubRibbon items={items} value={value} onChange={onChange} />
}
