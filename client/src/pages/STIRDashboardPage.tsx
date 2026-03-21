import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
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
import { fetchBEASeries } from '../lib/bea'
import { useFedWatch } from '../hooks/useFedWatch'
import { useFuturesCurve, type FuturesCurvePoint } from '../hooks/useFuturesCurve'
import { useFuturesStrip, type StripContract } from '../hooks/useFuturesStrip'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './STIRDashboardPage.module.css'

type ViewTab = 'strips' | 'pricing' | 'ust' | 'credit' | 'regimes'

type ProductKey = 'fedfunds' | 'sofr'

const PRODUCT_CONFIG: Record<ProductKey, { label: string; root: string; title: string }> = {
  fedfunds: { label: 'FED FUNDS', root: 'ZQ', title: 'FED FUNDS' },
  sofr: { label: '3M SOFR', root: 'SR3', title: '3M SOFR' },
}

const FVM_TABS = [
  { key: 'cpi', label: 'CPI' },
  { key: 'pce', label: 'PCE' },
  { key: 'labor', label: 'LABOR' },
] as const

const VIEW_TABS: Array<{ key: ViewTab; label: string }> = [
  { key: 'strips', label: 'STIR STRIPS' },
  { key: 'pricing', label: 'FORWARD PRICING' },
  { key: 'ust', label: 'UST CURVE' },
  { key: 'credit', label: 'CREDIT' },
  { key: 'regimes', label: 'REGIMES' },
] as const

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
  2026: 'rgba(148, 163, 184, 0.06)',
  2027: 'rgba(239, 83, 80, 0.08)',
  2028: 'rgba(78, 201, 176, 0.08)',
  2029: 'rgba(59, 130, 246, 0.15)',
  2030: 'rgba(255, 215, 0, 0.08)',
}

const YEAR_CYCLE = [
  'rgba(148, 163, 184, 0.06)',
  'rgba(239, 83, 80, 0.08)',
  'rgba(78, 201, 176, 0.08)',
  'rgba(59, 130, 246, 0.15)',
  'rgba(255, 215, 0, 0.08)',
]

const INTEGER_FORMAT = new Intl.NumberFormat('en-US')
const FVM_TICK = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#94A3B8' }
const LABOR_SCENARIO_COLORS = ['#EF5350', '#fbbf24', '#22d3ee', '#4ade80'] as const
const UST_TENORS = [
  { key: 'DGS3MO', label: '3M' },
  { key: 'DGS1', label: '1Y' },
  { key: 'DGS2', label: '2Y' },
  { key: 'DGS5', label: '5Y' },
  { key: 'DGS10', label: '10Y' },
  { key: 'DGS30', label: '30Y' },
] as const
const UST_SPREADS = [
  { label: '3m2s', long: 'DGS2', short: 'DGS3MO' },
  { label: '1s2s', long: 'DGS2', short: 'DGS1' },
  { label: '2s5s', long: 'DGS5', short: 'DGS2' },
  { label: '2s10s', long: 'DGS10', short: 'DGS2' },
  { label: '2s30s', long: 'DGS30', short: 'DGS2' },
  { label: '5s10s', long: 'DGS10', short: 'DGS5' },
  { label: '5s30s', long: 'DGS30', short: 'DGS5' },
  { label: '10s30s', long: 'DGS30', short: 'DGS10' },
] as const
const UST_BREAKEVENS = [
  { key: 'T5YIE', label: '5Y Breakeven' },
  { key: 'T10YIE', label: '10Y Breakeven' },
] as const
const REGIME_COLORS: Record<string, string> = {
  'Bull Steepener': '#66bb6a',
  'Bear Steepener': '#c62828',
  'Steepener Twist': '#ffee58',
  'Bull Flattener': '#42a5f5',
  'Bear Flattener': '#ab47bc',
  'Flattener Twist': '#ff9100',
}

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

function toneFromBps(v: number): 'cut' | 'hike' | 'flat' {
  if (v > 0.01) return 'hike'
  if (v < -0.01) return 'cut'
  return 'flat'
}

