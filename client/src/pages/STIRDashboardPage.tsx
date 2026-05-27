import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { CountrySelector, type CountryCode } from '../components/CountrySelector'
import { AssetSubRibbon } from '../components/AssetSubRibbon'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { UKFundamentalModelPanel } from '../components/UKFundamentalModelPanel'
import { EUFundamentalModelPanel } from '../components/EUFundamentalModelPanel'
import { CAFundamentalModelPanel } from '../components/CAFundamentalModelPanel'
import { JPFundamentalModelPanel } from '../components/JPFundamentalModelPanel'
import { AUFundamentalModelPanel } from '../components/AUFundamentalModelPanel'
import { fetchBEASeries } from '../lib/bea'
import { useFedWatch } from '../hooks/useFedWatch'
import { useOvernightRates } from '../hooks/useOvernightRates'
import { PolicyRatePage } from './PolicyRatePage'
import { CountryTermStructure, COUNTRY_TERM_STRUCTURE_CONFIGS } from './CountryTermStructure'
import { useFuturesCurve, type FuturesCurvePoint } from '../hooks/useFuturesCurve'
import { useFuturesStrip, type StripContract } from '../hooks/useFuturesStrip'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import { buildSpreadChartData, REGIME_COLORS, type SpreadChartPoint } from '../lib/curveRegime'
import { getCellColor } from '../lib/cellColor'
import { HIST_LOOKBACKS, histLookbackChange } from '../lib/historicalChanges'
import styles from './STIRDashboardPage.module.css'

const TreasuryAuctionContent = lazy(() => import('./TreasuryAuctionPage').then(m => ({ default: m.TreasuryAuctionContent })))
import { CountryCurvePage } from './CountryCurvePage'
import { GlobalRatesPage } from './GlobalRatesPage'
import { CrudeOilPage } from './CrudeOilPage'
import { MetalsPage } from './MetalsPage'
import { EnergyReturnsSection } from '../components/EnergyReturnsSection'
import { IndexComparisonPage } from './IndexComparisonPage'
import { SectorAttributionPage } from './SectorAttributionPage'
import { BreadthPage } from './BreadthPage'
import { CrossAssetVolPage } from './CrossAssetVolPage'
import { CountryReturnsPage } from './CountryReturnsPage'
import { PairReturnsPage } from './PairReturnsPage'

type ViewTab = 'strips' | 'pricing' | 'policy' | 'ust' | 'attribution' | 'credit' | 'money' | 'auctions' | 'gilt' | 'bund' | 'oat' | 'btp' | 'cad' | 'jgb' | 'agb'

type AssetClass = 'macro' | 'rates' | 'equities' | 'fx' | 'commodities'

const ASSET_CLASSES: Array<{ key: AssetClass; label: string }> = [
  { key: 'macro', label: 'MACRO' },
  { key: 'rates', label: 'RATES' },
  { key: 'equities', label: 'EQUITIES' },
  { key: 'fx', label: 'FX' },
  { key: 'commodities', label: 'COMMODITIES' },
]

type CommodityCategory = 'metals' | 'energy' | 'ags' | 'softs'

const COMMODITY_CATEGORIES: ReadonlyArray<{ key: CommodityCategory; label: string }> = [
  { key: 'metals', label: 'METALS' },
  { key: 'energy', label: 'ENERGY' },
  { key: 'ags',    label: 'AGS' },
  { key: 'softs',  label: 'SOFTS' },
]

type EnergyProduct = 'crude-oil'

const ENERGY_PRODUCTS: ReadonlyArray<{ key: EnergyProduct; label: string }> = [
  { key: 'crude-oil', label: 'CRUDE OIL' },
]

type EquitySection = 'index-comparison' | 'sector-attribution' | 'breadth'

const EQUITY_SECTIONS: ReadonlyArray<{ key: EquitySection; label: string }> = [
  { key: 'index-comparison',   label: 'INDEX COMPARISON' },
  { key: 'sector-attribution', label: 'SECTOR ATTRIBUTION' },
  { key: 'breadth',            label: 'BREADTH' },
]

type MacroSection = 'regimes' | 'cross-asset-vol'

const MACRO_SECTIONS: ReadonlyArray<{ key: MacroSection; label: string }> = [
  { key: 'regimes',          label: 'REGIMES' },
  { key: 'cross-asset-vol',  label: 'CROSS ASSET VOL' },
]

type GlobalEquitySection = 'country-returns'

const GLOBAL_EQUITY_SECTIONS: ReadonlyArray<{ key: GlobalEquitySection; label: string }> = [
  { key: 'country-returns', label: 'COUNTRY RETURNS' },
]

type GlobalFxSection = 'pair-returns'

const GLOBAL_FX_SECTIONS: ReadonlyArray<{ key: GlobalFxSection; label: string }> = [
  { key: 'pair-returns', label: 'PAIR RETURNS' },
]

type ProductKey = 'fedfunds' | 'sofr'

const PRODUCT_CONFIG: Record<ProductKey, { label: string; root: string; title: string }> = {
  fedfunds: { label: 'FED FUNDS', root: 'FF', title: 'FED FUNDS' },
  sofr: { label: '3M SOFR', root: 'SR3', title: '3M SOFR' },
}

// Non-US countries have a single market each
// rateLabel matches the overnight series surfaced in the banner. The EU page
// shows the ECB Deposit Facility Rate (a policy rate); the AUS page shows AONIA
// (the realized interbank overnight rate, formerly mislabeled "IOCR").
const COUNTRY_MARKET: Record<Exclude<CountryCode, 'US' | 'Global'>, { root: string; title: string; rateLabel: string; overnightSeries: string }> = {
  UK:  { root: 'SO3',  title: '3M SONIA',      rateLabel: 'CURRENT SONIA', overnightSeries: 'SONIA' },
  EU:  { root: 'EUR',  title: '3M EURIBOR',    rateLabel: 'CURRENT ECB DFR', overnightSeries: 'ECBDFR' },
  CAD: { root: 'CRA',  title: '3M CORRA',      rateLabel: 'CURRENT CORRA', overnightSeries: 'CORRA' },
  JPY: { root: 'TOA3', title: '3M TONA',       rateLabel: 'CURRENT TONA',  overnightSeries: 'TONA' },
  AUS: { root: 'AUS',  title: '90D BANK BILL', rateLabel: 'CURRENT AONIA', overnightSeries: 'AONIA' },
}

const FVM_TABS = [
  { key: 'cpi', label: 'CPI' },
  { key: 'pce', label: 'PCE' },
  { key: 'labor', label: 'LABOR' },
  { key: 'growth', label: 'GROWTH' },
] as const

function getViewTabs(country: CountryCode): Array<{ key: ViewTab; label: string }> {
  if (country === 'Global') return []
  if (country === 'US') {
    return [
      { key: 'strips', label: 'STIR STRIPS' },
      { key: 'pricing', label: 'FORWARD PRICING' },
      { key: 'policy', label: 'POLICY RATE' },
      { key: 'ust', label: 'UST CURVE' },
      { key: 'attribution', label: 'YIELD ATTRIBUTION' },
      { key: 'credit', label: 'CREDIT' },
      { key: 'money', label: 'MONEY MARKETS' },
      { key: 'auctions', label: 'TREASURY AUCTIONS' },
    ]
  }
  if (country === 'EU') {
    return [
      { key: 'strips', label: 'STIR STRIPS' },
      { key: 'pricing', label: 'FORWARD PRICING' },
      { key: 'policy', label: 'POLICY RATE' },
      { key: 'bund', label: 'BUND CURVE' },
      { key: 'oat', label: 'OAT CURVE' },
      { key: 'btp', label: 'BTP CURVE' },
    ]
  }
  const curveTabMap: Record<Exclude<CountryCode, 'US' | 'EU' | 'Global'>, { key: ViewTab; label: string }> = {
    UK:  { key: 'gilt', label: 'GILT CURVE' },
    CAD: { key: 'cad', label: 'CAD YIELD CURVE' },
    JPY: { key: 'jgb', label: 'JGB CURVE' },
    AUS: { key: 'agb', label: 'AGB CURVE' },
  }
  return [
    { key: 'strips', label: 'STIR STRIPS' },
    { key: 'pricing', label: 'FORWARD PRICING' },
    { key: 'policy', label: 'POLICY RATE' },
    curveTabMap[country],
  ]
}

const FVM_RANGES = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
  { key: 'all', label: 'ALL' },
] as const

interface CurveRow {
  ticker: string
  latestRate: number | null
  benchmarkRate: number | null
  latestPrice: number | null
  benchmarkPrice: number | null
  deltaBps: number | null
  order: number
}

interface SummaryRow {
  key: string
  label: string
  impliedRate: number
  stepBps: number
  totalBps: number
  impliedMoves: number
  stepSummary: string
  totalSummary: string
  tone: 'cut' | 'hike' | 'flat'
}

interface StripSummaryBox {
  label: string
  value: string
  sub: string
  tone: 'teal' | 'gold' | 'green' | 'red' | 'neutral'
  hoverKey?: 'mtg' | 'term6m' | 'term12m'
}

type WD = { date: string; value: number }

interface FvmSeriesModel {
  raw: WD[]
  currentLevel: number
  currentDate: string
  currentMoM: number | null
  currentYoY: number | null
  current1moAnn: number | null
  current3moAnn: number | null
  current6moAnn: number | null
  past1moMoM: number
  past3moAvgMoM: number
  past6moAvgMoM: number
}

interface FvmChartPoint {
  date: string
  yoy: number | null
  pace1m: number | null
  pace3m: number | null
  pace6m: number | null
}

interface FvmMomPoint {
  date: string
  mom: number
}

interface LaborProjectionScenario {
  label: string
  points: Array<{ date: string; value: number }>
}

interface LaborProjectionModel {
  currentU3: number
  latestDate: string
  currentEmployment: number
  currentClf: number
  scenarios: LaborProjectionScenario[]
}

interface LaborChartPoint {
  date: string
  historical: number | null
  scenario0: number | null
  scenario1: number | null
  scenario2: number | null
  scenario3: number | null
}

interface PayrollYoYPoint {
  date: string
  yoy: number
}

interface PayrollMomPoint {
  date: string
  mom: number
  ma3: number | null
  ma6: number | null
}

interface GDPNowPoint {
  forecastDate: string
  value: number
}

interface RDEPoint {
  date: string
  median: number | null
  p16: number | null
  p84: number | null
  p2_5: number | null
  p97_5: number | null
}

interface GDPNowQuarter {
  quarter: string
  forecasts: GDPNowPoint[]
}

interface ContributionPoint {
  forecast_date: string
  gdp: number | null
  pce: number | null
  equipment: number | null
  intell_prop: number | null
  nonres_struct: number | null
  resid_invest: number | null
  govt: number | null
  net_exports: number | null
}

interface ContractHistoryPoint {
  date: string
  impliedRate: number
  lastPrice: number
}

interface YieldData {
  date: string
  value: number
}

type UstSelection =
  | { type: 'yield'; key: string; label: string }
  | { type: 'spread'; label: string; longKey: string; shortKey: string }
  | { type: 'butterfly'; label: string; lowKey: string; middleKey: string; highKey: string }
  | null

type RealSelection =
  | { type: 'realYield'; key: '5y' | '10y'; label: string }
  | { type: 'realSpread'; label: string }

type BeSelection =
  | { type: 'beYield'; key: '5y' | '10y'; label: string }
  | { type: 'beSpread'; label: string }

const MONTH_CODE_TO_INDEX: Record<string, number> = {
  F: 0,
  G: 1,
  H: 2,
  J: 3,
  K: 4,
  M: 5,
  N: 6,
  Q: 7,
  U: 8,
  V: 9,
  X: 10,
  Z: 11,
}

const YEAR_BAND_COLORS: Record<number, string> = {
  2026: 'rgba(200, 210, 220, 0.08)',
  2027: 'rgba(239, 83, 80, 0.12)',
  2028: 'rgba(78, 201, 176, 0.12)',
  2029: 'rgba(59, 130, 246, 0.18)',
  2030: 'rgba(255, 215, 0, 0.12)',
}

const YEAR_CYCLE = [
  'rgba(200, 210, 220, 0.08)',
  'rgba(239, 83, 80, 0.12)',
  'rgba(78, 201, 176, 0.12)',
  'rgba(59, 130, 246, 0.18)',
  'rgba(255, 215, 0, 0.12)',
]

type PackName = 'Whites' | 'Reds' | 'Greens' | 'Blues' | 'Golds'
const PACK_NAMES: PackName[] = ['Whites', 'Reds', 'Greens', 'Blues', 'Golds']
const PACK_COLORS: Record<PackName, string> = {
  Whites: '#e5e7eb',
  Reds: '#ef4444',
  Greens: '#22c55e',
  Blues: '#3b82f6',
  Golds: '#facc15',
}
const SCENARIO_BPS: number[] = [-150, -125, -100, -75, -50, -25, 0, 25, 50, 75, 100, 125, 150]

const PACK_BACKGROUNDS: Record<PackName, string> = {
  Whites: 'rgba(229, 231, 235, 0.04)',
  Reds: 'rgba(239, 68, 68, 0.07)',
  Greens: 'rgba(34, 197, 94, 0.07)',
  Blues: 'rgba(59, 130, 246, 0.07)',
  Golds: 'rgba(250, 204, 21, 0.07)',
}

const INTEGER_FORMAT = new Intl.NumberFormat('en-US')
const FVM_TICK = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#94A3B8' }
const LABOR_SCENARIO_COLORS = ['#EF5350', '#fbbf24', '#22d3ee', '#4ade80'] as const
const UST_TENORS = [
  { key: 'DGS3MO', label: '3M' },
  { key: 'DGS1', label: '1Y' },
  { key: 'DGS2', label: '2Y' },
  { key: 'DGS5', label: '5Y' },
  { key: 'DGS7', label: '7Y' },
  { key: 'DGS10', label: '10Y' },
  { key: 'DGS30', label: '30Y' },
] as const
const BE_REAL_ROWS: ReadonlyArray<{ key: string; label: string; addSeparatorAfter?: boolean }> = [
  { key: 'T5YIE', label: '5Y BE' },
  { key: 'T10YIE', label: '10Y BE', addSeparatorAfter: true },
  { key: 'real5y', label: '5Y Real' },
  { key: 'real10y', label: '10Y Real' },
] as const
const UST_EXTRA = [
  { key: 'DGS1MO' },
  { key: 'DGS6MO' },
  { key: 'DGS20' },
  { key: 'BAMLH0A0HYM2' },
  { key: 'BAMLC0A1CAAA' },
  { key: 'BAMLC0A4CBBB' },
  { key: 'BAMLH0A3HYC' },
  { key: 'SOFR' },
  { key: 'IORB' },
  { key: 'IOER' },
] as const
const CREDIT_SPREADS = [
  { key: 'BAMLC0A1CAAA', label: 'AAA' },
  { key: 'BAMLC0A4CBBB', label: 'BBB' },
  { key: 'BAMLH0A0HYM2', label: 'HY' },
  { key: 'BAMLH0A3HYC', label: 'CCC' },
  { key: 'TRASH', label: 'Trash' },
] as const
const CREDIT_SERIES_CONFIG = [
  { key: 'BAMLC0A1CAAA', label: 'AAA', color: '#4ade80' },
  { key: 'BAMLC0A4CBBB', label: 'BBB', color: '#60a5fa' },
  { key: 'BAMLH0A0HYM2', label: 'HY', color: '#fbbf24' },
  { key: 'BAMLH0A3HYC', label: 'CCC', color: '#ef5350' },
  { key: 'TRASH', label: 'Trash', color: '#a78bfa' },
] as const
const YC_TENORS = [
  { key: 'DGS1MO', label: '1M', years: 1 / 12 },
  { key: 'DGS3MO', label: '3M', years: 0.25 },
  { key: 'DGS6MO', label: '6M', years: 0.5 },
  { key: 'DGS1', label: '1Y', years: 1 },
  { key: 'DGS2', label: '2Y', years: 2 },
  { key: 'DGS5', label: '5Y', years: 5 },
  { key: 'DGS7', label: '7Y', years: 7 },
  { key: 'DGS10', label: '10Y', years: 10 },
  { key: 'DGS20', label: '20Y', years: 20 },
  { key: 'DGS30', label: '30Y', years: 30 },
] as const
const UST_SPREADS = [
  { label: '3m2s', long: 'DGS2', short: 'DGS3MO' },
  { label: '1s2s', long: 'DGS2', short: 'DGS1' },
  { label: '2s5s', long: 'DGS5', short: 'DGS2' },
  { label: '2s10s', long: 'DGS10', short: 'DGS2' },
  { label: '2s30s', long: 'DGS30', short: 'DGS2' },
  { label: '5s10s', long: 'DGS10', short: 'DGS5' },
  { label: '7s10s', long: 'DGS10', short: 'DGS7' },
  { label: '5s30s', long: 'DGS30', short: 'DGS5' },
  { label: '10s30s', long: 'DGS30', short: 'DGS10' },
] as const
const BUTTERFLIES = [
  { label: '2s5s10s', low: 'DGS2', middle: 'DGS5', high: 'DGS10' },
  { label: '2s10s30s', low: 'DGS2', middle: 'DGS10', high: 'DGS30' },
  { label: '5s10s30s', low: 'DGS5', middle: 'DGS10', high: 'DGS30' },
] as const
const UST_BREAKEVENS = [
  { key: 'T5YIE', label: '5Y Breakeven' },
  { key: 'T10YIE', label: '10Y Breakeven' },
] as const
function fmtDaysWeeks(currentDate: string, benchmarkDate: string): { days: number; weeks: string } {
  if (!currentDate || !benchmarkDate) return { days: 0, weeks: '0.0' }
  const current = new Date(`${currentDate}T12:00:00Z`)
  const benchmark = new Date(`${benchmarkDate}T12:00:00Z`)
  const diffMs = Math.abs(current.getTime() - benchmark.getTime())
  const days = Math.round(diffMs / 86_400_000)
  return { days, weeks: (days / 7).toFixed(1) }
}

function fmtRate(v: number): string {
  return v.toFixed(3)
}

function fmtSignedPct(v: number | null, digits = 2): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}`
}

function fmtBps(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

function fmtSignedDecimal(v: number): string {
  if (Math.abs(v) < 0.05) return '0.0'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

function toneFromBps(v: number): 'cut' | 'hike' | 'flat' {
  if (v > 0.01) return 'hike'
  if (v < -0.01) return 'cut'
  return 'flat'
}

function summaryFromBps(v: number): string {
  // Probability format: |bps| / 25 = probability of a 25-bp move at (or by)
  // this meeting. For Summary (Total) this can exceed 100% — "120.8% Hike"
  // = the cumulative implied path is equivalent to 1.208 full hikes.
  // Direction (Hike/Cut/Flat) is taken from the sign of bps; the percent
  // is always rendered unsigned because "Cut" already carries the sign.
  const pct = Math.abs(v) / 25 * 100
  if (Math.abs(v) < 0.05) return `${pct.toFixed(1)}% Flat`
  if (v > 0) return `${pct.toFixed(1)}% Hike`
  return `${pct.toFixed(1)}% Cut`
}

function impliedMovesFromBps(v: number): number {
  return v / 25
}

function contractTicker(symbol: string): string {
  return symbol.replace(/^\//, '')
}

function fmtSignedPrice(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(3)}`
}

function fmtBpsValue(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}bp`
}

// Bare numeric bps formatter — used in table cells where the column header
// already conveys units, so the "bp" suffix would be redundant.
function fmtBpsNumber(v: number | null): string {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

// Convert a futures price change to its implied-rate change, formatted bare.
// Sign flips because rates and prices move inversely (1bp rate = 0.01 price).
function fmtBpsFromPrice(priceChange: number | null): string {
  if (priceChange == null) return '—'
  return fmtBpsNumber(priceChange * -100)
}

const CONTRIB_COMPONENTS = [
  { key: 'pce', label: 'PCE', color: '#42a5f5' },
  { key: 'equipment', label: 'Equipment', color: '#66bb6a' },
  { key: 'intell_prop', label: 'Intell. Prop.', color: '#ab47bc' },
  { key: 'nonres_struct', label: 'Nonres. Struct.', color: '#ffa726' },
  { key: 'resid_invest', label: 'Resid. Invest.', color: '#ef5350' },
  { key: 'govt', label: 'Govt.', color: '#26c6da' },
  { key: 'net_exports', label: 'Net Exports', color: '#ffee58' },
] as const

function getQuarterColor(idx: number): string {
  const colors = [
    '#90CAF9', '#F48FB1', '#CE93D8', '#80CBC4', '#FFE082',
    '#81C784', '#FFCC80', '#9FA8DA', '#ef9a9a', '#4FC3F7',
    '#A1887F', '#B39DDB', '#FF8A65', '#4DD0E1', '#AED581',
    '#DCE775', '#FFB74D', '#4DB6AC', '#81D4FA', '#C5E1A5',
  ]
  return colors[idx % colors.length]
}

function monthsForward(contract: StripContract, now = new Date()): number {
  const currentMonthIndex = now.getMonth()
  const contractMonthIndex = MONTH_CODE_TO_INDEX[contract.monthCode]
  if (contractMonthIndex == null) return 0
  return ((contract.year - now.getFullYear()) * 12) + (contractMonthIndex - currentMonthIndex)
}

function heatStyle(value: number | null, maxAbs: number): CSSProperties {
  if (value == null) return { color: '#728197' }
  if (Math.abs(value) < 1e-9 || maxAbs <= 0) return { color: '#728197' }

  const opacity = Math.max(0.6, Math.min(1, Math.abs(value) / maxAbs))
  const intensity = Math.abs(value) / maxAbs
  const bgAlpha = 0.05 + intensity * 0.2
  if (value > 0) return { color: `rgba(78, 201, 176, ${opacity})`, background: `rgba(78, 201, 176, ${bgAlpha.toFixed(3)})` }
  return { color: `rgba(239, 83, 80, ${opacity})`, background: `rgba(239, 83, 80, ${bgAlpha.toFixed(3)})` }
}

// First inflection point on the curve — the contract where the cycle direction
// reverses. Falls back to the last contract if the curve never reverses, or to
// the only/last contract for very short curves.
function findTerminalContract(contracts: StripContract[]): StripContract | null {
  if (contracts.length === 0) return null
  if (contracts.length < 3) return contracts[contracts.length - 1]

  let baseDirection = Math.sign(contracts[1].impliedRate - contracts[0].impliedRate)
  let baseIdx = 0

  if (baseDirection === 0) {
    for (let i = 2; i < contracts.length; i++) {
      const dir = Math.sign(contracts[i].impliedRate - contracts[i - 1].impliedRate)
      if (dir !== 0) {
        baseDirection = dir
        baseIdx = i - 1
        break
      }
    }
    if (baseDirection === 0) return contracts[contracts.length - 1]
  }

  for (let i = baseIdx + 1; i < contracts.length; i++) {
    const dir = Math.sign(contracts[i].impliedRate - contracts[i - 1].impliedRate)
    if (dir !== 0 && dir !== baseDirection) {
      return contracts[i - 1]
    }
  }

  return contracts[contracts.length - 1]
}

function summaryToneStyle(tone: StripSummaryBox['tone']): CSSProperties {
  switch (tone) {
    case 'gold':
      return { color: '#FFD700' }
    case 'green':
      return { color: '#4EC9B0' }
    case 'red':
      return { color: '#EF5350' }
    case 'neutral':
      return { color: '#94A3B8' }
    case 'teal':
    default:
      return { color: '#4EC9B0' }
  }
}

function getYearBandColor(year: number, years: number[]): string {
  if (YEAR_BAND_COLORS[year]) return YEAR_BAND_COLORS[year]
  const idx = years.indexOf(year)
  return YEAR_CYCLE[(idx >= 0 ? idx : 0) % YEAR_CYCLE.length]
}

function fmtShortMonthYear(d: string): string {
  const [y, m] = d.split('-')
  const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${short[parseInt(m, 10) - 1]} ${y}`
}

function addMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number)
  let ty = y
  let tm = m + n
  while (tm < 1) { ty -= 1; tm += 12 }
  while (tm > 12) { ty += 1; tm -= 12 }
  return `${ty}-${String(tm).padStart(2, '0')}-01`
}

function fillOct2025Gap(obs: FredObservation[]): FredObservation[] {
  const hasOct = obs.some((o) => o.date === '2025-10-01')
  if (hasOct) return obs
  const sepIdx = obs.findIndex((o) => o.date === '2025-09-01')
  const novIdx = obs.findIndex((o) => o.date === '2025-11-01')
  if (sepIdx < 0 || novIdx < 0) return obs
  const sepVal = parseFloat(obs[sepIdx].value)
  const novVal = parseFloat(obs[novIdx].value)
  if (Number.isNaN(sepVal) || Number.isNaN(novVal)) return obs

  const result = [...obs]
  result.splice(sepIdx + 1, 0, { date: '2025-10-01', value: ((sepVal + novVal) / 2).toString() })
  return result
}

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter((o) => o.value !== '.' && o.value.trim() !== '')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .filter((o) => !Number.isNaN(o.value))
}

function projectYoYAt(currentLevel: number, mom: number, monthsForward: number, map: Map<string, number>, currentDate: string): number | null {
  const projLevel = currentLevel * Math.pow(1 + mom / 100, monthsForward)
  const projDate = addMonths(currentDate, monthsForward)
  const denomDate = addMonths(projDate, -12)
  const denomLevel = map.get(denomDate)
  if (denomLevel == null || denomLevel === 0) return null
  return (projLevel / denomLevel - 1) * 100
}

function buildFvmModel(data: WD[]): FvmSeriesModel {
  const empty: FvmSeriesModel = {
    raw: data,
    currentLevel: 0,
    currentDate: '',
    currentMoM: null,
    currentYoY: null,
    current1moAnn: null,
    current3moAnn: null,
    current6moAnn: null,
    past1moMoM: 0,
    past3moAvgMoM: 0,
    past6moAvgMoM: 0,
  }
  if (data.length < 13) return empty

  const map = new Map(data.map((d) => [d.date, d.value]))
  const last = data[data.length - 1]
  const currentLevel = last.value
  const currentDate = last.date

  const p1 = map.get(addMonths(currentDate, -1))
  const p3 = map.get(addMonths(currentDate, -3))
  const p6 = map.get(addMonths(currentDate, -6))
  const p12 = map.get(addMonths(currentDate, -12))

  const currentMoM = p1 != null && p1 !== 0 ? ((currentLevel / p1) - 1) * 100 : null
  const currentYoY = p12 != null && p12 !== 0 ? ((currentLevel / p12) - 1) * 100 : null
  const current1moAnn = p1 != null && p1 !== 0 ? (Math.pow(currentLevel / p1, 12) - 1) * 100 : null
  const current3moAnn = p3 != null && p3 !== 0 ? (Math.pow(currentLevel / p3, 4) - 1) * 100 : null
  const current6moAnn = p6 != null && p6 !== 0 ? (Math.pow(currentLevel / p6, 2) - 1) * 100 : null

  const momValues: number[] = []
  for (let i = 0; i < 6; i += 1) {
    const dCurr = addMonths(currentDate, -i)
    const dPrev = addMonths(currentDate, -i - 1)
    const vCurr = map.get(dCurr)
    const vPrev = map.get(dPrev)
    if (vCurr != null && vPrev != null && vPrev !== 0) {
      momValues.push(((vCurr / vPrev) - 1) * 100)
    }
  }

  return {
    raw: data,
    currentLevel,
    currentDate,
    currentMoM,
    currentYoY,
    current1moAnn,
    current3moAnn,
    current6moAnn,
    past1moMoM: momValues[0] ?? 0,
    past3moAvgMoM: momValues.length >= 3 ? momValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3 : 0,
    past6moAvgMoM: momValues.length >= 6 ? momValues.reduce((a, b) => a + b, 0) / 6 : 0,
  }
}

function buildFvmYoYChartData(model: FvmSeriesModel): FvmChartPoint[] {
  if (!model.currentDate || model.raw.length === 0) return []
  const map = new Map(model.raw.map((d) => [d.date, d.value]))
  const rows: FvmChartPoint[] = []

  for (const d of model.raw) {
    const prior = map.get(addMonths(d.date, -12))
    rows.push({
      date: d.date,
      yoy: prior != null && prior !== 0 ? ((d.value / prior) - 1) * 100 : null,
      pace1m: null,
      pace3m: null,
      pace6m: null,
    })
  }

  const lastRow = rows[rows.length - 1]
  if (lastRow && model.currentYoY != null) {
    lastRow.pace1m = model.currentYoY
    lastRow.pace3m = model.currentYoY
    lastRow.pace6m = model.currentYoY
  }

  for (let n = 1; n <= 6; n += 1) {
    rows.push({
      date: addMonths(model.currentDate, n),
      yoy: null,
      pace1m: projectYoYAt(model.currentLevel, model.past1moMoM, n, map, model.currentDate),
      pace3m: projectYoYAt(model.currentLevel, model.past3moAvgMoM, n, map, model.currentDate),
      pace6m: projectYoYAt(model.currentLevel, model.past6moAvgMoM, n, map, model.currentDate),
    })
  }

  return rows
}

function buildFvmMomData(model: FvmSeriesModel): FvmMomPoint[] {
  const rows: FvmMomPoint[] = []
  for (let i = 1; i < model.raw.length; i += 1) {
    const curr = model.raw[i]
    const prev = model.raw[i - 1]
    if (prev.value === 0) continue
    rows.push({
      date: curr.date,
      mom: ((curr.value / prev.value) - 1) * 100,
    })
  }
  return rows
}

function getRangeCutoff(range: string, currentDate: string): string | null {
  if (!currentDate) return null
  switch (range) {
    case '1m':
      return addMonths(currentDate, -1)
    case '3m':
      return addMonths(currentDate, -3)
    case '6m':
      return addMonths(currentDate, -6)
    case 'ytd': {
      const [y] = currentDate.split('-')
      return `${y}-01-01`
    }
    case '1y':
      return addMonths(currentDate, -12)
    case '2y':
      return addMonths(currentDate, -24)
    case '5y':
      return addMonths(currentDate, -60)
    case 'all':
    default:
      return null
  }
}

function getDateCutoff(range: string): string | null {
  if (range === 'all') return null
  const now = new Date()
  const months: Record<string, number> = { '3m': 3, '6m': 6, '1y': 12, '5y': 60, '10y': 120 }
  const m = months[range] || 12
  now.setMonth(now.getMonth() - m)
  return now.toISOString().slice(0, 10)
}

function sortCurve(points: FuturesCurvePoint[]): FuturesCurvePoint[] {
  return [...points].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
}

