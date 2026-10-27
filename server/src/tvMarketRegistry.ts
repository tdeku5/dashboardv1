// TradingView market-close registry — the single source of truth for when each
// market's daily session closes. Confirmed at the TV-completed-bars Phase 0 gate
// (docs/prompts/tv-completed-bars-phase0-decisions.md, Q1).
//
// One row per market group: IANA zone, local close 'HH:MM' (24:00 = end of the
// session date, i.e. 00:00 the following day in that zone), and a short basis.
// DST is handled by the zone, via Intl (lib/tvBarComplete.ts).
//
// Editing a close here changes which bars every reader treats as complete.
// lib/tvBarComplete.test.ts proves the 2-day fast path stays safe for every row,
// so a close later than ~1 day after the session date will fail CI.
//
// Symbols in tv_series carry no exchange prefix (apart from TSX:TSX), so the
// resolver below keys on futures roots, yield-tenor patterns and exact names.

export interface MarketClose {
  timeZone: string
  /** Local close 'HH:MM'; '24:00' = midnight ending the session date. */
  closeLocal: string
  basis: string
}

export const MARKET_CLOSES = {
  // ── Futures ────────────────────────────────────────────────────────────────
  CME_RATES:         { timeZone: 'America/Chicago',  closeLocal: '16:30', basis: 'Globex halt 16:00 CT + 30 min buffer for post-close settlement revisions (user, Q1)' },
  CME_ENERGY_METALS: { timeZone: 'America/Chicago',  closeLocal: '16:30', basis: 'Globex halt 16:00 CT + 30 min settlement buffer (user, Q1)' },
  CBOT_GRAINS:       { timeZone: 'America/Chicago',  closeLocal: '13:20', basis: 'CBOT grains day-session close' },
  CME_LIVESTOCK:     { timeZone: 'America/Chicago',  closeLocal: '13:05', basis: 'CME livestock close' },
  CME_LUMBER:        { timeZone: 'America/Chicago',  closeLocal: '15:05', basis: 'CME lumber close' },
  CFE_VX:            { timeZone: 'America/Chicago',  closeLocal: '15:00', basis: 'VX settlement time (regular session ends 16:00 CT)' },
  ICE_US_SOFTS:      { timeZone: 'America/New_York', closeLocal: '14:20', basis: 'Latest of cocoa/coffee 13:30, sugar 13:00, cotton 14:20 ET — conservative' },
  ICE_EU_BRENT:      { timeZone: 'Europe/London',    closeLocal: '23:00', basis: 'ICE Brent close' },
  ICE_EU_STIR:       { timeZone: 'Europe/London',    closeLocal: '21:00', basis: 'ICE Euribor/SONIA close. Medium confidence: 20/20 matched final at 22:05 London' },
  MX_STIR:           { timeZone: 'America/Toronto',  closeLocal: '16:30', basis: 'Montréal Exchange close. LOW confidence: only 1/7 matched final at 17:05 ET' },
  OSE_STIR:          { timeZone: 'Asia/Tokyo',       closeLocal: '15:45', basis: 'JPX day session; night session belongs to the next date' },
  ASX24:             { timeZone: 'Australia/Sydney', closeLocal: '16:30', basis: 'ASX 24 day session' },
  SGX_IRON_COAL:     { timeZone: 'Asia/Singapore',   closeLocal: '19:00', basis: 'SGX T-session close. LOW confidence' },
  SHFE:              { timeZone: 'Asia/Shanghai',    closeLocal: '15:00', basis: 'SHFE day close; night session belongs to the next date. LOW confidence' },

  // ── Government yields (TVC cash composites) ────────────────────────────────
  US_YIELDS:  { timeZone: 'America/New_York', closeLocal: '17:30', basis: 'Medium: values changed after 17:05 ET, final by 17:27 ET (archive)' },
  CA_YIELDS:  { timeZone: 'America/Toronto',  closeLocal: '17:30', basis: 'LOW: 2/10 changed after 17:05 ET' },
  GB_YIELDS:  { timeZone: 'Europe/London',    closeLocal: '17:00', basis: 'LOW: cash composite' },
  EZ_YIELDS:  { timeZone: 'Europe/Berlin',    closeLocal: '18:00', basis: 'LOW: tiny revisions seen even after 23:05 CET (DE03Y -0.0008)' },
  SE_YIELDS:  { timeZone: 'Europe/Stockholm', closeLocal: '18:00', basis: 'LOW' },
  JP_YIELDS:  { timeZone: 'Asia/Tokyo',       closeLocal: '15:00', basis: 'Medium: JGB cash/futures day close' },
  AU_YIELDS:  { timeZone: 'Australia/Sydney', closeLocal: '16:30', basis: 'Medium' },
  NZ_YIELDS:  { timeZone: 'Pacific/Auckland', closeLocal: '17:00', basis: 'LOW' },
  CN_YIELDS:  { timeZone: 'Asia/Shanghai',    closeLocal: '17:00', basis: 'LOW' },

  // ── Equities, vol, FX, spot, crypto ────────────────────────────────────────
  US_EQUITY:       { timeZone: 'America/New_York', closeLocal: '16:00', basis: 'NYSE / Nasdaq close (indices, ETFs, single stocks, breadth)' },
  CBOE_VOL_INDEX:  { timeZone: 'America/New_York', closeLocal: '16:15', basis: 'Cboe index final values' },
  ICE_MOVE:        { timeZone: 'America/New_York', closeLocal: '17:30', basis: 'End-of-day publication. LOW confidence' },
  FX_NY17:         { timeZone: 'America/New_York', closeLocal: '17:00', basis: 'FX day convention (incl. DXY)' },
  SPOT_NY17:       { timeZone: 'America/New_York', closeLocal: '17:00', basis: 'TVC spot commodities. Medium' },
  CRYPTO_UTC:      { timeZone: 'Etc/UTC',          closeLocal: '24:00', basis: 'UTC calendar day' },
  EU_CASH_EQ:      { timeZone: 'Europe/Berlin',    closeLocal: '17:35', basis: 'CAC 40 / DAX / FTSE MIB closing auctions' },
  LSE_EQ:          { timeZone: 'Europe/London',    closeLocal: '16:35', basis: 'FTSE 100 closing auction' },
  NASDAQ_STO:      { timeZone: 'Europe/Stockholm', closeLocal: '17:30', basis: 'OMX Stockholm 30' },
  BIST:            { timeZone: 'Europe/Istanbul',  closeLocal: '18:10', basis: 'Borsa Istanbul closing auction' },
  JSE:             { timeZone: 'Africa/Johannesburg', closeLocal: '17:10', basis: 'JSE closing auction' },
  TSE_EQ:          { timeZone: 'Asia/Tokyo',       closeLocal: '15:30', basis: 'TSE close (Nikkei 225)' },
  HKEX:            { timeZone: 'Asia/Hong_Kong',   closeLocal: '16:10', basis: 'HKEX closing auction (Hang Seng)' },
  NSE:             { timeZone: 'Asia/Kolkata',     closeLocal: '15:30', basis: 'NSE close (NIFTY 50)' },
  SGX_EQ:          { timeZone: 'Asia/Singapore',   closeLocal: '17:16', basis: 'SGX closing routine (STI)' },
  IDX_EQ:          { timeZone: 'Asia/Jakarta',     closeLocal: '16:15', basis: 'IDX close' },
  ASX_EQ:          { timeZone: 'Australia/Sydney', closeLocal: '16:12', basis: 'ASX closing single-price auction' },
  NZX:             { timeZone: 'Pacific/Auckland', closeLocal: '17:00', basis: 'NZX 50' },
  B3:              { timeZone: 'America/Sao_Paulo', closeLocal: '18:30', basis: 'B3 closing call (Ibovespa). LOW confidence' },
  BMV:             { timeZone: 'America/Mexico_City', closeLocal: '15:10', basis: 'BMV close (IPC). LOW confidence' },
  BVC:             { timeZone: 'America/Bogota',   closeLocal: '16:05', basis: 'BVC close (COLCAP). LOW confidence' },
  TSX:             { timeZone: 'America/Toronto',  closeLocal: '16:00', basis: 'TSX close' },
} as const satisfies Record<string, MarketClose>

