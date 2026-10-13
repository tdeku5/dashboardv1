// Identity-colour registry — Asset Class Models.
//
// An identity colour names a THING (a country, a currency, a tenor, a sector,
// a regime, a series), never a sign or a state. Sign/state colours live in
// styles/acm-tokens.css (valence, direction, alert, status, heat); the two sets
// must never share a value (enforced by identityColors.test.ts).
//
// Every map is defined exactly once, here. Values are the ones the section
// already draws, copied from source at 7512e85. A value differs from source
// only when it failed 3:1 on a navy surface (lifted along its own OKLCH hue in
// 0.0025-L steps until it clears 3:1 on bg/panel/raised/overlay) or when a
// Phase 0-F collision was resolved — each such entry is listed in
// IDENTITY_ADJUSTMENTS below with its original value and reason.
//
// Phase 1 defines the registry only; pages import it as they are converted.

// ── Country (rates) ─────────────────────────────────────────────────────────
// One canonical key per country. The four source maps used US/UK/EU/DE/FR/IT/
// CA/JP/AU, CAD/JPY/AUS, market roots SR3/SO3/EUR/CRA/TOA3/AUS, and the
// yield-change grid's Canada/Japan/GB/Germany/France/Italy — all normalised by
// countryColor() through COUNTRY_ALIASES.

export type CountryKey = 'US' | 'UK' | 'EU' | 'DE' | 'FR' | 'IT' | 'CA' | 'JP' | 'AU'

export const COUNTRY_COLORS: Record<CountryKey, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  EU: '#facc15',
  DE: '#facc15', // same as EU: DE carries the EU colour where it stands alone (yield curves)
  FR: '#fb923c',
  IT: '#34d399',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

export const COUNTRY_ALIASES: Record<string, CountryKey> = {
  // CountrySelector codes
  CAD: 'CA', JPY: 'JP', AUS: 'AU',
  // STIR market roots
  SR3: 'US', SO3: 'UK', EUR: 'EU', CRA: 'CA', TOA3: 'JP',
  // GlobalRatesPage yield-change grid keys
  Canada: 'CA', Japan: 'JP', GB: 'UK', Germany: 'DE', France: 'FR', Italy: 'IT',
}

export function canonicalCountry(key: string): CountryKey | undefined {
  if (key in COUNTRY_COLORS) return key as CountryKey
  return COUNTRY_ALIASES[key]
}

export function countryColor(key: string): string | undefined {
  const k = canonicalCountry(key)
  return k ? COUNTRY_COLORS[k] : undefined
}

// ── FX currency (counter-currency of a cross) ──────────────────────────────
// Consistent across all six FX pages at 7512e85. Note: rates draws US blue /
// EU yellow while FX draws EUR blue / USD yellow — separate maps, reported in
// Phase 0, left as-is.

export type CurrencyKey = 'EUR' | 'GBP' | 'AUD' | 'NZD' | 'CAD' | 'JPY' | 'CHF' | 'NOK' | 'SEK' | 'CNH' | 'USD' | 'HUF' | 'PLN'

export const FX_CURRENCY_COLORS: Record<CurrencyKey, string> = {
  EUR: '#60a5fa',
  GBP: '#a78bfa',
  AUD: '#22d3ee',
  NZD: '#34d399',
  CAD: '#f87171',
  JPY: '#f472b6',
  CHF: '#fbbf24',
  NOK: '#fb923c',
  SEK: '#4ade80',
  CNH: '#e2e8f0',
  USD: '#facc15',
  HUF: '#c084fc',
  PLN: '#fb7185',
}

// ── Tenor ───────────────────────────────────────────────────────────────────
// PolicyRatePage, CountryTermStructure and GlobalPolicyTermStructureSection
// each defined this identically. UsRatesVolPage's realized-vol TENOR_SERIES
// used a second, different tenor palette; one map now covers both.
// Tenor and country share hexes (2Y=US, 5Y=UK, 10Y=IT, 30Y=CA) but no chart
// draws both maps, so the tenor map keeps its values (decisions file, Charts 3).

