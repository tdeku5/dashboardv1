import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Cell,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './PIODashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

type ContribRow = { date: string; [key: string]: number | null | string }

// ── PIO hierarchy ─────────────────────────────────────────────────────────────

interface PioItem {
  id:    string
  label: string
  depth: number
}

const PIO_HIERARCHY: PioItem[] = [
  { id: 'PI',                label: 'Personal Income',                                         depth: 0 },
  { id: 'W209RC1',           label: 'Compensation of Employees',                               depth: 1 },
  { id: 'A576RC1',           label: 'Wages and Salaries',                                      depth: 2 },
  { id: 'A132RC1',           label: 'Private Industries',                                      depth: 3 },
  { id: 'N231RC1M027SBEA',   label: 'Goods-producing industries',                              depth: 4 },
  { id: 'N552RC1M027SBEA',   label: 'Manufacturing',                                           depth: 5 },
  { id: 'N233RC1M027SBEA',   label: 'Services-producing industries',                           depth: 4 },
  { id: 'N234RC1M027SBEA',   label: 'Trade, transportation & util.',                           depth: 5 },
  { id: 'N235RC1M027SBEA',   label: 'Other services-producing',                                depth: 5 },
  { id: 'B202RC1',           label: 'Government',                                              depth: 3 },
  { id: 'A038RC1',           label: 'Supplements to Wages and Salaries',                       depth: 2 },
  { id: 'B040RC1M027SBEA',   label: 'Employer contrib. pension/insur.',                        depth: 3 },
  { id: 'B039RC1M027SBEA',   label: 'Employer contrib. govt social ins.',                      depth: 3 },
  { id: 'A041RC1',           label: "Proprietors' Income",                                     depth: 1 },
  { id: 'B042RC1',           label: 'Farm',                                                    depth: 2 },
  { id: 'A045RC1',           label: 'Nonfarm',                                                 depth: 2 },
  { id: 'A048RC1',           label: 'Rental Income',                                           depth: 1 },
  { id: 'PIROA',             label: 'Personal Income Receipts on Assets',                      depth: 1 },
  { id: 'PII',               label: 'Personal Interest Income',                                depth: 2 },
  { id: 'PDI',               label: 'Personal Dividend Income',                                depth: 2 },
  { id: 'PCTR',              label: 'Personal Current Transfer Receipts',                      depth: 1 },
  { id: 'A063RC1',           label: 'Govt Social Benefits to Persons',                         depth: 2 },
  { id: 'W823RC1',           label: 'Social Security',                                         depth: 3 },
  { id: 'W824RC1',           label: 'Medicare',                                                depth: 3 },
  { id: 'W729RC1',           label: 'Medicaid',                                                depth: 3 },
  { id: 'W825RC1',           label: 'Unemployment Insurance',                                  depth: 3 },
  { id: 'W826RC1',           label: "Veterans' Benefits",                                      depth: 3 },
  { id: 'W827RC1',           label: 'Other',                                                   depth: 3 },
  { id: 'B931RC1',           label: 'Other Current Transfer Receipts',                         depth: 2 },
  { id: 'A061RC1',           label: 'Less: Contributions for Govt Social Ins.',                depth: 1 },
  { id: 'W055RC1',           label: 'Less: Personal Current Taxes',                            depth: 0 },
  { id: 'DSPI',              label: '= Disposable Personal Income',                            depth: 0 },
  { id: 'A068RC1',           label: 'Less: Personal Outlays',                                  depth: 1 },
  { id: 'PCE',               label: 'Personal Consumption Expenditures',                       depth: 2 },
  { id: 'B069RC1',           label: 'Personal Interest Payments',                              depth: 2 },
  { id: 'W211RC1',           label: 'Personal Current Transfer Payments',                      depth: 2 },
  { id: 'W062RC1M027SBEA',   label: 'To Government',                                           depth: 3 },
  { id: 'B070RC1M027SBEA',   label: 'To Rest of World (net)',                                  depth: 3 },
  { id: 'PMSAVE',            label: '= Personal Saving',                                       depth: 0 },
  { id: 'PSAVERT',           label: 'Personal Saving Rate',                                    depth: 0 },
  { id: 'RPI',               label: 'Real Personal Income',                                    depth: 0 },
  { id: 'W875RX1',           label: 'Real Personal Income ex Transfers',                       depth: 0 },
  { id: 'DSPIC96',           label: 'Real Disposable Personal Income',                         depth: 0 },
  // Calculated series
  { id: 'CALC_NET_INTEREST',         label: 'Net Interest Income',                              depth: 0 },
  { id: 'CALC_TRANSFER_EX_CONTRIB',  label: 'Transfer Receipts ex Contributions for Social Insurance', depth: 0 },
  { id: 'CALC_PI_EX_TRANSFERS',      label: 'Personal Income ex Transfers',                    depth: 0 },
]

const FRED_SERIES_IDS = PIO_HIERARCHY.filter(n => !n.id.startsWith('CALC_')).map(n => n.id)

// ── Chart constants ──────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:  '#090e15',
    border:      '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:  'var(--font-mono)',
    fontSize:    11,
    padding:     '6px 10px',
  },
  labelStyle:    { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle:     { color: '#CBD5E1', padding: '1px 0' },
  cursor:        { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
  labelFormatter: (v: unknown) => typeof v === 'string' ? fmtFullDate(v) : '',
}

const BRUSH_STYLE = {
  height:         34,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  tickFormatter:  (d: string) => {
    const [y, m] = d.split('-')
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
  },
  gap: 3,
} as const

const QUICK_PERIODS_M = [
  { label: '1Y',  count: 12  },
  { label: '3Y',  count: 36  },
  { label: '5Y',  count: 60  },
  { label: '10Y', count: 120 },
  { label: 'Max', count: Infinity },
] as const

const QUICK_PERIODS_CONTRIB = [
  { label: '5Y',  count: 60  },
  { label: '10Y', count: 120 },
  { label: '20Y', count: 240 },
  { label: 'Max', count: Infinity },
] as const

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

const PIO_CONTRIB_ITEMS = [
  { id: 'comp',      label: 'Compensation of Employees', color: '#60a5fa' },
  { id: 'prop',      label: "Proprietors' Income",       color: '#4ade80' },
  { id: 'rental',    label: 'Rental Income',             color: '#f87171' },
  { id: 'assets',    label: 'Income on Assets',          color: '#a78bfa' },
  { id: 'transfers', label: 'Transfer Receipts',         color: '#fdba74' },
] as const

const COMP_CONTRIB_ITEMS = [
  { id: 'wages',       label: 'Wages and Salaries',               color: '#60a5fa' },
  { id: 'supplements', label: 'Supplements to Wages and Salaries', color: '#f59e0b' },
] as const

const WAGES_CONTRIB_ITEMS = [
  { id: 'private', label: 'Private Industries', color: '#60a5fa' },
  { id: 'govt',    label: 'Government',         color: '#f87171' },
] as const

const PRIVWAGES_CONTRIB_ITEMS = [
  { id: 'goods',    label: 'Goods-producing',    color: '#60a5fa' },
  { id: 'services', label: 'Services-producing', color: '#f59e0b' },
] as const

const ASSETS_CONTRIB_ITEMS = [
  { id: 'interest',  label: 'Personal Interest Income',  color: '#60a5fa' },
  { id: 'dividends', label: 'Personal Dividend Income',  color: '#4ade80' },
] as const

const GOVBEN_CONTRIB_ITEMS = [
  { id: 'socsec',   label: 'Social Security',        color: '#60a5fa' },
  { id: 'medicare', label: 'Medicare',                color: '#4ade80' },
  { id: 'medicaid', label: 'Medicaid',                color: '#f59e0b' },
  { id: 'ui',       label: 'Unemployment Insurance',  color: '#f87171' },
  { id: 'veterans', label: "Veterans' Benefits",      color: '#a78bfa' },
  { id: 'other',    label: 'Other',                   color: '#94a3b8' },
] as const

const OUTLAYS_CONTRIB_ITEMS = [
  { id: 'pce',      label: 'Personal Consumption Expenditures',  color: '#60a5fa' },
  { id: 'intpay',   label: 'Personal Interest Payments',         color: '#f59e0b' },
  { id: 'transpay', label: 'Personal Current Transfer Payments', color: '#f87171' },
] as const

// ── Chart key types ──────────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xMom' | 'xAnnMom'
type RatesChartKey    = 'piRates' | 'piExTransRates' | 'rpiRates' | 'rpiExTransRates'
type ContribChartKey  =
  | 'contribYoy' | 'contribMom'
  | 'compYoy'    | 'compMom'
  | 'wagesYoy'   | 'wagesMom'
  | 'privwagesYoy' | 'privwagesMom'
  | 'assetsYoy'  | 'assetsMom'
  | 'govbenYoy'  | 'govbenMom'
  | 'outlaysYoy' | 'outlaysMom'
type ChartKey = ExplorerChartKey | RatesChartKey | ContribChartKey

const EXPLORER_KEYS: ExplorerChartKey[] = ['xLevel', 'xRegime', 'xYoyDelta', 'xMom', 'xAnnMom']

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

function fmtBillions(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}T`
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs >= 10000 ? 0 : 1)}B`
  return `$${v.toFixed(0)}B`
}