export type MarketGroup = keyof typeof MARKET_CLOSES

/**
 * Conservative fallback for symbols the resolver doesn't know: 23:59 Pacific/
 * Honolulu on the session date — later than every close above, so an unknown
 * symbol's same-day bar is only accepted from a capture after that moment.
 */
export const FALLBACK_CLOSE: MarketClose = {
  timeZone: 'Pacific/Honolulu',
  closeLocal: '23:59',
  basis: 'Unknown symbol — conservative fallback',
}

/** Symbols deliberately left on the fallback (their source/close is unknown). */
export const FALLBACK_ALLOWLIST: readonly string[] = ['BVOL']

// ── Resolver ─────────────────────────────────────────────────────────────────

/** Futures roots → group. Contract symbols are ROOT + month code + 1–2 digit year. */
const FUTURES_ROOTS: Record<string, MarketGroup> = {
  FF: 'CME_RATES', SR3: 'CME_RATES', SR1: 'CME_RATES',
  CL: 'CME_ENERGY_METALS', GC: 'CME_ENERGY_METALS', SI: 'CME_ENERGY_METALS', HG: 'CME_ENERGY_METALS',
  VX: 'CFE_VX',
  BRN: 'ICE_EU_BRENT',
  EUR: 'ICE_EU_STIR', SO3: 'ICE_EU_STIR',
  CRA: 'MX_STIR',
  TOA3: 'OSE_STIR',
  AUS: 'ASX24',
}
const FUTURES_CONTRACT = /^(FF|SR3|SR1|CL|GC|SI|HG|VX|BRN|EUR|SO3|CRA|TOA3|AUS)[FGHJKMNQUVXZ]\d{1,2}$/