export type TenorKey = 'cash' | '2Y' | '5Y' | '10Y' | '30Y'

export const TENOR_COLORS: Record<TenorKey, string> = {
  cash: '#e2e8f0', // EFFR / SONIA / ECB DFR / CORRA / TONA / AONIA
  '2Y': '#60a5fa',
  '5Y': '#a78bfa',
  '10Y': '#34d399',
  '30Y': '#f87171',
}

// ── Equities ────────────────────────────────────────────────────────────────

export const SECTOR_COLORS: Record<string, string> = {
  XLK: '#3b82f6', // Technology
  XLE: '#f97316', // Energy
  XLV: '#06b6d4', // Health Care
  XLF: '#10b981', // Financials
  XLY: '#ec4899', // Consumer Discretionary
  XLP: '#84cc16', // Consumer Staples
  XLI: '#64748b', // Industrials
  XLC: '#6366f1', // Communication Services
  XLB: '#A3640D', // Materials — lifted from #a16207 (2.94:1)
  XLU: '#eab308', // Utilities
  XLRE: '#14b8a6', // Real Estate
}

export const SECTOR_INDEX_COLOR = '#ffffff' // SPY / the index line

export type UsIndexKey = 'SPX' | 'RSP' | 'NDX' | 'DJI' | 'RUT'

export const US_INDEX_COLORS: Record<UsIndexKey, string> = {
  SPX: '#e2e8f0',
  RSP: '#facc15',
  NDX: '#3b82f6',
  DJI: '#22c55e',
  RUT: '#c084fc',
}

export type BreadthKey = 'd20' | 'd50' | 'd200'

/** Ordinal light → dark for short → long moving average. */
export const BREADTH_MA_COLORS: Record<BreadthKey, string> = {
  d20: '#06b6d4',
  d50: '#3b82f6',
  d200: '#416BDE', // lifted from #1e40af (1.66:1); still darker than d50
}

// ── Vol ─────────────────────────────────────────────────────────────────────

export type CrossAssetVolKey = 'vix' | 'move' | 'gvz' | 'ovx' | 'bvol'

/** One colour per vol index, wherever it is drawn (CrossAssetVol, Equities VOL, US Rates VOL). */
export const VOL_INDEX_COLORS: Record<CrossAssetVolKey, string> = {
  vix: '#ef4444', // Equities VOL drew VIX #f59e0b; unified on the Cross Asset Vol value
  move: '#3b82f6',
  gvz: '#eab308',
  ovx: '#10b981',
  bvol: '#a855f7',
}

/** Equities → VOL page series other than the vol indices themselves. */
export const EQUITY_VOL_SERIES_COLORS = {
  realized20d: '#e2e8f0',
  vixMinusRealized: '#22d3ee',
  spreadZ: '#c084fc',
  vix3mMinusVix: '#a78bfa',
  vx2MinusVx1: '#f472b6',
  cor1m: '#60a5fa',
  cor3m: '#fbbf24',
  dspx: '#4ade80',
} as const

/** Rates → US → VOL. Implied MOVE shares VOL_INDEX_COLORS.move. */
export const US_RATES_VOL_COLORS = {
  implied: VOL_INDEX_COLORS.move,
  realized: '#f59e0b',
  premium: '#e2e8f0',
} as const

// ── Rates: curves and families ──────────────────────────────────────────────

export type RegimeKey =
  | 'Bull Steepener' | 'Bear Steepener' | 'Steepener Twist'
  | 'Bull Flattener' | 'Bear Flattener' | 'Flattener Twist' | 'Neutral'

export const CURVE_REGIME_COLORS: Record<RegimeKey, string> = {
  'Bull Steepener': '#66bb6a',
  'Bear Steepener': '#D33734', // lifted from #c62828 (2.57:1)
  'Steepener Twist': '#ffee58',
  'Bull Flattener': '#42a5f5',
  'Bear Flattener': '#ab47bc',
  'Flattener Twist': '#ff9100',
  Neutral: '#728197',
}

