// ── STIR Market Registry ─────────────────────────────────────────────────────
// Single source of truth for all short-term interest rate futures markets.

export type MarketKey = 'FF' | 'SR3' | 'SO3' | 'EUR' | 'CRA' | 'TOA3' | 'AUS'
export type CountryCode = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS'
export type CentralBank = 'FED' | 'BOE' | 'ECB' | 'BOC' | 'BOJ' | 'RBA'

export interface StirMarket {
  marketKey: MarketKey
  country: CountryCode
  displayName: string
  rateLabel: string          // e.g. "CURRENT EFFR", "CURRENT BANK RATE"
  tickerPrefix: string
  cadence: 'monthly' | 'quarterly'
  yearDigits: 1 | 2
  anchorSource: { type: 'fred'; seriesId: string } | { type: 'static'; value: number }
  centralBank: CentralBank
}

export const STIR_MARKETS: StirMarket[] = [
  {
    marketKey: 'FF',
    country: 'US',
    displayName: 'Fed Funds',
    rateLabel: 'CURRENT EFFR',
    tickerPrefix: 'FF',
    cadence: 'monthly',
    yearDigits: 2,
    anchorSource: { type: 'fred', seriesId: 'DFF' },
    centralBank: 'FED',
  },
  {
    marketKey: 'SR3',
    country: 'US',
    displayName: '3M SOFR',
    rateLabel: 'CURRENT EFFR',
    tickerPrefix: 'SR3',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'fred', seriesId: 'DFF' },
    centralBank: 'FED',
  },
  {
    marketKey: 'SO3',
    country: 'UK',
    displayName: '3M SONIA',
    rateLabel: 'CURRENT SONIA',
    tickerPrefix: 'SO3',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 3.73 },
    centralBank: 'BOE',
  },
  {
    marketKey: 'EUR',
    country: 'EU',
    displayName: '3M EURIBOR',
    rateLabel: 'CURRENT EURIBOR',
    tickerPrefix: 'EUR',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 2.15 },
    centralBank: 'ECB',
  },
  {
    marketKey: 'CRA',
    country: 'CAD',
    displayName: '3M CORRA',
    rateLabel: 'CURRENT CORRA',
    tickerPrefix: 'CRA',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 2.30 },
    centralBank: 'BOC',
  },
  {
    marketKey: 'TOA3',
    country: 'JPY',
    displayName: '3M TONA',
    rateLabel: 'CURRENT TONA',
    tickerPrefix: 'TOA3',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 0.727 },
    centralBank: 'BOJ',
  },
  {
    marketKey: 'AUS',
    country: 'AUS',
    displayName: '90D Bank Bill',
    rateLabel: 'CURRENT IOCR',
    tickerPrefix: 'AUS',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 4.10 },
    centralBank: 'RBA',
  },
]

const marketMap = new Map(STIR_MARKETS.map(m => [m.marketKey, m]))

// Also support legacy root symbols: ZQ → FF
const aliasMap = new Map<string, MarketKey>([['ZQ', 'FF']])

export function getMarket(key: string): StirMarket | undefined {
  const upper = key.toUpperCase() as MarketKey
  const resolved = aliasMap.get(upper) ?? upper
  return marketMap.get(resolved as MarketKey)
}

export function getMarketsByCountry(country: string): StirMarket[] {
  return STIR_MARKETS.filter(m => m.country === country.toUpperCase())
}

export function resolveMarketKey(key: string): MarketKey | undefined {
  const upper = key.toUpperCase()
  const resolved = aliasMap.get(upper) ?? upper
  return marketMap.has(resolved as MarketKey) ? (resolved as MarketKey) : undefined
}