function fmtPctTick(v: number): string {
  return `${v.toFixed(1)}%`
}

function fmtPctTooltip(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

// ── Compute helpers ──────────────────────────────────────────────────────────

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
}

function computeYoY(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 12) return { date: d.date, value: null }
    const prev = data[i - 12].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeMoM(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeAnnNm(data: WD[], n: number): { date: string; value: number | null }[] {
  const exp = 12 / n
  return data.map((d, i) => {
    if (i < n) return { date: d.date, value: null }
    const prev = data[i - n].value
    if (prev <= 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, exp) - 1) * 100 }
  })
}

function computeAnnualizedMoM(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0 || prev < 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, 12) - 1) * 100 }
  })
}

function computeMA(data: { date: string; value: number | null }[], period: number): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < period - 1) return { date: d.date, value: null }
    let sum = 0
    let count = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (data[j].value != null) { sum += data[j].value!; count++ }
    }
    return { date: d.date, value: count === period ? sum / count : null }
  })
}

function computeYoYDelta(yoy: { date: string; value: number | null }[], lag = 1): { date: string; value: number | null }[] {
  return yoy.map((d, i) => {
    if (i < lag || d.value == null || yoy[i - lag].value == null) return { date: d.date, value: null }
    return { date: d.date, value: d.value - yoy[i - lag].value! }
  })
}

function computeRegimes(
  yoy: { date: string; value: number | null }[],
  maWindow: number,
): { date: string; yoy: number | null; regime: '+' | '-' | '|' }[] {
  const ma = computeMA(yoy, maWindow)
  return yoy.map((d, i) => {
    const maVal = ma[i]?.value
    if (d.value == null || maVal == null) return { date: d.date, yoy: d.value, regime: '|' as const }
    const regime = d.value > maVal ? '+' as const
      : d.value < maVal ? '-' as const
      : '|' as const
    return { date: d.date, yoy: d.value, regime }
  })
}

function contribNiceTicks(min: number, max: number, target = 6): number[] {
  if (min === max) return [min]
  const range     = max - min
  const roughStep = range / target
  const mag       = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)))
  const niceStep  = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= roughStep) ?? roughStep
  const start     = Math.ceil(min / niceStep) * niceStep
  const ticks: number[] = []
  for (let t = start; t <= max + niceStep * 0.01; t += niceStep) {
    ticks.push(parseFloat(t.toFixed(6)))
  }
  return ticks
}

// ── Calculated series helpers ────────────────────────────────────────────────

function subtractSeries(a: WD[], b: WD[]): WD[] {
  const bMap = new Map(b.map(d => [d.date, d.value]))
  return a
    .filter(d => bMap.has(d.date))
    .map(d => ({ date: d.date, value: d.value - bMap.get(d.date)! }))
}

function resolveSeriesData(id: string, allData: AllData): WD[] {
  if (id === 'CALC_NET_INTEREST') {
    return subtractSeries(allData['PII'] ?? [], allData['B069RC1'] ?? [])
  }
  if (id === 'CALC_TRANSFER_EX_CONTRIB') {
    return subtractSeries(allData['PCTR'] ?? [], allData['A061RC1'] ?? [])
  }
  if (id === 'CALC_PI_EX_TRANSFERS') {
    return subtractSeries(allData['PI'] ?? [], allData['PCTR'] ?? [])
  }
  return allData[id] ?? []
}

// ── Generic contribution series builder ──────────────────────────────────────

function buildContribSeries(
  allData: AllData,
  parentId: string,
  components: readonly { key: string; fredId: string }[],
  lineKey: string,
  mode: 'yoy' | 'mom',
): ContribRow[] {
  const parentData = resolveSeriesData(parentId, allData)
  const compMaps = components.map(c => ({
    key: c.key,
    map: new Map(resolveSeriesData(c.fredId, allData).map(r => [r.date, r.value])),
  }))
  const parentMap = new Map(parentData.map(r => [r.date, r.value]))

  return parentData.map((pt, i) => {
    const { date } = pt
    let priorDate: string | undefined

    if (mode === 'yoy') {
      const [y, m] = date.split('-').map(Number)
      let pm = m - 12, py = y
      if (pm <= 0) { pm += 12; py -= 1 }
      priorDate = `${py}-${String(pm).padStart(2, '0')}-01`
    } else {
      if (i === 0) {
        const row: ContribRow = { date }
        for (const c of components) row[c.key] = null
        row[lineKey] = null
        return row
      }
      priorDate = parentData[i - 1].date
    }

    const pPrior = parentMap.get(priorDate!)
    const pNow   = parentMap.get(date)
    const row: ContribRow = { date }

    for (const cm of compMaps) {
      const now   = cm.map.get(date)
      const prior = cm.map.get(priorDate!)
      if (now == null || prior == null || prior === 0 || pPrior == null || pPrior === 0) {
        row[cm.key] = null
      } else {
        row[cm.key] = (prior / pPrior) * ((now / prior) - 1) * 100
      }
    }

    row[lineKey] = (pNow != null && pPrior != null && pPrior !== 0)
      ? (pNow / pPrior - 1) * 100
      : null

    return row
  })
}

// ── QuickSelectRow ────────────────────────────────────────────────────────────

