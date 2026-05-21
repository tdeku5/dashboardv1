// ── STIR Market Registry ─────────────────────────────────────────────────────
// Single source of truth for all short-term interest rate futures markets.

export type MarketKey = 'FF' | 'SR3' | 'SO3' | 'EUR' | 'CRA' | 'TOA3' | 'AUS'
export type CountryCode = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS'
export type CentralBank = 'FED' | 'BOE' | 'ECB' | 'BOC' | 'BOJ' | 'RBA'

export interface StirMarket {
  marketKey: MarketKey
  country: CountryCode
  displayName: string
  shortName: string          // e.g. "SOFR", "SONIA", "EURIBOR" — for compact column headers
  rateLabel: string          // e.g. "CURRENT EFFR", "CURRENT BANK RATE"
  tickerPrefix: string
  cadence: 'monthly' | 'quarterly'
  yearDigits: 1 | 2
  anchorSource: { type: 'fred'; seriesId: string } | { type: 'static'; value: number }
  centralBank: CentralBank
  // Proxy-to-policy spread for surfacing the policy-rate range labels.
  //   'zero': anchor IS the policy rate (or close enough — Fed Funds case
  //           where EFFR floats within the target band and the floor-bucket
  //           label IS the band itself).
  //   'static': constant spread in BPS (added to proxy bucket centers).
  //           Used for non-USD until proxy rates (ESTR / SONIA / TONA / etc.)
  //           are ingested into tv_series.
  //   'live':  TODO — compute spread = policy_rate − proxy_rate live from
  //           series_observations + tv_series at request time.
  proxyToPolicySpreadSource:
    | { type: 'zero' }
    | { type: 'static'; bps: number }
    // Computed live: spread = floor(EFFR, 25bp) − latest SOFR (= policy − proxy).
    // Used by SR3 to translate implied O/N SOFR into implied policy lower bound
    // so the probability matrix aligns with the Fed Funds matrix.
    | { type: 'live-sofr-policy' }
  // How the proxy-to-policy spread is applied to bucket labels and the tree:
  //   'shift-label' (default): tree operates on proxy buckets; labels add the
  //     spread when formatted. Implied Rate column shows proxy levels. This is
  //     the current ECB/SONIA/CORRA/TONA/AUS behavior — preserved here.
  //   'shift-tree': tree's starting rate is shifted by the spread so buckets
  //     land on the policy grid directly; labels use zero offset. The response's
  //     per-meeting effrStart/effrEnd are returned in POLICY units, and the
  //     Summary table's Implied Rate column reads as policy lower bound. Used
  //     by SR3 to align with Fed Funds.
  policyAlignment?: 'shift-label' | 'shift-tree'
}

export const STIR_MARKETS: StirMarket[] = [
  {
    marketKey: 'FF',
    country: 'US',
    displayName: 'Fed Funds',
    shortName: 'Fed Funds',
    rateLabel: 'CURRENT EFFR',
    tickerPrefix: 'FF',
    cadence: 'monthly',
    yearDigits: 2,
    anchorSource: { type: 'fred', seriesId: 'DFF' },
    centralBank: 'FED',
    proxyToPolicySpreadSource: { type: 'zero' },
  },
  {
    marketKey: 'SR3',
    country: 'US',
    displayName: '3M SOFR',
    shortName: 'SOFR',
    rateLabel: 'CURRENT SOFR',
    tickerPrefix: 'SR3',
    cadence: 'quarterly',
    yearDigits: 1,
    // Anchor the SR3 tree on O/N SOFR (the rate SR3 contracts actually settle
    // on) rather than EFFR. With anchor=EFFR the first meeting's delta was a
    // hybrid EFFR→SOFR jump that misaligned the matrix vs. Fed Funds.
    anchorSource: { type: 'fred', seriesId: 'SOFR' },
    centralBank: 'FED',
    // SOFR sits a few bp above the Fed's policy lower bound; compute the spread
    // live from current SOFR vs floor(EFFR, 25bp) so the matrix buckets in
    // policy ranges (3.50-3.75, etc.) rather than SOFR levels.
    proxyToPolicySpreadSource: { type: 'live-sofr-policy' },
    policyAlignment: 'shift-tree',
  },
  {
    marketKey: 'SO3',
    country: 'UK',
    displayName: '3M SONIA',
    shortName: 'SONIA',
    rateLabel: 'CURRENT SONIA',
    tickerPrefix: 'SO3',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 3.73 },
    centralBank: 'BOE',
    // BoE Bank Rate − SONIA: typically +3 to +7 bp. Static until SONIA is
    // ingested into tv_series; flip to live when available.
    proxyToPolicySpreadSource: { type: 'static', bps: 5 },
  },
  {
    marketKey: 'EUR',
    country: 'EU',
    displayName: '3M EURIBOR',
    shortName: 'EURIBOR',
    rateLabel: 'CURRENT EURIBOR',
    tickerPrefix: 'EUR',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 2.15 },
    centralBank: 'ECB',
    // ECB DFR − ESTR: typically +8 to +15 bp. Static until ESTR is ingested.
    proxyToPolicySpreadSource: { type: 'static', bps: 10 },
  },
  {
    marketKey: 'CRA',
    country: 'CAD',
    displayName: '3M CORRA',
    shortName: 'CORRA',
    rateLabel: 'CURRENT CORRA',
    tickerPrefix: 'CRA',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 2.30 },
    centralBank: 'BOC',
    // BoC Overnight Target − CORRA: typically very tight, near zero.
    proxyToPolicySpreadSource: { type: 'static', bps: 2 },
  },
  {
    marketKey: 'TOA3',
    country: 'JPY',
    displayName: '3M TONA',
    shortName: 'TONA',
    rateLabel: 'CURRENT TONA',
    tickerPrefix: 'TOA3',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 0.727 },
    centralBank: 'BOJ',
    // BoJ policy − TONA: typically very tight, near zero.
    proxyToPolicySpreadSource: { type: 'static', bps: 0 },
  },
  {
    marketKey: 'AUS',
    country: 'AUS',
    displayName: '90D Bank Bill',
    shortName: 'AU Bills',
    rateLabel: 'CURRENT IOCR',
    tickerPrefix: 'AUS',
    cadence: 'quarterly',
    yearDigits: 1,
    anchorSource: { type: 'static', value: 4.10 },
    centralBank: 'RBA',
    // RBA Cash Rate Target − interbank cash rate: typically very tight.
    proxyToPolicySpreadSource: { type: 'static', bps: 0 },
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
