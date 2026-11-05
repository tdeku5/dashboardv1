import { US_INDEX_COLORS as REGISTRY_US_INDEX_COLORS } from './identityColors'

export type { UsIndexKey } from './identityColors'
import type { UsIndexKey } from './identityColors'

export interface UsIndex {
  key: UsIndexKey
  ticker: string
  displayName: string
}

// User-mandated display order — do not sort.
export const US_INDICES: ReadonlyArray<UsIndex> = [
  { key: 'SPX', ticker: 'SPX', displayName: 'S&P 500' },
  { key: 'NDX', ticker: 'NDX', displayName: 'Nasdaq 100' },
  { key: 'DJI', ticker: 'DJI', displayName: 'Dow Jones Industrial' },
  { key: 'RUT', ticker: 'RUT', displayName: 'Russell 2000' },
  { key: 'RSP', ticker: 'RSP', displayName: 'S&P 500 Equal Weight' },
]

export const US_INDEX_KEYS: ReadonlyArray<UsIndexKey> =
  US_INDICES.map((i) => i.key) as ReadonlyArray<UsIndexKey>

// Colours: the identity registry's US_INDEX_COLORS (E1). SPX is the primary
// reference (light), RSP its equal-weight twin (yellow), the other three
// broad indices distinct hues.
export const US_INDEX_COLORS: Record<UsIndexKey, string> = REGISTRY_US_INDEX_COLORS

export const US_INDEX_LABEL: Record<UsIndexKey, string> = {
  SPX: 'SPX',
  NDX: 'NDX',
  DJI: 'DJI',
  RUT: 'RUT',
  RSP: 'RSP',
}
