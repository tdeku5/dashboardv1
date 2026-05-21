export interface Sector {
  ticker: string
  name: string
}

// Display order is intentional — matches the backend SECTORS constant in
// server/src/sectorAttribution.ts. Do not sort.
export const SECTORS: ReadonlyArray<Sector> = [
  { ticker: 'XLK',  name: 'Technology' },
  { ticker: 'XLE',  name: 'Energy' },
  { ticker: 'XLV',  name: 'Health Care' },
  { ticker: 'XLF',  name: 'Financials' },
  { ticker: 'XLY',  name: 'Consumer Discretionary' },
  { ticker: 'XLP',  name: 'Consumer Staples' },
  { ticker: 'XLI',  name: 'Industrials' },
  { ticker: 'XLC',  name: 'Communication Services' },
  { ticker: 'XLB',  name: 'Materials' },
  { ticker: 'XLU',  name: 'Utilities' },
  { ticker: 'XLRE', name: 'Real Estate' },
]