/** Latest vs prior-date curve overlays. Two "latest" blues are distinct roles. */
export const CURVE_COMPARE_COLORS = {
  forwardLatest: '#2196F3', // futures-implied forward curve (pricing tab, Global forward curves)
  yieldLatest: '#60a5fa',   // cash yield curve (UST curve, country curve pages)
  benchmark: '#888888',     // prior-date curve, dashed
} as const

/** Commodity forward-curve offsets (crude, metals, VIX futures curve). */
export const CURVE_OFFSET_COLORS = {
  current: '#e2e8f0',
  offset1: '#60a5fa',
  offset2: '#f59e0b',
} as const

/** UST tab: nominal / real / breakeven families. */
export const UST_FAMILY_COLORS = {
  nominal: '#60a5fa',
  real: '#4ade80',
  breakeven: '#fbbf24',
} as const

export const YIELD_ATTRIBUTION_COLORS = {
  nominalDelta: '#ffffff',
  breakevenDelta: '#ef5350',
  realDelta: '#60a5fa',
} as const

/** Line drawn over regime bars (2s10s, real 5s10s, BE 5s10s, HY OAS). */
export const REGIME_OVERLAY_LINE = '#ffffff'

export const CREDIT_SPREAD_COLORS = {
  AAA: '#4ade80',
  BBB: '#60a5fa',
  HY: '#fbbf24',
  CCC: '#ef5350',
  TRASH: '#a78bfa',
} as const

export const MONEY_MARKET_COLORS = {
  sofrIorb: '#4EC9B0',
  effrIorb: '#fbbf24',
  sofrEffr: '#a78bfa',
} as const

export const RESERVE_DEMAND_COLORS = {
  outer: '#60a5fa',  // 97.5th / 2.5th
  inner: '#94A3B8',  // 84th / 16th
  median: '#EF5350',
} as const

export const CALENDAR_SPREAD_COLORS = {
  current: '#22d3ee',
  lookback: '#94a3b8',
} as const

export const POLICY_RATE_COLORS = {
  effr: TENOR_COLORS.cash,
  cpi: '#7dd3fc',
  pce: '#86efac',
} as const

/** CB hike/cut scenario ladder on the contract modal. */
export const CB_SCENARIO_COLORS = {
  levels: '#a855f7',
  current: '#94a3b8',
} as const

/** Summary-box hover popup spread line (STIR). */
export const SUMMARY_POPUP_LINE = '#FFD700'

// ── STIR packs + FF contract-year bands ─────────────────────────────────────
// Pack names are CME's (Whites/Reds/…). No pack colour may equal a valence or
// direction token (enforced by test).

export type PackName = 'Whites' | 'Reds' | 'Greens' | 'Blues' | 'Golds'

export const STIR_PACK_COLORS: Record<PackName, string> = {
  Whites: '#e5e7eb',
  Reds: '#ef4444',
  Greens: '#22c55e',
  Blues: '#3b82f6',
  Golds: '#facc15',
}

export const STIR_PACK_BACKGROUNDS: Record<PackName, string> = {
  Whites: 'rgba(229, 231, 235, 0.04)',
  Reds: 'rgba(239, 68, 68, 0.07)',
  Greens: 'rgba(34, 197, 94, 0.07)',
  Blues: 'rgba(59, 130, 246, 0.07)',
  Golds: 'rgba(250, 204, 21, 0.07)',
}

/** FF year bands cycle every 5 years, anchored at 2026. */
const FF_YEAR_BAND_CYCLE = [
  'rgba(200, 210, 220, 0.08)', // 2026, 2031, …
  'rgba(239, 83, 80, 0.12)',   // 2027, …
  'rgba(78, 201, 176, 0.12)',  // 2028, …
  'rgba(59, 130, 246, 0.18)',  // 2029, …
  'rgba(255, 215, 0, 0.12)',   // 2030, …
] as const

/**
 * Keyed to the year itself. The page's getYearBandColor fell back to the
 * year's index in the visible list for years outside 2026–2030, so those
 * years' bands could change with the data shown — same drift as GDPNow.
 */
export function ffYearBandColor(year: number): string {
  const i = (((year - 2026) % FF_YEAR_BAND_CYCLE.length) + FF_YEAR_BAND_CYCLE.length) % FF_YEAR_BAND_CYCLE.length
  return FF_YEAR_BAND_CYCLE[i]
}

