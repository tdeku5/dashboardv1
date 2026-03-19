import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

type ProductKey = 'fedfunds' | 'sofr'

const PRODUCT_CONFIG: Record<ProductKey, { label: string; root: string; title: string }> = {
  fedfunds: { label: 'FED FUNDS', root: 'ZQ', title: 'FED FUNDS' },
  sofr: { label: '3M SOFR', root: 'SR3', title: '3M SOFR' },
}

const FVM_TABS = [
  { key: 'cpi', label: 'CPI MODEL' },
  { key: 'pce', label: 'PCE MODEL' },
  { key: 'ppi', label: 'PPI MODEL' },
  { key: 'growth', label: 'GROWTH' },
  { key: 'labor', label: 'LABOR' },
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

export function STIRDashboardPage() {
  const [activeView, setActiveView] = useState<'strip' | 'pricing'>('pricing')
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
      },
      {
        label: 'TERM>+6M',
        value: terminal && contract6m ? fmtBpsValue((contract6m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract6m ? contractTicker(contract6m.symbol) : '—',
        tone: 'gold',
      },
      {
        label: 'TERM>+12M',
        value: terminal && contract12m ? fmtBpsValue((contract12m.impliedRate - terminal.impliedRate) * 100) : '—',
        sub: contract12m ? contractTicker(contract12m.symbol) : '—',
        tone: 'gold',
      },
    ]

    return { terminal, boxes }
  }, [stripContracts, product, fedwatch.currentEFFR])

  const stripMaxOI = useMemo(
    () => Math.max(...stripContracts.map((contract) => contract.openInterest || 0), 0),
    [stripContracts],
  )

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
        <div className={styles.twoPanel}>
          <div className={styles.leftPanel}>
        <div className={styles.viewTabs}>
          <button
            className={`${styles.viewTab} ${activeView === 'strip' ? styles.viewTabActive : ''}`}
            onClick={() => setActiveView('strip')}
          >
            Strip
          </button>
          <button
            className={`${styles.viewTab} ${activeView === 'pricing' ? styles.viewTabActive : ''}`}
            onClick={() => setActiveView('pricing')}
          >
            Pricing
          </button>
        </div>

        <div className={styles.toggleGroup}>
          {(Object.entries(PRODUCT_CONFIG) as [ProductKey, typeof PRODUCT_CONFIG[ProductKey]][]).map(([key, config]) => (
            <button
              key={key}
              className={`${styles.toggleButton} ${product === key ? styles.toggleButtonActive : ''}`}
              onClick={() => setProduct(key)}
            >
              {config.label}
            </button>
          ))}
        </div>

        {activeView === 'pricing' && (
          <>
            <section className={styles.controlsSection}>
              <div className={styles.headerBlock}>
                <div className={styles.pageTitle}>// UNITED STATES: {productConfig.title} (FED IMPLIED)</div>
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
                      <BarChart data={curveData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="ticker" stroke="#728197" tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} />
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

        {activeView === 'strip' && (
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
                        <div key={box.label} className={styles.summaryBox}>
                          <div className={styles.summaryBoxLabel}>{box.label}</div>
                          <div className={styles.summaryBoxValue} style={summaryToneStyle(box.tone)}>{box.value}</div>
                          <div className={styles.summaryBoxSub}>{box.sub}</div>
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
          </div>

          <div className={styles.rightPanel}>
            <div className={styles.fvmPanel}>
              <div className={styles.fvmHeader}>
                <h2 className={styles.fvmTitle}>FUNDAMENTAL MODEL</h2>
                <div className={styles.fvmMeasureToggle}>
                  <button
                    className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'headline' ? styles.fvmMeasureBtnActive : ''}`}
                    onClick={() => setFvmMeasure('headline')}
                  >
                    HEADLINE
                  </button>
                  <button
                    className={`${styles.fvmMeasureBtn} ${fvmMeasure === 'core' ? styles.fvmMeasureBtnActive : ''}`}
                    onClick={() => setFvmMeasure('core')}
                  >
                    CORE
                  </button>
                </div>
              </div>
              <div className={styles.fvmTabs}>
                {FVM_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    className={`${styles.fvmTab} ${fvmTab === tab.key ? styles.fvmTabActive : ''}`}
                    onClick={() => setFvmTab(tab.key)}
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
                        {FVM_RANGES.map((range) => (
                          <button
                            key={range.key}
                            className={`${styles.fvmRangeBtn} ${fvmRange === range.key ? styles.fvmRangeBtnActive : ''}`}
                            onClick={() => setFvmRange(range.key)}
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