/** Government yield tenors, e.g. US10Y, GB03MY. */
const YIELD_TENOR = /^(US|CA|GB|DE|FR|IT|EU|SE|JP|AU|NZ|CN|GN)\d{2}M?Y$/
const YIELD_COUNTRY: Record<string, MarketGroup> = {
  US: 'US_YIELDS', CA: 'CA_YIELDS', GB: 'GB_YIELDS',
  DE: 'EZ_YIELDS', FR: 'EZ_YIELDS', IT: 'EZ_YIELDS', EU: 'EZ_YIELDS',
  SE: 'SE_YIELDS', JP: 'JP_YIELDS', AU: 'AU_YIELDS', NZ: 'NZ_YIELDS',
  CN: 'CN_YIELDS', GN: 'CN_YIELDS',
}

/** FX crosses: two ISO codes from this set (the pairs present in tv_series). */
const FX_PAIR = /^(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|CNH|BRL|CLP|COP|HUF|IDR|INR|KRW|MXN|MYR|NOK|PHP|PLN|RUB|SAR|SEK|SGD|THB|TRY|TWD|ZAR){2}$/

/** Space-separated symbols → one group. */
function each(symbols: string, group: MarketGroup): Record<string, MarketGroup> {
  return Object.fromEntries(symbols.split(' ').map(s => [s, group]))
}

const EXACT: Record<string, MarketGroup> = {
  ...each('ZB ZN ZF ZT UB TN ES', 'CME_RATES'),
  ...each('CL GC SI HG NG RBOB UHO PL PA', 'CME_ENERGY_METALS'),
  ...each('ZC ZS ZW', 'CBOT_GRAINS'),
  ...each('HE LE GF', 'CME_LIVESTOCK'),
  LBR: 'CME_LUMBER',
  VX1: 'CFE_VX', VX2: 'CFE_VX',
  ...each('CC KC SB CT', 'ICE_US_SOFTS'),
  BRN: 'ICE_EU_BRENT',
  FEF: 'SGX_IRON_COAL', ACF: 'SGX_IRON_COAL',
  REBAR: 'SHFE', STEEL: 'SHFE',
  // US breakevens / forward inflation, and the two tv_ohlcv TVC bill yields
  ...each('5YBE 7YBE 10YBE 30YBE 5y5y T5YIFR TVC:US03MY TVC:US01MY', 'US_YIELDS'),
  ...each('SPX DJI NDX RUT SPY RSP DBC GBTC GDX GLD HYG IBIT IEF KRE MBB MSTR PURR SMH THYP TIP TLT XBI XHB ' +
    'XLB XLC XLE XLF XLI XLK XLP XLRE XLU XLV XLY XOP BRDTH20 BRDTH50 BRDTH200', 'US_EQUITY'),
  ...each('VIX VIX3M VVIX COR1M COR3M DSPX GVOL OVOL', 'CBOE_VOL_INDEX'),
  MOVE: 'ICE_MOVE',
  DXY: 'FX_NY17',
  ...each('OIL GOLD SILVER COPPER', 'SPOT_NY17'),
  ...each('BTC ETH SOL', 'CRYPTO_UTC'),
  CAC40: 'EU_CASH_EQ', DAX: 'EU_CASH_EQ', FTMIB: 'EU_CASH_EQ',
  FTSE100: 'LSE_EQ', OMX30: 'NASDAQ_STO', BIST: 'BIST', SA40: 'JSE',
  NKY: 'TSE_EQ', HSI: 'HKEX', NIFTY50: 'NSE', STI: 'SGX_EQ', IDX: 'IDX_EQ',
  ASX: 'ASX_EQ', NZX50: 'NZX', IBOV: 'B3', IPC: 'BMV', COLCAP: 'BVC', 'TSX:TSX': 'TSX',
}

/** The symbol's market group, or null when it isn't known (→ fallback close). */
export function resolveMarketGroup(symbol: string): MarketGroup | null {
  const exact = EXACT[symbol]
  if (exact) return exact
  const fut = FUTURES_CONTRACT.exec(symbol)
  if (fut) return FUTURES_ROOTS[fut[1]]
  const yld = YIELD_TENOR.exec(symbol)
  if (yld) return YIELD_COUNTRY[yld[1]]
  if (FX_PAIR.test(symbol)) return 'FX_NY17'
  return null
}

/** The close rule for a symbol: its group's row, or the fallback. */
export function marketCloseFor(symbol: string): MarketClose {
  const g = resolveMarketGroup(symbol)
  return g ? MARKET_CLOSES[g] : FALLBACK_CLOSE
}