// ── Fundamental-model panels (US CPI/PCE/labor + UK/EU/CA/JP/AU) ────────────

export const FUNDAMENTAL_MODEL_COLORS = {
  headline: '#e2e8f0',        // YoY actual / U-3 / CPI-trim
  policyRate: '#a78bfa',      // Fed Funds / Bank Rate / ECB DFR / BoC / BoJ / RBA overlay
  pace1: '#4ade80',
  pace3: '#22d3ee',
  pace6: '#fbbf24',
  mom: '#4EC9B0',             // MoM / sequential line
  inflationTarget: '#EF5350', // 2% target reference line
  auTargetBand: '#34d399',    // RBA 2–3% band + 2.5% line
  auTrend: '#fbbf24',
  caMedian: '#22d3ee',
  caCommon: '#fbbf24',
  caAverage: '#4ade80',
} as const

export const LABOR_COLORS = {
  u3: '#e2e8f0',
  payrollYoY: '#a78bfa',
  ma3: '#4ade80',
  ma6: '#fbbf24',
} as const

/** Payroll scenario slots, weakest (slot 0, default 50k) → strongest. */
export const LABOR_SCENARIO_COLORS = ['#EF5350', '#fbbf24', '#22d3ee', '#4ade80'] as const

// ── GDPNow ──────────────────────────────────────────────────────────────────

export const GDPNOW_COMPONENT_COLORS = {
  pce: '#42a5f5',
  equipment: '#66bb6a',
  intell_prop: '#ab47bc',
  nonres_struct: '#ffa726',
  resid_invest: '#ef5350',
  govt: '#26c6da',
  net_exports: '#ffee58',
} as const

export const GDPNOW_GDP_LINE = '#ffffff'

const GDPNOW_QUARTER_PALETTE = [
  '#90CAF9', '#F48FB1', '#CE93D8', '#80CBC4', '#FFE082',
  '#81C784', '#FFCC80', '#9FA8DA', '#ef9a9a', '#4FC3F7',
  '#A1887F', '#B39DDB', '#FF8A65', '#4DD0E1', '#AED581',
  '#DCE775', '#FFB74D', '#4DB6AC', '#81D4FA', '#C5E1A5',
] as const

/**
 * Colour for a GDPNow quarter label ("Q3 2025"), keyed to the quarter itself:
 * palette[(year·4 + q − 1) mod 20]. The page's getQuarterColor(idx) used the
 * quarter's index in the range-filtered list, so a quarter changed colour when
 * the date range changed. Returns undefined for an unparseable label.
 */
export function gdpnowQuarterColor(quarter: string): string | undefined {
  const m = quarter.trim().match(/^Q([1-4])\s+(\d{4})$/)
  if (!m) return undefined
  const ordinal = Number(m[2]) * 4 + Number(m[1]) - 1
  return GDPNOW_QUARTER_PALETTE[ordinal % GDPNOW_QUARTER_PALETTE.length]
}

// ── Treasury auctions ───────────────────────────────────────────────────────
// TreasuryAuctionPage also mounts at the standalone /treasury route, so these
// apply there too once wired (Decision 4: not restyled for the section).

export const TREASURY_AUCTION_COLORS = {
  bidToCover: '#38bdf8',
  offeringAmount: '#f59e0b',
} as const

export type InvestorClassKey =
  | 'dealersAndBrokers' | 'foreignAndInternational' | 'investmentFunds' | 'depositoryInstitutions'
  | 'pensionAndRetirement' | 'federalReserve' | 'individuals' | 'other'

export const INVESTOR_CLASS_COLORS: Record<InvestorClassKey, string> = {
  dealersAndBrokers: '#3b82f6',
  foreignAndInternational: '#f59e0b',
  investmentFunds: '#10b981',
  depositoryInstitutions: '#8b5cf6',
  pensionAndRetirement: '#ec4899',
  federalReserve: '#ef4444',
  // Both lifted to ≥ 3:1; a bare lift left them ΔE2000 1.97 apart, so
  // Individuals was lifted further to ΔE ≥ 10 (option B, user decision) —
  // Other stays the darker grey, as at 7512e85.
  individuals: '#868D9B', // from #6b7280 (2.99:1)
  other: '#687385',       // from #374151 (1.40:1)
}