function renderDeltaLabel(props: any) {
  const { x, y, width, height, value } = props
  if (value == null) return null
  const numeric = Number(value)
  return (
    <text
      x={x + width / 2}
      y={numeric >= 0 ? y - 8 : y + height + 14}
      textAnchor="middle"
      fill="#94A3B8"
      fontSize={12}
      fontFamily="var(--font-mono)"
      fontWeight={700}
    >
      {fmtBps(numeric)}
    </text>
  )
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as CurveRow | undefined
  if (!row) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{label}</div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Latest</span>
        <span className={styles.tooltipValue}>
          {row.latestPrice != null ? row.latestPrice.toFixed(3) : '—'} | {row.latestRate != null ? `${fmtRate(row.latestRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Benchmark</span>
        <span className={styles.tooltipValue}>
          {row.benchmarkPrice != null ? row.benchmarkPrice.toFixed(3) : '—'} | {row.benchmarkRate != null ? `${fmtRate(row.benchmarkRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Delta</span>
        <span className={styles.tooltipValue}>{row.deltaBps != null ? `${fmtBps(row.deltaBps)} bps` : '—'}</span>
      </div>
    </div>
  )
}

function useContractHistory(symbol: string | null, days = 60) {
  const [history, setHistory] = useState<ContractHistoryPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) {
      setHistory([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    fetch(`/api/futures/contract-history/${encodeURIComponent(symbol)}?days=${days}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return await res.json() as { history?: ContractHistoryPoint[] }
      })
      .then((data) => {
        if (cancelled) return
        setHistory(data.history ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setHistory([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol, days])

  return { history, loading }
}

export function STIRDashboardPage() {
  const [assetClass, setAssetClass] = useState<AssetClass>('rates')
  const [activeView, setActiveView] = useState<ViewTab>('pricing')
  const [country, setCountry] = useState<CountryCode>('US')
  const [commodityCategory, setCommodityCategory] = useState<CommodityCategory>('energy')
  const [energyProduct, setEnergyProduct] = useState<EnergyProduct>('crude-oil')
  const [equitySection, setEquitySection] = useState<EquitySection>('index-comparison')
  const [globalEquitySection, setGlobalEquitySection] = useState<GlobalEquitySection>('country-returns')
  const [globalFxSection, setGlobalFxSection] = useState<GlobalFxSection>('pair-returns')
  const [macroSection, setMacroSection] = useState<MacroSection>('regimes')
  const viewTabs = useMemo(() => getViewTabs(country), [country])

  // Fall back to first tab if current tab is no longer visible for this country
  useEffect(() => {
    const validKeys = viewTabs.map(t => t.key)
    if (!validKeys.includes(activeView)) {
      setActiveView(validKeys[0])
    }
  }, [country, viewTabs, activeView])

  const [product, setProduct] = useState<ProductKey>('sofr')

  // SR3 contract-history modal state
  const [modalContract, setModalContract] = useState<StripContract | null>(null)
  const [modalContractColor, setModalContractColor] = useState<string>('#e5e7eb')
  const [modalMetric, setModalMetric] = useState<'rate' | 'price'>('rate')
  const [modalRange, setModalRange] = useState<'1M' | '3M' | '6M' | '1Y' | 'ALL'>('1Y')
  const [modalShowScenarios, setModalShowScenarios] = useState(true)

  useEffect(() => {
    if (!modalContract) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalContract(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalContract])

  const modalHistory = useContractHistory(modalContract?.symbol ?? null, 9999)
  const modalChartData = useMemo(() => {
    if (modalHistory.history.length === 0) return [] as { date: string; value: number }[]
    const cutoffDays = modalRange === '1M' ? 30 : modalRange === '3M' ? 90 : modalRange === '6M' ? 180 : modalRange === '1Y' ? 365 : null
    let points = modalHistory.history
    if (cutoffDays != null) {
      const cutoffMs = Date.now() - cutoffDays * 86400000
      points = points.filter((p) => new Date(p.date).getTime() >= cutoffMs)
    }
    return points.map((p) => ({ date: p.date, value: modalMetric === 'rate' ? p.impliedRate : p.lastPrice }))
  }, [modalHistory.history, modalRange, modalMetric])

  const [fvmTab, setFvmTab] = useState<string>('cpi')
  const [fvmMeasure, setFvmMeasure] = useState<'headline' | 'core'>('headline')
  const [fvmRange, setFvmRange] = useState<string>('1y')
  const [cpiData, setCpiData] = useState<{ headline: WD[]; core: WD[] }>({ headline: [], core: [] })
  const [cpiLoading, setCpiLoading] = useState(true)
  const [cpiError, setCpiError] = useState<string | null>(null)
  const [pceData, setPceData] = useState<{ headline: WD[]; core: WD[] }>({ headline: [], core: [] })
  const [pceLoading, setPceLoading] = useState(true)
  const [pceError, setPceError] = useState<string | null>(null)
  const [ustData, setUstData] = useState<Record<string, YieldData[]>>({})
  const [ustLoading, setUstLoading] = useState(true)
  const [ustError, setUstError] = useState<string | null>(null)
  const [ustSelection, setUstSelection] = useState<UstSelection>({
    type: 'spread',
    label: '2s10s',
    longKey: 'DGS10',
    shortKey: 'DGS2',
  })
  const [ustChartRange, setUstChartRange] = useState<string>('1y')
  const [regimeLookback, setRegimeLookback] = useState(20)
  const [realSelection, setRealSelection] = useState<RealSelection>({ type: 'realYield', key: '10y', label: '10Y Real' })
  const [realChartRange, setRealChartRange] = useState<string>('1y')
  const [realRegimeLookback, setRealRegimeLookback] = useState(20)
  const [beSelection, setBeSelection] = useState<BeSelection>({ type: 'beYield', key: '10y', label: '10Y BE' })
  const [beChartRange, setBeChartRange] = useState<string>('1y')
  const [beRegimeLookback, setBeRegimeLookback] = useState(20)
  const [creditChartRange, setCreditChartRange] = useState<string>('1y')
  const [creditRegimeLookback, setCreditRegimeLookback] = useState(20)
  const [creditRocLookback, setCreditRocLookback] = useState(20)
  const [creditVisibleSeries, setCreditVisibleSeries] = useState<Record<string, boolean>>({
    'BAMLC0A1CAAA': true, 'BAMLC0A4CBBB': true, 'BAMLH0A0HYM2': true, 'BAMLH0A3HYC': true, 'TRASH': true,
  })
  const [creditOverviewRange, setCreditOverviewRange] = useState<string>('1y')
  const [attrLookback, setAttrLookback] = useState(20)
  const [attrChartRange, setAttrChartRange] = useState<string>('1y')
  const [mmRange1, setMmRange1] = useState<string>('2y')
  const [mmRange2, setMmRange2] = useState<string>('2y')
  const [mmRange3, setMmRange3] = useState<string>('2y')
  const [rdeData, setRdeData] = useState<RDEPoint[]>([])
  const [rdeSyncing, setRdeSyncing] = useState(false)
  const [rdeRange, setRdeRange] = useState<string>('all')
  const [ycLookback, setYcLookback] = useState(1)
  const [ycCompressed, setYcCompressed] = useState(false)
  const [laborData, setLaborData] = useState<{ unrate: WD[]; employment: WD[]; clf: WD[]; payems: WD[] }>({
    unrate: [],
    employment: [],
    clf: [],
    payems: [],
  })
  const [laborLoading, setLaborLoading] = useState(true)
  const [laborError, setLaborError] = useState<string | null>(null)
  const [gdpnowData, setGdpnowData] = useState<GDPNowQuarter[]>([])
  const [gdpnowLoading, setGdpnowLoading] = useState(true)
  const [gdpnowError, setGdpnowError] = useState<string | null>(null)
  const [gdpnowRange, setGdpnowRange] = useState<string>('2y')
  const [gdpnowSyncing, setGdpnowSyncing] = useState(false)
  const [gdpnowContribs, setGdpnowContribs] = useState<ContributionPoint[]>([])
  const [fedFundsHistory, setFedFundsHistory] = useState<Array<{ date: string; value: number }>>([])
  const [showFedFunds, setShowFedFunds] = useState(false)
  const [payrollScenarios, setPayrollScenarios] = useState([50, 100, 150, 200])
  const [clfGrowthRate, setClfGrowthRate] = useState(0.05)
  const [hoveredBox, setHoveredBox] = useState<'mtg' | 'term6m' | 'term12m' | null>(null)
  const [lookbackDaysInput, setLookbackDaysInput] = useState('1')
  const [showMatrix, setShowMatrix] = useState(true)

  const productConfig = PRODUCT_CONFIG[product]
  const lookbackDays = Math.max(0, Number.parseInt(lookbackDaysInput, 10) || 0)

  // Derive active market from country + product selection
  const activeMarket = useMemo(() => {
    if (country === 'US' || country === 'Global') {
      const rateLabel = product === 'sofr' ? 'CURRENT SOFR' : 'CURRENT EFFR'
      return { root: productConfig.root, title: productConfig.title, rateLabel, overnightSeries: null as string | null }
    }
    const m = COUNTRY_MARKET[country]
    return { root: m.root, title: m.title, rateLabel: m.rateLabel, overnightSeries: m.overnightSeries as string | null }
  }, [country, productConfig, product])

  const curve = useFuturesCurve(activeMarket.root, lookbackDays)
  const fedwatch = useFedWatch(activeMarket.root)
  const strip = useFuturesStrip(activeMarket.root)
  // Non-US banners read the latest overnight rate from /api/overnight-rates;
  // US continues to use fedwatch.currentEFFR (live EFFR / SOFR via FRED).
  const overnightCodes = useMemo<readonly string[]>(
    () => (activeMarket.overnightSeries ? [activeMarket.overnightSeries] : []),
    [activeMarket.overnightSeries],
  )
  const overnight = useOvernightRates(overnightCodes)
  const overnightLatest = activeMarket.overnightSeries
    ? overnight.data[activeMarket.overnightSeries] ?? null
    : null

  // Independent t-X lookback for the SR3 calendar-spreads dashboard.
  const [spreadLookbackDays, setSpreadLookbackDays] = useState(1)
  const spreadCurve = useFuturesCurve(activeMarket.root, spreadLookbackDays)

  // SR3 calendar-spread history modal (front − back time series).
  const [openSpread, setOpenSpread] = useState<{ label: string; frontSymbol: string; backSymbol: string } | null>(null)
  const [spreadModalRange, setSpreadModalRange] = useState<'1M' | '3M' | '6M' | '1Y' | 'ALL'>('1Y')

  useEffect(() => {
    if (openSpread) setSpreadModalRange('1Y')
  }, [openSpread])

  useEffect(() => {
    if (!openSpread) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenSpread(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSpread])

  const spreadFrontHistory = useContractHistory(openSpread?.frontSymbol ?? null, 9999)
  const spreadBackHistory = useContractHistory(openSpread?.backSymbol ?? null, 9999)

  const spreadModalChartData = useMemo(() => {
    if (spreadFrontHistory.history.length === 0 || spreadBackHistory.history.length === 0) return []
    const frontMap = new Map(spreadFrontHistory.history.map((p) => [p.date, p.impliedRate]))
    const merged = spreadBackHistory.history
      .filter((p) => frontMap.has(p.date))
      .map((p) => ({
        date: p.date,
        spread: +(((p.impliedRate - (frontMap.get(p.date) as number)) * 100).toFixed(4)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoffDays = spreadModalRange === '1M' ? 30 : spreadModalRange === '3M' ? 90 : spreadModalRange === '6M' ? 180 : spreadModalRange === '1Y' ? 365 : null
    if (cutoffDays == null) return merged
    const cutoffMs = Date.now() - cutoffDays * 86400000
    return merged.filter((p) => new Date(p.date).getTime() >= cutoffMs)
  }, [spreadFrontHistory.history, spreadBackHistory.history, spreadModalRange])

  // Use the SR3-style strip rendering (pack grouping, ± OCR column, Δ in bps,
  // clickable contract modal, Terminal/NextMove summary boxes) for every STIR
  // market except US Fed Funds, which keeps the simpler year-grouped layout.
  const useStirStyling = !(country === 'US' && product === 'fedfunds')

  const modalYDomain = useMemo<[number | string, number | string]>(() => {
    if (modalChartData.length === 0) return ['auto', 'auto']
    let min = Infinity
    let max = -Infinity
    for (const p of modalChartData) {
      if (p.value < min) min = p.value
      if (p.value > max) max = p.value
    }
    const pad = (max - min) * 0.05 || 0.1
    return [min - pad, max + pad]
  }, [modalChartData])

  const loading = curve.loading || fedwatch.loading
  const error = curve.error || fedwatch.error
  const stripLoading = strip.loading || fedwatch.loading
  const stripError = strip.error || fedwatch.error

  const headerTiming = useMemo(
    () => fmtDaysWeeks(curve.currentDate, curve.lookbackDate),
    [curve.currentDate, curve.lookbackDate],
  )

  const curveData = useMemo(() => {
    let latest = sortCurve(curve.currentCurve)
    // For US Fed Funds, trim stale front-end contracts — show FFM26 through FFZ27
    if (country === 'US' && product === 'fedfunds') {
      latest = latest.filter((p) => p.expiryDate >= '2026-06-01' && p.expiryDate <= '2027-12-01')
    }
    const benchmark = new Map(sortCurve(curve.lookbackCurve).map((row) => [row.symbol, row]))

    return latest.map((row, idx) => {
      const compare = benchmark.get(row.symbol)
      return {
        ticker: contractTicker(row.symbol),
        latestRate: row.impliedRate,
        benchmarkRate: compare?.impliedRate ?? null,
        latestPrice: row.lastPrice,
        benchmarkPrice: compare?.lastPrice ?? null,
        deltaBps: compare ? (row.impliedRate - compare.impliedRate) * 100 : null,
        order: idx,
      }
    })
  }, [curve.currentCurve, curve.lookbackCurve, product, country])

  const curveDomain = useMemo<[number, number]>(() => {
    const rates = curveData.flatMap((row) => [row.latestRate, row.benchmarkRate])
      .filter((value): value is number => value != null)
    if (rates.length === 0) return [0, 5]
    const min = Math.min(...rates)
    const max = Math.max(...rates)
    return [min - 0.15, max + 0.15]
  }, [curveData])

  const summaryRows = useMemo<SummaryRow[]>(() => {
    // Use meeting-based summary when FedWatch meetings are available
    if (fedwatch.meetings.length > 0) {
      return fedwatch.meetings
        .filter((meeting) => meeting.meetingDate <= '2027-12-31')
        .map((meeting) => {
          // Server returns expectedChange already in bps (decimal-rate × 10000).
          // totalBps is computed from percent-unit rates, so the × 100 there
          // converts (percent diff) → bps and is correct.
          const stepBps = meeting.expectedChange
          // meeting.effrEnd and currentPolicyRate share units (both policy in
          // shift-tree markets; both proxy otherwise). currentEFFR is always
          // the raw proxy anchor so it's not safe to use as the baseline here.
          const totalBps = (meeting.effrEnd - fedwatch.currentPolicyRate) * 100
          const tone = toneFromBps(stepBps)
          return {
            key: meeting.meetingDate,
            label: meeting.meetingMonth,
            impliedRate: meeting.effrEnd,
            stepBps,
            totalBps,
            impliedMoves: impliedMovesFromBps(totalBps),
            stepSummary: summaryFromBps(stepBps),
            totalSummary: summaryFromBps(totalBps),
            tone,
          }
        })
    }

    // Fallback: contract-based summary
    const latest = sortCurve(curve.currentCurve)
      .filter((row) => row.year <= 2029)

    return latest.map((row, idx) => {
      const prior = idx > 0 ? latest[idx - 1] : null
      const stepBps = prior ? (row.impliedRate - prior.impliedRate) * 100 : (row.impliedRate - fedwatch.currentEFFR) * 100
      const totalBps = (row.impliedRate - fedwatch.currentEFFR) * 100
      const tone = toneFromBps(stepBps)
      return {
        key: row.symbol,
        label: row.expiryLabel,
        impliedRate: row.impliedRate,
        stepBps,
        totalBps,
        impliedMoves: impliedMovesFromBps(totalBps),
        stepSummary: summaryFromBps(stepBps),
        totalSummary: summaryFromBps(totalBps),
        tone,
      }
    })
  }, [fedwatch.meetings, fedwatch.currentEFFR, curve.currentCurve])

  const overnightRow = useMemo<SummaryRow>(() => ({
    key: 'cash',
    label: 'Overnight Cash',
    // Use currentPolicyRate so this row shares units with meeting.effrEnd in
    // the SOFR (shift-tree) tab; for other tabs it equals currentEFFR.
    impliedRate: fedwatch.currentPolicyRate || fedwatch.currentEFFR,
    stepBps: 0,
    totalBps: 0,
    impliedMoves: 0,
    stepSummary: '0.0% Flat',
    totalSummary: '0.0% Flat',
    tone: 'flat',
  }), [fedwatch.currentPolicyRate, fedwatch.currentEFFR])

  const matrixRows = useMemo(() => {
    return fedwatch.cumulativeProbabilities.map((row) => {
      let maxRange = ''
      let maxValue = -1
      for (const range of fedwatch.rangeColumns) {
        const value = row.targetRanges[range] ?? 0
        if (value > maxValue) {
          maxValue = value
          maxRange = range
        }
      }
      return { ...row, maxRange }
    })
  }, [fedwatch.cumulativeProbabilities, fedwatch.rangeColumns])

  const stripContracts = strip.data?.contracts ?? []

  const stripYearGroups = useMemo(() => {
    const groups = new Map<number, StripContract[]>()
    for (const contract of stripContracts) {
      const bucket = groups.get(contract.year)
      if (bucket) {
        bucket.push(contract)
      } else {
        groups.set(contract.year, [contract])
      }
    }
    return Array.from(groups.entries())
  }, [stripContracts])

  const stripYears = useMemo(() => stripYearGroups.map(([year]) => year), [stripYearGroups])

  const stripPacks = useMemo(() => {
    return PACK_NAMES
      .map((name, idx) => ({
        name,
        color: PACK_COLORS[name],
        contracts: stripContracts.slice(idx * 4, idx * 4 + 4),
      }))
      .filter((p) => p.contracts.length > 0)
  }, [stripContracts])

  const spreadColumns = useMemo(() => {
    const shortLabel = (c: { monthCode: string; year: number }) => `${c.monthCode}${c.year % 10}`
    const STRIDES = [3, 6, 9, 12] as const

    // Build a per-stride map of `M6/U6` → historical spread bps from the lookback curve.
    const lookbackBps = (months: number): Map<string, number> => {
      const stepCount = months / 3
      const out = new Map<string, number>()
      const arr = spreadCurve.lookbackCurve
      for (let i = 0; i + stepCount < arr.length; i++) {
        const front = arr[i]
        const back = arr[i + stepCount]
        out.set(`${shortLabel(front)}/${shortLabel(back)}`, (back.impliedRate - front.impliedRate) * 100)
      }
      return out
    }

    return STRIDES.map((months) => {
      const stepCount = months / 3 // SR3 quarterly: 1 step = 3 months
      const lbMap = lookbackBps(months)
      const data: Array<{
        label: string
        frontSymbol: string
        backSymbol: string
        spreadBps: number
        lookbackBps: number | null
        change1d: number | null
        change5d: number | null
        change1m: number | null
      }> = []
      for (let i = 0; i + stepCount < stripContracts.length; i++) {
        const front = stripContracts[i]
        const back = stripContracts[i + stepCount]
        // Spread = back_rate − front_rate (positive = hike priced, negative = cut priced).
        // ΔSpread_bps = Δback_rate_bps − Δfront_rate_bps, where Δrate_bps = -100 × Δprice.
        const ch = (a: number | null, b: number | null) =>
          a != null && b != null ? -100 * (a - b) : null
        const label = `${shortLabel(front)}/${shortLabel(back)}`
        data.push({
          label,
          frontSymbol: front.symbol,
          backSymbol: back.symbol,
          spreadBps: (back.impliedRate - front.impliedRate) * 100,
          lookbackBps: lbMap.get(label) ?? null,
          change1d: ch(back.pxChg1d, front.pxChg1d),
          change5d: ch(back.pxChg5d, front.pxChg5d),
          change1m: ch(back.pxChg1m, front.pxChg1m),
        })
      }
      return { stride: months, label: `${months}MTH`, data }
    })
  }, [stripContracts, spreadCurve.lookbackCurve])

  const stripMaxAbs = useMemo(() => {
    const maxAbs = {
      pxChg1d: 0,
      pxChg5d: 0,
      pxChg1m: 0,
    }

    for (const contract of stripContracts) {
      maxAbs.pxChg1d = Math.max(maxAbs.pxChg1d, Math.abs(contract.pxChg1d ?? 0))
      maxAbs.pxChg5d = Math.max(maxAbs.pxChg5d, Math.abs(contract.pxChg5d ?? 0))
      maxAbs.pxChg1m = Math.max(maxAbs.pxChg1m, Math.abs(contract.pxChg1m ?? 0))
    }

    return maxAbs
  }, [stripContracts])

  const stripSummary = useMemo(() => {
    const isStirPack = useStirStyling

    const terminal: StripContract | null = isStirPack
      ? findTerminalContract(stripContracts)
      : stripContracts.reduce<StripContract | null>((lowest, contract) => {
          if (!lowest || contract.impliedRate < lowest.impliedRate) return contract
          return lowest
        }, null)

    // Monthly contracts (FF): 6/12 steps for 6m/12m. Quarterly (all others): 2/4 steps.
    const isMonthly = country === 'US' && product === 'fedfunds'
    const step6 = isMonthly ? 6 : 2
    const step12 = isMonthly ? 12 : 4
    const terminalIndex = terminal ? stripContracts.findIndex((contract) => contract.symbol === terminal.symbol) : -1
    const contract6m = terminalIndex >= 0 ? stripContracts[terminalIndex + step6] ?? null : null
    const contract12m = terminalIndex >= 0 ? stripContracts[terminalIndex + step12] ?? null : null

    const boxes: StripSummaryBox[] = []

    if (isStirPack && stripContracts.length >= 2) {
      const first = stripContracts[0]
      const second = stripContracts[1]
      const nextMoveBps = (first.impliedRate - second.impliedRate) * 100
      let value: string
      let tone: StripSummaryBox['tone']
      if (Math.abs(nextMoveBps) < 0.05) {
        value = 'UNCH'
        tone = 'neutral'
      } else if (nextMoveBps > 0) {
        value = 'CUT'
        tone = 'green'
      } else {
        value = 'HIKE'
        tone = 'red'
      }
      boxes.push({
        label: 'NEXT MOVE',
        value,
        sub: '',
        tone,
      })
    }

    boxes.push(
      {
        label: 'TERMINAL',
        value: terminal ? `${fmtRate(terminal.impliedRate)}%` : '—',
        sub: terminal ? `${contractTicker(terminal.symbol)}  M+${monthsForward(terminal)}` : '—',
        tone: 'teal',
      },
      {
        label: isStirPack ? 'Terminal - OCR' : 'MTG>TERM',
        value: terminal ? fmtBpsValue((terminal.impliedRate - fedwatch.currentEFFR) * 100) : '—',
        sub: isStirPack ? '' : 'terminal vs overnight cash',
        tone: !terminal ? 'neutral' : (terminal.impliedRate - fedwatch.currentEFFR) * 100 >= 0 ? 'green' : 'red',
        hoverKey: 'mtg',
      },
      {
        label: isStirPack ? '+6m - Terminal' : 'TERM>+6M',
        value: terminal && contract6m ? fmtBpsValue((contract6m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract6m ? contractTicker(contract6m.symbol) : '—',
        tone: 'gold',
        hoverKey: 'term6m',
      },
      {
        label: isStirPack ? '+12m - Terminal' : 'TERM>+12M',
        value: terminal && contract12m ? fmtBpsValue((contract12m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract12m ? contractTicker(contract12m.symbol) : '—',
        tone: 'gold',
        hoverKey: 'term12m',
      },
    )

    return { terminal, contract6m, contract12m, boxes }
  }, [stripContracts, product, country, fedwatch.currentEFFR, useStirStyling])

  const terminalHistory = useContractHistory(stripSummary.terminal?.symbol ?? null)
  const plus6mHistory = useContractHistory(stripSummary.contract6m?.symbol ?? null)
  const plus12mHistory = useContractHistory(stripSummary.contract12m?.symbol ?? null)

  const mtgSpreadData = useMemo(
    () => terminalHistory.history.map((point) => ({
      date: point.date,
      spread: (point.impliedRate - fedwatch.currentEFFR) * 100,
    })),
    [terminalHistory.history, fedwatch.currentEFFR],
  )

  const term6mSpreadData = useMemo(() => {
    const base = new Map(terminalHistory.history.map((point) => [point.date, point.impliedRate]))
    return plus6mHistory.history
      .map((point) => {
        const terminalRate = base.get(point.date)
        if (terminalRate == null) return null
        return {
          date: point.date,
          spread: (point.impliedRate - terminalRate) * 100,
        }
      })
      .filter((point): point is { date: string; spread: number } => point != null)
  }, [plus6mHistory.history, terminalHistory.history])

  const term12mSpreadData = useMemo(() => {
    const base = new Map(terminalHistory.history.map((point) => [point.date, point.impliedRate]))
    return plus12mHistory.history
      .map((point) => {
        const terminalRate = base.get(point.date)
        if (terminalRate == null) return null
        return {
          date: point.date,
          spread: (point.impliedRate - terminalRate) * 100,
        }
      })
      .filter((point): point is { date: string; spread: number } => point != null)
  }, [plus12mHistory.history, terminalHistory.history])

  useEffect(() => {
    let cancelled = false
    setCpiLoading(true)
    setCpiError(null)

    Promise.all([
      fetchFredSeries('CPIAUCSL'),
      fetchFredSeries('CPILFESL'),
    ])
      .then(([headlineObs, coreObs]) => {
        if (cancelled) return
        setCpiData({
          headline: parseObs(fillOct2025Gap(headlineObs)),
          core: parseObs(fillOct2025Gap(coreObs)),
        })
        setCpiLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setCpiError(err instanceof Error ? err.message : String(err))
        setCpiLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setPceLoading(true)
    setPceError(null)

    Promise.all([
      fetchBEASeries(1),
      fetchBEASeries(25),
    ])
      .then(([headlineObs, coreObs]) => {
        if (cancelled) return
        setPceData({
          headline: parseObs(headlineObs),
          core: parseObs(coreObs),
        })
        setPceLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setPceError(err instanceof Error ? err.message : String(err))
        setPceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setUstLoading(true)
    setUstError(null)

    const ustSeries = [...UST_TENORS, ...UST_BREAKEVENS, ...UST_EXTRA]
    Promise.all(ustSeries.map((series) => fetchFredSeries(series.key)))
      .then((seriesList) => {
        if (cancelled) return
        const next: Record<string, YieldData[]> = {}
        seriesList.forEach((series, idx) => {
          next[ustSeries[idx].key] = parseObs(series)
        })
        setUstData(next)
        setUstLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setUstError(err instanceof Error ? err.message : String(err))
        setUstLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    fetchFredSeries('DFF')
      .then((data) => setFedFundsHistory(data.map((d: FredObservation) => ({ date: d.date, value: Number(d.value) })).filter((d: { value: number }) => !isNaN(d.value))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLaborLoading(true)
    setLaborError(null)

    Promise.all([
      fetchFredSeries('UNRATE'),
      fetchFredSeries('CE16OV'),
      fetchFredSeries('CLF16OV'),
      fetchFredSeries('PAYEMS'),
    ])
      .then(([unrateObs, employmentObs, clfObs, payemsObs]) => {
        if (cancelled) return
        setLaborData({
          unrate: parseObs(fillOct2025Gap(unrateObs)),
          employment: parseObs(fillOct2025Gap(employmentObs)),
          clf: parseObs(fillOct2025Gap(clfObs)),
          payems: parseObs(fillOct2025Gap(payemsObs)),
        })
        setLaborLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLaborError(err instanceof Error ? err.message : String(err))
        setLaborLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setGdpnowLoading(true)
    setGdpnowError(null)

    fetch('/api/gdpnow')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return await res.json() as unknown
      })
      .then((data) => {
        if (cancelled) return
        setGdpnowData(Array.isArray(data) ? data as GDPNowQuarter[] : [])
        setGdpnowLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setGdpnowError(err instanceof Error ? err.message : String(err))
        setGdpnowLoading(false)
      })

    fetch('/api/gdpnow/contributions')
      .then((r) => r.json() as Promise<unknown>)
      .then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) setGdpnowContribs(data as ContributionPoint[])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    fetch('/api/rde')
      .then((r) => r.json() as Promise<unknown>)
      .then((data) => { if (Array.isArray(data)) setRdeData(data as RDEPoint[]) })
      .catch(() => {})
  }, [])

  async function handleRdeRefresh() {
    setRdeSyncing(true)
    try {
      await fetch('/api/rde/sync', { method: 'POST' })
      const res = await fetch('/api/rde')
      const data = await res.json() as unknown
      if (Array.isArray(data)) setRdeData(data as RDEPoint[])
    } catch (err) {
      console.error('RDE sync failed:', err)
    }
    setRdeSyncing(false)
  }

  async function handleGdpnowRefresh() {
    setGdpnowSyncing(true)
    try {
      await fetch('/api/gdpnow/sync', { method: 'POST' })
      const [res, contribRes] = await Promise.all([
        fetch('/api/gdpnow'),
        fetch('/api/gdpnow/contributions'),
      ])
      const data = await res.json() as unknown
      if (Array.isArray(data)) setGdpnowData(data as GDPNowQuarter[])
      const contribData = await contribRes.json() as unknown
      if (Array.isArray(contribData)) setGdpnowContribs(contribData as ContributionPoint[])
    } catch (err) {
      console.error('GDPNow sync failed:', err)
    }
    setGdpnowSyncing(false)
  }

  const activeCpiSeries = useMemo(
    () => (fvmMeasure === 'headline' ? cpiData.headline : cpiData.core),
    [cpiData, fvmMeasure],
  )

  const activePceSeries = useMemo(
    () => (fvmMeasure === 'headline' ? pceData.headline : pceData.core),
    [pceData, fvmMeasure],
  )

  const fvmCpiModel = useMemo(() => buildFvmModel(activeCpiSeries), [activeCpiSeries])
  const fvmCpiYoYData = useMemo(() => buildFvmYoYChartData(fvmCpiModel), [fvmCpiModel])
  const fvmCpiMomData = useMemo(() => buildFvmMomData(fvmCpiModel), [fvmCpiModel])
  const fvmPceModel = useMemo(() => buildFvmModel(activePceSeries), [activePceSeries])
  const fvmPceYoYData = useMemo(() => buildFvmYoYChartData(fvmPceModel), [fvmPceModel])
  const fvmPceMomData = useMemo(() => buildFvmMomData(fvmPceModel), [fvmPceModel])
  const laborProjection = useMemo<LaborProjectionModel | null>(() => {
    if (!laborData.employment.length || !laborData.clf.length || !laborData.unrate.length) return null

    const latestEmployment = laborData.employment[laborData.employment.length - 1]
    const latestClf = laborData.clf[laborData.clf.length - 1]
    const latestU3 = laborData.unrate[laborData.unrate.length - 1]

    return {
      currentU3: latestU3.value,
      latestDate: latestEmployment.date,
      currentEmployment: latestEmployment.value,
      currentClf: latestClf.value,
      scenarios: payrollScenarios.map((monthlyGain) => ({
        label: `${monthlyGain}k`,
        points: Array.from({ length: 12 }, (_, idx) => {
          const n = idx + 1
          const projEmp = latestEmployment.value + (monthlyGain * n)
          const projClf = latestClf.value * Math.pow(1 + clfGrowthRate / 100, n)
          return {
            date: addMonths(latestEmployment.date, n),
            value: ((projClf - projEmp) / projClf) * 100,
          }
        }),
      })),
    }
  }, [laborData, payrollScenarios, clfGrowthRate])

  const activeFvmModel = fvmTab === 'pce' ? fvmPceModel : fvmCpiModel
  const activeFvmYoYData = fvmTab === 'pce' ? fvmPceYoYData : fvmCpiYoYData
  const activeFvmMomData = fvmTab === 'pce' ? fvmPceMomData : fvmCpiMomData

  const fvmRangeCutoff = useMemo(() => getRangeCutoff(fvmRange, activeFvmModel.currentDate), [fvmRange, activeFvmModel.currentDate])

  const fedFundsMonthly = useMemo(() => {
    if (fedFundsHistory.length === 0) return new Map<string, number>()
    const monthMap = new Map<string, number[]>()
    for (const p of fedFundsHistory) {
      const mk = p.date.slice(0, 7) + '-01'
      if (!monthMap.has(mk)) monthMap.set(mk, [])
      monthMap.get(mk)!.push(p.value)
    }
    const result = new Map<string, number>()
    for (const [date, values] of monthMap) {
      result.set(date, values.reduce((a, b) => a + b, 0) / values.length)
    }
    return result
  }, [fedFundsHistory])

  const fvmFilteredYoYData = useMemo(
    () => activeFvmYoYData.filter((row) => !fvmRangeCutoff || row.date >= fvmRangeCutoff || row.date > activeFvmModel.currentDate),
    [activeFvmYoYData, fvmRangeCutoff, activeFvmModel.currentDate],
  )

  const fvmFilteredMomData = useMemo(
    () => activeFvmMomData.filter((row) => !fvmRangeCutoff || row.date >= fvmRangeCutoff),
    [activeFvmMomData, fvmRangeCutoff],
  )

  const fvmYoYDataWithFF = useMemo(() => {
    if (!showFedFunds) return fvmFilteredYoYData
    return fvmFilteredYoYData.map((row) => ({
      ...row,
      fedFunds: fedFundsMonthly.get(row.date) ?? null,
    }))
  }, [fvmFilteredYoYData, fedFundsMonthly, showFedFunds])

  const fvmYoYDomain = useMemo<[number, number]>(() => {
    const yoyValues = fvmYoYDataWithFF
      .flatMap((d) => [d.yoy, d.pace1m, d.pace3m, d.pace6m, ...(showFedFunds ? [(d as unknown as { fedFunds?: number | null }).fedFunds ?? null] : [])])
      .filter((v): v is number => v != null)
    const allValues = [...yoyValues, 2]
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const padding = (max - min) * 0.1 || 0.2
    return [min - padding, max + padding]
  }, [fvmYoYDataWithFF, showFedFunds])

  const fvmMomDomain = useMemo<[number, number]>(() => {
    const momValues = fvmFilteredMomData.map((d) => d.mom).filter((v): v is number => v != null)
    const min = Math.min(...momValues)
    const max = Math.max(...momValues)
    const padding = (max - min) * 0.1 || 0.05
    return [min - padding, max + padding]
  }, [fvmFilteredMomData])

  const laborRangeCutoff = useMemo(
    () => getRangeCutoff(fvmRange, laborProjection?.latestDate ?? ''),
    [fvmRange, laborProjection?.latestDate],
  )

  const laborChartData = useMemo<LaborChartPoint[]>(() => {
    if (!laborProjection) return []

    const rows = laborData.unrate
      .filter((point) => !laborRangeCutoff || point.date >= laborRangeCutoff)
      .map<LaborChartPoint>((point) => ({
        date: point.date,
        historical: point.value,
        scenario0: null,
        scenario1: null,
        scenario2: null,
        scenario3: null,
      }))

    const lastHistorical = rows[rows.length - 1]
    if (lastHistorical) {
      lastHistorical.scenario0 = laborProjection.currentU3
      lastHistorical.scenario1 = laborProjection.currentU3
      lastHistorical.scenario2 = laborProjection.currentU3
      lastHistorical.scenario3 = laborProjection.currentU3
    }

    laborProjection.scenarios.forEach((scenario, index) => {
      scenario.points.forEach((point) => {
        rows.push({
          date: point.date,
          historical: null,
          scenario0: index === 0 ? point.value : null,
          scenario1: index === 1 ? point.value : null,
          scenario2: index === 2 ? point.value : null,
          scenario3: index === 3 ? point.value : null,
        })
      })
    })

    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [laborData.unrate, laborProjection, laborRangeCutoff])

  const laborChartDataWithFF = useMemo(() => {
    if (!showFedFunds) return laborChartData
    return laborChartData.map((row) => ({
      ...row,
      fedFunds: fedFundsMonthly.get(row.date) ?? null,
    }))
  }, [laborChartData, fedFundsMonthly, showFedFunds])

  const laborDomain = useMemo<[number, number]>(() => {
    const values = laborChartDataWithFF
      .flatMap((row) => [row.historical, row.scenario0, row.scenario1, row.scenario2, row.scenario3, ...(showFedFunds ? [(row as unknown as { fedFunds?: number | null }).fedFunds ?? null] : [])])
      .filter((value): value is number => value != null)
    if (!values.length) return [0, 10]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const padding = (max - min) * 0.1 || 0.2
    return [min - padding, max + padding]
  }, [laborChartDataWithFF, showFedFunds])

  const payrollYoY = useMemo<PayrollYoYPoint[]>(() => {
    const data = laborData.payems
    if (data.length < 13) return []
    return data.slice(12).map((point, idx) => {
      const prior = data[idx]
      return {
        date: point.date,
        yoy: ((point.value / prior.value) - 1) * 100,
      }
    })
  }, [laborData.payems])

  const payrollMoM = useMemo<PayrollMomPoint[]>(() => {
    const data = laborData.payems
    if (data.length < 2) return []

    const momSeries = data.slice(1).map((point, idx) => {
      const prior = data[idx]
      return {
        date: point.date,
        mom: point.value - prior.value,
      }
    })

    return momSeries.map((point, idx) => {
      let ma3: number | null = null
      let ma6: number | null = null

      if (idx >= 2) {
        ma3 = (momSeries[idx].mom + momSeries[idx - 1].mom + momSeries[idx - 2].mom) / 3
      }
      if (idx >= 5) {
        let sum = 0
        for (let i = 0; i < 6; i += 1) sum += momSeries[idx - i].mom
        ma6 = sum / 6
      }

      return { date: point.date, mom: point.mom, ma3, ma6 }
    })
  }, [laborData.payems])

  const filteredPayrollYoY = useMemo(
    () => payrollYoY.filter((row) => !laborRangeCutoff || row.date >= laborRangeCutoff),
    [payrollYoY, laborRangeCutoff],
  )

  const filteredPayrollMoM = useMemo(
    () => payrollMoM.filter((row) => !laborRangeCutoff || row.date >= laborRangeCutoff),
    [payrollMoM, laborRangeCutoff],
  )

  const payrollYoYDomain = useMemo<[number, number]>(() => {
    const values = filteredPayrollYoY.map((row) => row.yoy).filter((value): value is number => value != null)
    if (!values.length) return [-1, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const padding = (max - min) * 0.1 || 0.1
    return [min - padding, max + padding]
  }, [filteredPayrollYoY])

  const payrollMoMDomain = useMemo<[number, number]>(() => {
    const values = filteredPayrollMoM
      .flatMap((row) => [row.mom, row.ma3, row.ma6])
      .filter((value): value is number => value != null)
    if (!values.length) return [-0.5, 0.5]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const padding = (max - min) * 0.1 || 0.05
    return [min - padding, max + padding]
  }, [filteredPayrollMoM])

  const gdpnowChartData = useMemo(() => {
    if (gdpnowData.length === 0) {
      return { merged: [] as Array<Record<string, string | number | null>>, quarters: [] as string[] }
    }

    // Compute date cutoff based on range
    let cutoffDate = ''
    if (gdpnowRange !== 'all') {
      const now = new Date()
      const monthsBack: Record<string, number> = { '6m': 6, '1y': 12, '2y': 24, '5y': 60 }
      const months = monthsBack[gdpnowRange] ?? 24
      now.setMonth(now.getMonth() - months)
      cutoffDate = now.toISOString().slice(0, 10)
    }

    // Sort quarters chronologically ("Q1 2024" < "Q2 2024" < "Q1 2025")
    const parseQ = (s: string) => {
      const m = s.match(/Q(\d)\s+(\d{4})/)
      return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0
    }
    const sortedQuarters = [...gdpnowData].sort((a, b) => parseQ(a.quarter) - parseQ(b.quarter))

    const allDates = new Set<string>()
    for (const quarter of sortedQuarters) {
      for (const forecast of quarter.forecasts) {
        if (cutoffDate && forecast.forecastDate < cutoffDate) continue
        allDates.add(forecast.forecastDate)
      }
    }

    const sortedDates = [...allDates].sort()

    // Only include quarters that have data in the visible range
    const activeQuarters = sortedQuarters.filter((q) =>
      q.forecasts.some((f) => !cutoffDate || f.forecastDate >= cutoffDate)
    )

    const merged = sortedDates.map<Record<string, string | number | null>>((date) => {
      const point: Record<string, string | number | null> = { date }
      for (const quarter of activeQuarters) {
        const match = quarter.forecasts.find((forecast) => forecast.forecastDate === date)
        point[quarter.quarter] = match ? match.value : null
      }
      return point
    })

    return {
      merged,
      quarters: activeQuarters.map((quarter) => quarter.quarter),
    }
  }, [gdpnowData, gdpnowRange])

  const gdpnowLatest = useMemo(() => {
    let latest: { quarter: string; forecastDate: string; value: number } | null = null
    for (const quarter of gdpnowData) {
      for (const forecast of quarter.forecasts) {
        if (!latest || forecast.forecastDate > latest.forecastDate) {
          latest = {
            quarter: quarter.quarter,
            forecastDate: forecast.forecastDate,
            value: forecast.value,
          }
        }
      }
    }
    return latest
  }, [gdpnowData])

  const contribChartData = useMemo(() => {
    return gdpnowContribs.map((row) => ({
      date: row.forecast_date,
      gdp: row.gdp,
      pce: row.pce ?? 0,
      equipment: row.equipment ?? 0,
      intell_prop: row.intell_prop ?? 0,
      nonres_struct: row.nonres_struct ?? 0,
      resid_invest: row.resid_invest ?? 0,
      govt: row.govt ?? 0,
      net_exports: row.net_exports ?? 0,
    }))
  }, [gdpnowContribs])

  const ycCurveData = useMemo(() => {
    return YC_TENORS.map((tenor) => {
      const series = ustData[tenor.key] || []
      if (series.length < 2) return { ...tenor, latest: null as number | null, offset: null as number | null, delta: null as number | null }
      const latest = series[series.length - 1]
      const offsetIdx = Math.max(0, series.length - 1 - ycLookback)
      const offset = series[offsetIdx]
      const latestVal = latest?.value ?? null
      const offsetVal = offset?.value ?? null
      const delta = latestVal != null && offsetVal != null ? (latestVal - offsetVal) * 100 : null
      return { ...tenor, latest: latestVal, offset: offsetVal, delta }
    })
  }, [ustData, ycLookback])

  const ycLatestDate = useMemo(() => {
    const series = ustData['DGS10'] || []
    return series.length > 0 ? series[series.length - 1].date : '—'
  }, [ustData])

  const ycOffsetDate = useMemo(() => {
    const series = ustData['DGS10'] || []
    const idx = Math.max(0, series.length - 1 - ycLookback)
    return series.length > 0 ? series[idx].date : '—'
  }, [ustData, ycLookback])

  const ycYDomain = useMemo((): [number, number] => {
    const vals = ycCurveData.flatMap((d) => [d.latest, d.offset]).filter((v): v is number => v != null)
    if (vals.length === 0) return [0, 5]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.15 || 0.2
    return [min - pad, max + pad]
  }, [ycCurveData])

  const currentYields = useMemo(() => {
    return UST_TENORS.map((tenor) => {
      const series = ustData[tenor.key] || []
      if (series.length < 2) {
        return { ...tenor, current: null, prior: null, change: null, date: '' }
      }
      const current = series[series.length - 1].value
      const prior = series[series.length - 2].value
      return {
        ...tenor,
        current,
        prior,
        change: current - prior,
        date: series[series.length - 1].date,
      }
    })
  }, [ustData])

  const historicalChanges = useMemo(() => {
    const rows = UST_TENORS.map(t => {
      const series = ustData[t.key] || []
      const cells = HIST_LOOKBACKS.map(lb => ({
        lookback: lb.label,
        bps: histLookbackChange(series, lb.tradingDays),
      }))
      return { rowLabel: t.label, cells }
    })

    // Per-column normalization: each lookback column has its own |bps| scale,
    // so a 5D move and a YTD move don't compete on the same axis.
    const colMaxAbs: Record<string, number> = {}
    for (const lb of HIST_LOOKBACKS) {
      let max = 0
      for (const r of rows) {
        const cell = r.cells.find(c => c.lookback === lb.label)
        if (cell?.bps != null && Number.isFinite(cell.bps)) {
          const a = Math.abs(cell.bps)
          if (a > max) max = a
        }
      }
      colMaxAbs[lb.label] = max
    }

    let latestDate = ''
    for (const t of UST_TENORS) {
      const s = ustData[t.key] || []
      if (s.length > 0 && s[s.length - 1].date > latestDate) latestDate = s[s.length - 1].date
    }
    return { rows, colMaxAbs, latestDate }
  }, [ustData])

  const currentSpreads = useMemo(() => {
    return UST_SPREADS.map((spread) => {
      const longSeries = ustData[spread.long] || []
      const shortSeries = ustData[spread.short] || []
      if (longSeries.length < 2 || shortSeries.length < 2) {
        return { ...spread, current: null, prior: null, change: null }
      }

      const longCurrent = longSeries[longSeries.length - 1].value
      const shortCurrent = shortSeries[shortSeries.length - 1].value
      const longPrior = longSeries[longSeries.length - 2].value
      const shortPrior = shortSeries[shortSeries.length - 2].value
      const current = (longCurrent - shortCurrent) * 100
      const prior = (longPrior - shortPrior) * 100

      return {
        ...spread,
        current,
        prior,
        change: current - prior,
      }
    })
  }, [ustData])

  const realYieldData = useMemo(() => {
    const dgs5 = ustData.DGS5 || []
    const dgs10 = ustData.DGS10 || []
    const t5yie = ustData.T5YIE || []
    const t10yie = ustData.T10YIE || []

    const be5Map = new Map(t5yie.map((point) => [point.date, point.value]))
    const be10Map = new Map(t10yie.map((point) => [point.date, point.value]))

    const real5y = dgs5
      .filter((point) => be5Map.has(point.date))
      .map((point) => ({
        date: point.date,
        value: point.value - be5Map.get(point.date)!,
      }))

    const real10y = dgs10
      .filter((point) => be10Map.has(point.date))
      .map((point) => ({
        date: point.date,
        value: point.value - be10Map.get(point.date)!,
      }))

    const real5Map = new Map(real5y.map((point) => [point.date, point.value]))
    const realSpread = real10y
      .filter((point) => real5Map.has(point.date))
      .map((point) => ({
        date: point.date,
        value: (point.value - real5Map.get(point.date)!) * 100,
        longYield: point.value,
        shortYield: real5Map.get(point.date)!,
      }))

    return { real5y, real10y, realSpread }
  }, [ustData])

  const beRealChanges = useMemo(() => {
    const seriesByKey: Record<string, { date: string; value: number }[]> = {
      T5YIE:   ustData.T5YIE   || [],
      T10YIE:  ustData.T10YIE  || [],
      real5y:  realYieldData.real5y,
      real10y: realYieldData.real10y,
    }
    const rows = BE_REAL_ROWS.map(r => {
      const series = seriesByKey[r.key] || []
      const cells = HIST_LOOKBACKS.map(lb => ({
        lookback: lb.label,
        bps: histLookbackChange(series, lb.tradingDays),
      }))
      return { rowLabel: r.label, cells }
    })

    // Per-column normalization, computed independently from the
    // historicalChanges grid (BE/Real moves are typically smaller than
    // nominal yield moves; mixing scales would crush this grid).
    const colMaxAbs: Record<string, number> = {}
    for (const lb of HIST_LOOKBACKS) {
      let max = 0
      for (const r of rows) {
        const cell = r.cells.find(c => c.lookback === lb.label)
        if (cell?.bps != null && Number.isFinite(cell.bps)) {
          const a = Math.abs(cell.bps)
          if (a > max) max = a
        }
      }
      colMaxAbs[lb.label] = max
    }

    let latestDate = ''
    for (const r of BE_REAL_ROWS) {
      const s = seriesByKey[r.key] || []
      if (s.length > 0 && s[s.length - 1].date > latestDate) latestDate = s[s.length - 1].date
    }
    return { rows, colMaxAbs, latestDate }
  }, [ustData, realYieldData])

  const attrChartData = useMemo(() => {
    const nominal = ustData['DGS5'] || []
    const breakeven = ustData['T5YIE'] || []
    const real5y = realYieldData.real5y || []
    if (nominal.length === 0 || breakeven.length === 0 || real5y.length === 0) return []

    const beMap = new Map(breakeven.map((p) => [p.date, p.value]))
    const realMap = new Map(real5y.map((p) => [p.date, p.value]))

    const aligned = nominal
      .filter((p) => beMap.has(p.date) && realMap.has(p.date))
      .map((p) => ({ date: p.date, nominal: p.value, breakeven: beMap.get(p.date)!, real: realMap.get(p.date)! }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoff = getDateCutoff(attrChartRange)
    const filtered = cutoff ? aligned.filter((p) => p.date >= cutoff) : aligned

    return filtered.map((point) => {
      const fullIdx = aligned.findIndex((c) => c.date === point.date)
      const lookbackIdx = fullIdx - attrLookback
      if (lookbackIdx < 0) return { date: point.date, nominalChg: null as number | null, beChg: null as number | null, realChg: null as number | null }
      const prior = aligned[lookbackIdx]
      return {
        date: point.date,
        nominalChg: (point.nominal - prior.nominal) * 100,
        beChg: (point.breakeven - prior.breakeven) * 100,
        realChg: (point.real - prior.real) * 100,
      }
    })
  }, [ustData, realYieldData, attrLookback, attrChartRange])

  const attr10yChartData = useMemo(() => {
    const nominal = ustData['DGS10'] || []
    const breakeven = ustData['T10YIE'] || []
    const real10y = realYieldData.real10y || []
    if (nominal.length === 0 || breakeven.length === 0 || real10y.length === 0) return []

    const beMap = new Map(breakeven.map((p) => [p.date, p.value]))
    const realMap = new Map(real10y.map((p) => [p.date, p.value]))

    const aligned = nominal
      .filter((p) => beMap.has(p.date) && realMap.has(p.date))
      .map((p) => ({ date: p.date, nominal: p.value, breakeven: beMap.get(p.date)!, real: realMap.get(p.date)! }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoff = getDateCutoff(attrChartRange)
    const filtered = cutoff ? aligned.filter((p) => p.date >= cutoff) : aligned

    return filtered.map((point) => {
      const fullIdx = aligned.findIndex((c) => c.date === point.date)
      const lookbackIdx = fullIdx - attrLookback
      if (lookbackIdx < 0) return { date: point.date, nominalChg: null as number | null, beChg: null as number | null, realChg: null as number | null }
      const prior = aligned[lookbackIdx]
      return {
        date: point.date,
        nominalChg: (point.nominal - prior.nominal) * 100,
        beChg: (point.breakeven - prior.breakeven) * 100,
        realChg: (point.real - prior.real) * 100,
      }
    })
  }, [ustData, realYieldData, attrLookback, attrChartRange])

  const iorbCombined = useMemo(() => {
    const ioer = ustData['IOER'] || []
    const iorb = ustData['IORB'] || []
    const iorbDates = new Set(iorb.map((p) => p.date))
    return [...ioer.filter((p) => !iorbDates.has(p.date)), ...iorb].sort((a, b) => a.date.localeCompare(b.date))
  }, [ustData])

  const moneyMarketSpreads = useMemo(() => {
    const effr = fedFundsHistory // DFF series, already fetched
    const sofr = ustData['SOFR'] || []

    const effrMap = new Map(effr.map((p) => [p.date, p.value]))
    const sofrMap = new Map(sofr.map((p) => [p.date, p.value]))
    const iorbMap = new Map(iorbCombined.map((p) => [p.date, p.value]))

    const allDates = new Set<string>()
    effr.forEach((p) => allDates.add(p.date))
    sofr.forEach((p) => allDates.add(p.date))
    iorbCombined.forEach((p) => allDates.add(p.date))

    return [...allDates].sort().map((date) => ({
      date,
      sofrIorb: sofrMap.has(date) && iorbMap.has(date) ? (sofrMap.get(date)! - iorbMap.get(date)!) * 100 : null,
      effrIorb: effrMap.has(date) && iorbMap.has(date) ? (effrMap.get(date)! - iorbMap.get(date)!) * 100 : null,
      sofrEffr: sofrMap.has(date) && effrMap.has(date) ? (sofrMap.get(date)! - effrMap.get(date)!) * 100 : null,
    }))
  }, [ustData, iorbCombined, fedFundsHistory])

  const mmData1 = useMemo(() => {
    const cutoff = getDateCutoff(mmRange1)
    return (cutoff ? moneyMarketSpreads.filter((p) => p.date >= cutoff) : moneyMarketSpreads).filter((p) => p.sofrIorb != null)
  }, [moneyMarketSpreads, mmRange1])

  const mmData2 = useMemo(() => {
    const cutoff = getDateCutoff(mmRange2)
    return (cutoff ? moneyMarketSpreads.filter((p) => p.date >= cutoff) : moneyMarketSpreads).filter((p) => p.effrIorb != null)
  }, [moneyMarketSpreads, mmRange2])

  const mmData3 = useMemo(() => {
    const cutoff = getDateCutoff(mmRange3)
    return (cutoff ? moneyMarketSpreads.filter((p) => p.date >= cutoff) : moneyMarketSpreads).filter((p) => p.sofrEffr != null)
  }, [moneyMarketSpreads, mmRange3])

  const rdeChartData = useMemo(() => {
    const cutoff = getDateCutoff(rdeRange)
    return cutoff ? rdeData.filter((p) => p.date >= cutoff) : rdeData
  }, [rdeData, rdeRange])

  const realYields = useMemo(() => {
    function getLatest(series: Array<{ date: string; value: number }>) {
      if (series.length < 2) return { current: null, change: null, date: null }
      const current = series[series.length - 1].value
      const prior = series[series.length - 2].value
      return { current, change: current - prior, date: series[series.length - 1].date }
    }

    return {
      real5y: getLatest(realYieldData.real5y),
      real10y: getLatest(realYieldData.real10y),
      realSpread: getLatest(realYieldData.realSpread),
    }
  }, [realYieldData])

  const breakevensData = useMemo(() => {
    const be5y = ustData.T5YIE || []
    const be10y = ustData.T10YIE || []

    const be5Map = new Map(be5y.map((point) => [point.date, point.value]))
    const beSpread = be10y
      .filter((point) => be5Map.has(point.date))
      .map((point) => ({
        date: point.date,
        value: (point.value - be5Map.get(point.date)!) * 100,
        longYield: point.value,
        shortYield: be5Map.get(point.date)!,
      }))

    return { be5y, be10y, beSpread }
  }, [ustData])

  const breakevens = useMemo(() => {
    function getLatest(series: Array<{ date: string; value: number }>) {
      if (series.length < 2) return { current: null, change: null }
      const current = series[series.length - 1].value
      const prior = series[series.length - 2].value
      return { current, change: current - prior }
    }

    return {
      be5y: getLatest(breakevensData.be5y),
      be10y: getLatest(breakevensData.be10y),
      beSpread: getLatest(breakevensData.beSpread),
    }
  }, [breakevensData])

  const ustChartData = useMemo(() => {
    if (!ustSelection || ustSelection.type !== 'yield') return []
    const cutoff = getDateCutoff(ustChartRange)
    const series = ustData[ustSelection.key] || []
    return series
      .filter((point) => !cutoff || point.date >= cutoff)
      .map((point) => ({ date: point.date, value: point.value }))
  }, [ustSelection, ustData, ustChartRange])

  const ustSpreadChartData = useMemo((): SpreadChartPoint[] => {
    if (!ustSelection || ustSelection.type !== 'spread') return []
    const shortSeries = ustData[ustSelection.shortKey] || []
    const longSeries = ustData[ustSelection.longKey] || []
    if (shortSeries.length === 0 || longSeries.length === 0) return []
    const full = buildSpreadChartData(shortSeries, longSeries, regimeLookback)
    const cutoff = getDateCutoff(ustChartRange)
    return cutoff ? full.filter(p => p.date >= cutoff) : full
  }, [ustSelection, ustData, ustChartRange, regimeLookback])

  const currentButterflies = useMemo(() => {
    return BUTTERFLIES.map((fly) => {
      const lowS = ustData[fly.low] || []
      const midS = ustData[fly.middle] || []
      const highS = ustData[fly.high] || []
      if (lowS.length < 2 || midS.length < 2 || highS.length < 2) return { ...fly, current: null as number | null, prior: null as number | null, change: null as number | null }
      const cur = (2 * midS[midS.length - 1].value - highS[highS.length - 1].value - lowS[lowS.length - 1].value) * 100
      const pri = (2 * midS[midS.length - 2].value - highS[highS.length - 2].value - lowS[lowS.length - 2].value) * 100
      return { ...fly, current: cur, prior: pri, change: cur - pri }
    })
  }, [ustData])

  const butterflyChartData = useMemo(() => {
    if (!ustSelection || ustSelection.type !== 'butterfly') return []
    const lowS = ustData[ustSelection.lowKey] || []
    const midS = ustData[ustSelection.middleKey] || []
    const highS = ustData[ustSelection.highKey] || []
    const midMap = new Map(midS.map((p) => [p.date, p.value]))
    const highMap = new Map(highS.map((p) => [p.date, p.value]))
    const cutoff = getDateCutoff(ustChartRange)
    return lowS
      .filter((p) => midMap.has(p.date) && highMap.has(p.date))
      .filter((p) => !cutoff || p.date >= cutoff)
      .map((p) => ({
        date: p.date,
        value: (2 * midMap.get(p.date)! - highMap.get(p.date)! - p.value) * 100,
      }))
  }, [ustSelection, ustData, ustChartRange])

  const creditChartData = useMemo(() => {
    const hyOas = ustData['BAMLH0A0HYM2'] || []
    const dgs2 = ustData['DGS2'] || []
    const dgs10 = ustData['DGS10'] || []
    if (hyOas.length === 0 || dgs2.length === 0 || dgs10.length === 0) return []

    const map2 = new Map(dgs2.map((p) => [p.date, p.value]))
    const map10 = new Map(dgs10.map((p) => [p.date, p.value]))

    const aligned = hyOas
      .filter((p) => map2.has(p.date) && map10.has(p.date))
      .map((p) => ({
        date: p.date,
        oas: p.value,
        yield2y: map2.get(p.date)!,
        yield10y: map10.get(p.date)!,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoff = getDateCutoff(creditChartRange)
    const filtered = cutoff ? aligned.filter((p) => p.date >= cutoff) : aligned

    return filtered.map((point) => {
      const fullIdx = aligned.findIndex((c) => c.date === point.date)
      const lookbackIdx = fullIdx - creditRegimeLookback
      if (lookbackIdx < 0) return { ...point, regime: null as string | null }

      const prior = aligned[lookbackIdx]
      const shortChange = point.yield2y - prior.yield2y
      const longChange = point.yield10y - prior.yield10y
      const spreadNow = (point.yield10y - point.yield2y) * 100
      const spreadThen = (prior.yield10y - prior.yield2y) * 100
      const spreadChange = spreadNow - spreadThen

      let regime: string
      if (spreadChange > 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Steepener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Steepener'
        else regime = 'Steepener Twist'
      } else if (spreadChange < 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Flattener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Flattener'
        else regime = 'Flattener Twist'
      } else {
        regime = 'Neutral'
      }
      return { ...point, regime }
    })
  }, [ustData, creditChartRange, creditRegimeLookback])

  const creditSpreadDashboard = useMemo(() => {
    const lookbacks = [
      { label: '1D', offset: 1 },
      { label: '5D', offset: 5 },
      { label: '20D', offset: 20 },
      { label: '60D', offset: 60 },
      { label: '120D', offset: 120 },
      { label: 'YTD', offset: -1 },
    ]

    function getValueAtOffset(series: Array<{ date: string; value: number }>, offset: number): number | null {
      if (offset === -1) {
        if (series.length === 0) return null
        const latestYear = parseInt(series[series.length - 1].date.slice(0, 4))
        const prevYearEnd = `${latestYear - 1}-12-31`
        for (let i = series.length - 1; i >= 0; i--) {
          if (series[i].date <= prevYearEnd) return series[i].value
        }
        return null
      }
      const idx = series.length - 1 - offset
      return idx < 0 ? null : series[idx].value
    }

    const cccSeries = ustData['BAMLH0A3HYC'] || []
    const hySeries = ustData['BAMLH0A0HYM2'] || []
    const hyMap = new Map(hySeries.map((p) => [p.date, p.value]))
    const trashSeries = cccSeries
      .filter((p) => hyMap.has(p.date))
      .map((p) => ({ date: p.date, value: (p.value - hyMap.get(p.date)!) * 100 }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return CREDIT_SPREADS.map((spread) => {
      let series: Array<{ date: string; value: number }>
      let isBps = false
      if (spread.key === 'TRASH') {
        series = trashSeries
        isBps = true
      } else {
        series = (ustData[spread.key] || []).slice().sort((a, b) => a.date.localeCompare(b.date))
      }
      if (series.length === 0) return { ...spread, current: null as number | null, changes: lookbacks.map(() => null as number | null) }

      const current = series[series.length - 1].value
      const currentBps = isBps ? current : current * 100

      const changes = lookbacks.map((lb) => {
        const priorVal = getValueAtOffset(series, lb.offset)
        if (priorVal == null) return null
        return isBps ? current - priorVal : (current - priorVal) * 100
      })

      return { ...spread, current: currentBps, changes }
    })
  }, [ustData])

  const creditColumnShading = useMemo(() => {
    return Array.from({ length: 6 }, (_, col) => {
      const absVals = creditSpreadDashboard.map((r) => r.changes[col]).filter((v): v is number => v != null).map(Math.abs)
      const max = absVals.length > 0 ? Math.max(...absVals) : 0
      return max
    })
  }, [creditSpreadDashboard])

  function getCreditCellBg(value: number | null, colIdx: number): string {
    if (value == null || value === 0) return 'transparent'
    const max = creditColumnShading[colIdx]
    if (!max) return 'transparent'
    const alpha = 0.05 + (Math.abs(value) / max) * 0.2
    return value > 0
      ? `rgba(239, 83, 80, ${alpha.toFixed(3)})`
      : `rgba(78, 201, 176, ${alpha.toFixed(3)})`
  }

  const creditOverviewChartData = useMemo(() => {
    const cccSeries = ustData['BAMLH0A3HYC'] || []
    const hySeries = ustData['BAMLH0A0HYM2'] || []
    const hyMap = new Map(hySeries.map((p) => [p.date, p.value]))
    const trashMap = new Map<string, number>()
    cccSeries.forEach((p) => { const hv = hyMap.get(p.date); if (hv != null) trashMap.set(p.date, (p.value - hv) * 100) })

    const allDates = new Set<string>()
    CREDIT_SERIES_CONFIG.forEach((s) => {
      if (s.key === 'TRASH') { trashMap.forEach((_, d) => allDates.add(d)) }
      else { (ustData[s.key] || []).forEach((p) => allDates.add(p.date)) }
    })

    const cutoff = getDateCutoff(creditOverviewRange)
    const sortedDates = [...allDates].sort().filter((d) => !cutoff || d >= cutoff)

    const maps: Record<string, Map<string, number>> = {}
    CREDIT_SERIES_CONFIG.forEach((s) => {
      if (s.key === 'TRASH') maps[s.key] = trashMap
      else maps[s.key] = new Map((ustData[s.key] || []).map((p) => [p.date, p.value * 100]))
    })

    return sortedDates.map((date) => {
      const point: Record<string, string | number | null> = { date }
      CREDIT_SERIES_CONFIG.forEach((s) => { point[s.key] = maps[s.key]?.get(date) ?? null })
      return point
    })
  }, [ustData, creditOverviewRange])

  function toggleCreditSeries(key: string) {
    setCreditVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const creditRocChartData = useMemo(() => {
    const hyOas = ustData['BAMLH0A0HYM2'] || []
    const dgs2 = ustData['DGS2'] || []
    const dgs10 = ustData['DGS10'] || []
    if (hyOas.length === 0 || dgs2.length === 0 || dgs10.length === 0) return []

    const map2 = new Map(dgs2.map((p) => [p.date, p.value]))
    const map10 = new Map(dgs10.map((p) => [p.date, p.value]))

    const aligned = hyOas
      .filter((p) => map2.has(p.date) && map10.has(p.date))
      .map((p) => ({ date: p.date, oas: p.value, yield2y: map2.get(p.date)!, yield10y: map10.get(p.date)! }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoff = getDateCutoff(creditChartRange)
    const filtered = cutoff ? aligned.filter((p) => p.date >= cutoff) : aligned

    return filtered.map((point) => {
      const fullIdx = aligned.findIndex((c) => c.date === point.date)

      let roc: number | null = null
      const rocIdx = fullIdx - creditRocLookback
      if (rocIdx >= 0) roc = (point.oas - aligned[rocIdx].oas) * 100

      let regime: string | null = null
      const regimeIdx = fullIdx - creditRegimeLookback
      if (regimeIdx >= 0) {
        const prior = aligned[regimeIdx]
        const shortChange = point.yield2y - prior.yield2y
        const longChange = point.yield10y - prior.yield10y
        const spreadChange = (point.yield10y - point.yield2y) * 100 - (prior.yield10y - prior.yield2y) * 100
        if (spreadChange > 0) {
          if (shortChange < 0 && longChange < 0) regime = 'Bull Steepener'
          else if (shortChange > 0 && longChange > 0) regime = 'Bear Steepener'
          else regime = 'Steepener Twist'
        } else if (spreadChange < 0) {
          if (shortChange < 0 && longChange < 0) regime = 'Bull Flattener'
          else if (shortChange > 0 && longChange > 0) regime = 'Bear Flattener'
          else regime = 'Flattener Twist'
        }
      }
      return { ...point, roc, regime }
    })
  }, [ustData, creditChartRange, creditRocLookback, creditRegimeLookback])

  const realChartData = useMemo(() => {
    if (realSelection.type !== 'realYield') return []
    const cutoff = getDateCutoff(realChartRange)
    const series = realSelection.key === '5y' ? realYieldData.real5y : realYieldData.real10y
    return series
      .filter((point) => !cutoff || point.date >= cutoff)
      .map((point) => ({ date: point.date, value: point.value }))
  }, [realSelection, realChartRange, realYieldData])

  const realSpreadChartData = useMemo(() => {
    if (realSelection.type !== 'realSpread') return []

    const cutoff = getDateCutoff(realChartRange)
    const filtered = cutoff ? realYieldData.realSpread.filter((point) => point.date >= cutoff) : realYieldData.realSpread

    return filtered.map((point) => {
      const fullIdx = realYieldData.realSpread.findIndex((candidate) => candidate.date === point.date)
      const lookbackIdx = fullIdx - realRegimeLookback
      if (lookbackIdx < 0) return { ...point, spread: point.value, regime: null as string | null }

      const prior = realYieldData.realSpread[lookbackIdx]
      const shortChange = point.shortYield - prior.shortYield
      const longChange = point.longYield - prior.longYield
      const spreadChange = point.value - prior.value

      let regime: string
      if (spreadChange > 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Steepener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Steepener'
        else regime = 'Steepener Twist'
      } else if (spreadChange < 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Flattener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Flattener'
        else regime = 'Flattener Twist'
      } else {
        regime = 'Neutral'
      }

      return { ...point, spread: point.value, regime }
    })
  }, [realSelection, realYieldData, realChartRange, realRegimeLookback])

  const beChartData = useMemo(() => {
    if (beSelection.type !== 'beYield') return []
    const series = beSelection.key === '5y' ? breakevensData.be5y : breakevensData.be10y
    const cutoff = getDateCutoff(beChartRange)
    return (cutoff ? series.filter((point) => point.date >= cutoff) : series)
      .map((point) => ({ date: point.date, value: point.value }))
  }, [beSelection, breakevensData, beChartRange])

  const beSpreadChartData = useMemo(() => {
    if (beSelection.type !== 'beSpread') return []
    const { beSpread } = breakevensData
    const cutoff = getDateCutoff(beChartRange)
    const filtered = cutoff ? beSpread.filter((point) => point.date >= cutoff) : beSpread

    return filtered.map((point) => {
      const fullIdx = beSpread.findIndex((candidate) => candidate.date === point.date)
      const lookbackIdx = fullIdx - beRegimeLookback
      if (lookbackIdx < 0) return { ...point, spread: point.value, regime: null as string | null }

      const prior = beSpread[lookbackIdx]
      const shortChange = point.shortYield - prior.shortYield
      const longChange = point.longYield - prior.longYield
      const spreadChange = point.value - prior.value

      let regime: string
      if (spreadChange > 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Steepener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Steepener'
        else regime = 'Steepener Twist'
      } else if (spreadChange < 0) {
        if (shortChange < 0 && longChange < 0) regime = 'Bull Flattener'
        else if (shortChange > 0 && longChange > 0) regime = 'Bear Flattener'
        else regime = 'Flattener Twist'
      } else {
        regime = 'Neutral'
      }

      return { ...point, spread: point.value, regime }
    })
  }, [beSelection, breakevensData, beChartRange, beRegimeLookback])

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}><FredRefreshButton /></div>
      </header>

      <nav className={styles.breadcrumb}>
        <span className={styles.breadcrumbCurrent}>Asset Class Models</span>
      </nav>

      <main className={styles.body}>
        {/* ═══ Asset Class Selector ═══ */}
        <div className={styles.assetClassBar}>
          {ASSET_CLASSES.map((ac, idx) => (
            <button
              key={ac.key}
              className={`${styles.assetClassBtn} ${assetClass === ac.key ? styles.assetClassBtnActive : ''}`}
              onClick={() => setAssetClass(ac.key)}
              style={{
                border: `1px solid ${assetClass === ac.key ? '#60a5fa' : 'rgba(255, 255, 255, 0.15)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {ac.label}
            </button>
          ))}
        </div>

        {/* ═══ Country Selector — visible for rates, equities, fx ═══ */}
        {(assetClass === 'rates' || assetClass === 'equities' || assetClass === 'fx') && (
          <CountrySelector value={country} onChange={setCountry} />
        )}

        {/* ═══ Macro View ═══ */}
        {assetClass === 'macro' && (
          <>
            <AssetSubRibbon
              items={MACRO_SECTIONS}
              value={macroSection}
              onChange={setMacroSection}
            />
            {macroSection === 'regimes' && (
              <div className={styles.comingSoon}>Regimes coming soon</div>
            )}
            {macroSection === 'cross-asset-vol' && <CrossAssetVolPage />}
          </>
        )}

        {/* ═══ Equities View ═══ */}
        {assetClass === 'equities' && (
          country === 'US' ? (
            <>
              <AssetSubRibbon
                items={EQUITY_SECTIONS}
                value={equitySection}
                onChange={setEquitySection}
              />
              {equitySection === 'index-comparison' && <IndexComparisonPage />}
              {equitySection === 'sector-attribution' && <SectorAttributionPage />}
              {equitySection === 'breadth' && <BreadthPage />}
            </>
          ) : country === 'Global' ? (
            <>
              <AssetSubRibbon
                items={GLOBAL_EQUITY_SECTIONS}
                value={globalEquitySection}
                onChange={setGlobalEquitySection}
              />
              {globalEquitySection === 'country-returns' && <CountryReturnsPage />}
            </>
          ) : (
            <div className={styles.comingSoon}>{country} equities coming soon</div>
          )
        )}

        {/* ═══ FX View ═══ */}
        {assetClass === 'fx' && (
          country === 'Global' ? (
            <>
              <AssetSubRibbon
                items={GLOBAL_FX_SECTIONS}
                value={globalFxSection}
                onChange={setGlobalFxSection}
              />
              {globalFxSection === 'pair-returns' && <PairReturnsPage />}
            </>
          ) : (
            <div className={styles.comingSoon}>{country} FX coming soon</div>
          )
        )}

        {/* ═══ Commodities View ═══ */}
        {assetClass === 'commodities' && (
          <>
            <AssetSubRibbon
              items={COMMODITY_CATEGORIES}
              value={commodityCategory}
              onChange={setCommodityCategory}
            />
            {commodityCategory === 'energy' ? (
              <>
                <EnergyReturnsSection />
                <AssetSubRibbon
                  items={ENERGY_PRODUCTS}
                  value={energyProduct}
                  onChange={setEnergyProduct}
                />
                {energyProduct === 'crude-oil' && <CrudeOilPage />}
              </>
            ) : commodityCategory === 'metals' ? (
              <MetalsPage />
            ) : (
              <div className={styles.comingSoon}>
                {COMMODITY_CATEGORIES.find((c) => c.key === commodityCategory)?.label} models coming soon
              </div>
            )}
          </>
        )}

        {/* ═══ Rates View (existing content) ═══ */}
        {assetClass === 'rates' && (<>

        {country === 'Global' && <GlobalRatesPage />}

        {country !== 'Global' && <>
        <div className={styles.viewTabs}>
          {viewTabs.map((tab, idx) => (
            <button
              key={tab.key}
              className={`${styles.viewTab} ${activeView === tab.key ? styles.viewTabActive : ''}`}
              onClick={() => setActiveView(tab.key)}
              style={{
                border: `1px solid ${activeView === tab.key ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeView === 'strips' || activeView === 'pricing') && country === 'US' && (
          <div className={styles.toggleGroup}>
            {(Object.entries(PRODUCT_CONFIG) as [ProductKey, typeof PRODUCT_CONFIG[ProductKey]][]).map(([key, config], idx) => (
              <button
                key={key}
                className={`${styles.toggleButton} ${product === key ? styles.toggleButtonActive : ''}`}
                onClick={() => setProduct(key)}
                style={{
                  border: `1px solid ${product === key ? '#4EC9B0' : 'rgba(255, 255, 255, 0.12)'}`,
                  ...(idx > 0 ? { borderLeft: 'none' } : {}),
                }}
              >
                {config.label}
              </button>
            ))}
          </div>
        )}

        <div className={(activeView === 'strips' || activeView === 'pricing') && (country === 'US' || country === 'UK' || country === 'EU' || country === 'CAD' || country === 'JPY') ? styles.twoPanel : styles.fullPanel}>
          <div className={(activeView === 'strips' || activeView === 'pricing') && (country === 'US' || country === 'UK' || country === 'EU' || country === 'CAD' || country === 'JPY') ? styles.leftPanel : undefined}>
        {(activeView === 'strips' || activeView === 'pricing') && (
          <div className={styles.ffrBand}>
            {activeMarket.rateLabel}{' '}
            {(() => {
              if (overnightLatest) {
                const stale = overnightLatest.stale_days > 3
                return (
                  <>
                    {overnightLatest.value.toFixed(2)}%
                    {stale && (
                      <span className={styles.curveNote} style={{ marginLeft: 8, display: 'inline-block' }}>
                        Last updated: {overnightLatest.date}
                      </span>
                    )}
                  </>
                )
              }
              return fedwatch.currentEFFR != null ? `${fedwatch.currentEFFR.toFixed(2)}%` : '—'
            })()}
          </div>
        )}
        {activeView === 'pricing' && (
          <>
            <div className={styles.ustYcHeader}>
              <div>
                <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>
                  {country}: {activeMarket.title}
                </div>
                <div className={styles.ustYcDates}>
                  {'\u25CF'} LATEST: {curve.currentDate || '—'} &nbsp;&nbsp; {'\u25CF'} BENCHMARK: {curve.lookbackDate || '—'} ({headerTiming.days} DAYS, {headerTiming.weeks} WEEKS)
                </div>
              </div>
              <div className={styles.ustYcControls}>
                <label className={styles.ustLookbackWrap}>
                  <span className={styles.ustLookbackLabel}>t −</span>
                  <input
                    className={styles.laborInput}
                    type="number"
                    min="0"
                    step="1"
                    value={lookbackDaysInput}
                    onChange={(e) => setLookbackDaysInput(e.target.value)}
                    style={{ width: '40px' }}
                  />
                </label>
              </div>
            </div>

            {error && (
              <section className={styles.section}>
                <div className={styles.error}>{error}</div>
              </section>
            )}

            {!error && loading && (
              <section className={styles.section}>
                <div className={styles.loading}>Loading futures dashboard…</div>
              </section>
            )}

            {!error && !loading && (
              <>
                <section className={styles.section}>
                  <div className={styles.chartPanel}>
                    <div className={styles.panelTitle}>
                      {country}: {activeMarket.title}
                    </div>
                    {curve.trimmedStaleSymbols.length > 0 && (
                      <div className={styles.curveNote}>
                        Curve trimmed: dropped {curve.trimmedStaleSymbols.length}
                        {' '}stale contract{curve.trimmedStaleSymbols.length === 1 ? '' : 's'}
                        {' '}({curve.trimmedStaleSymbols.join(', ')})
                        {curve.lastGoodContract && ` · last good contract = ${curve.lastGoodContract}`}
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={curveData} margin={{ top: 16, right: 24, left: 8, bottom: 4 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis dataKey="ticker" stroke="#728197" tick={false} tickLine={false} />
                        <YAxis
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                          domain={curveDomain}
                          allowDataOverflow
                          label={{
                            value: '%',
                            position: 'top',
                            offset: 10,
                            style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' },
                          }}
                        />
                        <Tooltip content={<CurveTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="latestRate"
                          name="Latest"
                          stroke="#2196F3"
                          strokeWidth={2.5}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="benchmarkRate"
                          name="Benchmark"
                          stroke="#888888"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={{ r: 2.5 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className={styles.chartPanel}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={curveData} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="ticker"
                          stroke="#728197"
                          tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          angle={-45}
                          textAnchor="end"
                          height={70}
                          dy={10}
                        />
                        <YAxis
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(v: number) => `${v.toFixed(0)}`}
                          label={{
                            value: 'bps',
                            position: 'top',
                            offset: 10,
                            style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' },
                          }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                        <Bar dataKey="deltaBps" radius={[2, 2, 0, 0]}>
                          {curveData.map((row) => (
                            <Cell key={row.ticker} fill={(row.deltaBps ?? 0) >= 0 ? '#4EC9B0' : '#EF5350'} />
                          ))}
                          <LabelList content={renderDeltaLabel} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle}>Summary Table</div>
                  </div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Meeting</th>
                          <th>Implied<br/>Rate</th>
                          <th>Bps<br/>(Step)</th>
                          <th>Bps<br/>(Total)</th>
                          <th>Implied # Cuts/Hikes<br/>(Step)</th>
                          {/* Implied # Cuts/Hikes (Total) shown on SOFR + non-USD; hidden on Fed Funds per user spec */}
                          {!(country === 'US' && product === 'fedfunds') && (
                            <th>Implied # Cuts/Hikes<br/>(Total)</th>
                          )}
                          <th>Summary<br/>(Step)</th>
                          <th>Summary<br/>(Total)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[overnightRow, ...summaryRows].map((row) => (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td className={styles.mono}>{fmtRate(row.impliedRate)}</td>
                            <td className={`${styles.mono} ${row.stepBps < 0 ? styles.cutText : row.stepBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.stepBps)}</td>
                            <td className={`${styles.mono} ${row.totalBps < 0 ? styles.cutText : row.totalBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.totalBps)}</td>
                            <td className={`${styles.mono} ${styles.cellCenter} ${row.stepBps < 0 ? styles.cutText : row.stepBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtSignedDecimal(row.stepBps / 25)}</td>
                            {!(country === 'US' && product === 'fedfunds') && (
                              <td className={`${styles.mono} ${styles.cellCenter} ${row.totalBps < 0 ? styles.cutText : row.totalBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtSignedDecimal(row.totalBps / 25)}</td>
                            )}
                            <td><span className={`${styles.badge} ${styles[row.tone]}`}>{row.stepSummary}</span></td>
                            <td><span className={`${styles.badge} ${styles[row.totalBps < 0 ? 'cut' : row.totalBps > 0 ? 'hike' : 'flat']}`}>{row.totalSummary}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {country === 'US' && product === 'fedfunds' && fedwatch.rangeColumns.length > 0 && (
                  <section className={styles.section}>
                    <button className={styles.matrixToggle} onClick={() => setShowMatrix((v) => !v)}>
                      {showMatrix ? '▼' : '▶'} Detailed Probability Matrix
                    </button>
                    {showMatrix && (
                      <div className={styles.matrixSubtitle}>
                        {Math.abs(fedwatch.proxyToPolicySpread) > 1e-9 && fedwatch.proxyToPolicySpreadSource
                          ? fedwatch.proxyToPolicySpreadSource
                          : `as of ${fedwatch.asOfDate || '—'}`}
                      </div>
                    )}
                    {showMatrix && (
                      <div className={styles.matrixWrap}>
                        <table className={styles.matrixTable}>
                          <thead>
                            <tr>
                              <th>Meeting</th>
                              {fedwatch.rangeColumns.map((range) => (
                                <th key={range}>{range}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {matrixRows.map((row) => (
                              <tr key={row.meetingDate}>
                                <td>{row.meetingLabel}</td>
                                {fedwatch.rangeColumns.map((range) => {
                                  const value = row.targetRanges[range] ?? 0
                                  return (
                                    <td
                                      key={range}
                                      className={range === row.maxRange ? styles.matrixHot : ''}
                                    >
                                      {(value * 100).toFixed(1)}%
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}

        {activeView === 'strips' && (
          <>
            {stripError && (
              <section className={styles.section}>
                <div className={styles.error}>{stripError}</div>
              </section>
            )}

            {!stripError && stripLoading && (
              <section className={styles.section}>
                <div className={styles.loading}>Loading strip monitor…</div>
              </section>
            )}

            {!stripError && !stripLoading && stripContracts.length === 0 && (
              <section className={styles.section}>
                <div className={styles.loading}>No strip data available</div>
              </section>
            )}

            {!stripError && !stripLoading && stripContracts.length > 0 && (
              <>
                <section className={styles.section}>
                  <div className={styles.chartPanel}>
                    <div className={styles.summaryRow}>
                      {stripSummary.boxes.map((box) => (
                        <div
                          key={box.label}
                          className={styles.summaryBox}
                          onMouseEnter={box.hoverKey ? () => setHoveredBox(box.hoverKey ?? null) : undefined}
                          onMouseLeave={box.hoverKey ? () => setHoveredBox(null) : undefined}
                          style={box.hoverKey ? { position: 'relative', cursor: 'pointer' } : undefined}
                        >
                          <div className={styles.summaryBoxLabel}>{box.label}</div>
                          <div className={box.label === 'NEXT MOVE' ? styles.nextMoveValue : styles.summaryBoxValue} style={summaryToneStyle(box.tone)}>{box.value}</div>
                          {box.sub ? <div className={styles.summaryBoxSub}>{box.sub}</div> : null}
                          {box.hoverKey === hoveredBox && (
                            <div className={styles.spreadPopup}>
                              <div className={styles.spreadPopupTitle}>
                                {box.label} Spread History (60d)
                              </div>
                              <ResponsiveContainer width="100%" height={150}>
                                <LineChart
                                  data={
                                    box.hoverKey === 'mtg'
                                      ? mtgSpreadData
                                      : box.hoverKey === 'term6m'
                                        ? term6mSpreadData
                                        : term12mSpreadData
                                  }
                                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                                >
                                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 9, fill: '#728197', fontFamily: 'var(--font-mono)' }}
                                    tickFormatter={(value: string) => fmtShortMonthYear(value)}
                                    minTickGap={18}
                                  />
                                  <YAxis
                                    tick={{ fontSize: 9, fill: '#728197', fontFamily: 'var(--font-mono)' }}
                                    tickFormatter={(value: number) => `${value.toFixed(1)}bp`}
                                    width={42}
                                  />
                                  <Tooltip
                                    contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                                    labelStyle={{ color: '#94A3B8' }}
                                    formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)}bp` : '—')}
                                    labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                                  />
                                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                                  <Line type="monotone" dataKey="spread" stroke="#FFD700" strokeWidth={1.5} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                              {(box.hoverKey === 'mtg' && terminalHistory.loading)
                                || (box.hoverKey === 'term6m' && (terminalHistory.loading || plus6mHistory.loading))
                                || (box.hoverKey === 'term12m' && (terminalHistory.loading || plus12mHistory.loading)) ? (
                                <div className={styles.summaryBoxSub}>Loading history…</div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className={styles.section}>
                  <div className={styles.chartPanel}>
                    <div className={styles.stripHeader}>
                      {activeMarket.root} STRIP {stripContracts.length} contracts
                    </div>
                    <div className={styles.tableWrap}>
                      <table className={styles.stripTable}>
                        <thead>
                          <tr>
                            <th>Contract</th>
                            <th>Last Px</th>
                            <th>Imp Rate</th>
                            {useStirStyling && <th className={styles.ocrHeader}>± OCR</th>}
                            {useStirStyling ? (
                              <>
                                <th className={styles.changeHeader}>Imp Rate Δ 1d</th>
                                <th className={styles.changeHeader}>Imp Rate Δ 5d</th>
                                <th className={styles.changeHeader}>Imp Rate Δ 1m</th>
                              </>
                            ) : (
                              <>
                                <th>Px 1D</th>
                                <th>Px 5D</th>
                                <th>Px 1M</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {useStirStyling ? (
                            stripPacks.map((pack) => (
                              <Fragment key={pack.name}>
                                <tr className={styles.packHeaderRow} style={{ background: PACK_BACKGROUNDS[pack.name] }}>
                                  <td colSpan={7} className={styles.packHeaderCell} style={{ color: pack.color }}>
                                    {pack.name}
                                  </td>
                                </tr>
                                {pack.contracts.map((contract) => (
                                  <tr key={contract.symbol} style={{ background: PACK_BACKGROUNDS[pack.name] }}>
                                    <td
                                      style={{ color: pack.color }}
                                      className={styles.contractClickable}
                                      onClick={() => {
                                        setModalContractColor(pack.color)
                                        setModalContract(contract)
                                        setModalMetric('rate')
                                        setModalRange('1Y')
                                      }}
                                    >{contractTicker(contract.symbol)}</td>
                                    <td style={{ color: '#e2e8f0' }}>{contract.lastPrice.toFixed(3)}</td>
                                    <td style={{ color: pack.color }}>{contract.impliedRate.toFixed(3)}</td>
                                    {(() => {
                                      const ocrBps = (contract.impliedRate - fedwatch.currentEFFR) * 100
                                      const cls = ocrBps > 0 ? styles.ocrPositive : ocrBps < 0 ? styles.ocrNegative : ''
                                      return <td className={cls}>{fmtBpsNumber(ocrBps)}</td>
                                    })()}
                                    <td className={styles.changeCell} style={heatStyle(contract.pxChg1d, stripMaxAbs.pxChg1d)}>{fmtBpsFromPrice(contract.pxChg1d)}</td>
                                    <td className={styles.changeCell} style={heatStyle(contract.pxChg5d, stripMaxAbs.pxChg5d)}>{fmtBpsFromPrice(contract.pxChg5d)}</td>
                                    <td className={styles.changeCell} style={heatStyle(contract.pxChg1m, stripMaxAbs.pxChg1m)}>{fmtBpsFromPrice(contract.pxChg1m)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            ))
                          ) : (
                            stripYearGroups.map(([year, contracts]) => (
                              <Fragment key={year}>
                                <tr className={styles.yearRow} style={{ background: getYearBandColor(year, stripYears) }}>
                                  <td colSpan={6} className={styles.yearRowLabel}>{year}</td>
                                </tr>
                                {contracts.map((contract) => (
                                  <tr
                                    key={contract.symbol}
                                    style={{ background: getYearBandColor(contract.year, stripYears) }}
                                  >
                                    <td>{contractTicker(contract.symbol)}</td>
                                    <td style={{ color: '#e2e8f0' }}>{contract.lastPrice.toFixed(3)}</td>
                                    <td>{contract.impliedRate.toFixed(3)}</td>
                                    <td style={heatStyle(contract.pxChg1d, stripMaxAbs.pxChg1d)}>{fmtSignedPrice(contract.pxChg1d)}</td>
                                    <td style={heatStyle(contract.pxChg5d, stripMaxAbs.pxChg5d)}>{fmtSignedPrice(contract.pxChg5d)}</td>
                                    <td style={heatStyle(contract.pxChg1m, stripMaxAbs.pxChg1m)}>{fmtSignedPrice(contract.pxChg1m)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

              </>
            )}
          </>
        )}

        {activeView === 'policy' && country === 'US' && (
          <section className={styles.section}>
            <PolicyRatePage />
          </section>
        )}

        {activeView === 'policy' && country !== 'US' && (
          <section className={styles.section}>
            <CountryTermStructure
              countryLabel={country}
              {...COUNTRY_TERM_STRUCTURE_CONFIGS[country]}
            />
          </section>
        )}

        {activeView === 'ust' && (
          <section className={styles.section}>
            {/* ═══ Yield Curve Chart ═══ */}
            <div className={styles.ustDashboard}>
              <div className={styles.ustYcHeader}>
                <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>US TREASURY YIELD CURVE</div>
                <div className={styles.ustYcControls}>
                  <label className={styles.ustLookbackWrap}>
                    <span className={styles.ustLookbackLabel}>t −</span>
                    <input
                      className={styles.laborInput}
                      type="number"
                      min="0"
                      value={ycLookback}
                      onChange={(e) => setYcLookback(Math.max(0, parseInt(e.target.value) || 1))}
                      style={{ width: '40px' }}
                    />
                  </label>
                  <button
                    onClick={() => setYcCompressed((v) => !v)}
                    style={{
                      background: ycCompressed ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                      border: `1px solid ${ycCompressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                      color: ycCompressed ? '#60a5fa' : '#728197',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      padding: '3px 10px',
                      cursor: 'pointer',
                      borderRadius: '2px',
                    }}
                  >
                    COMPRESSED
                  </button>
                </div>
              </div>
              <div className={styles.ustYcDates}>
                {'\u25CF'} LATEST: {ycLatestDate} &nbsp;&nbsp; {'\u25CF'} OFFSET: {ycOffsetDate} ({ycLookback} {ycLookback === 1 ? 'day' : 'days'})
              </div>
              {ustLoading ? (
                <div className={styles.loading}>Loading…</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={450}>
                    <LineChart data={ycCurveData.map((d, idx) => ({ ...d, xVal: ycCompressed ? d.years : idx }))} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey={ycCompressed ? 'years' : 'label'}
                        type={ycCompressed ? 'number' : 'category'}
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        {...(ycCompressed ? { domain: [0, 30] as [number, number], ticks: [1 / 12, 0.25, 0.5, 1, 2, 5, 7, 10, 20, 30], tickFormatter: (v: number) => (v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`) } : {})}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                        domain={ycYDomain}
                        allowDataOverflow
                      />
                      <Tooltip
                        contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                        formatter={(value: unknown, name: string | undefined) => [typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                        labelFormatter={(label: unknown) => {
                          const point = ycCurveData.find((d) => (ycCompressed ? d.years === label : d.label === label))
                          return point?.label || String(label)
                        }}
                      />
                      <Line type="monotone" dataKey="latest" name="Latest" stroke="#60a5fa" strokeWidth={2.5} dot={{ r: 3, fill: '#60a5fa' }} connectNulls />
                      <Line type="monotone" dataKey="offset" name="Offset" stroke="#888888" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2.5, fill: '#888888' }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={ycCurveData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke="#728197" tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(0)}`}
                        label={{ value: 'bps', position: 'top', offset: 10, style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' } }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                      <Bar dataKey="delta" radius={[2, 2, 0, 0]}>
                        {ycCurveData.map((d, idx) => (
                          <Cell key={idx} fill={(d.delta ?? 0) >= 0 ? '#4EC9B0' : '#EF5350'} />
                        ))}
                        <LabelList
                          dataKey="delta"
                          content={((props: { x?: number; y?: number; width?: number; height?: number; value?: number | null }) => {
                            const { x = 0, y = 0, width = 0, height = 0, value } = props
                            if (value == null) return null
                            const numeric = Number(value)
                            return (
                              <text
                                x={x + width / 2}
                                y={numeric >= 0 ? y - 8 : y + height + 14}
                                textAnchor="middle"
                                fill="#94A3B8"
                                fontSize={11}
                                fontFamily="var(--font-mono)"
                                fontWeight={700}
                              >
                                {numeric > 0 ? '+' : ''}{numeric.toFixed(1)}
                              </text>
                            )
                          }) as never}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>

            {/* ═══ Historical Yield Changes + BE/Real (side-by-side) ═══ */}
            <div className={styles.histChangesRow}>
              <div className={styles.ustDashboard}>
                <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>NOMINAL YIELDS</div>
                <div className={styles.ustYcDates}>
                  {'●'} AS OF: {historicalChanges.latestDate || '—'}
                </div>
                {ustLoading ? (
                  <div className={styles.loading}>Loading Treasury data…</div>
                ) : ustError ? (
                  <div className={styles.error}>{ustError}</div>
                ) : (
                  <div className={styles.histChangesGrid}>
                    <div className={styles.histChangesHeaderCell}></div>
                    {HIST_LOOKBACKS.map(lb => (
                      <div key={lb.label} className={styles.histChangesHeaderCell}>{lb.label}</div>
                    ))}
                    {historicalChanges.rows.map(row => (
                      <Fragment key={row.rowLabel}>
                        <div className={styles.histChangesRowLabel}>{row.rowLabel}</div>
                        {row.cells.map(cell => {
                          const bg = getCellColor(cell.bps, historicalChanges.colMaxAbs[cell.lookback] ?? 0, 'red-blue')
                          return (
                            <div
                              key={`${row.rowLabel}-${cell.lookback}`}
                              className={styles.histChangesCell}
                              style={bg ? { background: bg } : undefined}
                            >
                              {cell.bps != null && Number.isFinite(cell.bps)
                                ? `${cell.bps >= 0 ? '+' : ''}${cell.bps.toFixed(1)} bps`
                                : '—'}
                            </div>
                          )
                        })}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.ustDashboard}>
                <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>BREAKEVENS &amp; REAL RATES</div>
                <div className={styles.ustYcDates}>
                  {'●'} AS OF: {beRealChanges.latestDate || '—'}
                </div>
                {ustLoading ? (
                  <div className={styles.loading}>Loading Treasury data…</div>
                ) : ustError ? (
                  <div className={styles.error}>{ustError}</div>
                ) : (
                  <div className={styles.beRealGrid}>
                    <div className={styles.histChangesHeaderCell}></div>
                    {HIST_LOOKBACKS.map(lb => (
                      <div key={lb.label} className={styles.histChangesHeaderCell}>{lb.label}</div>
                    ))}
                    {beRealChanges.rows.map((row, idx) => (
                      <Fragment key={row.rowLabel}>
                        <div className={styles.histChangesRowLabel}>{row.rowLabel}</div>
                        {row.cells.map(cell => {
                          const bg = getCellColor(cell.bps, beRealChanges.colMaxAbs[cell.lookback] ?? 0, 'red-blue')
                          return (
                            <div
                              key={`${row.rowLabel}-${cell.lookback}`}
                              className={styles.histChangesCell}
                              style={bg ? { background: bg } : undefined}
                            >
                              {cell.bps != null && Number.isFinite(cell.bps)
                                ? `${cell.bps >= 0 ? '+' : ''}${cell.bps.toFixed(1)} bps`
                                : '—'}
                            </div>
                          )
                        })}
                        {BE_REAL_ROWS[idx]?.addSeparatorAfter && (
                          <div className={styles.beRealSeparator} />
                        )}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ═══ Nominal Yields Dashboard ═══ */}
            <div className={styles.ustDashboard}>
              <div className={styles.ustSectionLabel}>Nominal Yields</div>
              {ustLoading ? (
                <div className={styles.loading}>Loading Treasury data…</div>
              ) : ustError ? (
                <div className={styles.error}>{ustError}</div>
              ) : (
                <>
                  <div className={styles.ustYieldRow}>
                    {currentYields.map((tenor) => (
                      <div
                        key={tenor.key}
                        className={`${styles.ustYieldBox} ${ustSelection?.type === 'yield' && ustSelection.key === tenor.key ? styles.ustBoxSelected : ''}`}
                        onClick={() => setUstSelection({ type: 'yield', key: tenor.key, label: tenor.label })}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={styles.ustYieldLabel}>{tenor.label}</div>
                        <div className={styles.ustYieldValue}>
                          {tenor.current != null ? tenor.current.toFixed(2) : '—'}%
                        </div>
                        <div
                          className={styles.ustYieldChange}
                          style={{
                            color: tenor.change != null
                              ? tenor.change > 0 ? '#4EC9B0' : tenor.change < 0 ? '#EF5350' : '#728197'
                              : '#728197',
                          }}
                        >
                          {tenor.change != null ? `${tenor.change > 0 ? '+' : ''}${(tenor.change * 100).toFixed(1)}bp` : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.ustSectionLabel}>Nominal Spreads</div>
                  <div className={styles.ustSpreadRow}>
                    {currentSpreads.map((spread) => (
                      <div
                        key={spread.label}
                        className={`${styles.ustSpreadBox} ${ustSelection?.type === 'spread' && ustSelection.label === spread.label ? styles.ustBoxSelected : ''}`}
                        onClick={() => setUstSelection({ type: 'spread', label: spread.label, longKey: spread.long, shortKey: spread.short })}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={styles.ustSpreadLabel}>{spread.label}</div>
                        <div
                          className={styles.ustSpreadValue}
                          style={{
                            color: spread.current != null
                              ? spread.current > 0 ? '#4EC9B0' : spread.current < 0 ? '#EF5350' : '#e2e8f0'
                              : '#728197',
                          }}
                        >
                          {spread.current != null ? `${spread.current > 0 ? '+' : ''}${spread.current.toFixed(1)}bp` : '—'}
                        </div>
                        <div
                          className={styles.ustSpreadChange}
                          style={{
                            color: spread.change != null
                              ? spread.change > 0 ? '#4EC9B0' : spread.change < 0 ? '#EF5350' : '#728197'
                              : '#728197',
                          }}
                        >
                          {spread.change != null ? `${spread.change > 0 ? '+' : ''}${spread.change.toFixed(1)}bp` : '—'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.ustSectionLabel}>Butterflies</div>
                  <div className={styles.butterflyRow}>
                    {currentButterflies.map((fly) => (
                      <div
                        key={fly.label}
                        className={`${styles.ustSpreadBox} ${ustSelection?.type === 'butterfly' && ustSelection.label === fly.label ? styles.ustBoxSelected : ''}`}
                        onClick={() => setUstSelection({ type: 'butterfly', label: fly.label, lowKey: fly.low, middleKey: fly.middle, highKey: fly.high })}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={styles.ustSpreadLabel} style={{ color: '#60a5fa' }}>{fly.label}</div>
                        <div className={styles.ustSpreadValue} style={{
                          color: fly.current != null
                            ? fly.current > 0 ? '#4EC9B0' : fly.current < 0 ? '#EF5350' : '#e2e8f0'
                            : '#728197',
                        }}>
                          {fly.current != null ? `${fly.current > 0 ? '+' : ''}${fly.current.toFixed(1)}bp` : '—'}
                        </div>
                        <div className={styles.ustSpreadChange} style={{
                          color: fly.change != null
                            ? fly.change > 0 ? '#4EC9B0' : fly.change < 0 ? '#EF5350' : '#728197'
                            : '#728197',
                        }}>
                          {fly.change != null ? `${fly.change > 0 ? '+' : ''}${fly.change.toFixed(1)}bp` : '—'}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={styles.ustChartTitle}>
                    {ustSelection?.type === 'yield'
                      ? `${ustSelection.label} Treasury Yield`
                      : ustSelection?.type === 'butterfly'
                        ? `${ustSelection.label} butterfly`
                        : `${ustSelection?.label} yield curve regimes`}
                  </div>

                    <div className={styles.ustChartControls}>
                      <div className={styles.ustRangeBar}>
                      {['3m', '6m', '1y', '5y', '10y', 'all'].map((range, idx) => (
                        <button
                          key={range}
                          className={`${styles.fvmRangeBtn} ${ustChartRange === range ? styles.fvmRangeBtnActive : ''}`}
                          onClick={() => setUstChartRange(range)}
                          style={{
                            border: `1px solid ${ustChartRange === range ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                            ...(idx > 0 ? { borderLeft: 'none' } : {}),
                            fontSize: '0.75rem',
                            padding: '4px 10px',
                          }}
                        >
                          {range.toUpperCase()}
                        </button>
                      ))}
                      </div>
                    {ustSelection?.type === 'spread' && (
                      <label className={styles.ustLookbackWrap}>
                        <span className={styles.ustLookbackLabel}>Lookback (days):</span>
                        <input
                          className={styles.laborInput}
                          type="number"
                          min="1"
                          value={regimeLookback}
                          onChange={(e) => setRegimeLookback(Math.max(1, Number.parseInt(e.target.value, 10) || 20))}
                          style={{ width: '50px' }}
                        />
                      </label>
                    )}
                  </div>

                  {ustSelection?.type === 'spread' && (
                    <div className={styles.ustRegimeLegend}>
                      {Object.entries(REGIME_COLORS).map(([name, color]) => (
                        <span key={name} className={styles.ustRegimeLegendItem}>
                          <span className={styles.ustRegimeSwatch} style={{ background: color }} />
                          {name}
                        </span>
                      ))}
                      <span className={styles.ustRegimeLegendItem}>
                        <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                        {ustSelection.label}
                      </span>
                    </div>
                  )}

                  {ustSelection?.type === 'butterfly' ? (
                    <ResponsiveContainer width="100%" height={420}>
                      <LineChart data={butterflyChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(date: string) => {
                            const d = new Date(date)
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                            return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                          }}
                          interval="preserveStartEnd"
                          minTickGap={60}
                        />
                        <YAxis
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
                        <Tooltip
                          contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                          formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)}bp` : '—')}
                        />
                        <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                        <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : ustSelection?.type === 'yield' ? (
                    <ResponsiveContainer width="100%" height={420}>
                      <LineChart data={ustChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(date: string) => {
                            const d = new Date(date)
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                            return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                          }}
                          interval="preserveStartEnd"
                          minTickGap={60}
                        />
                        <YAxis
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip
                          contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                          labelStyle={{ color: '#94A3B8' }}
                          formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                        />
                        <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                        <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height={420}>
                      <ComposedChart data={ustSpreadChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(date: string) => {
                            const d = new Date(date)
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                            return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                          }}
                          interval="preserveStartEnd"
                          minTickGap={60}
                        />
                        <YAxis
                          stroke="#728197"
                          tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                        />
                        <Tooltip
                          contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                          labelStyle={{ color: '#94A3B8' }}
                          formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)}bp` : '—')}
                        />
                        <Bar dataKey="spread" barSize={3}>
                          {ustSpreadChartData.map((point, idx) => (
                            <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="spread" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                        <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </>
              )}
            </div>

            {!ustLoading && !ustError && (
              <div className={styles.ustDashboard}>
                <div className={styles.ustSectionLabel} style={{ color: '#4ade80' }}>REAL YIELDS &amp; SPREADS</div>
                <div className={styles.realYieldRow}>
                  <div
                    className={`${styles.ustYieldBox} ${realSelection.type === 'realYield' && realSelection.key === '5y' ? styles.ustBoxSelectedGreen : ''}`}
                    onClick={() => setRealSelection({ type: 'realYield', key: '5y', label: '5Y Real' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustYieldLabel} style={{ color: '#4ade80' }}>5Y REAL</div>
                    <div className={styles.ustYieldValue} style={{ color: '#4ade80' }}>
                      {realYields.real5y.current != null ? `${realYields.real5y.current.toFixed(2)}%` : '—'}
                    </div>
                    <div
                      className={styles.ustYieldChange}
                      style={{
                        color: realYields.real5y.change != null
                          ? realYields.real5y.change > 0 ? '#4EC9B0' : realYields.real5y.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {realYields.real5y.change != null ? `${realYields.real5y.change > 0 ? '+' : ''}${(realYields.real5y.change * 100).toFixed(1)}bp` : '—'}
                    </div>
                  </div>

                  <div
                    className={`${styles.ustYieldBox} ${realSelection.type === 'realYield' && realSelection.key === '10y' ? styles.ustBoxSelectedGreen : ''}`}
                    onClick={() => setRealSelection({ type: 'realYield', key: '10y', label: '10Y Real' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustYieldLabel} style={{ color: '#4ade80' }}>10Y REAL</div>
                    <div className={styles.ustYieldValue} style={{ color: '#4ade80' }}>
                      {realYields.real10y.current != null ? `${realYields.real10y.current.toFixed(2)}%` : '—'}
                    </div>
                    <div
                      className={styles.ustYieldChange}
                      style={{
                        color: realYields.real10y.change != null
                          ? realYields.real10y.change > 0 ? '#4EC9B0' : realYields.real10y.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {realYields.real10y.change != null ? `${realYields.real10y.change > 0 ? '+' : ''}${(realYields.real10y.change * 100).toFixed(1)}bp` : '—'}
                    </div>
                  </div>

                  <div
                    className={`${styles.ustSpreadBox} ${realSelection.type === 'realSpread' ? styles.ustBoxSelectedGreen : ''}`}
                    onClick={() => setRealSelection({ type: 'realSpread', label: '5s10s real' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustSpreadLabel} style={{ color: '#4ade80' }}>5s10s real</div>
                    <div
                      className={styles.ustSpreadValue}
                      style={{
                        color: realYields.realSpread.current != null
                          ? realYields.realSpread.current > 0 ? '#4EC9B0' : realYields.realSpread.current < 0 ? '#EF5350' : '#e2e8f0'
                          : '#728197',
                      }}
                    >
                      {realYields.realSpread.current != null ? `${realYields.realSpread.current > 0 ? '+' : ''}${realYields.realSpread.current.toFixed(1)}bp` : '—'}
                    </div>
                    <div
                      className={styles.ustSpreadChange}
                      style={{
                        color: realYields.realSpread.change != null
                          ? realYields.realSpread.change > 0 ? '#4EC9B0' : realYields.realSpread.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {realYields.realSpread.change != null ? `${realYields.realSpread.change > 0 ? '+' : ''}${realYields.realSpread.change.toFixed(1)}bp` : '—'}
                    </div>
                  </div>
                </div>

                <div className={styles.ustChartTitle}>
                  {realSelection.type === 'realYield'
                    ? `${realSelection.label} YIELD`
                    : `${realSelection.label} yield curve regimes`}
                </div>

                <div className={styles.ustChartControls}>
                  <div className={styles.ustRangeBar}>
                    {['3m', '6m', '1y', '5y', '10y', 'all'].map((range, idx) => (
                      <button
                        key={range}
                        className={`${styles.fvmRangeBtn} ${realChartRange === range ? styles.fvmRangeBtnActive : ''}`}
                        onClick={() => setRealChartRange(range)}
                        style={{
                          border: `1px solid ${realChartRange === range ? '#4ade80' : 'rgba(255, 255, 255, 0.12)'}`,
                          ...(idx > 0 ? { borderLeft: 'none' } : {}),
                        }}
                      >
                        {range.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {realSelection.type === 'realSpread' && (
                    <label className={styles.ustLookbackWrap}>
                      <span className={styles.ustLookbackLabel}>Lookback (days):</span>
                      <input
                        className={styles.laborInput}
                        type="number"
                        min="1"
                        value={realRegimeLookback}
                        onChange={(e) => setRealRegimeLookback(Math.max(1, Number.parseInt(e.target.value, 10) || 20))}
                        style={{ width: '50px' }}
                      />
                    </label>
                  )}
                </div>

                {realSelection.type === 'realSpread' && (
                  <div className={styles.ustRegimeLegend}>
                    {Object.entries(REGIME_COLORS).map(([name, color]) => (
                      <span key={name} className={styles.ustRegimeLegendItem}>
                        <span className={styles.ustRegimeSwatch} style={{ background: color }} />
                        {name}
                      </span>
                    ))}
                    <span className={styles.ustRegimeLegendItem}>
                      <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                      {realSelection.label}
                    </span>
                  </div>
                )}

                {realSelection.type === 'realYield' ? (
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={realChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(date: string) => {
                          const d = new Date(date)
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                          return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                        }}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                        labelStyle={{ color: '#94A3B8' }}
                        formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      />
                      <Line type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={2} dot={false} />
                      <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={realSpreadChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(date: string) => {
                          const d = new Date(date)
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                          return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                        }}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                      />
                      <Tooltip
                        contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                        labelStyle={{ color: '#94A3B8' }}
                        formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)}bp` : '—')}
                      />
                      <Bar dataKey="spread" barSize={3}>
                        {realSpreadChartData.map((point, idx) => (
                          <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="spread" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                      <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}

            {!ustLoading && !ustError && (
              <div className={styles.ustDashboard}>
                <div className={styles.ustSectionLabel} style={{ color: '#fbbf24' }}>INFLATION BREAKEVENS</div>

                <div className={styles.realYieldRow}>
                  <div
                    className={`${styles.ustYieldBox} ${beSelection.type === 'beYield' && beSelection.key === '5y' ? styles.ustBoxSelectedYellow : ''}`}
                    onClick={() => setBeSelection({ type: 'beYield', key: '5y', label: '5Y BE' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustYieldLabel} style={{ color: '#fbbf24' }}>5Y BE</div>
                    <div className={styles.ustYieldValue} style={{ color: '#fbbf24' }}>
                      {breakevens.be5y.current != null ? `${breakevens.be5y.current.toFixed(2)}%` : '—'}
                    </div>
                    <div
                      className={styles.ustYieldChange}
                      style={{
                        color: breakevens.be5y.change != null
                          ? breakevens.be5y.change > 0 ? '#4EC9B0' : breakevens.be5y.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {breakevens.be5y.change != null ? `${breakevens.be5y.change > 0 ? '+' : ''}${(breakevens.be5y.change * 100).toFixed(1)}bp` : '—'}
                    </div>
                  </div>

                  <div
                    className={`${styles.ustYieldBox} ${beSelection.type === 'beYield' && beSelection.key === '10y' ? styles.ustBoxSelectedYellow : ''}`}
                    onClick={() => setBeSelection({ type: 'beYield', key: '10y', label: '10Y BE' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustYieldLabel} style={{ color: '#fbbf24' }}>10Y BE</div>
                    <div className={styles.ustYieldValue} style={{ color: '#fbbf24' }}>
                      {breakevens.be10y.current != null ? `${breakevens.be10y.current.toFixed(2)}%` : '—'}
                    </div>
                    <div
                      className={styles.ustYieldChange}
                      style={{
                        color: breakevens.be10y.change != null
                          ? breakevens.be10y.change > 0 ? '#4EC9B0' : breakevens.be10y.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {breakevens.be10y.change != null ? `${breakevens.be10y.change > 0 ? '+' : ''}${(breakevens.be10y.change * 100).toFixed(1)}bp` : '—'}
                    </div>
                  </div>

                  <div
                    className={`${styles.ustSpreadBox} ${beSelection.type === 'beSpread' ? styles.ustBoxSelectedYellow : ''}`}
                    onClick={() => setBeSelection({ type: 'beSpread', label: '5s10s BE' })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustSpreadLabel} style={{ color: '#fbbf24' }}>5s10s BE</div>
                    <div
                      className={styles.ustSpreadValue}
                      style={{
                        color: breakevens.beSpread.current != null
                          ? breakevens.beSpread.current > 0 ? '#4EC9B0' : breakevens.beSpread.current < 0 ? '#EF5350' : '#e2e8f0'
                          : '#728197',
                      }}
                    >
                      {breakevens.beSpread.current != null ? `${breakevens.beSpread.current > 0 ? '+' : ''}${breakevens.beSpread.current.toFixed(1)}bp` : '—'}
                    </div>
                    <div
                      className={styles.ustSpreadChange}
                      style={{
                        color: breakevens.beSpread.change != null
                          ? breakevens.beSpread.change > 0 ? '#4EC9B0' : breakevens.beSpread.change < 0 ? '#EF5350' : '#728197'
                          : '#728197',
                      }}
                    >
                      {breakevens.beSpread.change != null ? `${breakevens.beSpread.change > 0 ? '+' : ''}${breakevens.beSpread.change.toFixed(1)}bp` : '—'}
                    </div>
                  </div>
                </div>

                <div className={styles.ustChartTitle}>
                  {beSelection.type === 'beYield'
                    ? `${beSelection.label}`
                    : `${beSelection.label} yield curve regimes`}
                </div>

                <div className={styles.ustChartControls}>
                  <div className={styles.ustRangeBar}>
                    {['3m', '6m', '1y', '5y', '10y', 'all'].map((range, idx) => (
                      <button
                        key={range}
                        className={`${styles.fvmRangeBtn} ${beChartRange === range ? styles.fvmRangeBtnActive : ''}`}
                        onClick={() => setBeChartRange(range)}
                        style={{
                          border: `1px solid ${beChartRange === range ? '#fbbf24' : 'rgba(255, 255, 255, 0.12)'}`,
                          ...(idx > 0 ? { borderLeft: 'none' } : {}),
                          fontSize: '0.75rem',
                          padding: '4px 10px',
                          ...(beChartRange === range ? { color: '#fbbf24', background: 'rgba(251, 191, 36, 0.08)' } : {}),
                        }}
                      >
                        {range.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {beSelection.type === 'beSpread' && (
                    <label className={styles.ustLookbackWrap}>
                      <span className={styles.ustLookbackLabel}>Lookback (days):</span>
                      <input
                        className={styles.laborInput}
                        type="number"
                        min="1"
                        value={beRegimeLookback}
                        onChange={(e) => setBeRegimeLookback(Math.max(1, Number.parseInt(e.target.value, 10) || 20))}
                        style={{ width: '50px' }}
                      />
                    </label>
                  )}
                </div>

                {beSelection.type === 'beSpread' && (
                  <div className={styles.ustRegimeLegend}>
                    {Object.entries(REGIME_COLORS).map(([name, color]) => (
                      <span key={name} className={styles.ustRegimeLegendItem}>
                        <span className={styles.ustRegimeSwatch} style={{ background: color }} />
                        {name}
                      </span>
                    ))}
                    <span className={styles.ustRegimeLegendItem}>
                      <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                      {beSelection.label}
                    </span>
                  </div>
                )}

                {beSelection.type === 'beYield' ? (
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={beChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(date: string) => {
                          const d = new Date(date)
                          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                          return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                        }}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip />
                      <Line type="monotone" dataKey="value" stroke="#fbbf24" strokeWidth={2} dot={false} />
                      <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={beSpreadChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(date: string) => {
                          const d = new Date(date)
                          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                          return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                        }}
                        interval="preserveStartEnd"
                        minTickGap={60}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                      />
                      <Tooltip />
                      <Bar dataKey="spread" barSize={3}>
                        {beSpreadChartData.map((point, idx) => (
                          <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="spread" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                      <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            )}
          </section>
        )}

        {(['gilt', 'bund', 'oat', 'btp', 'cad', 'jgb', 'agb'] as ViewTab[]).includes(activeView) && (
          <CountryCurvePage pageKey={activeView} />
        )}

        {activeView === 'attribution' && (
          <div>
            <div className={styles.ustDashboard}>
              <div className={styles.ustYcHeader}>
                <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: 0 }}>
                  5Y NOMINAL YIELD — CHANGE ATTRIBUTION
                </div>
                <div className={styles.ustYcControls}>
                  <label className={styles.ustLookbackWrap}>
                    <span className={styles.ustLookbackLabel}>Window:</span>
                    <input className={styles.laborInput} type="number" min="1" value={attrLookback} onChange={(e) => setAttrLookback(Math.max(1, parseInt(e.target.value) || 20))} style={{ width: '50px' }} />
                    <span className={styles.ustLookbackLabel}>d</span>
                  </label>
                </div>
              </div>

              <div className={styles.ustChartControls}>
                <div className={styles.ustRangeBar}>
                  {['3m', '6m', '1y', '2y', '5y', 'all'].map((range, idx) => (
                    <button
                      key={range}
                      className={styles.fvmRangeBtn}
                      onClick={() => setAttrChartRange(range)}
                      style={{
                        border: `1px solid ${attrChartRange === range ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                        ...(idx > 0 ? { borderLeft: 'none' } : {}),
                        fontSize: '0.75rem',
                        padding: '4px 10px',
                        color: attrChartRange === range ? '#e2e8f0' : '#728197',
                        background: attrChartRange === range ? 'rgba(226, 232, 240, 0.08)' : 'transparent',
                      }}
                    >
                      {range.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.ustRegimeLegend}>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                  5Y Nominal Δ
                </span>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#ef5350' }} />
                  Breakeven Δ
                </span>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#60a5fa' }} />
                  Real Yield Δ
                </span>
              </div>

              {ustLoading ? (
                <div className={styles.loading}>Loading attribution data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={500}>
                  <ComposedChart data={attrChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }} stackOffset="sign">
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      stroke="#728197"
                      tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                    />
                    <YAxis
                      stroke="#728197"
                      tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                      labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                      formatter={(value: unknown, name: string | undefined) => {
                        const labels: Record<string, string> = { nominalChg: '5Y Nominal Δ', beChg: 'Breakeven Δ', realChg: 'Real Yield Δ' }
                        return [typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(1)}bp` : '—', labels[name ?? ''] || (name ?? '')]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Bar dataKey="beChg" stackId="attr" fill="#ef5350" name="beChg" barSize={3} />
                    <Bar dataKey="realChg" stackId="attr" fill="#60a5fa" name="realChg" barSize={3} />
                    <Line type="monotone" dataKey="nominalChg" stroke="#ffffff" strokeWidth={1.5} dot={false} name="nominalChg" />
                    <Brush dataKey="date" height={25} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className={styles.ustDashboard}>
              <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 8px' }}>
                10Y NOMINAL YIELD — CHANGE ATTRIBUTION
              </div>
              <div className={styles.ustRegimeLegend}>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                  10Y Nominal Δ
                </span>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#ef5350' }} />
                  Breakeven Δ
                </span>
                <span className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: '#60a5fa' }} />
                  Real Yield Δ
                </span>
              </div>
              {ustLoading ? (
                <div className={styles.loading}>Loading attribution data…</div>
              ) : (
                <ResponsiveContainer width="100%" height={500}>
                  <ComposedChart data={attr10yChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }} stackOffset="sign">
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      stroke="#728197"
                      tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                    />
                    <YAxis
                      stroke="#728197"
                      tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                      labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                      formatter={(value: unknown, name: string | undefined) => {
                        const labels: Record<string, string> = { nominalChg: '10Y Nominal Δ', beChg: 'Breakeven Δ', realChg: 'Real Yield Δ' }
                        return [typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(1)}bp` : '—', labels[name ?? ''] || (name ?? '')]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Bar dataKey="beChg" stackId="attr" fill="#ef5350" name="beChg" barSize={3} />
                    <Bar dataKey="realChg" stackId="attr" fill="#60a5fa" name="realChg" barSize={3} />
                    <Line type="monotone" dataKey="nominalChg" stroke="#ffffff" strokeWidth={1.5} dot={false} name="nominalChg" />
                    <Brush dataKey="date" height={25} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {activeView === 'credit' && (
          <div>
            <div className={styles.ustDashboard} style={{ marginBottom: '12px' }}>
              <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 8px' }}>
                CREDIT SPREADS
              </div>

              <div className={styles.ustRangeBar} style={{ marginBottom: '6px' }}>
                {['3m', '6m', '1y', '2y', '5y', '10y', 'all'].map((range, idx) => (
                  <button
                    key={range}
                    className={styles.fvmRangeBtn}
                    onClick={() => setCreditOverviewRange(range)}
                    style={{
                      border: `1px solid ${creditOverviewRange === range ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                      ...(idx > 0 ? { borderLeft: 'none' } : {}),
                      fontSize: '0.75rem',
                      padding: '4px 10px',
                      color: creditOverviewRange === range ? '#60a5fa' : '#728197',
                      background: creditOverviewRange === range ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                    }}
                  >
                    {range.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className={styles.creditLegend}>
                {CREDIT_SERIES_CONFIG.map((s) => (
                  <button
                    key={s.key}
                    className={`${styles.creditLegendItem} ${!creditVisibleSeries[s.key] ? styles.creditLegendItemOff : ''}`}
                    onClick={() => toggleCreditSeries(s.key)}
                  >
                    <span className={styles.creditLegendSwatch} style={{ background: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>

              {ustLoading ? (
                <div className={styles.loading}>Loading credit data…</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={creditOverviewChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={60} />
                      <YAxis stroke="#728197" tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                        labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                        formatter={(value: unknown, name: string | undefined) => {
                          const cfg = CREDIT_SERIES_CONFIG.find((s) => s.key === name)
                          return [typeof value === 'number' ? `${value.toFixed(0)}bp` : '—', cfg?.label || (name ?? '')]
                        }}
                      />
                      {CREDIT_SERIES_CONFIG.map((s) => (
                        creditVisibleSeries[s.key] ? (
                          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} connectNulls name={s.key} />
                        ) : null
                      ))}
                      <Brush dataKey="date" height={25} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </LineChart>
                  </ResponsiveContainer>

                  <table className={styles.creditTable}>
                    <thead>
                      <tr>
                        <th className={styles.creditThLeft}>Spread</th>
                        <th>Last (bp)</th>
                        <th>1D Δ</th>
                        <th>1W Δ</th>
                        <th>1M Δ</th>
                        <th>3MO Δ</th>
                        <th>6MO Δ</th>
                        <th>YTD Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditSpreadDashboard.map((row) => (
                        <tr key={row.label}>
                          <td className={styles.creditSpreadName}>{row.label}</td>
                          <td className={styles.creditSpreadLast}>{row.current != null ? row.current.toFixed(0) : '—'}</td>
                          {row.changes.map((chg, idx) => (
                            <td
                              key={idx}
                              style={{
                                color: chg != null ? (chg > 0 ? '#EF5350' : chg < 0 ? '#4EC9B0' : '#728197') : '#728197',
                                background: getCreditCellBg(chg, idx),
                              }}
                            >
                              {chg != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(0)}` : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            <div className={styles.ustDashboard}>
              <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 8px' }}>
                HY SPREAD W UST CURVE REGIMES
              </div>
            <div className={styles.creditControlsRow}>
              <div className={styles.ustRangeBar}>
                {['3m', '6m', '1y', '2y', '5y', '10y', 'all'].map((range, idx) => (
                  <button
                    key={range}
                    className={styles.fvmRangeBtn}
                    onClick={() => setCreditChartRange(range)}
                    style={{
                      border: `1px solid ${creditChartRange === range ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                      ...(idx > 0 ? { borderLeft: 'none' } : {}),
                      fontSize: '0.75rem',
                      padding: '4px 10px',
                      color: creditChartRange === range ? '#60a5fa' : '#728197',
                      background: creditChartRange === range ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                    }}
                  >
                    {range.toUpperCase()}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <label className={styles.ustLookbackWrap}>
                  <span className={styles.ustLookbackLabel}>Regime:</span>
                  <input className={styles.laborInput} type="number" min="1" value={creditRegimeLookback} onChange={(e) => setCreditRegimeLookback(Math.max(1, parseInt(e.target.value) || 20))} style={{ width: '45px' }} />
                  <span className={styles.ustLookbackLabel}>d</span>
                </label>
                <label className={styles.ustLookbackWrap}>
                  <span className={styles.ustLookbackLabel}>RoC:</span>
                  <input className={styles.laborInput} type="number" min="1" value={creditRocLookback} onChange={(e) => setCreditRocLookback(Math.max(1, parseInt(e.target.value) || 20))} style={{ width: '45px' }} />
                  <span className={styles.ustLookbackLabel}>d</span>
                </label>
              </div>
            </div>

            <div className={styles.ustRegimeLegend}>
              {Object.entries(REGIME_COLORS).map(([name, color]) => (
                <span key={name} className={styles.ustRegimeLegendItem}>
                  <span className={styles.ustRegimeSwatch} style={{ background: color }} />
                  {name}
                </span>
              ))}
            </div>

            {ustLoading ? (
              <div className={styles.loading}>Loading credit data…</div>
            ) : (
              <div className={styles.creditChartGrid}>
                <div>
                  <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 2px' }}>US HY OAS</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#728197', paddingBottom: '8px' }}>
                    w/ 2s10s Curve Regimes ({creditRegimeLookback}d)
                  </div>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={creditChartData} margin={{ top: 10, right: 16, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                      <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => v.toFixed(1)} domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}
                        labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                        formatter={(value: unknown, name: string | undefined) => [typeof value === 'number' ? `${value.toFixed(2)}%` : '—', name === 'oas' ? 'HY OAS' : '']}
                      />
                      <Bar dataKey="oas" barSize={3}>
                        {creditChartData.map((point, idx) => (
                          <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="oas" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                      <Brush dataKey="date" height={25} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 2px' }}>US HY OAS — {creditRocLookback}D RATE OF CHANGE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: '#728197', paddingBottom: '8px' }}>
                    w/ 2s10s Curve Regimes ({creditRegimeLookback}d)
                  </div>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={creditRocChartData} margin={{ top: 10, right: 16, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                      <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                      <Tooltip
                        contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}
                        labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                        formatter={(value: unknown, name: string | undefined) => [typeof value === 'number' ? `${value.toFixed(1)}bp` : '—', name === 'roc' ? `${creditRocLookback}d Δ` : '']}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                      <Bar dataKey="roc" barSize={3}>
                        {creditRocChartData.map((point, idx) => (
                          <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="roc" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                      <Brush dataKey="date" height={25} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {activeView === 'money' && (
          <div>
            <div className={styles.ustDashboard}>
              <div className={styles.ustSectionLabel} style={{ color: '#e2e8f0', padding: '0 0 12px' }}>
                MONEY MARKET RATE SPREADS
              </div>

              {ustLoading ? (
                <div className={styles.loading}>Loading money market data…</div>
              ) : (
                <div className={styles.mmGrid}>
                  {/* SOFR − IORB (top left) */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>SOFR − IORB</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197', padding: '2px 0 8px', lineHeight: 1.4 }}>Positive spread means banks are lending reserves in repo, reducing liquidity elsewhere</div>
                    <div style={{ marginBottom: '6px' }}>
                      <div className={styles.ustRangeBar}>
                        {['3m', '6m', '1y', '2y', '5y', 'all'].map((range, idx) => (
                          <button key={range} className={styles.fvmRangeBtn} onClick={() => setMmRange1(range)} style={{ border: `1px solid ${mmRange1 === range ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`, ...(idx > 0 ? { borderLeft: 'none' } : {}), fontSize: '0.65rem', padding: '2px 7px', color: mmRange1 === range ? '#e2e8f0' : '#728197', background: mmRange1 === range ? 'rgba(226, 232, 240, 0.08)' : 'transparent' }}>{range.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={mmData1} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                        <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }} labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }} formatter={(value: unknown) => [typeof value === 'number' ? `${value.toFixed(1)}bp` : '—', 'SOFR − IORB']} />
                        <ReferenceLine y={0} stroke="#EF5350" strokeWidth={1.5} label={{ value: 'SCARCITY WARNING', position: 'insideTopLeft', fill: '#EF5350', fontSize: 9, fontWeight: 600 }} />
                        <Line type="monotone" dataKey="sofrIorb" stroke="#4EC9B0" strokeWidth={1.5} dot={false} connectNulls />
                        <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* EFFR − IORB (top right) */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>EFFR − IORB</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197', padding: '2px 0 8px', lineHeight: 1.4 }}>Historically a positive spread has been an indicator of reserve scarcity</div>
                    <div style={{ marginBottom: '6px' }}>
                      <div className={styles.ustRangeBar}>
                        {['3m', '6m', '1y', '2y', '5y', 'all'].map((range, idx) => (
                          <button key={range} className={styles.fvmRangeBtn} onClick={() => setMmRange2(range)} style={{ border: `1px solid ${mmRange2 === range ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`, ...(idx > 0 ? { borderLeft: 'none' } : {}), fontSize: '0.65rem', padding: '2px 7px', color: mmRange2 === range ? '#e2e8f0' : '#728197', background: mmRange2 === range ? 'rgba(226, 232, 240, 0.08)' : 'transparent' }}>{range.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={mmData2} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                        <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }} labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }} formatter={(value: unknown) => [typeof value === 'number' ? `${value.toFixed(1)}bp` : '—', 'EFFR − IORB']} />
                        <ReferenceLine y={0} stroke="#EF5350" strokeWidth={1.5} label={{ value: 'SCARCITY WARNING', position: 'insideTopLeft', fill: '#EF5350', fontSize: 9, fontWeight: 600 }} />
                        <Line type="monotone" dataKey="effrIorb" stroke="#fbbf24" strokeWidth={1.5} dot={false} connectNulls />
                        <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* SOFR − EFFR (bottom left) */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>SOFR − EFFR</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197', padding: '2px 0 8px', lineHeight: 1.4 }}>FHLB Repo Demand: Higher spread means FHLBs deploy more cash to repos</div>
                    <div style={{ marginBottom: '6px' }}>
                      <div className={styles.ustRangeBar}>
                        {['3m', '6m', '1y', '2y', '5y', 'all'].map((range, idx) => (
                          <button key={range} className={styles.fvmRangeBtn} onClick={() => setMmRange3(range)} style={{ border: `1px solid ${mmRange3 === range ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`, ...(idx > 0 ? { borderLeft: 'none' } : {}), fontSize: '0.65rem', padding: '2px 7px', color: mmRange3 === range ? '#e2e8f0' : '#728197', background: mmRange3 === range ? 'rgba(226, 232, 240, 0.08)' : 'transparent' }}>{range.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={mmData3} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                        <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                        <Tooltip contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }} labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }} formatter={(value: unknown) => [typeof value === 'number' ? `${value.toFixed(1)}bp` : '—', 'SOFR − EFFR']} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                        <Line type="monotone" dataKey="sofrEffr" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls />
                        <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Reserve Demand Elasticity (bottom right) */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>RESERVE DEMAND ELASTICITY</div>
                      <button onClick={handleRdeRefresh} disabled={rdeSyncing} style={{ background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.12)', color: rdeSyncing ? '#4a5568' : '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: '0.55rem', padding: '2px 6px', cursor: rdeSyncing ? 'not-allowed' : 'pointer', borderRadius: '2px' }}>{rdeSyncing ? 'SYNCING...' : '↻ REFRESH'}</button>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197', padding: '2px 0 8px', lineHeight: 1.4 }}>Basis point/percentage point — NY Fed estimate of reserve ampleness</div>
                    <div style={{ marginBottom: '6px' }}>
                      <div className={styles.ustRangeBar}>
                        {['1y', '2y', '5y', '10y', 'all'].map((range, idx) => (
                          <button key={range} className={styles.fvmRangeBtn} onClick={() => setRdeRange(range)} style={{ border: `1px solid ${rdeRange === range ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`, ...(idx > 0 ? { borderLeft: 'none' } : {}), fontSize: '0.65rem', padding: '2px 7px', color: rdeRange === range ? '#e2e8f0' : '#728197', background: rdeRange === range ? 'rgba(226, 232, 240, 0.08)' : 'transparent' }}>{range.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.ustRegimeLegend} style={{ paddingBottom: '4px' }}>
                      <span className={styles.ustRegimeLegendItem}><span className={styles.ustRegimeSwatch} style={{ background: '#60a5fa' }} />97.5th / 2.5th</span>
                      <span className={styles.ustRegimeLegendItem}><span className={styles.ustRegimeSwatch} style={{ background: '#94A3B8' }} />84th / 16th</span>
                      <span className={styles.ustRegimeLegendItem}><span className={styles.ustRegimeSwatch} style={{ background: '#EF5350', height: '2px', borderRadius: '1px' }} />50th (median)</span>
                    </div>
                    {rdeChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={rdeChartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                          <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} tickFormatter={(date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis stroke="#728197" tick={{ fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }} labelFormatter={(label: unknown) => { if (typeof label !== 'string') return ''; return new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                          <Line type="monotone" dataKey="p97_5" stroke="#60a5fa" strokeWidth={1} dot={false} name="97.5th" />
                          <Line type="monotone" dataKey="p2_5" stroke="#60a5fa" strokeWidth={1} dot={false} name="2.5th" />
                          <Line type="monotone" dataKey="p84" stroke="#94A3B8" strokeWidth={1} dot={false} name="84th" />
                          <Line type="monotone" dataKey="p16" stroke="#94A3B8" strokeWidth={1} dot={false} name="16th" />
                          <Line type="monotone" dataKey="median" stroke="#EF5350" strokeWidth={2} dot={false} name="Median" />
                          <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#4a5568', textAlign: 'center', padding: '40px 0' }}>No RDE data — click REFRESH to sync from NY Fed</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === 'auctions' && (
          <Suspense fallback={<div className={styles.comingSoon}>Loading…</div>}>
            <TreasuryAuctionContent />
          </Suspense>
        )}

          </div>

          {(activeView === 'strips' || activeView === 'pricing') && country === 'US' && (
          <div className={styles.rightPanel}>
            <div className={styles.fvmPanel}>
              <div className={styles.fvmHeader}>
                <h2 className={styles.fvmTitle}>FUNDAMENTAL MODEL</h2>
                {(fvmTab === 'cpi' || fvmTab === 'pce') && (
                  <div className={styles.fvmMeasureToggle}>
                    <button
                      className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'headline' ? styles.fvmMeasureBtnActive : ''}`}
                      onClick={() => setFvmMeasure('headline')}
                      style={{
                        border: `1px solid ${fvmMeasure === 'headline' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                      }}
                    >
                      HEADLINE
                    </button>
                    <button
                      className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'core' ? styles.fvmMeasureBtnActive : ''}`}
                      onClick={() => setFvmMeasure('core')}
                      style={{
                        border: `1px solid ${fvmMeasure === 'core' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                        borderLeft: 'none',
                      }}
                    >
                      CORE
                    </button>
                  </div>
                )}
              </div>
              <div className={styles.fvmTabs}>
                {FVM_TABS.map((tab, idx) => (
                  <button
                    key={tab.key}
                    className={`${styles.fvmTab} ${fvmTab === tab.key ? styles.fvmTabActive : ''}`}
                    onClick={() => {
                      setFvmTab(tab.key)
                      if (tab.key === 'labor') setFvmRange('2y')
                      if (tab.key === 'growth') setFvmRange('all')
                    }}
                    style={{
                      border: `1px solid ${fvmTab === tab.key ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                      ...(idx > 0 ? { borderLeft: 'none' } : {}),
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className={styles.fvmBody}>
                {fvmTab === 'cpi' || fvmTab === 'pce' ? (
                  (fvmTab === 'cpi' ? cpiError : pceError) ? (
                    <div className={styles.comingSoon}>{fvmTab === 'cpi' ? cpiError : pceError}</div>
                  ) : (fvmTab === 'cpi' ? cpiLoading : pceLoading) ? (
                    <div className={styles.comingSoon}>Loading {fvmTab === 'cpi' ? 'CPI' : 'PCE'} model…</div>
                  ) : (
                    <>
                      <div className={styles.fvmStatsLine}>
                        LATEST: {activeFvmModel.currentDate ? fmtShortMonthYear(activeFvmModel.currentDate) : '—'} | Index: {activeFvmModel.currentLevel ? activeFvmModel.currentLevel.toFixed(3) : '—'} | MoM: {activeFvmModel.currentMoM != null ? `${fmtSignedPct(activeFvmModel.currentMoM)}%` : '—'} | YoY: {activeFvmModel.currentYoY != null ? `${activeFvmModel.currentYoY.toFixed(2)}%` : '—'}
                      </div>

                      <div className={styles.fvmRangeBar}>
                        {FVM_RANGES.map((range, idx) => (
                          <button
                            key={range.key}
                            className={`${styles.fvmRangeBtn} ${fvmRange === range.key ? styles.fvmRangeBtnActive : ''}`}
                            onClick={() => setFvmRange(range.key)}
                            style={{
                              border: `1px solid ${fvmRange === range.key ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                              ...(idx > 0 ? { borderLeft: 'none' } : {}),
                            }}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setShowFedFunds((v) => !v)}
                        style={{
                          background: showFedFunds ? 'rgba(167, 139, 250, 0.08)' : 'transparent',
                          border: `1px solid ${showFedFunds ? '#a78bfa' : 'rgba(255, 255, 255, 0.12)'}`,
                          color: showFedFunds ? '#a78bfa' : '#728197',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          padding: '3px 10px',
                          cursor: 'pointer',
                          borderRadius: '2px',
                          marginBottom: '6px',
                        }}
                      >
                        FED FUNDS
                      </button>

                      <div className={styles.fvmLegend}>
                        <span style={{ color: '#e2e8f0' }}>― YoY actual</span>
                        <span style={{ color: '#4ade80' }}>-- 1M MoM</span>
                        <span style={{ color: '#22d3ee' }}>-- 3M MoM avg</span>
                        <span style={{ color: '#fbbf24' }}>-- 6M MoM avg</span>
                        <span style={{ color: '#EF5350' }}>-- 2% Target</span>
                        {showFedFunds && <span style={{ color: '#a78bfa' }}>― Fed Funds</span>}
                      </div>

                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={fvmYoYDataWithFF} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                          <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={(v: string) => fmtShortMonthYear(v)} minTickGap={24} />
                          <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={fvmYoYDomain} allowDataOverflow />
                          <Tooltip
                            contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                            labelStyle={{ color: '#94A3B8' }}
                            formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                            labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                          />
                          <ReferenceLine y={2} stroke="#EF5350" strokeDasharray="8 4" />
                          <Line type="monotone" dataKey="yoy" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace1m" stroke="#4ade80" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace3m" stroke="#22d3ee" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace6m" stroke="#fbbf24" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                          {showFedFunds && (
                            <Line type="monotone" dataKey="fedFunds" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="Fed Funds" />
                          )}
                        </LineChart>
                      </ResponsiveContainer>

                      <div className={styles.fvmSectionLabel}>MoM % — Historical month-over-month changes</div>

                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={fvmFilteredMomData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={(v: string) => fmtShortMonthYear(v)} minTickGap={24} />
                          <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={fvmMomDomain} allowDataOverflow />
                          <Tooltip
                            contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                            labelStyle={{ color: '#94A3B8' }}
                            formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                            labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                          <Line
                            type="monotone"
                            dataKey="mom"
                            stroke="#4EC9B0"
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </>
                  )
                ) : fvmTab === 'labor' ? (
                  laborError ? (
                    <div className={styles.comingSoon}>{laborError}</div>
                  ) : laborLoading ? (
                    <div className={styles.comingSoon}>Loading labor model…</div>
                  ) : !laborProjection ? (
                    <div className={styles.comingSoon}>No labor data available</div>
                  ) : (
                    <>
                      <div className={styles.fvmStatsLine}>
                        LATEST: {fmtShortMonthYear(laborProjection.latestDate)} | U-3: {laborProjection.currentU3.toFixed(1)}% | Employment: {INTEGER_FORMAT.format(Math.round(laborProjection.currentEmployment))}k | CLF: {INTEGER_FORMAT.format(Math.round(laborProjection.currentClf))}k
                      </div>

                      <div className={styles.laborInputRow}>
                        <span className={styles.laborInputLabel}>CLF Growth:</span>
                        <input
                          className={styles.laborInput}
                          type="number"
                          step="0.01"
                          value={clfGrowthRate}
                          onChange={(e) => {
                            const value = Number.parseFloat(e.target.value)
                            if (!Number.isNaN(value)) setClfGrowthRate(value)
                          }}
                        />
                        <span className={styles.laborInputLabel}>%/mo</span>
                        <span className={styles.laborInputLabel}>Scenarios (k):</span>
                        {payrollScenarios.map((scenario, index) => (
                          <input
                            key={index}
                            className={styles.laborInput}
                            type="number"
                            step="25"
                            value={scenario}
                            onChange={(e) => {
                              const value = Number.parseFloat(e.target.value)
                              if (Number.isNaN(value)) return
                              setPayrollScenarios((prev) => prev.map((item, itemIndex) => (
                                itemIndex === index ? value : item
                              )))
                            }}
                          />
                        ))}
                      </div>

                      <div className={styles.fvmRangeBar}>
                        {FVM_RANGES.map((range, idx) => (
                          <button
                            key={range.key}
                            className={`${styles.fvmRangeBtn} ${fvmRange === range.key ? styles.fvmRangeBtnActive : ''}`}
                            onClick={() => setFvmRange(range.key)}
                            style={{
                              border: `1px solid ${fvmRange === range.key ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                              ...(idx > 0 ? { borderLeft: 'none' } : {}),
                            }}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setShowFedFunds((v) => !v)}
                        style={{
                          background: showFedFunds ? 'rgba(167, 139, 250, 0.08)' : 'transparent',
                          border: `1px solid ${showFedFunds ? '#a78bfa' : 'rgba(255, 255, 255, 0.12)'}`,
                          color: showFedFunds ? '#a78bfa' : '#728197',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          padding: '3px 10px',
                          cursor: 'pointer',
                          borderRadius: '2px',
                          marginBottom: '6px',
                        }}
                      >
                        FED FUNDS
                      </button>

                      <div className={styles.fvmLegend}>
                        <span style={{ color: '#e2e8f0' }}>― U-3 actual</span>
                        <span style={{ color: '#EF5350' }}>-- {payrollScenarios[0]}k</span>
                        <span style={{ color: '#fbbf24' }}>-- {payrollScenarios[1]}k</span>
                        <span style={{ color: '#22d3ee' }}>-- {payrollScenarios[2]}k</span>
                        <span style={{ color: '#4ade80' }}>-- {payrollScenarios[3]}k</span>
                        {showFedFunds && <span style={{ color: '#a78bfa' }}>― Fed Funds</span>}
                      </div>

                      <ResponsiveContainer width="100%" height={350}>
                        <LineChart data={laborChartDataWithFF} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={(v: string) => fmtShortMonthYear(v)} minTickGap={24} />
                          <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={laborDomain} allowDataOverflow />
                          <Tooltip
                            contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                            labelStyle={{ color: '#94A3B8' }}
                            formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                            labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                          />
                          <ReferenceLine
                            x={laborProjection.latestDate}
                            stroke="rgba(255,255,255,0.3)"
                            strokeDasharray="4 4"
                          />
                          <Line type="monotone" dataKey="historical" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario0" stroke={LABOR_SCENARIO_COLORS[0]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario1" stroke={LABOR_SCENARIO_COLORS[1]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario2" stroke={LABOR_SCENARIO_COLORS[2]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario3" stroke={LABOR_SCENARIO_COLORS[3]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          {showFedFunds && (
                            <Line type="monotone" dataKey="fedFunds" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="Fed Funds" />
                          )}
                        </LineChart>
                      </ResponsiveContainer>

                      <div className={styles.fvmSectionLabel}>YoY % — Total Nonfarm Payroll Growth</div>

                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredPayrollYoY} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={(v: string) => fmtShortMonthYear(v)} minTickGap={24} />
                          <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={payrollYoYDomain} allowDataOverflow />
                          <Tooltip
                            contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                            labelStyle={{ color: '#94A3B8' }}
                            formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                            labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                          <Line
                            type="monotone"
                            dataKey="yoy"
                            stroke="#a78bfa"
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls
                          />
                        </LineChart>
                      </ResponsiveContainer>

                      <div className={styles.fvmSectionLabel}>MoM Δ — Total Nonfarm Payroll Growth (Thousands)</div>
                      <div className={styles.fvmLegend}>
                        <span style={{ color: '#4EC9B0' }}>■ MoM Δ (k)</span>
                        <span style={{ color: '#4ade80' }}>-- 3mo MA</span>
                        <span style={{ color: '#fbbf24' }}>-- 6mo MA</span>
                      </div>

                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={filteredPayrollMoM} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={(v: string) => fmtShortMonthYear(v)} minTickGap={24} />
                          <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => v.toFixed(0)} width={42} domain={payrollMoMDomain} allowDataOverflow />
                          <Tooltip
                            contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                            labelStyle={{ color: '#94A3B8' }}
                            formatter={(value: unknown) => (typeof value === 'number' ? value.toFixed(0) : '—')}
                            labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                          <Bar dataKey="mom" radius={[1, 1, 0, 0]}>
                            {filteredPayrollMoM.map((point, idx) => (
                              <Cell key={idx} fill={(point.mom ?? 0) >= 0 ? '#4EC9B0' : '#EF5350'} />
                            ))}
                          </Bar>
                          <Line
                            type="monotone"
                            dataKey="ma3"
                            stroke="#4ade80"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                            connectNulls
                          />
                          <Line
                            type="monotone"
                            dataKey="ma6"
                            stroke="#fbbf24"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                            connectNulls
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </>
                  )
                ) : fvmTab === 'growth' ? (
                  gdpnowError ? (
                    <div className={styles.comingSoon}>{gdpnowError}</div>
                  ) : gdpnowLoading ? (
                    <div className={styles.comingSoon}>Loading GDPNow data…</div>
                  ) : gdpnowData.length === 0 ? (
                    <div className={styles.comingSoon}>No GDPNow data available</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className={styles.fvmSectionLabel}>GDPNow — Atlanta Fed Nowcast</div>
                        <button
                          onClick={handleGdpnowRefresh}
                          disabled={gdpnowSyncing}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: gdpnowSyncing ? '#4a5568' : '#94A3B8',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.6rem',
                            padding: '3px 8px',
                            cursor: gdpnowSyncing ? 'not-allowed' : 'pointer',
                            borderRadius: '2px',
                          }}
                        >
                          {gdpnowSyncing ? 'SYNCING...' : '↻ REFRESH'}
                        </button>
                      </div>

                      <div className={styles.fvmStatsLine}>
                        {gdpnowLatest
                          ? `LATEST: ${gdpnowLatest.quarter} | ${gdpnowLatest.value.toFixed(1)}% | Updated: ${gdpnowLatest.forecastDate}`
                          : 'LATEST: —'}
                      </div>

                      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                        {['6m', '1y', '2y', '5y', 'all'].map((r) => (
                          <button
                            key={r}
                            onClick={() => setGdpnowRange(r)}
                            style={{
                              background: gdpnowRange === r ? 'rgba(255,215,0,0.15)' : 'transparent',
                              border: `1px solid ${gdpnowRange === r ? '#e2e8f0' : 'rgba(255,255,255,0.12)'}`,
                              color: gdpnowRange === r ? '#e2e8f0' : '#94A3B8',
                              borderRadius: '3px',
                              padding: '2px 8px',
                              fontSize: '0.65rem',
                              fontFamily: 'var(--font-mono)',
                              cursor: 'pointer',
                              textTransform: 'uppercase',
                            }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>

                      <div className={styles.fvmLegend}>
                        {gdpnowChartData.quarters.slice(-6).map((quarter) => {
                          const globalIdx = gdpnowChartData.quarters.indexOf(quarter)
                          return (
                            <span key={quarter} style={{ color: getQuarterColor(globalIdx) }}>
                              ― {quarter}
                            </span>
                          )
                        })}
                      </div>

                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={gdpnowChartData.merged} margin={{ top: 10, right: 16, left: 8, bottom: 16 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="date"
                            stroke="#728197"
                            tick={FVM_TICK}
                            tickFormatter={(date: string) => {
                              const d = new Date(date)
                              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                              return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                            }}
                            interval="preserveStartEnd"
                            minTickGap={50}
                          />
                          <YAxis
                            stroke="#728197"
                            tick={FVM_TICK}
                            tickFormatter={(value: number) => `${value.toFixed(1)}%`}
                            domain={['auto', 'auto']}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
                          <Tooltip
                            contentStyle={{
                              background: '#0d1520',
                              border: '1px solid rgba(255,255,255,0.12)',
                              borderRadius: '3px',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.7rem',
                            }}
                            labelFormatter={(label: unknown) => {
                              if (typeof label !== 'string') return ''
                              const date = label
                              const d = new Date(date)
                              return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            }}
                            formatter={(value: unknown, name: string | undefined) => [
                              typeof value === 'number' ? `${value.toFixed(1)}%` : '—',
                              name ?? '',
                            ]}
                          />
                          {gdpnowChartData.quarters.map((quarter, idx) => (
                            <Line
                              key={quarter}
                              type="stepAfter"
                              dataKey={quarter}
                              stroke={getQuarterColor(idx)}
                              strokeWidth={1.5}
                              dot={false}
                              connectNulls={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>

                      {contribChartData.length > 0 && (
                        <>
                          <div className={styles.fvmSectionLabel} style={{ marginTop: '16px' }}>GDPNOW SUBCOMPONENT CONTRIBUTIONS</div>

                          <div className={styles.fvmLegend}>
                            {CONTRIB_COMPONENTS.map((c) => (
                              <span key={c.key} style={{ color: c.color }}>{'\u25A0'} {c.label}</span>
                            ))}
                            <span style={{ color: '#ffffff' }}>― GDP</span>
                          </div>

                          <ResponsiveContainer width="100%" height={350}>
                            <ComposedChart data={contribChartData} margin={{ top: 10, right: 16, left: 8, bottom: 16 }} stackOffset="sign">
                              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                stroke="#728197"
                                tick={{ fontSize: 9, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                                tickFormatter={(date: string) => {
                                  const d = new Date(date)
                                  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                                  return `${months[d.getMonth()]} ${d.getDate()}`
                                }}
                                interval="preserveStartEnd"
                                minTickGap={40}
                              />
                              <YAxis
                                stroke="#728197"
                                tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: '#0d1520',
                                  border: '1px solid rgba(255,255,255,0.12)',
                                  borderRadius: '3px',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '0.65rem',
                                }}
                                formatter={(value: unknown, name: string | undefined) => [
                                  typeof value === 'number' ? `${value.toFixed(2)}pp` : '—',
                                  name ?? '',
                                ]}
                                labelFormatter={(label: unknown) => {
                                  if (typeof label !== 'string') return ''
                                  const d = new Date(label)
                                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                }}
                              />
                              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />

                              {CONTRIB_COMPONENTS.map((c) => (
                                <Bar key={c.key} dataKey={c.key} stackId="contrib" fill={c.color} name={c.label} />
                              ))}

                              <Line
                                type="stepAfter"
                                dataKey="gdp"
                                stroke="#ffffff"
                                strokeWidth={2}
                                dot={false}
                                name="GDP"
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </>
                      )}
                    </>
                  )
                ) : (
                  <div className={styles.comingSoon}>
                    {FVM_TABS.find((tab) => tab.key === fvmTab)?.label} — coming soon
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {(activeView === 'strips' || activeView === 'pricing') && country === 'UK' && (
            <div className={styles.rightPanel}>
              <UKFundamentalModelPanel />
            </div>
          )}

          {(activeView === 'strips' || activeView === 'pricing') && country === 'EU' && (
            <div className={styles.rightPanel}>
              <EUFundamentalModelPanel />
            </div>
          )}

          {(activeView === 'strips' || activeView === 'pricing') && country === 'CAD' && (
            <div className={styles.rightPanel}>
              <CAFundamentalModelPanel />
            </div>
          )}

          {(activeView === 'strips' || activeView === 'pricing') && country === 'JPY' && (
            <div className={styles.rightPanel}>
              <JPFundamentalModelPanel />
            </div>
          )}

          {(activeView === 'strips' || activeView === 'pricing') && country === 'AUS' && (
            <div className={styles.rightPanel}>
              <AUFundamentalModelPanel />
            </div>
          )}
        </div>
        {activeView === 'strips' && useStirStyling && stripContracts.length > 0 && (
          <section className={styles.spreadsDashboardFullWidth}>
            <div className={styles.spreadsDashboardHeader}>
              <div className={styles.spreadsHeader}>{activeMarket.root} CALENDAR SPREADS</div>
              <div className={styles.spreadLookbackControl}>
                <label htmlFor="spreadLookback">t −</label>
                <input
                  id="spreadLookback"
                  type="number"
                  min="0"
                  max="252"
                  value={spreadLookbackDays}
                  onChange={(e) => setSpreadLookbackDays(Math.max(0, parseInt(e.target.value) || 0))}
                  className={styles.spreadLookbackInput}
                />
              </div>
            </div>
            <div className={styles.spreadsDateLabels}>
              <span>{'●'} LATEST: {spreadCurve.currentDate || '—'}</span>
              {spreadLookbackDays > 0 && spreadCurve.lookbackDate && (
                <span style={{ marginLeft: 16 }}>{'●'} BENCHMARK: {spreadCurve.lookbackDate} (t − {spreadLookbackDays})</span>
              )}
            </div>
            <div
              className={styles.spreadsGrid}
              style={{ gridTemplateColumns: `repeat(${Math.max(1, spreadColumns.filter((c) => c.data.length > 0).length)}, 1fr)` }}
            >
              {spreadColumns.filter((c) => c.data.length > 0).map((col) => (
                <div key={col.stride} className={styles.spreadColumn}>
                  <div className={styles.spreadColumnTitle}>{col.stride}m Spreads</div>
                  <div className={styles.spreadChartContainer}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={col.data} margin={{ top: 12, right: 12, left: 8, bottom: 50 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={8}
                          angle={-30}
                          textAnchor="end"
                          height={50}
                          interval={0}
                          stroke="#728197"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={6}
                          tickFormatter={(v: number) => v.toFixed(1)}
                          label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: '#cbd5e1', fontSize: 10 }}
                          domain={['auto', 'auto']}
                          stroke="#728197"
                        />
                        <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1} />
                        <Tooltip
                          contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                          formatter={(v: number | undefined, name: string | undefined) => [
                            v == null ? '—' : `${v.toFixed(2)}bp`,
                            name === 'lookbackBps' ? `t − ${spreadLookbackDays}` : 'Current',
                          ]}
                        />
                        <Line type="linear" dataKey="spreadBps" stroke="#22d3ee" strokeWidth={1.5} dot={{ r: 3, fill: '#22d3ee' }} isAnimationActive={false} name="Current" />
                        {spreadLookbackDays > 0 && (
                          <Line type="linear" dataKey="lookbackBps" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2, fill: '#94a3b8' }} isAnimationActive={false} connectNulls={false} name={`t − ${spreadLookbackDays}`} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <table className={styles.spreadTable}>
                    <thead>
                      <tr>
                        <th>Spread</th>
                        <th>Value</th>
                        <th>1D Δ</th>
                        <th>5D Δ</th>
                        <th>1M Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {col.data.map((s) => {
                        const valClass = s.spreadBps > 0 ? styles.ocrPositive : s.spreadBps < 0 ? styles.ocrNegative : ''
                        const chClass = (v: number | null) =>
                          v == null ? '' : v > 0 ? styles.changeNegative : v < 0 ? styles.changePositive : ''
                        const fmt = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
                        return (
                          <tr key={s.label}>
                            <td
                              className={styles.spreadLabelClickable}
                              onClick={() => setOpenSpread({ label: s.label, frontSymbol: s.frontSymbol, backSymbol: s.backSymbol })}
                            >{s.label}</td>
                            <td className={valClass}>{fmt(s.spreadBps)}</td>
                            <td className={chClass(s.change1d)}>{fmt(s.change1d)}</td>
                            <td className={chClass(s.change5d)}>{fmt(s.change5d)}</td>
                            <td className={chClass(s.change1m)}>{fmt(s.change1m)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )}
        </>}
        </>)}
      </main>
      {openSpread && (
        <div className={styles.modalBackdrop} onClick={() => setOpenSpread(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setOpenSpread(null)} aria-label="Close">×</button>
            <h2 className={styles.modalTitle} style={{ color: '#22d3ee' }}>{openSpread.label}</h2>
            <p className={styles.modalSubtitle}>{activeMarket.title} · {openSpread.frontSymbol} − {openSpread.backSymbol}</p>
            <div className={styles.modalChartContainer}>
              {(spreadFrontHistory.loading || spreadBackHistory.loading) ? (
                <div className={styles.loading} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
              ) : spreadModalChartData.length === 0 ? (
                <div className={styles.loading} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No history available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={spreadModalChartData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 13, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(value: string) => {
                        const d = new Date(value)
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                      tickMargin={8}
                      stroke="#728197"
                    />
                    <YAxis
                      tick={{ fontSize: 13, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(v: number) => `${v.toFixed(1)}bp`}
                      tickMargin={6}
                      domain={['auto', 'auto']}
                      stroke="#728197"
                    />
                    <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1} />
                    <Tooltip
                      contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                      formatter={(v: number | undefined) => v == null ? '' : `${v.toFixed(2)}bp`}
                    />
                    <Line type="monotone" dataKey="spread" stroke="#22d3ee" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    <Brush
                      dataKey="date"
                      height={28}
                      stroke="#60a5fa"
                      fill="#0d1520"
                      travellerWidth={10}
                      tickFormatter={(value: string) => {
                        const d = new Date(value)
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={styles.modalRangeButtons}>
              {(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((r) => (
                <button key={r} className={spreadModalRange === r ? styles.activeRange : ''} onClick={() => setSpreadModalRange(r)}>{r}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {modalContract && (
        <div className={styles.modalBackdrop} onClick={() => setModalContract(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setModalContract(null)} aria-label="Close">×</button>
            <h2 className={styles.modalTitle} style={{ color: modalContractColor }}>{contractTicker(modalContract.symbol)}</h2>
            <p className={styles.modalSubtitle}>{activeMarket.title} · {modalContract.expiryLabel}</p>
            <div className={styles.modalToggleRow}>
              <div className={styles.modalToggleGroup}>
                <button className={modalMetric === 'rate' ? styles.activeToggle : ''} onClick={() => setModalMetric('rate')}>IMPLIED RATE</button>
                <button className={modalMetric === 'price' ? styles.activeToggle : ''} onClick={() => setModalMetric('price')}>PRICE</button>
              </div>
              <div className={styles.modalToggleGroup}>
                <button className={modalShowScenarios ? styles.activeToggleGreen : ''} onClick={() => setModalShowScenarios((v) => !v)}>
                  CB LEVELS: {modalShowScenarios ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            <div className={styles.modalChartContainer}>
              {modalHistory.loading ? (
                <div className={styles.loading} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
              ) : modalChartData.length === 0 ? (
                <div className={styles.loading} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No history available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={modalChartData} margin={{ top: 12, right: 110, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 13, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(value: string) => {
                        const d = new Date(value)
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }}
                      interval="preserveStartEnd"
                      minTickGap={60}
                      stroke="#728197"
                    />
                    <YAxis
                      tick={{ fontSize: 13, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(v: number) => modalMetric === 'rate' ? `${v.toFixed(2)}%` : v.toFixed(2)}
                      domain={modalYDomain}
                      stroke="#728197"
                    />
                    <Tooltip
                      contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                      formatter={(v: number | undefined) => v == null ? '' : modalMetric === 'rate' ? `${v.toFixed(3)}%` : v.toFixed(3)}
                    />
                    {modalShowScenarios && fedwatch.currentEFFR > 0 && SCENARIO_BPS.map((changeBps) => {
                      const ratePct = fedwatch.currentEFFR + changeBps / 100
                      const yValue = modalMetric === 'rate' ? ratePct : 100 - ratePct
                      const isCurrent = changeBps === 0
                      const labelText = isCurrent ? 'Current Rate' : `${Math.abs(changeBps)} bps ${changeBps < 0 ? 'cut' : 'hike'}`
                      return (
                        <ReferenceLine
                          key={changeBps}
                          y={yValue}
                          stroke={isCurrent ? '#94a3b8' : '#a855f7'}
                          strokeDasharray={isCurrent ? '4 4' : undefined}
                          strokeWidth={1}
                          label={{
                            value: labelText,
                            position: 'right',
                            fill: isCurrent ? '#94a3b8' : '#a855f7',
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                          }}
                        />
                      )
                    })}
                    <Line type="monotone" dataKey="value" stroke={modalContractColor} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    <Brush
                      dataKey="date"
                      height={28}
                      stroke="#60a5fa"
                      fill="#0d1520"
                      travellerWidth={10}
                      tickFormatter={(value: string) => {
                        const d = new Date(value)
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={styles.modalRangeButtons}>
              {(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((r) => (
                <button key={r} className={modalRange === r ? styles.activeRange : ''} onClick={() => setModalRange(r)}>{r}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