function QuickSelectRow({
  period,
  onSelect,
  periods,
}: {
  period:   string
  onSelect: (label: string, count: number) => void
  periods:  readonly { label: string; count: number }[]
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {periods.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${period === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.count)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ── PioContribTooltip ─────────────────────────────────────────────────────────

function PioContribTooltip({
  row,
  activeSeries,
  mouseX,
  mouseY,
  isRightHalf,
  seriesItems,
  lineKey,
  lineLabel,
}: {
  row:           ContribRow
  activeSeries:  Set<string>
  mouseX:        number
  mouseY:        number
  isRightHalf:   boolean
  seriesItems:   readonly { id: string; label: string; color: string }[]
  lineKey:       string
  lineLabel:     string
}) {
  const activeItems = seriesItems.filter(s => activeSeries.has(s.id))
  const items = activeItems
    .map(s => ({ ...s, value: row[s.id] as number | null }))
    .filter(s => s.value != null)
    .sort((a, b) => Math.abs(b.value!) - Math.abs(a.value!))

  const horizPos = isRightHalf
    ? { right: window.innerWidth - mouseX + 14 }
    : { left:  mouseX + 14 }

  const showLine = activeSeries.has(lineKey)
  const lineVal = row[lineKey] as number | null

  return (
    <div style={{
      position: 'fixed',
      ...horizPos,
      top: mouseY - 24,
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      padding: '8px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      maxWidth: 300,
      pointerEvents: 'none',
      zIndex: 1000,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {fmtFullDate(row.date)}
      </div>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 1,
            background: item.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#64748B', flex: 1, marginRight: 8 }}>{item.label}</span>
          <span style={{ color: item.value! >= 0 ? '#4ade80' : '#f87171' }}>
            {item.value! >= 0 ? '+' : ''}{item.value!.toFixed(2)} pp
          </span>
        </div>
      ))}
      {showLine && lineVal != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>{lineLabel}</span>
          <span style={{ color: lineVal >= 0 ? '#4ade80' : '#f87171' }}>
            {lineVal >= 0 ? '+' : ''}{lineVal.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── PioContribChart (custom SVG diverging stacked bar) ───────────────────────

function PioContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'piocontrib',
  seriesItems,
  lineKey,
  lineLabel,
}: {
  data:           ContribRow[]
  visibleStart:   number
  visibleEnd:     number
  activeSeries:   Set<string>
  lineWidth?:     number
  clipPrefix?:    string
  seriesItems:    readonly { id: string; label: string; color: string }[]
  lineKey:        string
  lineLabel:      string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize]         = useState({ width: 600, height: 400 })
  const [hovered, setHovered]   = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(
    () => data.slice(Math.max(0, visibleStart), Math.min(data.length, visibleEnd + 1)),
    [data, visibleStart, visibleEnd]
  )

  const { width, height } = size
  const innerW = Math.max(0, width  - CONTRIB_CM.left - CONTRIB_CM.right)
  const innerH = Math.max(0, height - CONTRIB_CM.top  - CONTRIB_CM.bottom)
  const n      = visible.length
  const colW   = n > 0 ? innerW / n : 0
  const barW   = Math.min(28, colW * 0.82)

  const activeItems = useMemo(
    () => seriesItems.filter(s => activeSeries.has(s.id)),
    [activeSeries, seriesItems]
  )
  const showLine = activeSeries.has(lineKey)

  const yDomain = useMemo((): [number, number] => {
    let min = 0, max = 0
    for (const row of visible) {
      let posStack = 0, negStack = 0
      for (const s of activeItems) {
        const v = row[s.id] as number | null
        if (v == null || v === 0) continue
        if (v > 0) posStack += v; else negStack += v
      }
      if (showLine && row[lineKey] != null) {
        posStack = Math.max(posStack, row[lineKey] as number)
        negStack = Math.min(negStack, row[lineKey] as number)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showLine])

  const [yMin, yMax] = yDomain
  const yRange = yMax - yMin || 1
  const y0 = CONTRIB_CM.top + (1 - (0 - yMin) / yRange) * innerH

  const { columns, linePts } = useMemo(() => {
    const toY = (v: number) => CONTRIB_CM.top + (1 - (v - yMin) / yRange) * innerH
    type Rect = { y: number; h: number; color: string; id: string; value: number }

    const cols = visible.map((row, i) => {
      const cx    = CONTRIB_CM.left + (i + 0.5) * colW
      const rects: Rect[] = []
      let posStack = 0
      let negStack = 0

      for (const s of activeItems) {
        const value = row[s.id] as number | null
        if (value == null || value === 0) continue

        if (value > 0) {
          const yTop = toY(posStack + value)
          const yBot = toY(posStack)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, value })
          posStack += value
        } else {
          const yTop = toY(negStack)
          const yBot = toY(negStack + value)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, value })
          negStack += value
        }
      }

      return { cx, rects, row }
    })

    const pts = showLine
      ? cols.filter(c => (c.row[lineKey] as number | null) != null).map(c => ({ cx: c.cx, cy: toY(c.row[lineKey] as number) }))
      : []

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, showLine, colW, yMin, yRange, innerH])

  const yTicks = useMemo(() => contribNiceTicks(yMin, yMax, 6), [yMin, yMax])

  const xTicks = useMemo(() => {
    const ticks: { label: string; cx: number }[] = []
    let lastX = -Infinity
    visible.forEach((row, i) => {
      const cx = CONTRIB_CM.left + (i + 0.5) * colW
      if (cx - lastX >= 60) {
        ticks.push({ label: fmtAxisDate(row.date), cx })
        lastX = cx
      }
    })
    return ticks
  }, [visible, colW])

  const linePath = linePts.length > 1
    ? `M${linePts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')}`
    : ''

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx   = e.clientX - rect.left - CONTRIB_CM.left
    setMousePos({ x: e.clientX, y: e.clientY })
    if (n > 0 && mx >= 0 && mx <= innerW) {
      setHovered(Math.min(n - 1, Math.floor(mx / colW)))
    } else {
      setHovered(null)
    }
  }, [n, innerW, colW])

  const handleMouseLeave = useCallback(() => setHovered(null), [])

  const uid    = useId()
  const hovCol = hovered != null ? columns[hovered] : null
  const isRightHalf = hovered != null && hovered >= n / 2
  const clipId = `${clipPrefix}${uid.replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={CONTRIB_CM.left} y={CONTRIB_CM.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {yTicks.map(t => {
          const ty = CONTRIB_CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <line key={t}
              x1={CONTRIB_CM.left} x2={CONTRIB_CM.left + innerW}
              y1={ty} y2={ty}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1}
            />
          )
        })}

        <line
          x1={CONTRIB_CM.left} x2={CONTRIB_CM.left + innerW}
          y1={y0} y2={y0}
          stroke="rgba(255,255,255,0.25)" strokeWidth={1}
        />

        {hovCol && (
          <rect
            x={hovCol.cx - colW / 2} y={CONTRIB_CM.top}
            width={colW} height={innerH}
            fill="rgba(255,255,255,0.04)"
            pointerEvents="none"
            clipPath={`url(#${clipId})`}
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {columns.map(col =>
            col.rects.map(r => (
              <rect
                key={`${col.row.date}-${r.id}`}
                x={col.cx - barW / 2}
                y={r.y}
                width={barW}
                height={r.h}
                fill={r.color}
                fillOpacity={0.8}
              />
            ))
          )}
        </g>

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={lineWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {yTicks.map(t => {
          const ty = CONTRIB_CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <text key={t}
              x={CONTRIB_CM.left - 6} y={ty + 4}
              textAnchor="end"
              fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
            >
              {t.toFixed(2)}
            </text>
          )
        })}

        {xTicks.map(t => (
          <text key={t.label}
            x={t.cx} y={height - CONTRIB_CM.bottom + 14}
            textAnchor="middle"
            fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
          >
            {t.label}
          </text>
        ))}
      </svg>

      {hovCol && (
        <PioContribTooltip
          row={hovCol.row}
          activeSeries={activeSeries}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRightHalf}
          seriesItems={seriesItems}
          lineKey={lineKey}
          lineLabel={lineLabel}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function PIODashboardContent() {
  // ── FRED data fetch ────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          FRED_SERIES_IDS.map(async (id) => {
            const obs = await fetchFredSeries(id)
            return [id, parseObs(obs)] as [string, WD[]]
          })
        )
        if (cancelled) return
        setAllData(Object.fromEntries(entries))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to fetch data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Explorer state ────────────────────────────────────────────────────────

  const [selectedId, setSelectedId] = useState('PI')

  const selectedItem = useMemo(
    () => PIO_HIERARCHY.find(n => n.id === selectedId),
    [selectedId]
  )

  const selectedLabel = selectedItem?.label ?? 'Personal Income'
  const selectedData  = useMemo(() => resolveSeriesData(selectedId, allData), [allData, selectedId])

  // Explorer user-controlled parameters
  const [regimeMa, setRegimeMa]       = useState(12)
  const [deltaWindow, setDeltaWindow] = useState(1)
  const [deltaMa, setDeltaMa]         = useState(12)
  const [momMa1, setMomMa1]           = useState(3)
  const [momMa2, setMomMa2]           = useState(6)

  // Explorer computed data
  const exYoY          = useMemo(() => computeYoY(selectedData), [selectedData])
  const exMoM          = useMemo(() => computeMoM(selectedData), [selectedData])
  const exAnnMoM       = useMemo(() => computeAnnualizedMoM(selectedData), [selectedData])
  const exYoYDelta     = useMemo(() => computeYoYDelta(exYoY, deltaWindow), [exYoY, deltaWindow])
  const exYoYDeltaMa   = useMemo(() => computeMA(exYoYDelta, deltaMa), [exYoYDelta, deltaMa])
  const exMoMMa1       = useMemo(() => computeMA(exMoM, momMa1), [exMoM, momMa1])
  const exMoMMa2       = useMemo(() => computeMA(exMoM, momMa2), [exMoM, momMa2])

  const exLevelData = useMemo(
    () => selectedData.map(d => ({ date: d.date, value: d.value })),
    [selectedData]
  )

  const exRegimeData = useMemo(
    () => computeRegimes(exYoY, regimeMa),
    [exYoY, regimeMa]
  )

  const exYoYDeltaData = useMemo(() =>
    exYoYDelta.map((d, i) => ({ date: d.date, delta: d.value, ma: exYoYDeltaMa[i]?.value ?? null })),
    [exYoYDelta, exYoYDeltaMa]
  )

  const exMoMData = useMemo(() =>
    exMoM.map((d, i) => ({ date: d.date, mom: d.value, ma1: exMoMMa1[i]?.value ?? null, ma2: exMoMMa2[i]?.value ?? null })),
    [exMoM, exMoMMa1, exMoMMa2]
  )

  const exAnnMoMData = useMemo(() =>
    exAnnMoM.map(d => ({ date: d.date, value: d.value })),
    [exAnnMoM]
  )

  // ── Income rate chart data ──────────────────────────────────────────────

  const piRatesData = useMemo(() => {
    const data = allData['PI'] ?? []
    const yoy = computeYoY(data)
    const a6  = computeAnnNm(data, 6)
    const a3  = computeAnnNm(data, 3)
    return data.map((d, i) => ({
      date:  d.date,
      yoy:   yoy[i]?.value ?? null,
      ann6m: a6[i]?.value  ?? null,
      ann3m: a3[i]?.value  ?? null,
    }))
  }, [allData])

  const piExTransRatesData = useMemo(() => {
    const data = resolveSeriesData('CALC_PI_EX_TRANSFERS', allData)
    const yoy = computeYoY(data)
    const a6  = computeAnnNm(data, 6)
    const a3  = computeAnnNm(data, 3)
    return data.map((d, i) => ({
      date:  d.date,
      yoy:   yoy[i]?.value ?? null,
      ann6m: a6[i]?.value  ?? null,
      ann3m: a3[i]?.value  ?? null,
    }))
  }, [allData])

  const rpiRatesData = useMemo(() => {
    const data = allData['RPI'] ?? []
    const yoy = computeYoY(data)
    const a6  = computeAnnNm(data, 6)
    const a3  = computeAnnNm(data, 3)
    return data.map((d, i) => ({
      date:  d.date,
      yoy:   yoy[i]?.value ?? null,
      ann6m: a6[i]?.value  ?? null,
      ann3m: a3[i]?.value  ?? null,
    }))
  }, [allData])

  const rpiExTransRatesData = useMemo(() => {
    const data = allData['W875RX1'] ?? []
    const yoy = computeYoY(data)
    const a6  = computeAnnNm(data, 6)
    const a3  = computeAnnNm(data, 3)
    return data.map((d, i) => ({
      date:  d.date,
      yoy:   yoy[i]?.value ?? null,
      ann6m: a6[i]?.value  ?? null,
      ann3m: a3[i]?.value  ?? null,
    }))
  }, [allData])

  // ── Contribution chart data ─────────────────────────────────────────────

  const PI_COMPONENTS = [
    { key: 'comp',      fredId: 'W209RC1' },
    { key: 'prop',      fredId: 'A041RC1' },
    { key: 'rental',    fredId: 'A048RC1' },
    { key: 'assets',    fredId: 'PIROA' },
    { key: 'transfers', fredId: 'CALC_TRANSFER_EX_CONTRIB' },
  ] as const

  const COMP_COMPONENTS = [
    { key: 'wages',       fredId: 'A576RC1' },
    { key: 'supplements', fredId: 'A038RC1' },
  ] as const

  const WAGES_COMPONENTS = [
    { key: 'private', fredId: 'A132RC1' },
    { key: 'govt',    fredId: 'B202RC1' },
  ] as const

  const PRIVWAGES_COMPONENTS = [
    { key: 'goods',    fredId: 'N231RC1M027SBEA' },
    { key: 'services', fredId: 'N233RC1M027SBEA' },
  ] as const

  const ASSETS_COMPONENTS = [
    { key: 'interest',  fredId: 'PII' },
    { key: 'dividends', fredId: 'PDI' },
  ] as const

  const GOVBEN_COMPONENTS = [
    { key: 'socsec',   fredId: 'W823RC1' },
    { key: 'medicare', fredId: 'W824RC1' },
    { key: 'medicaid', fredId: 'W729RC1' },
    { key: 'ui',       fredId: 'W825RC1' },
    { key: 'veterans', fredId: 'W826RC1' },
    { key: 'other',    fredId: 'W827RC1' },
  ] as const

  const OUTLAYS_COMPONENTS = [
    { key: 'pce',      fredId: 'PCE' },
    { key: 'intpay',   fredId: 'B069RC1' },
    { key: 'transpay', fredId: 'W211RC1' },
  ] as const

  // PI contribution data
  const contribYoyData = useMemo(() => buildContribSeries(allData, 'PI', PI_COMPONENTS, 'pi', 'yoy'), [allData])
  const contribMomData = useMemo(() => buildContribSeries(allData, 'PI', PI_COMPONENTS, 'pi', 'mom'), [allData])

  // Compensation contribution data
  const compYoyData = useMemo(() => buildContribSeries(allData, 'W209RC1', COMP_COMPONENTS, 'compTotal', 'yoy'), [allData])
  const compMomData = useMemo(() => buildContribSeries(allData, 'W209RC1', COMP_COMPONENTS, 'compTotal', 'mom'), [allData])

  // Wages contribution data
  const wagesYoyData = useMemo(() => buildContribSeries(allData, 'A576RC1', WAGES_COMPONENTS, 'wagesTotal', 'yoy'), [allData])
  const wagesMomData = useMemo(() => buildContribSeries(allData, 'A576RC1', WAGES_COMPONENTS, 'wagesTotal', 'mom'), [allData])

  // Private Wages contribution data
  const privwagesYoyData = useMemo(() => buildContribSeries(allData, 'A132RC1', PRIVWAGES_COMPONENTS, 'privwagesTotal', 'yoy'), [allData])
  const privwagesMomData = useMemo(() => buildContribSeries(allData, 'A132RC1', PRIVWAGES_COMPONENTS, 'privwagesTotal', 'mom'), [allData])

  // Income on Assets contribution data
  const assetsYoyData = useMemo(() => buildContribSeries(allData, 'PIROA', ASSETS_COMPONENTS, 'assetsTotal', 'yoy'), [allData])
  const assetsMomData = useMemo(() => buildContribSeries(allData, 'PIROA', ASSETS_COMPONENTS, 'assetsTotal', 'mom'), [allData])

  // Gov't Social Benefits contribution data
  const govbenYoyData = useMemo(() => buildContribSeries(allData, 'A063RC1', GOVBEN_COMPONENTS, 'govbenTotal', 'yoy'), [allData])
  const govbenMomData = useMemo(() => buildContribSeries(allData, 'A063RC1', GOVBEN_COMPONENTS, 'govbenTotal', 'mom'), [allData])

  // Personal Outlays contribution data
  const outlaysYoyData = useMemo(() => buildContribSeries(allData, 'A068RC1', OUTLAYS_COMPONENTS, 'outlaysTotal', 'yoy'), [allData])
  const outlaysMomData = useMemo(() => buildContribSeries(allData, 'A068RC1', OUTLAYS_COMPONENTS, 'outlaysTotal', 'mom'), [allData])

  // ── Income rate visibility states ────────────────────────────────────────

  const [visPI, setVisPI]                   = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))
  const [visPIExTrans, setVisPIExTrans]     = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))
  const [visRPI, setVisRPI]                 = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))
  const [visRPIExTrans, setVisRPIExTrans]   = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))

  // ── Contribution visibility states ────────────────────────────────────────

  const mkVis = (items: readonly { id: string }[], lineKey: string) =>
    () => new Set([...items.map(s => s.id), lineKey])

  const [visContribYoy, setVisContribYoy] = useState<Set<string>>(mkVis(PIO_CONTRIB_ITEMS, 'pi'))
  const [visContribMom, setVisContribMom] = useState<Set<string>>(mkVis(PIO_CONTRIB_ITEMS, 'pi'))
  const [visCompYoy, setVisCompYoy]       = useState<Set<string>>(mkVis(COMP_CONTRIB_ITEMS, 'compTotal'))
  const [visCompMom, setVisCompMom]       = useState<Set<string>>(mkVis(COMP_CONTRIB_ITEMS, 'compTotal'))
  const [visWagesYoy, setVisWagesYoy]     = useState<Set<string>>(mkVis(WAGES_CONTRIB_ITEMS, 'wagesTotal'))
  const [visWagesMom, setVisWagesMom]     = useState<Set<string>>(mkVis(WAGES_CONTRIB_ITEMS, 'wagesTotal'))
  const [visPrivwagesYoy, setVisPrivwagesYoy] = useState<Set<string>>(mkVis(PRIVWAGES_CONTRIB_ITEMS, 'privwagesTotal'))
  const [visPrivwagesMom, setVisPrivwagesMom] = useState<Set<string>>(mkVis(PRIVWAGES_CONTRIB_ITEMS, 'privwagesTotal'))
  const [visAssetsYoy, setVisAssetsYoy]   = useState<Set<string>>(mkVis(ASSETS_CONTRIB_ITEMS, 'assetsTotal'))
  const [visAssetsMom, setVisAssetsMom]   = useState<Set<string>>(mkVis(ASSETS_CONTRIB_ITEMS, 'assetsTotal'))
  const [visGovbenYoy, setVisGovbenYoy]   = useState<Set<string>>(mkVis(GOVBEN_CONTRIB_ITEMS, 'govbenTotal'))
  const [visGovbenMom, setVisGovbenMom]   = useState<Set<string>>(mkVis(GOVBEN_CONTRIB_ITEMS, 'govbenTotal'))
  const [visOutlaysYoy, setVisOutlaysYoy] = useState<Set<string>>(mkVis(OUTLAYS_CONTRIB_ITEMS, 'outlaysTotal'))
  const [visOutlaysMom, setVisOutlaysMom] = useState<Set<string>>(mkVis(OUTLAYS_CONTRIB_ITEMS, 'outlaysTotal'))

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (key: string) => setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const toggleContribYoy = useMemo(() => mkToggle(setVisContribYoy), [])
  const toggleContribMom = useMemo(() => mkToggle(setVisContribMom), [])
  const toggleCompYoy = useMemo(() => mkToggle(setVisCompYoy), [])
  const toggleCompMom = useMemo(() => mkToggle(setVisCompMom), [])
  const toggleWagesYoy = useMemo(() => mkToggle(setVisWagesYoy), [])
  const toggleWagesMom = useMemo(() => mkToggle(setVisWagesMom), [])
  const togglePrivwagesYoy = useMemo(() => mkToggle(setVisPrivwagesYoy), [])
  const togglePrivwagesMom = useMemo(() => mkToggle(setVisPrivwagesMom), [])
  const toggleAssetsYoy = useMemo(() => mkToggle(setVisAssetsYoy), [])
  const toggleAssetsMom = useMemo(() => mkToggle(setVisAssetsMom), [])
  const toggleGovbenYoy = useMemo(() => mkToggle(setVisGovbenYoy), [])
  const toggleGovbenMom = useMemo(() => mkToggle(setVisGovbenMom), [])
  const toggleOutlaysYoy = useMemo(() => mkToggle(setVisOutlaysYoy), [])
  const toggleOutlaysMom = useMemo(() => mkToggle(setVisOutlaysMom), [])
  const togglePI         = useMemo(() => mkToggle(setVisPI), [])
  const togglePIExTrans  = useMemo(() => mkToggle(setVisPIExTrans), [])
  const toggleRPI        = useMemo(() => mkToggle(setVisRPI), [])
  const toggleRPIExTrans = useMemo(() => mkToggle(setVisRPIExTrans), [])

  // ── Brush states ────────────────────────────────────────────────────────

  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: '10Y' },
    xRegime:   { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xMom:      { start: 0, end: 0, period: '10Y' },
    xAnnMom:   { start: 0, end: 0, period: '10Y' },
    piRates:         { start: 0, end: 0, period: '10Y' },
    piExTransRates:  { start: 0, end: 0, period: '10Y' },
    rpiRates:        { start: 0, end: 0, period: '10Y' },
    rpiExTransRates: { start: 0, end: 0, period: '10Y' },
    contribYoy: { start: 0, end: 0, period: '' },
    contribMom: { start: 0, end: 0, period: '' },
    compYoy:      { start: 0, end: 0, period: '' },
    compMom:      { start: 0, end: 0, period: '' },
    wagesYoy:     { start: 0, end: 0, period: '' },
    wagesMom:     { start: 0, end: 0, period: '' },
    privwagesYoy: { start: 0, end: 0, period: '' },
    privwagesMom: { start: 0, end: 0, period: '' },
    assetsYoy:    { start: 0, end: 0, period: '' },
    assetsMom:    { start: 0, end: 0, period: '' },
    govbenYoy:    { start: 0, end: 0, period: '' },
    govbenMom:    { start: 0, end: 0, period: '' },
    outlaysYoy:   { start: 0, end: 0, period: '' },
    outlaysMom:   { start: 0, end: 0, period: '' },
  })

  // Initialize brushes when data arrives or component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endM = selectedData.length - 1
    const start = Math.max(0, endM - 119) // last 120 months = 10 years
    const newBrush: BrushState = { start, end: endM, period: '10Y' }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [selectedId, selectedData.length])

  // Initialize rate chart brushes when data arrives
  useEffect(() => {
    const piLen = piRatesData.length
    if (piLen === 0) return
    const initBr = (len: number) => {
      const end = Math.max(0, len - 1)
      return { start: Math.max(0, end - 119), end, period: '10Y' }
    }
    setBrushes(prev => ({
      ...prev,
      piRates:         initBr(piRatesData.length),
      piExTransRates:  initBr(piExTransRatesData.length),
      rpiRates:        initBr(rpiRatesData.length),
      rpiExTransRates: initBr(rpiExTransRatesData.length),
    }))
  }, [piRatesData.length, piExTransRatesData.length, rpiRatesData.length, rpiExTransRatesData.length])

  // ── Level chart Y-domain (auto-scaled to visible range) ─────────────────

  const yDomainLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.xLevel
    if (!exLevelData.length || end < start) return undefined
    const visible = exLevelData.slice(
      Math.max(0, start),
      Math.min(exLevelData.length, end + 1)
    )
    if (!visible.length) return undefined
    const vals = visible.map(d => d.value).filter(v => v != null) as number[]
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [exLevelData, brushes.xLevel.start, brushes.xLevel.end])

  // Synchronized explorer brush
  const handleExplorerBrush = useCallback(
    (_key: ExplorerChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => {
        const newBrush = {
          period: '',
          start:  startIndex ?? prev[_key].start,
          end:    endIndex   ?? prev[_key].end,
        }
        const next = { ...prev }
        for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
        return next
      })
    },
    []
  )

  const handleExplorerQuickSelect = useCallback(
    (_key: ExplorerChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      const newBrush = {
        start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
        end,
        period: label,
      }
      const next = {} as Record<string, BrushState>
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      setBrushes(prev => ({ ...prev, ...next }))
    },
    []
  )

  // Rate chart brush handlers
  const handleRateBrush = useCallback(
    (key: RatesChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start: startIndex ?? prev[key].start,
          end:   endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleRateQuickSelect = useCallback(
    (key: RatesChartKey, label: string, count: number, dataLen: number) => {
      const end = (dataLen || 1) - 1
      setBrushes(prev => ({
        ...prev,
        [key]: {
          start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
          end,
          period: label,
        },
      }))
    },
    []
  )

  // Initialize contribution brushes when data arrives
  useEffect(() => {
    const initBrush = (len: number) => {
      if (len === 0) return { start: 0, end: 0, period: '' }
      const end = len - 1
      return { start: Math.max(0, end - 119), end, period: '' }
    }
    const refLen = contribYoyData.length
    if (refLen === 0) return
    setBrushes(prev => ({
      ...prev,
      contribYoy:   initBrush(contribYoyData.length),
      contribMom:   initBrush(contribMomData.length),
      compYoy:      initBrush(compYoyData.length),
      compMom:      initBrush(compMomData.length),
      wagesYoy:     initBrush(wagesYoyData.length),
      wagesMom:     initBrush(wagesMomData.length),
      privwagesYoy: initBrush(privwagesYoyData.length),
      privwagesMom: initBrush(privwagesMomData.length),
      assetsYoy:    initBrush(assetsYoyData.length),
      assetsMom:    initBrush(assetsMomData.length),
      govbenYoy:    initBrush(govbenYoyData.length),
      govbenMom:    initBrush(govbenMomData.length),
      outlaysYoy:   initBrush(outlaysYoyData.length),
      outlaysMom:   initBrush(outlaysMomData.length),
    }))
  }, [contribYoyData.length, contribMomData.length, compYoyData.length, compMomData.length,
      wagesYoyData.length, wagesMomData.length, privwagesYoyData.length, privwagesMomData.length,
      assetsYoyData.length, assetsMomData.length, govbenYoyData.length, govbenMomData.length,
      outlaysYoyData.length, outlaysMomData.length])

  // Contribution chart brush handler
  const handleContribBrush = useCallback(
    (key: ContribChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start:  startIndex ?? prev[key].start,
          end:    endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleContribQuickSelect = useCallback(
    (key: ContribChartKey, label: string, count: number, dataLen: number) => {
      const end = (dataLen || 1) - 1
      setBrushes(prev => ({
        ...prev,
        [key]: {
          start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
          end,
          period: label,
        },
      }))
    },
    []
  )

  // ════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <>
        <div className={styles.majorHeader}>Personal Income &amp; Outlays Dashboard</div>
        <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
          BEA National Income &amp; Product Accounts &mdash; monthly, billions of dollars SAAR
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading {FRED_SERIES_IDS.length} personal income series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && Object.keys(allData).length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                Income Growth Rates
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Income Growth Rates</div>

            {/* Pair 1 — Nominal */}
            <div className={styles.twoColGrid}>
              {/* Personal Income */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Personal Income</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPI.has('yoy') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePI('yoy')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPI.has('ann6m') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePI('ann6m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta;
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPI.has('ann3m') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePI('ann3m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={piRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'ann6m' ? '6moΔ Ann.' : name === 'ann3m' ? '3moΔ Ann.' : 'YoY'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visPI.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visPI.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="ann6m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visPI.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="ann3m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.piRates.start}
                        endIndex={brushes.piRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('piRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.piRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('piRates', l, c, piRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>

              {/* Personal Income ex Transfer Receipts */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Personal Income ex Transfer Receipts</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPIExTrans.has('yoy') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePIExTrans('yoy')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPIExTrans.has('ann6m') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePIExTrans('ann6m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta;
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visPIExTrans.has('ann3m') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePIExTrans('ann3m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={piExTransRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'ann6m' ? '6moΔ Ann.' : name === 'ann3m' ? '3moΔ Ann.' : 'YoY'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visPIExTrans.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visPIExTrans.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="ann6m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visPIExTrans.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="ann3m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.piExTransRates.start}
                        endIndex={brushes.piExTransRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('piExTransRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.piExTransRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('piExTransRates', l, c, piExTransRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>
            </div>

            {/* Pair 2 — Real */}
            <div className={styles.twoColGrid}>
              {/* Real Personal Income */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Real Personal Income</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPI.has('yoy') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPI('yoy')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPI.has('ann6m') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPI('ann6m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta;
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPI.has('ann3m') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPI('ann3m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rpiRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'ann6m' ? '6moΔ Ann.' : name === 'ann3m' ? '3moΔ Ann.' : 'YoY'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visRPI.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRPI.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="ann6m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRPI.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="ann3m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.rpiRates.start}
                        endIndex={brushes.rpiRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('rpiRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.rpiRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('rpiRates', l, c, rpiRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>

              {/* Real Personal Income ex Transfer Receipts */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Real Personal Income ex Transfer Receipts</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPIExTrans.has('yoy') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPIExTrans('yoy')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPIExTrans.has('ann6m') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPIExTrans('ann6m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta;
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${!visRPIExTrans.has('ann3m') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleRPIExTrans('ann3m')}
                    >
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rpiExTransRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'ann6m' ? '6moΔ Ann.' : name === 'ann3m' ? '3moΔ Ann.' : 'YoY'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visRPIExTrans.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRPIExTrans.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="ann6m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRPIExTrans.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="ann3m"
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.rpiExTransRates.start}
                        endIndex={brushes.rpiExTransRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('rpiExTransRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.rpiExTransRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('rpiExTransRates', l, c, rpiExTransRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Component Explorer</div>

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>PIO Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                >
                  {PIO_HIERARCHY.map(item => (
                    <option key={item.id} value={item.id}>
                      {'\u2014 '.repeat(item.depth)}{item.label}
                    </option>
                  ))}
                </select>
                <span className={styles.fredId}>{selectedId}</span>
              </div>
            </div>

            {selectedData.length === 0 ? (
              <div className={styles.statusBlock}>No data for {selectedId}</div>
            ) : (
              <>
                {/* E1: Level */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; Level</div>
                      <div className={styles.sectionSubtitle}>Billions of dollars, SAAR</div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#60a5fa' }} />
                        Level
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exLevelData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis domain={yDomainLevel} tick={TICK} tickLine={false} axisLine={false} width={58}
                          tickFormatter={fmtBillions} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtBillions(v) : '-', ''] as [string, string]} />
                        <Line type="monotone" dataKey="value" name="Level"
                          stroke="#60a5fa" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xLevel.start}
                          endIndex={brushes.xLevel.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xLevel', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xLevel.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xLevel', l, c, exLevelData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E2: YoY % Change with Regime Shading */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; YoY % Change</div>
                      <div className={styles.sectionSubtitle}>Regime Shading</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>Regime MA</span>
                        <input type="number" min={1} max={60} value={regimeMa}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setRegimeMa(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(74,222,128,0.4)' }} />
                        + (above MA)
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(239,68,68,0.4)' }} />
                        &minus; (below MA)
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#e2e8f0' }} />
                        YoY
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exRegimeData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (name === 'regime') return [null, null]
                            if (typeof v !== 'number') return ['-', '']
                            return [fmtPctTooltip(v), 'YoY'] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="yoy" isAnimationActive={false} legendType="none" maxBarSize={8000} barSize={4}>
                          {exRegimeData.map((entry, idx) => (
                            <Cell key={`regime-${idx}`}
                              fill={
                                entry.regime === '+' ? 'rgba(74,222,128,0.30)'
                                : entry.regime === '-' ? 'rgba(239,68,68,0.30)'
                                : 'rgba(148,163,184,0.08)'
                              } />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#e2e8f0" strokeWidth={2}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xRegime.start}
                          endIndex={brushes.xRegime.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xRegime', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xRegime.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xRegime', l, c, exRegimeData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E3: YoY Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; YoY &Delta;</div>
                      <div className={styles.sectionSubtitle}>Change in Year-over-Year %</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>&Delta; Window</span>
                        <input type="number" min={1} max={12} value={deltaWindow}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 12) setDeltaWindow(n) }}
                          className={styles.lookbackInput} />
                      </div>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA</span>
                        <input type="number" min={1} max={32} value={deltaMa}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 32) setDeltaMa(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: '#4ade80' }} />
                        YoY &Delta;({deltaWindow})
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#60a5fa' }} />
                        {deltaMa}-pd MA
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exYoYDeltaData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (typeof v !== 'number') return ['-', '']
                            const lbl = name === 'ma' ? `${deltaMa}-pd MA` : `YoY \u0394(${deltaWindow})`
                            return [fmtPctTooltip(v), lbl] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="delta" isAnimationActive={false} legendType="none" maxBarSize={16}>
                          {exYoYDeltaData.map((entry, idx) => (
                            <Cell key={`d-${idx}`}
                              fill={(entry.delta ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(74,222,128,0.40)'} />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="ma" name={`${deltaMa}-pd MA`}
                          stroke="#60a5fa" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xYoyDelta.start}
                          endIndex={brushes.xYoyDelta.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xYoyDelta', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xYoyDelta.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xYoyDelta', l, c, exYoYDeltaData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E4: MoM %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; MoM %&Delta;</div>
                      <div className={styles.sectionSubtitle}>Month-over-Month</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA1</span>
                        <input type="number" min={1} max={24} value={momMa1}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMomMa1(n) }}
                          className={styles.lookbackInput} />
                      </div>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA2</span>
                        <input type="number" min={1} max={24} value={momMa2}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMomMa2(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(147,197,253,0.75)' }} />
                        MoM %
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#4ade80' }} />
                        {momMa1}-pd MA
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#f97316' }} />
                        {momMa2}-pd MA
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exMoMData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (typeof v !== 'number') return ['-', '']
                            const lbl = name === 'ma1' ? `${momMa1}-pd MA` : name === 'ma2' ? `${momMa2}-pd MA` : 'MoM'
                            return [fmtPctTooltip(v), lbl] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="mom" name="MoM" isAnimationActive={false} legendType="none" maxBarSize={16}
                          fill="rgba(147,197,253,0.75)" />
                        <Line type="monotone" dataKey="ma1" name={`${momMa1}-pd MA`}
                          stroke="#4ade80" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Line type="monotone" dataKey="ma2" name={`${momMa2}-pd MA`}
                          stroke="#f97316" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xMom.start}
                          endIndex={brushes.xMom.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xMom', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xMom.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xMom', l, c, exMoMData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E5: Annualized MoM %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; Annualized MoM %&Delta;</div>
                      <div className={styles.sectionSubtitle}>(M/M)^12 &minus; 1</div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#fdba74' }} />
                        Annualized MoM %
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exAnnMoMData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtPctTooltip(v) : '-', ''] as [string, string]} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Line type="monotone" dataKey="value" name="Ann. MoM"
                          stroke="#fdba74" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xAnnMom.start}
                          endIndex={brushes.xAnnMom.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xAnnMom', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xAnnMom.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xAnnMom', l, c, exAnnMoMData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>
              </>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                Personal Income Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Personal Income Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Personal Income
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              {/* Left — YoY */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Personal Income</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {PIO_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visContribYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleContribYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visContribYoy.has('pi') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleContribYoy('pi')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Personal Income
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={contribYoyData}
                    visibleStart={brushes.contribYoy.start}
                    visibleEnd={brushes.contribYoy.end}
                    activeSeries={visContribYoy}
                    clipPrefix="pioyoy"
                    seriesItems={PIO_CONTRIB_ITEMS}
                    lineKey="pi"
                    lineLabel="Personal Income"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={contribYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush
                        dataKey="date"
                        startIndex={brushes.contribYoy.start}
                        endIndex={brushes.contribYoy.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleContribBrush('contribYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.contribYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('contribYoy', l, c, contribYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>

              {/* Right — MoM */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Personal Income</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {PIO_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visContribMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleContribMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visContribMom.has('pi') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleContribMom('pi')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Personal Income
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={contribMomData}
                    visibleStart={brushes.contribMom.start}
                    visibleEnd={brushes.contribMom.end}
                    activeSeries={visContribMom}
                    clipPrefix="piomom"
                    seriesItems={PIO_CONTRIB_ITEMS}
                    lineKey="pi"
                    lineLabel="Personal Income"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={contribMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush
                        dataKey="date"
                        startIndex={brushes.contribMom.start}
                        endIndex={brushes.contribMom.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleContribBrush('contribMom', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.contribMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('contribMom', l, c, contribMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Compensation of Employees Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Compensation of Employees Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Compensation of Employees
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Compensation</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {COMP_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visCompYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleCompYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visCompYoy.has('compTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleCompYoy('compTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Compensation
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={compYoyData}
                    visibleStart={brushes.compYoy.start}
                    visibleEnd={brushes.compYoy.end}
                    activeSeries={visCompYoy}
                    clipPrefix="compyoy"
                    seriesItems={COMP_CONTRIB_ITEMS}
                    lineKey="compTotal"
                    lineLabel="Compensation of Employees"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={compYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.compYoy.start}
                        endIndex={brushes.compYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('compYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.compYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('compYoy', l, c, compYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Compensation</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {COMP_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visCompMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleCompMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visCompMom.has('compTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleCompMom('compTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Compensation
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={compMomData}
                    visibleStart={brushes.compMom.start}
                    visibleEnd={brushes.compMom.end}
                    activeSeries={visCompMom}
                    clipPrefix="compmom"
                    seriesItems={COMP_CONTRIB_ITEMS}
                    lineKey="compTotal"
                    lineLabel="Compensation of Employees"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={compMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.compMom.start}
                        endIndex={brushes.compMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('compMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.compMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('compMom', l, c, compMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Wages and Salaries Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Wages and Salaries Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Wages and Salaries
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Wages &amp; Salaries</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {WAGES_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visWagesYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleWagesYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visWagesYoy.has('wagesTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleWagesYoy('wagesTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Wages &amp; Salaries
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={wagesYoyData}
                    visibleStart={brushes.wagesYoy.start}
                    visibleEnd={brushes.wagesYoy.end}
                    activeSeries={visWagesYoy}
                    clipPrefix="wagesyoy"
                    seriesItems={WAGES_CONTRIB_ITEMS}
                    lineKey="wagesTotal"
                    lineLabel="Wages and Salaries"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={wagesYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.wagesYoy.start}
                        endIndex={brushes.wagesYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('wagesYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.wagesYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('wagesYoy', l, c, wagesYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Wages &amp; Salaries</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {WAGES_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visWagesMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleWagesMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visWagesMom.has('wagesTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleWagesMom('wagesTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Wages &amp; Salaries
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={wagesMomData}
                    visibleStart={brushes.wagesMom.start}
                    visibleEnd={brushes.wagesMom.end}
                    activeSeries={visWagesMom}
                    clipPrefix="wagesmom"
                    seriesItems={WAGES_CONTRIB_ITEMS}
                    lineKey="wagesTotal"
                    lineLabel="Wages and Salaries"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={wagesMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.wagesMom.start}
                        endIndex={brushes.wagesMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('wagesMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.wagesMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('wagesMom', l, c, wagesMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Private Wages and Salaries Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Private Wages and Salaries Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Private Industries Wages
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Private Wages</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {PRIVWAGES_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visPrivwagesYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => togglePrivwagesYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visPrivwagesYoy.has('privwagesTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePrivwagesYoy('privwagesTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Private Wages
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={privwagesYoyData}
                    visibleStart={brushes.privwagesYoy.start}
                    visibleEnd={brushes.privwagesYoy.end}
                    activeSeries={visPrivwagesYoy}
                    clipPrefix="privwagesyoy"
                    seriesItems={PRIVWAGES_CONTRIB_ITEMS}
                    lineKey="privwagesTotal"
                    lineLabel="Private Wages and Salaries"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={privwagesYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.privwagesYoy.start}
                        endIndex={brushes.privwagesYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('privwagesYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.privwagesYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('privwagesYoy', l, c, privwagesYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Private Wages</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {PRIVWAGES_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visPrivwagesMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => togglePrivwagesMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visPrivwagesMom.has('privwagesTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => togglePrivwagesMom('privwagesTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Private Wages
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={privwagesMomData}
                    visibleStart={brushes.privwagesMom.start}
                    visibleEnd={brushes.privwagesMom.end}
                    activeSeries={visPrivwagesMom}
                    clipPrefix="privwagesmom"
                    seriesItems={PRIVWAGES_CONTRIB_ITEMS}
                    lineKey="privwagesTotal"
                    lineLabel="Private Wages and Salaries"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={privwagesMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.privwagesMom.start}
                        endIndex={brushes.privwagesMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('privwagesMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.privwagesMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('privwagesMom', l, c, privwagesMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Income on Assets Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Income on Assets Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Personal Income Receipts on Assets
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Income on Assets</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {ASSETS_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visAssetsYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleAssetsYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visAssetsYoy.has('assetsTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleAssetsYoy('assetsTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Income on Assets
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={assetsYoyData}
                    visibleStart={brushes.assetsYoy.start}
                    visibleEnd={brushes.assetsYoy.end}
                    activeSeries={visAssetsYoy}
                    clipPrefix="assetsyoy"
                    seriesItems={ASSETS_CONTRIB_ITEMS}
                    lineKey="assetsTotal"
                    lineLabel="Income on Assets"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={assetsYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.assetsYoy.start}
                        endIndex={brushes.assetsYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('assetsYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.assetsYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('assetsYoy', l, c, assetsYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Income on Assets</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {ASSETS_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visAssetsMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleAssetsMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visAssetsMom.has('assetsTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleAssetsMom('assetsTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Income on Assets
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={assetsMomData}
                    visibleStart={brushes.assetsMom.start}
                    visibleEnd={brushes.assetsMom.end}
                    activeSeries={visAssetsMom}
                    clipPrefix="assetsmom"
                    seriesItems={ASSETS_CONTRIB_ITEMS}
                    lineKey="assetsTotal"
                    lineLabel="Income on Assets"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={assetsMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.assetsMom.start}
                        endIndex={brushes.assetsMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('assetsMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.assetsMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('assetsMom', l, c, assetsMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Gov't Social Benefits Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Gov&apos;t Social Benefits Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Gov&apos;t Social Benefits to Persons
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Gov&apos;t Benefits</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {GOVBEN_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visGovbenYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleGovbenYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visGovbenYoy.has('govbenTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleGovbenYoy('govbenTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Gov&apos;t Benefits
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={govbenYoyData}
                    visibleStart={brushes.govbenYoy.start}
                    visibleEnd={brushes.govbenYoy.end}
                    activeSeries={visGovbenYoy}
                    clipPrefix="govbenyoy"
                    seriesItems={GOVBEN_CONTRIB_ITEMS}
                    lineKey="govbenTotal"
                    lineLabel="Gov't Social Benefits"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={govbenYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.govbenYoy.start}
                        endIndex={brushes.govbenYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('govbenYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.govbenYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('govbenYoy', l, c, govbenYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Gov&apos;t Benefits</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {GOVBEN_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visGovbenMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleGovbenMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visGovbenMom.has('govbenTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleGovbenMom('govbenTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Gov&apos;t Benefits
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={govbenMomData}
                    visibleStart={brushes.govbenMom.start}
                    visibleEnd={brushes.govbenMom.end}
                    activeSeries={visGovbenMom}
                    clipPrefix="govbenmom"
                    seriesItems={GOVBEN_CONTRIB_ITEMS}
                    lineKey="govbenTotal"
                    lineLabel="Gov't Social Benefits"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={govbenMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.govbenMom.start}
                        endIndex={brushes.govbenMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('govbenMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.govbenMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('govbenMom', l, c, govbenMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Personal Outlays Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>Personal Outlays Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>
                  Contributions to YoY and MoM % change in Personal Outlays
                </div>
              </div>
            </div>

            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY Personal Outlays</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {OUTLAYS_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visOutlaysYoy.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleOutlaysYoy(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visOutlaysYoy.has('outlaysTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleOutlaysYoy('outlaysTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Personal Outlays
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={outlaysYoyData}
                    visibleStart={brushes.outlaysYoy.start}
                    visibleEnd={brushes.outlaysYoy.end}
                    activeSeries={visOutlaysYoy}
                    clipPrefix="outlaysyoy"
                    seriesItems={OUTLAYS_CONTRIB_ITEMS}
                    lineKey="outlaysTotal"
                    lineLabel="Personal Outlays"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={outlaysYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.outlaysYoy.start}
                        endIndex={brushes.outlaysYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('outlaysYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.outlaysYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('outlaysYoy', l, c, outlaysYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM Personal Outlays</div>
                    <div className={styles.sectionSubtitle}>Recent</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {OUTLAYS_CONTRIB_ITEMS.map(item => (
                      <button key={item.id} type="button"
                        className={`${styles.legendItem} ${!visOutlaysMom.has(item.id) ? styles.legendItemOff : ''}`}
                        onClick={() => toggleOutlaysMom(item.id)}
                      >
                        <span className={styles.legendSwatch} style={{ background: item.color }} />
                        {item.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${!visOutlaysMom.has('outlaysTotal') ? styles.legendItemOff : ''}`}
                      onClick={() => toggleOutlaysMom('outlaysTotal')}
                    >
                      <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                      Personal Outlays
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <PioContribChart
                    data={outlaysMomData}
                    visibleStart={brushes.outlaysMom.start}
                    visibleEnd={brushes.outlaysMom.end}
                    activeSeries={visOutlaysMom}
                    clipPrefix="outlaysmom"
                    seriesItems={OUTLAYS_CONTRIB_ITEMS}
                    lineKey="outlaysTotal"
                    lineLabel="Personal Outlays"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={outlaysMomData} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                      <Brush dataKey="date"
                        startIndex={brushes.outlaysMom.start}
                        endIndex={brushes.outlaysMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('outlaysMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.outlaysMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('outlaysMom', l, c, outlaysMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>
          </>
        )}
    </>
  )
}

export function PIODashboardPage() {
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
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/growth" className={styles.breadcrumbLink}>Growth</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Personal Income &amp; Outlays</span>
      </nav>
      <div className={styles.body}>
        <PIODashboardContent />
      </div>
    </div>
  )
}