// ── Reference ───────────────────────────────────────────────────────────────

export interface IdentityAdjustment { map: string; key: string; from: string; to: string; reason: string }

/** Every value that differs from its 7512e85 source, and why. */
export const IDENTITY_ADJUSTMENTS: readonly IdentityAdjustment[] = [
  { map: 'SECTOR_COLORS', key: 'XLB', from: '#a16207', to: '#A3640D', reason: 'contrast 2.94 → ≥3:1' },
  { map: 'BREADTH_MA_COLORS', key: 'd200', from: '#1e40af', to: '#416BDE', reason: 'contrast 1.66 → ≥3:1' },
  { map: 'CURVE_REGIME_COLORS', key: 'Bear Steepener', from: '#c62828', to: '#D33734', reason: 'contrast 2.57 → ≥3:1' },
  { map: 'INVESTOR_CLASS_COLORS', key: 'individuals', from: '#6b7280', to: '#868D9B', reason: 'contrast 2.99 → ≥3:1, then ΔE ≥ 10 from Other (option B)' },
  { map: 'INVESTOR_CLASS_COLORS', key: 'other', from: '#374151', to: '#687385', reason: 'contrast 1.40 → ≥3:1' },
  { map: 'VOL_INDEX_COLORS', key: 'vix', from: '#f59e0b', to: '#ef4444', reason: 'VIX unified across CrossAssetVol + Equities VOL (Equities VOL changes)' },
  { map: 'TENOR_COLORS', key: '2Y/5Y/10Y/30Y', from: '#ef4444/#f59e0b/#3b82f6/#a855f7', to: '#60a5fa/#a78bfa/#34d399/#f87171', reason: 'UsRatesVol realized-vol tenors merged into the one tenor map' },
]

/**
 * Every identity colour in the registry as [path, value], for tests.
 * rgba backgrounds (pack rows, FF year bands) are tints, not identity hues,
 * and are excluded from contrast / sign-collision checks.
 */
export function allIdentityColors(): Array<[string, string]> {
  const maps: Record<string, Record<string, string> | readonly string[]> = {
    COUNTRY_COLORS, FX_CURRENCY_COLORS, TENOR_COLORS, SECTOR_COLORS, US_INDEX_COLORS,
    BREADTH_MA_COLORS, VOL_INDEX_COLORS, EQUITY_VOL_SERIES_COLORS, US_RATES_VOL_COLORS,
    CURVE_REGIME_COLORS, CURVE_COMPARE_COLORS, CURVE_OFFSET_COLORS, UST_FAMILY_COLORS,
    YIELD_ATTRIBUTION_COLORS, CREDIT_SPREAD_COLORS, MONEY_MARKET_COLORS, RESERVE_DEMAND_COLORS,
    CALENDAR_SPREAD_COLORS, POLICY_RATE_COLORS, CB_SCENARIO_COLORS, STIR_PACK_COLORS,
    FUNDAMENTAL_MODEL_COLORS, LABOR_COLORS, LABOR_SCENARIO_COLORS, GDPNOW_COMPONENT_COLORS,
    GDPNOW_QUARTER_PALETTE, TREASURY_AUCTION_COLORS, INVESTOR_CLASS_COLORS,
  }
  const out: Array<[string, string]> = [
    ['SECTOR_INDEX_COLOR', SECTOR_INDEX_COLOR], ['REGIME_OVERLAY_LINE', REGIME_OVERLAY_LINE],
    ['SUMMARY_POPUP_LINE', SUMMARY_POPUP_LINE], ['GDPNOW_GDP_LINE', GDPNOW_GDP_LINE],
  ]
  for (const [name, m] of Object.entries(maps)) {
    for (const [k, v] of Object.entries(m)) out.push([`${name}.${k}`, v])
  }
  return out
}
