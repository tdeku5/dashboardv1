// Explicit mapping lists for the series catalog (AI Chart Agent, Phase 0/B).
// EVERY entry here is traceable to an existing registry/config file or to
// gate-approved product knowledge — nothing fuzzy-matched, nothing guessed
// from ticker strings. Symbols NOT listed here are cataloged as unresolved
// (NULL description) per the Phase A gate: they are worked through manually
// in a follow-up session. To resolve one, append an entry (alphabetized
// within its group) with its `src` attribution.

export interface TvMapEntry {
  description: string
  category: string
  country: string
  units: string
  /** registry/config file (or approval note) this entry is traceable to */
  src: string
}

// ── TV continuous symbols ─────────────────────────────────────────────────────
// Grouped builders emit one explicit entry per symbol; only symbols verified
// present in tv_series (Phase A inventory) are listed.

const e = (description: string, category: string, country: string, units: string, src: string): TvMapEntry =>
  ({ description, category, country, units, src })

// Government bond yield curves — tenor lists exactly as present in tv_series.
// Source: curve/term-structure pages (CountryTermStructure.tsx,
// GlobalPolicyTermStructureSection.tsx, Global2s10sRegimeSection.tsx).
const YIELD_CURVES: ReadonlyArray<[cc: string, country: string, name: string, tenors: string[]]> = [
  ['AU', 'AU', 'Australia', ['01Y', '02Y', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['CA', 'CA', 'Canada', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['DE', 'DE', 'Germany', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['EU', 'EU', 'Euro area', ['02Y', '05Y', '10Y', '30Y']],
  ['FR', 'FR', 'France', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['GB', 'UK', 'United Kingdom', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['IT', 'IT', 'Italy', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
  ['JP', 'JP', 'Japan', ['01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y', '40Y']],
  ['US', 'US', 'United States', ['01MY', '01Y', '02Y', '03MY', '03Y', '05Y', '07Y', '10Y', '20Y', '30Y']],
]

function tenorLabel(t: string): string {
  return t.endsWith('MY') ? `${parseInt(t, 10)}-month` : `${parseInt(t, 10)}-year`
}

// FX pairs exactly as present in tv_series. Source: fxPairReturns.ts (EM
// groups), EuFxPage.tsx / DxyForeignYieldsChart.tsx / FX country pages (DM).
const FX_PAIRS = [
  'AUDCHF', 'AUDCNH', 'AUDGBP', 'AUDJPY', 'AUDUSD',
  'CADAUD', 'CADCHF', 'CADCNH', 'CADEUR', 'CADGBP', 'CADJPY', 'CHFGBP', 'CNHJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURCNH', 'EURGBP', 'EURHUF', 'EURJPY', 'EURPLN', 'EURUSD',
  'GBPCNH', 'GBPUSD', 'JPYCHF', 'JPYGBP', 'NZDUSD',
  'USDBRL', 'USDCAD', 'USDCHF', 'USDCLP', 'USDCNH', 'USDCOP', 'USDHUF', 'USDIDR', 'USDINR',
  'USDJPY', 'USDKRW', 'USDMXN', 'USDMYR', 'USDNOK', 'USDPHP', 'USDPLN', 'USDRUB', 'USDSEK',
  'USDSGD', 'USDTHB', 'USDTRY', 'USDTWD', 'USDZAR',
] as const

const CCY_NAME: Record<string, string> = {
  AUD: 'Australian dollar', BRL: 'Brazilian real', CAD: 'Canadian dollar', CHF: 'Swiss franc',
  CLP: 'Chilean peso', CNH: 'offshore Chinese yuan', COP: 'Colombian peso', EUR: 'euro',
  GBP: 'pound sterling', HUF: 'Hungarian forint', IDR: 'Indonesian rupiah', INR: 'Indian rupee',
  JPY: 'Japanese yen', KRW: 'Korean won', MXN: 'Mexican peso', MYR: 'Malaysian ringgit',
  NOK: 'Norwegian krone', NZD: 'New Zealand dollar', PHP: 'Philippine peso', PLN: 'Polish zloty',
  RUB: 'Russian rouble', SEK: 'Swedish krona', SGD: 'Singapore dollar', THB: 'Thai baht',
  TRY: 'Turkish lira', TWD: 'Taiwan dollar', USD: 'US dollar', ZAR: 'South African rand',
}

// Equity indices — names verbatim from countryReturns.ts / usIndices.ts.
const EQUITY_INDICES: ReadonlyArray<[sym: string, name: string, country: string, src: string]> = [
  ['ASX', 'Australia S&P/ASX index', 'AU', 'server/src/countryReturns.ts'],
  ['CAC40', 'France CAC 40 index', 'FR', 'server/src/countryReturns.ts'],
  ['DAX', 'Germany DAX index', 'DE', 'server/src/countryReturns.ts'],
  ['DJI', 'Dow Jones Industrial Average', 'US', 'client/src/constants/usIndices.ts'],
  ['FTMIB', 'Italy FTSE MIB index', 'IT', 'server/src/countryReturns.ts'],
  ['FTSE100', 'United Kingdom FTSE 100 index', 'UK', 'server/src/countryReturns.ts'],
  ['HSI', 'Hong Kong Hang Seng index', 'HK', 'server/src/countryReturns.ts'],
  ['NDX', 'Nasdaq 100', 'US', 'client/src/constants/usIndices.ts'],
  ['NKY', 'Japan Nikkei 225 index', 'JP', 'server/src/countryReturns.ts'],
  ['NZX50', 'New Zealand NZX 50 index', 'NZ', 'server/src/countryReturns.ts'],
  ['RSP', 'S&P 500 equal-weight (RSP)', 'US', 'client/src/constants/usIndices.ts'],
  ['RUT', 'Russell 2000', 'US', 'client/src/constants/usIndices.ts'],
  ['SPX', 'S&P 500', 'US', 'client/src/constants/usIndices.ts'],
  ['SPY', 'SPDR S&P 500 ETF (SPY)', 'US', 'server/src/sectorAttribution.ts'],
  ['TSX:TSX', 'Canada S&P/TSX Composite index', 'CA', 'server/src/countryReturns.ts'],
]

// S&P sector ETFs — names verbatim from sectorAttribution.ts.
const SECTOR_ETFS: ReadonlyArray<[sym: string, name: string]> = [
  ['XLB', 'Materials'], ['XLC', 'Communication Services'], ['XLE', 'Energy'],
  ['XLF', 'Financials'], ['XLI', 'Industrials'], ['XLK', 'Technology'],
  ['XLP', 'Consumer Staples'], ['XLRE', 'Real Estate'], ['XLU', 'Utilities'],
  ['XLV', 'Health Care'], ['XLY', 'Consumer Discretionary'],
]

// Commodities (continuous) — names verbatim from metalsData.ts.
const COMMODITIES: ReadonlyArray<[sym: string, name: string]> = [
  ['BRN', 'Brent Crude'], ['CL', 'Crude Oil (WTI)'], ['GC', 'Gold'], ['GOLD', 'Gold (spot)'],
  ['HG', 'Copper'], ['NG', 'Natural Gas'], ['PA', 'Palladium'], ['PL', 'Platinum'],
  ['RBOB', 'RBOB Gasoline'], ['SI', 'Silver'], ['SILVER', 'Silver (spot)'], ['UHO', 'Heating Oil'],
]

// Vol / dispersion / correlation — labels from VolPage.tsx + crossAssetVol.ts
// (GVOL carries Cboe GVZ, OVOL carries Cboe OVX per the crossAssetVol comment).
const VOL_SYMBOLS: ReadonlyArray<[sym: string, desc: string, src: string]> = [
  ['BVOL', 'Bond-market volatility index (cross-asset vol panel, BVOL)', 'server/src/crossAssetVol.ts'],
  ['COR1M', 'Cboe 1-month implied correlation index', 'client/src/pages/VolPage.tsx'],
  ['COR3M', 'Cboe 3-month implied correlation index', 'client/src/pages/VolPage.tsx'],
  ['DSPX', 'Cboe S&P 500 Dispersion Index', 'client/src/pages/VolPage.tsx'],
  ['GVOL', 'Gold volatility index (Cboe GVZ)', 'server/src/crossAssetVol.ts'],
  ['MOVE', 'ICE BofA MOVE Treasury volatility index', 'server/src/crossAssetVol.ts'],
  ['OVOL', 'Crude oil volatility index (Cboe OVX)', 'server/src/crossAssetVol.ts'],
  ['VIX', 'Cboe VIX index (30-day S&P 500 implied vol)', 'server/src/vixCurve.ts'],
  ['VIX3M', 'Cboe VIX3M index (3-month S&P 500 implied vol)', 'server/src/vixCurve.ts'],
  ['VX1', 'VIX futures — continuous front month', 'server/src/vixCurve.ts'],
  ['VX2', 'VIX futures — continuous second month', 'server/src/vixCurve.ts'],
]

// ── Manual mapping session, 2026-07-09 (user-confirmed; resolves the 84
//    gate-frozen symbols). Category vocabulary extended with 'crypto'
//    (BTC/ETH/SOL); listed crypto-exposure securities are 'equities'.
//    Known duplicates cataloged as-is per instruction (T5YIFR≡5y5y,
//    GN02Y/GN10Y/GN30Y≡CN02Y/CN10Y/CN30Y) — nothing removed from tv_series.
const MANUAL_SRC = 'manual mapping session 2026-07-09 (user-confirmed)'

const MANUAL_BREAKEVENS: ReadonlyArray<[sym: string, desc: string]> = [
  ['10YBE', 'US 10-Year Breakeven Inflation Rate'],
  ['30YBE', 'US 30-Year Breakeven Inflation Rate'],
  ['5YBE', 'US 5-Year Breakeven Inflation Rate'],
  ['5y5y', 'US 5-Year, 5-Year Forward Inflation Expectation Rate'],
  ['7YBE', 'US 7-Year Breakeven Inflation Rate'],
  ['T5YIFR', 'US 5-Year, 5-Year Forward Inflation Expectation Rate (duplicate of 5y5y)'],
]

const MANUAL_YIELDS: ReadonlyArray<[sym: string, desc: string, country: string]> = [
  ['CN01Y', 'China 1-Year Government Bond Yield', 'CN'],
  ['CN02Y', 'China 2-Year Government Bond Yield', 'CN'],
  ['CN03Y', 'China 3-Year Government Bond Yield', 'CN'],
  ['CN05Y', 'China 5-Year Government Bond Yield', 'CN'],
  ['CN07Y', 'China 7-Year Government Bond Yield', 'CN'],
  ['CN10Y', 'China 10-Year Government Bond Yield', 'CN'],
  ['CN20Y', 'China 20-Year Government Bond Yield', 'CN'],
  ['CN30Y', 'China 30-Year Government Bond Yield', 'CN'],
  ['EU01MY', 'Euro Area 1-Month Government Bond Yield', 'EU'],
  ['EU01Y', 'Euro Area 1-Year Government Bond Yield', 'EU'],
  ['EU03MY', 'Euro Area 3-Month Government Bond Yield', 'EU'],
  ['EU03Y', 'Euro Area 3-Year Government Bond Yield', 'EU'],
  ['EU07Y', 'Euro Area 7-Year Government Bond Yield', 'EU'],
  ['EU20Y', 'Euro Area 20-Year Government Bond Yield', 'EU'],
  ['GN02Y', 'China 2-Year Government Bond Yield (duplicate of CN02Y)', 'CN'],
  ['GN10Y', 'China 10-Year Government Bond Yield (duplicate of CN10Y)', 'CN'],
  ['GN30Y', 'China 30-Year Government Bond Yield (duplicate of CN30Y)', 'CN'],
  ['NZ02Y', 'New Zealand 2-Year Government Bond Yield', 'NZ'],
  ['NZ10Y', 'New Zealand 10-Year Government Bond Yield', 'NZ'],
  ['SE02Y', 'Sweden 2-Year Government Bond Yield', 'SE'],
  ['SE10Y', 'Sweden 10-Year Government Bond Yield', 'SE'],
]

const MANUAL_UST_FUTURES: ReadonlyArray<[sym: string, desc: string]> = [
  ['TN', 'Ultra 10-Year US Treasury Note Futures (continuous)'],
  ['UB', 'Ultra US Treasury Bond Futures (continuous)'],
  ['ZB', '30-Year US Treasury Bond Futures (continuous)'],
  ['ZF', '5-Year US Treasury Note Futures (continuous)'],
  ['ZN', '10-Year US Treasury Note Futures (continuous)'],
  ['ZT', '2-Year US Treasury Note Futures (continuous)'],
]

const MANUAL_EQUITY_INDICES: ReadonlyArray<[sym: string, desc: string, country: string]> = [
  ['BIST', 'BIST 100 Index (Turkey)', 'TR'],
  ['COLCAP', 'MSCI COLCAP Index (Colombia)', 'CO'],
  ['ES', 'E-mini S&P 500 Futures (continuous)', 'US'],
  ['IBOV', 'Ibovespa Index (Brazil)', 'BR'],
  ['IDX', 'IDX Composite Index (Indonesia)', 'ID'],
  ['IPC', 'S&P/BMV IPC Index (Mexico)', 'MX'],
  ['NIFTY50', 'NIFTY 50 Index (India)', 'IN'],
  ['OMX30', 'OMX Stockholm 30 Index', 'SE'],
  ['SA40', 'FTSE/JSE Top 40 Index (South Africa)', 'ZA'],
  ['STI', 'Straits Times Index (Singapore)', 'SG'],
]

const MANUAL_COMMODITIES: ReadonlyArray<[sym: string, desc: string, country: string]> = [
  ['ACF', 'Coking Coal Futures (continuous)', 'multi'],
  ['CC', 'Cocoa Futures (ICE, continuous)', 'US'],
  ['COPPER', 'Spot Copper Price (XCU/USD)', 'multi'],
  ['CT', 'Cotton No. 2 Futures (ICE, continuous)', 'US'],
  ['FEF', 'SGX TSI Iron Ore CFR China 62% Fe Futures (continuous)', 'CN'],
  ['GF', 'Feeder Cattle Futures (CME, continuous)', 'US'],
  ['HE', 'Lean Hogs Futures (CME, continuous)', 'US'],
  ['KC', 'Coffee C Futures (ICE, continuous)', 'US'],
  ['LBR', 'Lumber Futures (CME, continuous)', 'US'],
  ['LE', 'Live Cattle Futures (CME, continuous)', 'US'],
  // OIL: TradingView source (TVC:USOIL) extends to 1862; the local tv_series
  // copy starts 1954 per the export window — catalog dates come from local data.
  ['OIL', 'WTI Crude Oil Spot (TVC:USOIL)', 'US'],
  ['REBAR', 'Steel Rebar Futures (SHFE, continuous)', 'CN'],
  ['STEEL', 'Steel Long Futures (continuous)', 'multi'],
  ['SB', 'Sugar No. 11 Futures (ICE, continuous)', 'US'],
  ['ZC', 'Corn Futures (CBOT, continuous)', 'US'],
  ['ZS', 'Soybean Futures (CBOT, continuous)', 'US'],
  ['ZW', 'Chicago SRW Wheat Futures (CBOT, continuous)', 'US'],
]

const MANUAL_BOND_ETFS: ReadonlyArray<[sym: string, desc: string]> = [
  ['HYG', 'iShares iBoxx $ High Yield Corporate Bond ETF'],
  ['IEF', 'iShares 7-10 Year Treasury Bond ETF'],
  ['MBB', 'iShares MBS ETF'],
  ['TIP', 'iShares TIPS Bond ETF'],
  ['TLT', 'iShares 20+ Year Treasury Bond ETF'],
]

const MANUAL_EQUITY_ETFS: ReadonlyArray<[sym: string, desc: string]> = [
  ['GDX', 'VanEck Gold Miners ETF'],
  ['KRE', 'SPDR S&P Regional Banking ETF'],
  ['SMH', 'VanEck Semiconductor ETF'],
  ['XBI', 'SPDR S&P Biotech ETF'],
  ['XHB', 'SPDR S&P Homebuilders ETF'],
  ['XOP', 'SPDR S&P Oil & Gas Exploration & Production ETF'],
]

const MANUAL_COMMODITY_ETFS: ReadonlyArray<[sym: string, desc: string]> = [
  ['DBC', 'Invesco DB Commodity Index Tracking Fund'],
  ['GLD', 'SPDR Gold Shares'],
]

const MANUAL_CRYPTO: ReadonlyArray<[sym: string, desc: string]> = [
  ['BTC', 'Bitcoin / US Dollar'],
  ['ETH', 'Ether / US Dollar'],
  ['SOL', 'Solana / US Dollar'],
]

const MANUAL_CRYPTO_EQUITIES: ReadonlyArray<[sym: string, desc: string]> = [
  ['GBTC', 'Grayscale Bitcoin Trust'],
  ['IBIT', 'iShares Bitcoin Trust ETF'],
  ['MSTR', 'Strategy Inc. (MicroStrategy) Common Stock'],
  ['PURR', 'Hyperliquid Digital Asset Treasury Company (US-listed equity)'],
  ['THYP', 'Hyperliquid ETF'],
]

// FX additions — countries per the confirmed mapping table (unlike the
// generated pairs, which use 'multi'). USDSAR: STALE FEED (last obs
// 2026-05-07) — logged in the resolution summary, cataloged as-is.
const MANUAL_FX: ReadonlyArray<[sym: string, desc: string, country: string]> = [
  ['USDGBP', 'USD/GBP exchange rate (US dollar in pound sterling)', 'UK'],
  ['USDSAR', 'USD/SAR exchange rate (US dollar in Saudi riyal)', 'SA'],
]

export function buildTvContinuousMap(): Record<string, TvMapEntry> {
  const map: Record<string, TvMapEntry> = {}
  for (const [cc, country, name, tenors] of YIELD_CURVES) {
    for (const t of tenors) {
      map[`${cc}${t}`] = e(
        `${name} ${tenorLabel(t)} government ${t.endsWith('MY') ? 'bill/money-market' : 'bond'} yield`,
        'rates', country, '%', 'curve pages (CountryTermStructure/GlobalPolicyTermStructureSection)',
      )
    }
  }
  for (const pair of FX_PAIRS) {
    const b = pair.slice(0, 3)
    const q = pair.slice(3)
    map[pair] = e(
      `${b}/${q} exchange rate (${CCY_NAME[b]} in ${CCY_NAME[q]})`,
      'fx', 'multi', 'price', 'server/src/fxPairReturns.ts / FX pages',
    )
  }
  for (const [sym, name, country, src] of EQUITY_INDICES) map[sym] = e(name, 'equities', country, 'index level', src)
  for (const [sym, name] of SECTOR_ETFS) map[sym] = e(`S&P 500 sector ETF — ${name}`, 'equities', 'US', 'price', 'server/src/sectorAttribution.ts')
  for (const [sym, name] of COMMODITIES) map[sym] = e(`${name} — continuous front-month price`, 'commodities', 'multi', 'price', 'server/src/metalsData.ts')
  for (const [sym, desc, src] of VOL_SYMBOLS) map[sym] = e(desc, 'vol', 'US', 'index level', src)
  // Breadth — universe per BREADTH_INDEX_LABEL in server/src/breadth.ts.
  map['BRDTH20'] = e('S&P 500 breadth — % of members above the 20-day moving average', 'breadth', 'US', '%', 'server/src/breadth.ts')
  map['BRDTH50'] = e('S&P 500 breadth — % of members above the 50-day moving average', 'breadth', 'US', '%', 'server/src/breadth.ts')
  map['BRDTH200'] = e('S&P 500 breadth — % of members above the 200-day moving average', 'breadth', 'US', '%', 'server/src/breadth.ts')
  // Dollar index — DxyForeignYieldsChart.tsx.
  map['DXY'] = e('US dollar index (DXY)', 'fx', 'US', 'index level', 'client/src/components/DxyForeignYieldsChart.tsx')
  // Manual mapping session additions (user-confirmed, 2026-07-09):
  for (const [sym, desc] of MANUAL_BREAKEVENS) map[sym] = e(desc, 'inflation', 'US', '%', MANUAL_SRC)
  for (const [sym, desc, country] of MANUAL_YIELDS) map[sym] = e(desc, 'rates', country, '%', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_UST_FUTURES) map[sym] = e(desc, 'rates', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc, country] of MANUAL_EQUITY_INDICES) map[sym] = e(desc, 'equities', country, 'index level', MANUAL_SRC)
  for (const [sym, desc, country] of MANUAL_COMMODITIES) map[sym] = e(desc, 'commodities', country, 'price', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_BOND_ETFS) map[sym] = e(desc, 'rates', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_EQUITY_ETFS) map[sym] = e(desc, 'equities', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_COMMODITY_ETFS) map[sym] = e(desc, 'commodities', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_CRYPTO) map[sym] = e(desc, 'crypto', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc] of MANUAL_CRYPTO_EQUITIES) map[sym] = e(desc, 'equities', 'US', 'price', MANUAL_SRC)
  for (const [sym, desc, country] of MANUAL_FX) map[sym] = e(desc, 'fx', country, 'price', MANUAL_SRC)
  map['VVIX'] = e('Cboe VVIX Index (volatility of VIX)', 'vol', 'US', 'index level', MANUAL_SRC)
  return map
}

// ── TV dated-contract families (Phase A gate decision 1) ────────────────────
// Roots verified in the Phase A inventory. SR1 approved at the gate as known
// product knowledge.
export const TV_FAMILIES: Record<string, TvMapEntry> = {
  AUS: e('ASX 30-day interbank cash rate futures — dated contracts', 'rates', 'AU', 'price (100 − rate)', 'client/src/pages/GlobalPolicyTermStructureSection.tsx'),
  BRN: e('Brent Crude futures — dated contracts', 'commodities', 'multi', 'price', 'server/src/metalsData.ts (root family)'),
  CL: e('WTI Crude Oil futures — dated contracts', 'commodities', 'US', 'price', 'server/src/metalsData.ts (root family)'),
  CRA: e('3-month CORRA futures — dated contracts', 'rates', 'CA', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  EUR: e('3-month Euribor futures — dated contracts', 'rates', 'EU', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  FF: e('30-day Fed Funds futures — dated contracts', 'rates', 'US', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  GC: e('Gold futures — dated contracts', 'commodities', 'US', 'price', 'client/src/components/MetalBasisChart.tsx'),
  HG: e('Copper futures — dated contracts', 'commodities', 'US', 'price', 'server/src/metalsData.ts (root family)'),
  SI: e('Silver futures — dated contracts', 'commodities', 'US', 'price', 'client/src/components/MetalBasisChart.tsx'),
  SO3: e('3-month SONIA futures — dated contracts', 'rates', 'UK', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  SR1: e('CME 1-Month SOFR futures — dated contracts', 'rates', 'US', 'price (100 − rate)', 'Phase A gate approval (known product knowledge)'),
  SR3: e('CME 3-Month SOFR futures — dated contracts', 'rates', 'US', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  TOA3: e('3-month TONA futures — dated contracts', 'rates', 'JP', 'price (100 − rate)', 'client/src/pages/STIRDashboardPage.tsx'),
  VX: e('Cboe VIX futures — dated monthly contracts', 'vol', 'US', 'price', 'server/src/vixCurve.ts'),
}

// tv_ohlcv's two symbols (TradingView TVC money-market yields, OHLCV bars).
export const TV_OHLCV_MAP: Record<string, TvMapEntry> = {
  'TVC:US01MY': e('United States 1-month Treasury yield (TVC, OHLCV bars)', 'rates', 'US', '%', 'server/src/routes/tv.ts'),
  'TVC:US03MY': e('United States 3-month Treasury yield (TVC, OHLCV bars)', 'rates', 'US', '%', 'server/src/routes/tv.ts'),
}

// ── ECB collector code mirror ────────────────────────────────────────────────
// collectors/ecbCollector.ts does not export its SERIES config; the EU3 suffix
// → label table below is copied verbatim from that file (EU3_HICP_ITEMS) with
// this attribution rather than modifying the ingestion module.
const ECB_HICP_SUFFIX: ReadonlyArray<[suffix: string, label: string]> = [
  ['HICP', 'HICP — all items'],
  ['HICP_XEF', 'HICP — ex energy, food, alcohol & tobacco (core)'],
  ['HICP_XEFUN', 'HICP — ex energy & unprocessed food (ECB core)'],
  ['HICP_CP01', 'HICP 01 Food and non-alcoholic beverages'], ['HICP_CP02', 'HICP 02 Alcohol and tobacco'],
  ['HICP_CP03', 'HICP 03 Clothing and footwear'], ['HICP_CP04', 'HICP 04 Housing, water, electricity, gas'],
  ['HICP_CP05', 'HICP 05 Furnishings and household equipment'], ['HICP_CP06', 'HICP 06 Health'],
  ['HICP_CP07', 'HICP 07 Transport'], ['HICP_CP08', 'HICP 08 Information and communication'],
  ['HICP_CP09', 'HICP 09 Recreation and culture'], ['HICP_CP10', 'HICP 10 Education'],
  ['HICP_CP11', 'HICP 11 Restaurants and accommodation'], ['HICP_CP12', 'HICP 12 Insurance and financial services'],
  ['HICP_ENERGY', 'HICP — energy'], ['HICP_FOOD', 'HICP — food incl. alcohol & tobacco'],
  ['HICP_FOODUN', 'HICP — unprocessed food'], ['HICP_SERVICES', 'HICP — services'],
  ['HICP_GOODS', 'HICP — goods'], ['HICP_NEIG', 'HICP — non-energy industrial goods'],
  ['HICP_DUR', 'HICP — durable goods'], ['HICP_NONDUR', 'HICP — non-durable goods'],
  ['HICP_SEMIDUR', 'HICP — semi-durable goods'],
  ['HICP_D_CEREALS', 'HICP — cereals and cereal products'], ['HICP_D_MEAT', 'HICP — meat'],
  ['HICP_D_FISH', 'HICP — fish and seafood'], ['HICP_D_DAIRY', 'HICP — milk, dairy and eggs'],
  ['HICP_D_FRUIT', 'HICP — fruits and nuts'], ['HICP_D_VEG', 'HICP — vegetables'],
  ['HICP_D_ALCOHOL', 'HICP — alcoholic beverages'], ['HICP_D_CLOTHING', 'HICP — clothing'],
  ['HICP_D_RENTS', 'HICP — actual rentals for housing'], ['HICP_D_MAINT', 'HICP — dwelling maintenance and repair'],
  ['HICP_D_WATER', 'HICP — water supply and misc. dwelling services'], ['HICP_D_ELECTRICITY', 'HICP — electricity'],
  ['HICP_D_GAS', 'HICP — gas'], ['HICP_D_LIQFUEL', 'HICP — liquid fuels'],
  ['HICP_D_FURNITURE', 'HICP — furniture and furnishings'], ['HICP_D_APPLIANCES', 'HICP — household appliances'],
  ['HICP_D_MEDICINES', 'HICP — medicines and health products'], ['HICP_D_CARS', 'HICP — motor cars'],
  ['HICP_D_MOTORFUEL', 'HICP — fuels and lubricants'], ['HICP_D_TRANSPSVC', 'HICP — passenger transport services'],
  ['HICP_D_ICTEQUIP', 'HICP — information & communication equipment'], ['HICP_D_ICTSVC', 'HICP — information & communication services'],
  ['HICP_D_CULTGOODS', 'HICP — cultural goods'], ['HICP_D_CULTSVC', 'HICP — cultural services'],
  ['HICP_D_RESTAURANTS', 'HICP — food and beverage serving services'], ['HICP_D_ACCOMM', 'HICP — accommodation services'],
  ['HICP_D_INSURANCE', 'HICP — insurance'],
]

const EU3_COUNTRY: Record<string, string> = { DE: 'Germany', FR: 'France', IT: 'Italy' }

export function buildEcbMap(): Record<string, { description: string; category: string; country: string; src: string }> {
  const map: Record<string, { description: string; category: string; country: string; src: string }> = {}
  const src = 'server/src/collectors/ecbCollector.ts (mirrored EU3_HICP_ITEMS)'
  // Euro-area rates-model codes (documented in the collector header).
  const ea: ReadonlyArray<[string, string]> = [
    ['HICP_HEADLINE', 'Euro area HICP — overall index (NSA)'],
    ['HICP_CORE', 'Euro area HICP — ex energy & unprocessed food (NSA)'],
    ['HICP_SUPERCORE', 'Euro area HICP — ex energy, food, alcohol & tobacco (NSA)'],
    ['HICP_HEADLINE_SA', 'Euro area HICP — overall index (SA)'],
    ['HICP_CORE_SA', 'Euro area HICP — ex energy & unprocessed food (SA)'],
    ['HICP_SUPERCORE_SA', 'Euro area HICP — ex energy, food, alcohol & tobacco (SA)'],
  ]
  for (const [code, desc] of ea) map[code] = { description: desc, category: 'inflation', country: 'EU', src }
  map['UNRATE_EA'] = { description: 'Euro area unemployment rate (SA)', category: 'labor', country: 'EU', src }
  for (const cc of ['DE', 'FR', 'IT']) {
    const cn = EU3_COUNTRY[cc]
    for (const [suffix, label] of ECB_HICP_SUFFIX) {
      map[`${cc}_${suffix}`] = { description: `${cn} ${label} (2025=100, NSA)`, category: 'inflation', country: cc, src }
    }
    map[`UNRATE_${cc}`] = { description: `${cn} unemployment rate (SA, LFSI)`, category: 'labor', country: cc, src }
    map[`${cc}_LOANS_HH`] = { description: `${cn} MFI loans to households — outstanding (€M)`, category: 'credit', country: cc, src }
    map[`${cc}_LOANS_NFC`] = { description: `${cn} MFI loans to non-financial corporations — outstanding (€M)`, category: 'credit', country: cc, src }
    map[`${cc}_LOANS_HH_YOY`] = { description: `${cn} MFI loans to households — ECB adjusted annual growth (%)`, category: 'credit', country: cc, src }
    map[`${cc}_LOANS_NFC_YOY`] = { description: `${cn} MFI loans to NFCs — ECB adjusted annual growth (%)`, category: 'credit', country: cc, src }
  }
  return map
}

// ── Deterministic category rules ─────────────────────────────────────────────
// Auditable stem/prefix tables — first match wins. These assign the coarse
// category tag only; descriptions always come from real metadata/registries.

export const COLLECTOR_STEM_CATEGORY: ReadonlyArray<[re: RegExp, category: string]> = [
  [/(CPI|HICP|IPPI|PPI|CPIW|HICPW|INFL)/, 'inflation'],
  [/(UNRATE|EMPLOY|EMP_|_EMP|LABOUR|LFS|UR_|PART_RATE|UNDEREMP|UNDERUTIL|WPI|LCI|VAC|JOBVAC|JOBOFFER|NEWOFFERS|EI_BENEF|SEPH|PAYE|CLAIM|HOURS|PRODUCTIVITY|ULC|COMP_HOUR|REGEMP|MFG_EARNINGS|UNEMP)/, 'labor'],
  [/(HOUS|HPI|NHPI|PERMITS|APPROVALS|STARTS|DWELL|MORTGAGE|LEND_|MEAN_PRICE)/, 'housing'],
  [/(FISC|DEBT|GFS|MTS|DTS|TAX|RECEIPTS|PSNB|BORROW)/, 'fiscal'],
  [/(LOANS|CREDIT|HHCRED|M4|DEPOSITS|DSR|NW_TO_DI|DEBT_TO_DI)/, 'credit'],
  [/(IIP|IP_|_IP$|INDPRO|CONSTRUCTION|MFG_SALES|MGDP|GVA)/, 'industrial'],
  [/(GDP|GDI|CONS|GFCF|CAPEX|RETAIL|TRADE|EXPORTS|IMPORTS|HSI|HH_SPEND|SPENDING|SAVING|COE|PROFITS|INVENTORIES|SALES|ESI|CONF|SENTIMENT|INCOME|DISPINC|PCE|RGDP|NGDP|DEFLATOR|CTB_|BUSINV|RESINV|GOV_|PUBINV|INVENT)/, 'growth'],
  [/(TONA|SOFR|SONIA|CORRA|AONIA|ESTR|ECBDFR|CASH_RATE|TARGET|RATE)/, 'rates'],
]

// FRED prefix/exact rules (documented, deterministic). Descriptions come from
// series_metadata titles; these rules assign category only.
export const FRED_CATEGORY_RULES: ReadonlyArray<[re: RegExp, category: string]> = [
  [/^(CPI|CUSR|CUUR|CWUR|CORESTICK|PCETRIM|CP0000)/, 'inflation'],
  [/^(WPS|PPI|PCU)/, 'inflation'],
  [/^(PCEPI|DPCERD|PCEPILFE)/, 'inflation'],
  [/^(MICH)$/, 'inflation'],
  [/^(CES|LNS|PAYEMS|UNRATE|UNEMPLOY|CLF16OV|CE16OV|EMRATIO|CIVPART|JTS|ICSA|ICNSA|CCSA|CCNSA|OPHNFB|ULCNFB|AWHAETP|AHETPI|U[1-6]RATE)/, 'labor'],
  [/^(HOUST|PERMIT|COMPU|UNDCON|HSN1F|MSACSR|HOSSUP|MSPNHSUS|CSUSHPI|USSTHPI|MORTGAGE|RREACB|RHEACB|CRLACB|DRSFRM|TLRESCONS|PRFI|A011R|EXHOSLUSM)/, 'housing'],
  [/^(INDPRO|IPG|IPN|IPB|IPMAN|IPMINE|IPUTIL|CAPUTL)/, 'industrial'],
  [/^(TOTLL|TOTBKCR|BUSLOANS|CONSUMER|CLSACB|CIBOARD|DRCLACB|DRBLACB|DRCRE|DRCC|RCCCBB|TDSP|MDSP|CDSP|BOGZ1)/, 'credit'],
  [/^(GDP|PCEC|PCDG|PCND|PCESV|GPDI|FPI|PNFI|NETEXP|EXPGS|IMPGS|GCE|FGCE|SLCE|A261|W875|RSAFS|RSFS|MARTS|BOPT|BOPG|BOPS|ITX|ITM|PI$|DSPI|PMSAVE|PSAVERT|RPI$|UMCSENT|CBI|GDI)/, 'growth'],
  [/^(DGS|DFF|T5YIF|T10Y|TB3MS|EFFR|SOFR|IORB|WALCL|RRPONTSYD)/, 'rates'],
  [/^(GASREGW|DCOILWTICO|DHHNGSP)/, 'commodities'],
]

// FRED country exceptions (default US) — non-US series stored via FRED.
export const FRED_COUNTRY_EXCEPTIONS: Record<string, string> = {
  CP0000EZ19M086NEST: 'EU', // euro-area HICP comparator (Other Inflation page)
}

// ── Overnight rates (server/src/overnight*.ts modules) ──────────────────────
export const OVERNIGHT_MAP: Record<string, { description: string; country: string }> = {
  AONIA: { description: 'AONIA — AUD overnight index average (RBA cash market)', country: 'AU' },
  AU_CASH_RATE_TARGET: { description: 'RBA cash rate target', country: 'AU' },
  CA_TARGET: { description: 'Bank of Canada overnight rate target', country: 'CA' },
  CORRA: { description: 'CORRA — Canadian overnight repo rate average', country: 'CA' },
  ECBDFR: { description: 'ECB deposit facility rate', country: 'EU' },
  SONIA: { description: 'SONIA — sterling overnight index average', country: 'UK' },
  TONA: { description: 'TONA — Tokyo overnight average rate', country: 'JP' },
}

// ── Census trade end-use keys (routes/census-trade.ts) ──────────────────────
const CENSUS_CATEGORY: Record<string, string> = {
  AUTOS: 'automotive vehicles, parts and engines',
  CAPITAL: 'capital goods except automotive',
  CONSUMER: 'consumer goods',
  FOODS: 'foods, feeds and beverages',
  INDUS: 'industrial supplies and materials',
  OTHER: 'other goods',
}

export function censusDescription(seriesId: string): string | null {
  if (seriesId === 'CENSUS_GOODS_EXP_TOTAL') return 'US goods exports — total (Census basis)'
  if (seriesId === 'CENSUS_GOODS_IMP_TOTAL') return 'US goods imports — total (Census basis)'
  const m = /^CENSUS_(EXP|IMP)_([A-Z]+)$/.exec(seriesId)
  if (!m || !CENSUS_CATEGORY[m[2]]) return null
  return `US goods ${m[1] === 'EXP' ? 'exports' : 'imports'} — ${CENSUS_CATEGORY[m[2]]} (Census end-use)`
}

// ── uk_hpi wide-table metrics (gate decision 3: per region × metric) ─────────
export const UK_HPI_METRICS: ReadonlyArray<[column: string, label: string, units: string]> = [
  ['average_price', 'average price (NSA)', 'GBP'],
  ['average_price_sa', 'average price (SA)', 'GBP'],
  ['index_value', 'price index (NSA)', 'index'],
  ['index_sa', 'price index (SA)', 'index'],
  ['annual_change', 'annual change', '%'],
  ['monthly_change', 'monthly change', '%'],
  ['price_detached', 'average price — detached', 'GBP'],
  ['price_semi', 'average price — semi-detached', 'GBP'],
  ['price_terraced', 'average price — terraced', 'GBP'],
  ['price_flat', 'average price — flat/maisonette', 'GBP'],
  ['sales_volume', 'sales volume', 'transactions'],
]

// ── Treasury event-family entries (gate decision 4) ─────────────────────────
export const TREASURY_FAMILY_DESCRIPTIONS: Record<string, string> = {
  treasury_auctions: 'US Treasury auction results (bid-to-cover, yields, bidder take-down) — dated auctions',
  treasury_investor_class: 'US Treasury investor-class auction allotments — dated auctions',
}
