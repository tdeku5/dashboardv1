export type UsIndexKey = 'SPX' | 'NDX' | 'DJI' | 'RUT' | 'RSP'

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

// Colors — SPX is the primary reference (white/light gray), RSP its equal-weight
// twin (yellow) sits alongside it, and the three other broad indices get distinct hues.
export const US_INDEX_COLORS: Record<UsIndexKey, string> = {
  SPX: '#e2e8f0',
  RSP: '#facc15',
  NDX: '#3b82f6',
  DJI: '#22c55e',
  RUT: '#c084fc',
}

export const US_INDEX_LABEL: Record<UsIndexKey, string> = {
  SPX: 'SPX',
  NDX: 'NDX',
  DJI: 'DJI',
  RUT: 'RUT',
  RSP: 'RSP',
}
