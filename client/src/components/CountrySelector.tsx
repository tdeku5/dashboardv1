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
}

export function CountrySelector({ value, onChange }: Props) {
  return <AssetSubRibbon items={COUNTRIES} value={value} onChange={onChange} />
}