function summaryFromBps(v: number): string {
  const moves = Math.abs(v) / 25
  if (Math.abs(v) < 0.01) return 'UNCH'
  if (moves < 1) {
    const pct = (moves * 100).toFixed(0)
    if (v > 0) return `+${pct}% HIKES`
    return `${pct}% CUTS`
  }
  if (v > 0) return `+${moves.toFixed(1)} HIKES`
  return `${moves.toFixed(1)} CUTS`
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

function fmtSignedInteger(v: number | null): string {
  if (v == null) return '—'
  if (v === 0) return '0'
  const sign = v > 0 ? '+' : ''
  return `${sign}${INTEGER_FORMAT.format(v)}`
}

function fmtBpsValue(v: number | null): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}bp`
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
  if (value > 0) return { color: `rgba(78, 201, 176, ${opacity})` }
  return { color: `rgba(239, 83, 80, ${opacity})` }
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
  const [activeView, setActiveView] = useState<ViewTab>('pricing')
  const [product, setProduct] = useState<ProductKey>('fedfunds')
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
  const [laborData, setLaborData] = useState<{ unrate: WD[]; employment: WD[]; clf: WD[]; payems: WD[] }>({
    unrate: [],
    employment: [],
    clf: [],
    payems: [],
  })
  const [laborLoading, setLaborLoading] = useState(true)
  const [laborError, setLaborError] = useState<string | null>(null)
  const [payrollScenarios, setPayrollScenarios] = useState([50, 100, 150, 200])
  const [clfGrowthRate, setClfGrowthRate] = useState(0.05)
  const [hoveredBox, setHoveredBox] = useState<'mtg' | 'term6m' | 'term12m' | null>(null)
  const [lookbackDaysInput, setLookbackDaysInput] = useState('1')
  const [showMatrix, setShowMatrix] = useState(true)

  const productConfig = PRODUCT_CONFIG[product]
  const lookbackDays = Math.max(0, Number.parseInt(lookbackDaysInput, 10) || 0)

  const curve = useFuturesCurve(productConfig.root, lookbackDays)
  const fedwatch = useFedWatch()
  const strip = useFuturesStrip(productConfig.root)

  const loading = curve.loading || fedwatch.loading
  const error = curve.error || fedwatch.error
  const stripLoading = strip.loading || fedwatch.loading
  const stripError = strip.error || fedwatch.error

  const headerTiming = useMemo(
    () => fmtDaysWeeks(curve.currentDate, curve.lookbackDate),
    [curve.currentDate, curve.lookbackDate],
  )

  const curveData = useMemo(() => {
    const latest = sortCurve(curve.currentCurve)
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
  }, [curve.currentCurve, curve.lookbackCurve])

  const curveDomain = useMemo<[number, number]>(() => {
    const rates = curveData.flatMap((row) => [row.latestRate, row.benchmarkRate])
      .filter((value): value is number => value != null)
    if (rates.length === 0) return [0, 5]
    const min = Math.min(...rates)
    const max = Math.max(...rates)
    return [min - 0.15, max + 0.15]
  }, [curveData])

  const summaryRows = useMemo<SummaryRow[]>(() => {
    if (product === 'fedfunds') {
      return fedwatch.meetings
        .filter((meeting) => meeting.meetingDate <= '2027-03-31')
        .map((meeting) => {
          const stepBps = meeting.expectedChange * 100
          const totalBps = (meeting.effrEnd - fedwatch.currentEFFR) * 100
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
  }, [product, fedwatch.meetings, fedwatch.currentEFFR, curve.currentCurve])

  const overnightRow = useMemo<SummaryRow>(() => ({
    key: 'cash',
    label: 'Overnight Cash',
    impliedRate: fedwatch.currentEFFR,
    stepBps: 0,
    totalBps: 0,
    impliedMoves: 0,
    stepSummary: 'UNCH',
    totalSummary: 'UNCH',
    tone: 'flat',
  }), [fedwatch.currentEFFR])

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

  const stripMaxAbs = useMemo(() => {
    const maxAbs = {
      pxChg1d: 0,
      pxChg5d: 0,
      pxChg1m: 0,
      oiChg: 0,
    }

    for (const contract of stripContracts) {
      maxAbs.pxChg1d = Math.max(maxAbs.pxChg1d, Math.abs(contract.pxChg1d ?? 0))
      maxAbs.pxChg5d = Math.max(maxAbs.pxChg5d, Math.abs(contract.pxChg5d ?? 0))
      maxAbs.pxChg1m = Math.max(maxAbs.pxChg1m, Math.abs(contract.pxChg1m ?? 0))
      maxAbs.oiChg = Math.max(maxAbs.oiChg, Math.abs(contract.oiChg ?? 0))
    }

    return maxAbs
  }, [stripContracts])

  const stripSummary = useMemo(() => {
    const terminal = stripContracts.reduce<StripContract | null>((lowest, contract) => {
      if (!lowest || contract.impliedRate < lowest.impliedRate) return contract
      return lowest
    }, null)

    const step6 = product === 'sofr' ? 2 : 6
    const step12 = product === 'sofr' ? 4 : 12
    const terminalIndex = terminal ? stripContracts.findIndex((contract) => contract.symbol === terminal.symbol) : -1
    const contract6m = terminalIndex >= 0 ? stripContracts[terminalIndex + step6] ?? null : null
    const contract12m = terminalIndex >= 0 ? stripContracts[terminalIndex + step12] ?? null : null

    const boxes: StripSummaryBox[] = [
      {
        label: 'TERMINAL',
        value: terminal ? `${fmtRate(terminal.impliedRate)}%` : '—',
        sub: terminal ? `${contractTicker(terminal.symbol)}  M+${monthsForward(terminal)}` : '—',
        tone: 'teal',
      },
      {
        label: 'MTG>TERM',
        value: terminal ? fmtBpsValue((terminal.impliedRate - fedwatch.currentEFFR) * 100) : '—',
        sub: 'terminal vs overnight cash',
        tone: !terminal ? 'neutral' : (terminal.impliedRate - fedwatch.currentEFFR) * 100 >= 0 ? 'green' : 'red',
        hoverKey: 'mtg',
      },
      {
        label: 'TERM>+6M',
        value: terminal && contract6m ? fmtBpsValue((contract6m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract6m ? contractTicker(contract6m.symbol) : '—',
        tone: 'gold',
        hoverKey: 'term6m',
      },
      {
        label: 'TERM>+12M',
        value: terminal && contract12m ? fmtBpsValue((contract12m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract12m ? contractTicker(contract12m.symbol) : '—',
        tone: 'gold',
        hoverKey: 'term12m',
      },
    ]

    return { terminal, contract6m, contract12m, boxes }
  }, [stripContracts, product, fedwatch.currentEFFR])

  const stripMaxOI = useMemo(
    () => Math.max(...stripContracts.map((contract) => contract.openInterest || 0), 0),
    [stripContracts],
  )

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

    const ustSeries = [...UST_TENORS, ...UST_BREAKEVENS]
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

  const fvmFilteredYoYData = useMemo(
    () => activeFvmYoYData.filter((row) => !fvmRangeCutoff || row.date >= fvmRangeCutoff || row.date > activeFvmModel.currentDate),
    [activeFvmYoYData, fvmRangeCutoff, activeFvmModel.currentDate],
  )

  const fvmFilteredMomData = useMemo(
    () => activeFvmMomData.filter((row) => !fvmRangeCutoff || row.date >= fvmRangeCutoff),
    [activeFvmMomData, fvmRangeCutoff],
  )

  const fvmYoYDomain = useMemo<[number, number]>(() => {
    const yoyValues = fvmFilteredYoYData
      .flatMap((d) => [d.yoy, d.pace1m, d.pace3m, d.pace6m])
      .filter((v): v is number => v != null)
    const allValues = [...yoyValues, 2]
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const padding = (max - min) * 0.1 || 0.2
    return [min - padding, max + padding]
  }, [fvmFilteredYoYData])

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

  const laborDomain = useMemo<[number, number]>(() => {
    const values = laborChartData
      .flatMap((row) => [row.historical, row.scenario0, row.scenario1, row.scenario2, row.scenario3])
      .filter((value): value is number => value != null)
    if (!values.length) return [0, 10]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const padding = (max - min) * 0.1 || 0.2
    return [min - padding, max + padding]
  }, [laborChartData])

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

  const ustSpreadChartData = useMemo(() => {
    if (!ustSelection || ustSelection.type !== 'spread') return []

    const longSeries = ustData[ustSelection.longKey] || []
    const shortSeries = ustData[ustSelection.shortKey] || []
    if (longSeries.length === 0 || shortSeries.length === 0) return []

    const shortMap = new Map(shortSeries.map((point) => [point.date, point.value]))
    const aligned = longSeries
      .filter((point) => shortMap.has(point.date))
      .map((point) => ({
        date: point.date,
        longYield: point.value,
        shortYield: shortMap.get(point.date)!,
        spread: (point.value - shortMap.get(point.date)!) * 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const cutoff = getDateCutoff(ustChartRange)
    const filtered = cutoff ? aligned.filter((point) => point.date >= cutoff) : aligned

    return filtered.map((point) => {
      const fullIdx = aligned.findIndex((candidate) => candidate.date === point.date)
      const lookbackIdx = fullIdx - regimeLookback

      if (lookbackIdx < 0) {
        return { ...point, regime: null as string | null }
      }

      const prior = aligned[lookbackIdx]
      const shortChange = point.shortYield - prior.shortYield
      const longChange = point.longYield - prior.longYield
      const spreadChange = point.spread - prior.spread

      let regime: string
      if (spreadChange > 0) {
        if (shortChange < 0 && longChange < 0) {
          regime = 'Bull Steepener'
        } else if (shortChange > 0 && longChange > 0) {
          regime = 'Bear Steepener'
        } else {
          regime = 'Steepener Twist'
        }
      } else if (spreadChange < 0) {
        if (shortChange < 0 && longChange < 0) {
          regime = 'Bull Flattener'
        } else if (shortChange > 0 && longChange > 0) {
          regime = 'Bear Flattener'
        } else {
          regime = 'Flattener Twist'
        }
      } else {
        regime = 'Neutral'
      }

      return { ...point, regime }
    })
  }, [ustSelection, ustData, ustChartRange, regimeLookback])

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
        <div className={styles.barRight} />
      </header>

      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Rates Models</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.viewTabs}>
          {VIEW_TABS.map((tab, idx) => (
            <button
              key={tab.key}
              className={`${styles.viewTab} ${activeView === tab.key ? styles.viewTabActive : ''}`}
              onClick={() => setActiveView(tab.key)}
              style={{
                border: `1px solid ${activeView === tab.key ? '#4EC9B0' : 'rgba(255, 255, 255, 0.12)'}`,
                ...(idx > 0 ? { borderLeft: 'none' } : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeView === 'strips' || activeView === 'pricing') && (
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

        <div className={styles.twoPanel}>
          <div className={styles.leftPanel}>
        {activeView === 'pricing' && (
          <>
            <section className={styles.controlsSection}>
              <div className={styles.headerBlock}>
                <div className={styles.pageTitle}>// UNITED STATES: {productConfig.title}</div>
                <div className={styles.subtitleRow}>
                  <span>● LATEST: {curve.currentDate || '—'} (0 DAYS, 0.0 WEEKS)</span>
                  <span>● BENCHMARK: {curve.lookbackDate || '—'} ({headerTiming.days} DAYS, {headerTiming.weeks} WEEKS)</span>
                </div>
                <label className={styles.lookbackWrap}>
                  <span className={styles.lookbackLabel}>t -</span>
                  <input
                    className={styles.lookbackInput}
                    type="number"
                    min="0"
                    step="1"
                    value={lookbackDaysInput}
                    onChange={(e) => setLookbackDaysInput(e.target.value)}
                  />
                </label>
              </div>
            </section>

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
                      US: {productConfig.title === 'FED FUNDS' ? 'Fed Funds' : '3M SOFR'}
                    </div>
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
                          <th>Implied Rate</th>
                          <th>Bps (Step)</th>
                          <th>Bps (Total)</th>
                          <th>Implied # Cuts/Hikes</th>
                          <th>Summary</th>
                          <th>Summary (Total)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[overnightRow, ...summaryRows].map((row) => (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td className={styles.mono}>{fmtRate(row.impliedRate)}</td>
                            <td className={`${styles.mono} ${row.stepBps < 0 ? styles.cutText : row.stepBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.stepBps)}</td>
                            <td className={`${styles.mono} ${row.totalBps < 0 ? styles.cutText : row.totalBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.totalBps)}</td>
                            <td className={styles.mono}>{row.impliedMoves.toFixed(1)}</td>
                            <td><span className={`${styles.badge} ${styles[row.tone]}`}>{row.stepSummary}</span></td>
                            <td><span className={`${styles.badge} ${styles[row.totalBps < 0 ? 'cut' : row.totalBps > 0 ? 'hike' : 'flat']}`}>{row.totalSummary}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {product === 'fedfunds' && (
                  <section className={styles.section}>
                    <button className={styles.matrixToggle} onClick={() => setShowMatrix((v) => !v)}>
                      {showMatrix ? '▼' : '▶'} Detailed Probability Matrix
                    </button>
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
                          <div className={styles.summaryBoxValue} style={summaryToneStyle(box.tone)}>{box.value}</div>
                          <div className={styles.summaryBoxSub}>{box.sub}</div>
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
                      {productConfig.root} STRIP {stripContracts.length} contracts
                    </div>
                    <div className={styles.tableWrap}>
                      <table className={styles.stripTable}>
                        <thead>
                          <tr>
                            <th>Contract</th>
                            <th>Last Px</th>
                            <th>Imp Rate</th>
                            <th>Px 1D</th>
                            <th>Px 5D</th>
                            <th>Px 1M</th>
                            <th>Volume</th>
                            <th>OI</th>
                            <th>OI Chg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stripYearGroups.map(([year, contracts]) => (
                            <Fragment key={year}>
                              <tr className={styles.yearRow} style={{ background: getYearBandColor(year, stripYears) }}>
                                <td colSpan={9} className={styles.yearRowLabel}>{year}</td>
                              </tr>
                              {contracts.map((contract) => (
                                <tr
                                  key={contract.symbol}
                                  style={{ background: getYearBandColor(contract.year, stripYears) }}
                                >
                                  <td>{contractTicker(contract.symbol)}</td>
                                  <td style={{ color: '#FFD700' }}>{contract.lastPrice.toFixed(3)}</td>
                                  <td>{contract.impliedRate.toFixed(3)}</td>
                                  <td style={heatStyle(contract.pxChg1d, stripMaxAbs.pxChg1d)}>{fmtSignedPrice(contract.pxChg1d)}</td>
                                  <td style={heatStyle(contract.pxChg5d, stripMaxAbs.pxChg5d)}>{fmtSignedPrice(contract.pxChg5d)}</td>
                                  <td style={heatStyle(contract.pxChg1m, stripMaxAbs.pxChg1m)}>{fmtSignedPrice(contract.pxChg1m)}</td>
                                  <td>{INTEGER_FORMAT.format(contract.volume)}</td>
                                  <td className={styles.oiCell}>
                                    <div className={styles.oiCellInner} style={{ padding: '5px 6px' }}>
                                      {(contract.openInterest || 0) > 0 && stripMaxOI > 0 && (
                                        <div
                                          className={styles.oiBar}
                                          style={{
                                            zIndex: 1,
                                            width: `${((contract.openInterest || 0) / stripMaxOI) * 100}%`,
                                            right: 0,
                                            background: 'rgba(94, 160, 230, 0.25)',
                                          }}
                                        />
                                      )}
                                      <span className={styles.oiValue} style={{ zIndex: 0 }}>{INTEGER_FORMAT.format(contract.openInterest)}</span>
                                    </div>
                                  </td>
                                  <td style={heatStyle(contract.oiChg, stripMaxAbs.oiChg)}>{fmtSignedInteger(contract.oiChg)}</td>
                                </tr>
                              ))}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {activeView === 'ust' && (
          <section className={styles.section}>
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

                  <div className={styles.ustChartTitle}>
                    {ustSelection?.type === 'yield'
                      ? `${ustSelection.label} Treasury Yield`
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

                  {ustSelection?.type === 'yield' ? (
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

        {activeView === 'credit' && (
          <section className={styles.section}>
            <div className={styles.comingSoon}>Credit coming soon</div>
          </section>
        )}

        {activeView === 'regimes' && (
          <section className={styles.section}>
            <div className={styles.comingSoon}>Regimes coming soon</div>
          </section>
        )}
          </div>

          <div className={styles.rightPanel}>
            <div className={styles.fvmPanel}>
              <div className={styles.fvmHeader}>
                <h2 className={styles.fvmTitle}>FUNDAMENTAL MODEL</h2>
                <div className={styles.fvmMeasureToggle}>
                  <button
                    className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'headline' ? styles.fvmMeasureBtnActive : ''}`}
                    onClick={() => setFvmMeasure('headline')}
                    style={{
                      border: `1px solid ${fvmMeasure === 'headline' ? '#FFD700' : 'rgba(255, 255, 255, 0.12)'}`,
                    }}
                  >
                    HEADLINE
                  </button>
                  <button
                    className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'core' ? styles.fvmMeasureBtnActive : ''}`}
                    onClick={() => setFvmMeasure('core')}
                    style={{
                      border: `1px solid ${fvmMeasure === 'core' ? '#FFD700' : 'rgba(255, 255, 255, 0.12)'}`,
                      borderLeft: 'none',
                    }}
                  >
                    CORE
                  </button>
                </div>
              </div>
              <div className={styles.fvmTabs}>
                {FVM_TABS.map((tab, idx) => (
                  <button
                    key={tab.key}
                    className={`${styles.fvmTab} ${fvmTab === tab.key ? styles.fvmTabActive : ''}`}
                    onClick={() => {
                      setFvmTab(tab.key)
                      if (tab.key === 'labor') setFvmRange('2y')
                    }}
                    style={{
                      border: `1px solid ${fvmTab === tab.key ? '#FFD700' : 'rgba(255, 255, 255, 0.12)'}`,
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
                              border: `1px solid ${fvmRange === range.key ? '#FFD700' : 'rgba(255, 255, 255, 0.12)'}`,
                              ...(idx > 0 ? { borderLeft: 'none' } : {}),
                            }}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>

                      <div className={styles.fvmLegend}>
                        <span style={{ color: '#FFD700' }}>― YoY actual</span>
                        <span style={{ color: '#4ade80' }}>-- 1M MoM</span>
                        <span style={{ color: '#22d3ee' }}>-- 3M MoM avg</span>
                        <span style={{ color: '#fbbf24' }}>-- 6M MoM avg</span>
                        <span style={{ color: '#EF5350' }}>-- 2% Target</span>
                      </div>

                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={fvmFilteredYoYData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
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
                          <Line type="monotone" dataKey="yoy" stroke="#FFD700" strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace1m" stroke="#4ade80" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace3m" stroke="#22d3ee" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                          <Line type="monotone" dataKey="pace6m" stroke="#fbbf24" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
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
                            dot={{ r: 2, fill: '#4EC9B0' }}
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
                              border: `1px solid ${fvmRange === range.key ? '#FFD700' : 'rgba(255, 255, 255, 0.12)'}`,
                              ...(idx > 0 ? { borderLeft: 'none' } : {}),
                            }}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>

                      <div className={styles.fvmLegend}>
                        <span style={{ color: '#FFD700' }}>― U-3 actual</span>
                        <span style={{ color: '#EF5350' }}>-- {payrollScenarios[0]}k</span>
                        <span style={{ color: '#fbbf24' }}>-- {payrollScenarios[1]}k</span>
                        <span style={{ color: '#22d3ee' }}>-- {payrollScenarios[2]}k</span>
                        <span style={{ color: '#4ade80' }}>-- {payrollScenarios[3]}k</span>
                      </div>

                      <ResponsiveContainer width="100%" height={350}>
                        <LineChart data={laborChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
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
                          <Line type="monotone" dataKey="historical" stroke="#FFD700" strokeWidth={2} dot={{ r: 2, fill: '#FFD700' }} connectNulls />
                          <Line type="monotone" dataKey="scenario0" stroke={LABOR_SCENARIO_COLORS[0]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario1" stroke={LABOR_SCENARIO_COLORS[1]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario2" stroke={LABOR_SCENARIO_COLORS[2]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
                          <Line type="monotone" dataKey="scenario3" stroke={LABOR_SCENARIO_COLORS[3]} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
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
                            dot={{ r: 1.5, fill: '#a78bfa' }}
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
                ) : (
                  <div className={styles.comingSoon}>
                    {FVM_TABS.find((tab) => tab.key === fvmTab)?.label} — coming soon
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
