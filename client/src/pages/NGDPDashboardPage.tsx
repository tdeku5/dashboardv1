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
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './NGDPDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

interface ContribRow {
  date:  string
  total: number | null
  [key: string]: string | number | null
}

interface ContribComponent {
  id:       string
  seriesId: string
  label:    string
  color:    string
}

interface ContribPairConfig {
  key:         string
  titleQoQ:    string
  titleYoY:    string
  subtitle:    string
  parentId:    string
  parentLabel: string
  components:  ContribComponent[]
}

// ── NIPA Table 1.1.5 hierarchy ────────────────────────────────────────────────

interface NipaItem {
  line:   number
  id:     string
  label:  string
  depth:  number
}

const NIPA_HIERARCHY: NipaItem[] = [
  { line: 1,  id: 'GDP',                label: 'Total Gross Domestic Product',                      depth: 0 },
  { line: 2,  id: 'PCEC',               label: 'Personal Consumption Expenditures',                 depth: 1 },
  { line: 3,  id: 'DGDSRC1Q027SBEA',    label: 'Goods',                                             depth: 2 },
  { line: 4,  id: 'PCDG',               label: 'Durable Goods',                                     depth: 3 },
  { line: 5,  id: 'DMOTRC1Q027SBEA',    label: 'Motor vehicles and parts',                          depth: 4 },
  { line: 6,  id: 'DFDHRC1Q027SBEA',    label: 'Furnishings and durable household equipment',       depth: 4 },
  { line: 7,  id: 'DREQRC1Q027SBEA',    label: 'Recreational goods and vehicles',                   depth: 4 },
  { line: 8,  id: 'DODGRC1Q027SBEA',    label: 'Other durable goods',                               depth: 4 },
  { line: 9,  id: 'PCND',               label: 'Nondurable Goods',                                  depth: 3 },
  { line: 10, id: 'DFXARC1Q027SBEA',    label: 'Food and beverages for off-premises consumption',   depth: 4 },
  { line: 11, id: 'DCLORC1Q027SBEA',    label: 'Clothing and footwear',                             depth: 4 },
  { line: 12, id: 'DGOERC1Q027SBEA',    label: 'Gasoline and other energy goods',                   depth: 4 },
  { line: 13, id: 'DONGRC1Q027SBEA',    label: 'Other nondurable goods',                            depth: 4 },
  { line: 14, id: 'PCESV',              label: 'Services',                                          depth: 2 },
  { line: 15, id: 'DHCERC1Q027SBEA',    label: 'Household consumption expenditures (for services)', depth: 3 },
  { line: 16, id: 'DHUTRC1Q027SBEA',    label: 'Housing and utilities',                             depth: 4 },
  { line: 17, id: 'DHLCRC1Q027SBEA',    label: 'Health care',                                       depth: 4 },
  { line: 18, id: 'DTRSRC1Q027SBEA',    label: 'Transportation services',                           depth: 4 },
  { line: 19, id: 'DRCARC1Q027SBEA',    label: 'Recreation services',                               depth: 4 },
  { line: 20, id: 'DFSARC1Q027SBEA',    label: 'Food services and accommodations',                  depth: 4 },
  { line: 21, id: 'DIFSRC1Q027SBEA',    label: 'Financial services and accommodations',             depth: 4 },
  { line: 22, id: 'DOTSRC1Q027SBEA',    label: 'Other services',                                    depth: 4 },
  { line: 23, id: 'GPDI',               label: 'Gross Private Domestic Investment',                 depth: 1 },
  { line: 24, id: 'FPI',                label: 'Fixed Investment',                                  depth: 2 },
  { line: 25, id: 'PNFI',               label: 'Nonresidential',                                    depth: 3 },
  { line: 26, id: 'B009RC1Q027SBEA',    label: 'Structures',                                        depth: 4 },
  { line: 27, id: 'Y033RC1Q027SBEA',    label: 'Equipment',                                         depth: 4 },
  { line: 28, id: 'Y034RC1Q027SBEA',    label: 'Information processing equipment',                  depth: 5 },
  { line: 29, id: 'A680RC1Q027SBEA',    label: 'Industrial equipment',                              depth: 5 },
  { line: 30, id: 'A681RC1Q027SBEA',    label: 'Transportation equipment',                          depth: 5 },
  { line: 31, id: 'A862RC1Q027SBEA',    label: 'Other equipment',                                   depth: 5 },
  { line: 32, id: 'Y001RC1Q027SBEA',    label: 'Intellectual Property Products',                    depth: 4 },
  { line: 33, id: 'B985RC1Q027SBEA',    label: 'Software',                                          depth: 5 },
  { line: 34, id: 'Y006RC1Q027SBEA',    label: 'Research and development',                          depth: 5 },
  { line: 35, id: 'Y020RC1Q027SBEA',    label: 'Entertainment, literary, and artistic originals',   depth: 5 },
  { line: 36, id: 'PRFI',               label: 'Residential',                                       depth: 3 },
  { line: 37, id: 'CBI',                label: 'Change in Private Inventories',                     depth: 2 },
  { line: 38, id: 'NETEXP',             label: 'Net Exports of Goods and Services',                 depth: 1 },
  { line: 39, id: 'EXPGS',              label: 'Exports',                                           depth: 2 },
  { line: 40, id: 'A253RC1Q027SBEA',    label: 'Goods',                                             depth: 3 },
  { line: 41, id: 'A646RC1Q027SBEA',    label: 'Services',                                          depth: 3 },
  { line: 42, id: 'IMPGS',              label: 'Imports',                                           depth: 2 },
  { line: 43, id: 'A255RC1Q027SBEA',    label: 'Goods',                                             depth: 3 },
  { line: 44, id: 'B656RC1Q027SBEA',    label: 'Services',                                          depth: 3 },
  { line: 45, id: 'GCE',                label: "Gov't Consumption Expenditures and Gross Investment", depth: 1 },
  { line: 46, id: 'FGCE',               label: 'Federal',                                           depth: 2 },
  { line: 47, id: 'FDEFX',              label: 'National Defense',                                  depth: 3 },
  { line: 48, id: 'FNDEFX',             label: 'Nondefense',                                        depth: 3 },
  { line: 49, id: 'SLCE',               label: 'State and Local',                                   depth: 2 },
]

// Line-number → FRED ID lookup
const NI = Object.fromEntries(NIPA_HIERARCHY.map(n => [n.line, n.id])) as Record<number, string>

const ALL_SERIES_IDS = NIPA_HIERARCHY.map(n => n.id)

// ── Contribution pair configurations ──────────────────────────────────────────

const GDP_PAIR: ContribPairConfig = {
  key: 'gdp',
  titleQoQ: 'Contributions to QoQ nGDP',
  titleYoY: 'Contributions to YoY nGDP',
  subtitle: 'Expenditure Decomposition',
  parentId: 'GDP',
  parentLabel: 'nGDP',
  components: [
    { id: 'pce',        seriesId: 'PCEC',   label: 'PCE',                color: '#60a5fa' },
    { id: 'investment', seriesId: 'GPDI',   label: 'Private Investment', color: '#f59e0b' },
    { id: 'netExports', seriesId: 'NETEXP', label: 'Net Exports',        color: '#4ade80' },
    { id: 'govt',       seriesId: 'GCE',    label: "Gov't Spending",     color: '#f87171' },
  ],
}

const PCE_PAIRS: ContribPairConfig[] = [
  {
    key: 'pce',
    titleQoQ: 'Contributions to QoQ PCE',
    titleYoY: 'Contributions to YoY PCE',
    subtitle: '',
    parentId: 'PCEC',
    parentLabel: 'PCE',
    components: [
      { id: 'services', seriesId: 'PCESV', label: 'Services', color: '#60a5fa' },
      { id: 'goods',    seriesId: NI[3],    label: 'Goods',    color: '#4ade80' },
    ],
  },
  {
    key: 'goodsPce',
    titleQoQ: 'Contributions to QoQ Goods PCE',
    titleYoY: 'Contributions to YoY Goods PCE',
    subtitle: '',
    parentId: NI[3],
    parentLabel: 'Goods PCE',
    components: [
      { id: 'durables',    seriesId: 'PCDG', label: 'Durables',    color: '#4ade80' },
      { id: 'nondurables', seriesId: 'PCND', label: 'Nondurables', color: '#fb923c' },
    ],
  },
  {
    key: 'durablesPce',
    titleQoQ: 'Contributions to QoQ Durable Goods PCE',
    titleYoY: 'Contributions to YoY Durable Goods PCE',
    subtitle: '',
    parentId: 'PCDG',
    parentLabel: 'Durable Goods PCE',
    components: [
      { id: 'motor',        seriesId: NI[5], label: 'Motor Vehicles & Parts',              color: '#60a5fa' },
      { id: 'furnishings',  seriesId: NI[6], label: 'Furnishings & Durable HH Equipment',  color: '#fb923c' },
      { id: 'recreation',   seriesId: NI[7], label: 'Rec. Goods & Vehicles',               color: '#4ade80' },
      { id: 'otherDurable', seriesId: NI[8], label: 'Other Durable Goods',                 color: '#f87171' },
    ],
  },
  {
    key: 'nondurablesPce',
    titleQoQ: 'Contributions to QoQ Nondurable Goods PCE',
    titleYoY: 'Contributions to YoY Nondurable Goods PCE',
    subtitle: '',
    parentId: 'PCND',
    parentLabel: 'Nondurable Goods PCE',
    components: [
      { id: 'food',             seriesId: NI[10], label: 'Food & Beverage',        color: '#60a5fa' },
      { id: 'clothing',         seriesId: NI[11], label: 'Clothing & Footwear',    color: '#fb923c' },
      { id: 'gas',              seriesId: NI[12], label: 'Gas & Energy Goods',     color: '#4ade80' },
      { id: 'otherNondurable',  seriesId: NI[13], label: 'Other Nondurable Goods', color: '#f87171' },
    ],
  },
  {
    key: 'hhServices',
    titleQoQ: 'Contributions to QoQ HH Services Consumption',
    titleYoY: 'Contributions to YoY HH Services Consumption',
    subtitle: '',
    parentId: NI[15],
    parentLabel: 'HH Services',
    components: [
      { id: 'housing',   seriesId: NI[16], label: 'Housing & Utilities',       color: '#60a5fa' },
      { id: 'health',    seriesId: NI[17], label: 'Health Care',               color: '#fb923c' },
      { id: 'transport', seriesId: NI[18], label: 'Transportation Services',   color: '#4ade80' },
      { id: 'rec',       seriesId: NI[19], label: 'Recreation Services',       color: '#f87171' },
      { id: 'foodSvc',   seriesId: NI[20], label: 'Food Services & Accom.',    color: '#a78bfa' },
      { id: 'financial', seriesId: NI[21], label: 'Financial Services',        color: '#2dd4bf' },
      { id: 'otherSvc',  seriesId: NI[22], label: 'Other Services',            color: '#facc15' },
    ],
  },
]

const INVESTMENT_PAIRS: ContribPairConfig[] = [
  {
    key: 'fixedInv',
    titleQoQ: 'Contributions to QoQ Fixed Investment',
    titleYoY: 'Contributions to YoY Fixed Investment',
    subtitle: '',
    parentId: 'FPI',
    parentLabel: 'Fixed Investment',
    components: [
      { id: 'nonres',      seriesId: 'PNFI', label: 'Nonresidential', color: '#60a5fa' },
      { id: 'residential', seriesId: 'PRFI', label: 'Residential',    color: '#f87171' },
    ],
  },
  {
    key: 'nonresInv',
    titleQoQ: 'Contributions to QoQ Nonresidential Investment',
    titleYoY: 'Contributions to YoY Nonresidential Investment',
    subtitle: '',
    parentId: 'PNFI',
    parentLabel: 'Nonresidential Investment',
    components: [
      { id: 'structures', seriesId: NI[26], label: 'Structures',                     color: '#60a5fa' },
      { id: 'equipment',  seriesId: NI[27], label: 'Equipment',                      color: '#f87171' },
      { id: 'ip',         seriesId: NI[32], label: 'Intellectual Property Products',  color: '#4ade80' },
    ],
  },
  {
    key: 'equipInv',
    titleQoQ: 'Contributions to QoQ Equipment Investment',
    titleYoY: 'Contributions to YoY Equipment Investment',
    subtitle: '',
    parentId: NI[27],
    parentLabel: 'Equipment Investment',
    components: [
      { id: 'infoProc',   seriesId: NI[28], label: 'Information Processing', color: '#60a5fa' },
      { id: 'industrial', seriesId: NI[29], label: 'Industrial',             color: '#f87171' },
      { id: 'transport',  seriesId: NI[30], label: 'Transportation',         color: '#4ade80' },
      { id: 'otherEquip', seriesId: NI[31], label: 'Other Equipment',        color: '#a78bfa' },
    ],
  },
  {
    key: 'ipInv',
    titleQoQ: 'Contributions to QoQ IP Investment',
    titleYoY: 'Contributions to YoY IP Investment',
    subtitle: '',
    parentId: NI[32],
    parentLabel: 'IP Investment',
    components: [
      { id: 'software',      seriesId: NI[33], label: 'Software',                                     color: '#60a5fa' },
      { id: 'rd',            seriesId: NI[34], label: 'R&D',                                          color: '#f87171' },
      { id: 'entertainment', seriesId: NI[35], label: 'Entertainment, Literary, & Artistic Originals', color: '#4ade80' },
    ],
  },
]

// ── Chart constants ──────────────────────────────────────────────────────────

const CM   = { top: 8, right: 16, bottom: 28, left: 62 } as const
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

const QUICK_PERIODS_Q = [
  { label: '5Y',  count: 20  },
  { label: '10Y', count: 40  },
  { label: '20Y', count: 80  },
  { label: 'Max', count: Infinity },
] as const

// ── Explorer chart keys ──────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xQoq' | 'xAnnQoq'

const EXPLORER_KEYS: ExplorerChartKey[] = ['xLevel', 'xRegime', 'xYoyDelta', 'xQoq', 'xAnnQoq']

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
    if (i < 4) return { date: d.date, value: null }
    const prev = data[i - 4].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeQoQ(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeAnnualizedQoQ(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0 || prev < 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, 4) - 1) * 100 }
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

function computeContribution(
  component: WD[],
  parent: WD[],
  lag: number,
): { date: string; value: number | null }[] {
  const parentMap = new Map(parent.map(d => [d.date, d.value]))
  return component.map((d, i) => {
    if (i < lag) return { date: d.date, value: null }
    const prev = component[i - lag]
    const parentPrev = parentMap.get(prev.date)
    if (parentPrev == null || parentPrev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev.value) / Math.abs(parentPrev)) * 100 }
  })
}

function niceAxisTicks(min: number, max: number, targetCount = 6): number[] {
  if (min === max) return [min]
  const range     = max - min
  const roughStep = range / targetCount
  const mag       = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)))
  const niceStep  = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= roughStep) ?? roughStep
  const start     = Math.ceil(min / niceStep) * niceStep
  const ticks: number[] = []
  for (let t = start; t <= max + niceStep * 0.01; t += niceStep) {
    ticks.push(Math.round(t * 1e6) / 1e6)
  }
  return ticks
}

function computeDecompDomain(
  data: ContribRow[],
  start: number,
  end: number,
  items: readonly { id: string }[],
  activeSeries: Set<string>,
): [number, number] {
  const visible = data.slice(Math.max(0, start), Math.min(data.length, end + 1))
  let lo = 0
  let hi = 0
  for (const row of visible) {
    let posStack = 0
    let negStack = 0
    for (const s of items) {
      if (!activeSeries.has(s.id)) continue
      const v = row[s.id]
      if (typeof v !== 'number' || v == null) continue
      if (v > 0) posStack += v
      else negStack += v
    }
    if (posStack > hi) hi = posStack
    if (negStack < lo) lo = negStack
  }
  const pad = (hi - lo) * 0.08 || 1
  return [Math.floor((lo - pad) * 10) / 10, Math.ceil((hi + pad) * 10) / 10]
}

function buildContribData(
  allData: AllData,
  parentId: string,
  components: ContribComponent[],
  lag: number,
): ContribRow[] {
  const parent = allData[parentId] ?? []
  if (!parent.length) return []
  const totalPct = lag === 1 ? computeQoQ(parent) : computeYoY(parent)
  const totalMap = new Map(totalPct.map(d => [d.date, d.value]))
  const compMaps = components.map(c => {
    const contrib = computeContribution(allData[c.seriesId] ?? [], parent, lag)
    return new Map(contrib.map(d => [d.date, d.value]))
  })
  return parent.map(d => {
    const row: ContribRow = { date: d.date, total: totalMap.get(d.date) ?? null }
    components.forEach((c, i) => { row[c.id] = compMaps[i].get(d.date) ?? null })
    return row
  })
}

// ── DecompTooltip ─────────────────────────────────────────────────────────────

function DecompTooltip({
  row,
  activeItems,
  parentLabel,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:         ContribRow
  activeItems: readonly { id: string; label: string; color: string }[]
  parentLabel: string
  mouseX:      number
  mouseY:      number
  isRightHalf: boolean
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left:   isRightHalf ? mouseX - 220 : mouseX + 14,
        top:    mouseY - 40,
        background: '#090e15',
        border: '1px solid rgba(255,255,255,0.13)',
        borderRadius: 2,
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        pointerEvents: 'none',
        zIndex: 100,
        minWidth: 180,
      }}
    >
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {fmtFullDate(row.date)}
      </div>
      {activeItems.map(item => {
        const delta = row[item.id] as number | null
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 1,
              background: item.color, display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ color: '#64748B', flex: 1, marginRight: 8 }}>{item.label}</span>
            <span style={{ color: (delta ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
              {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%` : '—'}
            </span>
          </div>
        )
      })}
      {row.total != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>{parentLabel}</span>
          <span style={{ color: (row.total as number) >= 0 ? '#4ade80' : '#f87171' }}>
            {(row.total as number) >= 0 ? '+' : ''}{(row.total as number).toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── DecompChart (custom SVG diverging stacked bar) ────────────────────────────

function DecompChart({
  data,
  visibleStart,
  visibleEnd,
  items,
  parentLabel,
  activeSeries,
  yDomain,
}: {
  data:         ContribRow[]
  visibleStart: number
  visibleEnd:   number
  items:        readonly { id: string; label: string; color: string }[]
  parentLabel:  string
  activeSeries: Set<string>
  yDomain:      [number, number]
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
  const innerW = Math.max(0, width  - CM.left - CM.right)
  const innerH = Math.max(0, height - CM.top  - CM.bottom)
  const [yMin, yMax] = yDomain
  const yRange = yMax - yMin || 1
  const n      = visible.length
  const colW   = n > 0 ? innerW / n : 0
  const barW   = Math.min(28, colW * 0.82)

  const activeItems = useMemo(
    () => items.filter(s => activeSeries.has(s.id)),
    [items, activeSeries]
  )

  const y0 = CM.top + (1 - (0 - yMin) / yRange) * innerH

  const { columns, linePts } = useMemo(() => {
    const toY = (v: number) => CM.top + (1 - (v - yMin) / yRange) * innerH
    type Rect = { y: number; h: number; color: string; id: string; delta: number }

    const cols = visible.map((row, i) => {
      const cx    = CM.left + (i + 0.5) * colW
      const rects: Rect[] = []
      let posStack = 0
      let negStack = 0

      for (const s of activeItems) {
        const delta = row[s.id] as number | null
        if (delta == null || delta === 0) continue

        if (delta > 0) {
          const yTop = toY(posStack + delta)
          const yBot = toY(posStack)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, delta })
          posStack += delta
        } else {
          const yTop = toY(negStack)
          const yBot = toY(negStack + delta)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, delta })
          negStack += delta
        }
      }

      return { cx, rects, row }
    })

    const pts = cols
      .filter(c => c.row.total != null)
      .map(c => ({ cx: c.cx, cy: toY(c.row.total as number) }))

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, colW, yMin, yRange, innerH])

  const yTicks = useMemo(() => niceAxisTicks(yMin, yMax, 6), [yMin, yMax])

  const xTicks = useMemo(() => {
    const ticks: { label: string; cx: number }[] = []
    let lastX = -Infinity
    visible.forEach((row, i) => {
      const cx = CM.left + (i + 0.5) * colW
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
    const mx   = e.clientX - rect.left - CM.left
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
  const isRH   = hovered != null && hovered >= n / 2
  const clipId = `dc${uid.replace(/[^a-zA-Z0-9]/g, '')}`

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
            <rect x={CM.left} y={CM.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {yTicks.map(t => {
          const ty = CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <line key={t}
              x1={CM.left} x2={CM.left + innerW}
              y1={ty}      y2={ty}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1}
            />
          )
        })}

        <line
          x1={CM.left} x2={CM.left + innerW}
          y1={y0}      y2={y0}
          stroke="rgba(255,255,255,0.25)" strokeWidth={1}
        />

        {hovCol && (
          <rect
            x={hovCol.cx - colW / 2} y={CM.top}
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
              />
            ))
          )}
        </g>

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {yTicks.map(t => {
          const ty = CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <text key={t}
              x={CM.left - 6} y={ty + 4}
              textAnchor="end"
              fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
            >
              {`${t >= 0 ? '' : ''}${t.toFixed(1)}%`}
            </text>
          )
        })}

        {xTicks.map(t => (
          <text key={t.label + t.cx}
            x={t.cx} y={height - CM.bottom + 14}
            textAnchor="middle"
            fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
          >
            {t.label}
          </text>
        ))}
      </svg>

      {hovCol && (
        <DecompTooltip
          row={hovCol.row}
          activeItems={activeItems}
          parentLabel={parentLabel}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRH}
        />
      )}
    </div>
  )
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

// ── DecompLegend ─────────────────────────────────────────────────────────────

function DecompLegend({
  items,
  parentLabel,
  activeSeries,
  onToggle,
}: {
  items:        readonly { id: string; label: string; color: string }[]
  parentLabel:  string
  activeSeries: Set<string>
  onToggle:     (id: string) => void
}) {
  return (
    <div className={styles.legendRow}>
      <div className={styles.legend}>
        {items.map(s => (
          <button key={s.id} type="button"
            className={`${styles.legendItem} ${activeSeries.has(s.id) ? '' : styles.legendItemOff}`}
            onClick={() => onToggle(s.id)}
          >
            <span className={styles.legendSwatch} style={{ background: s.color }} />
            <span>{s.label}</span>
          </button>
        ))}
        <span className={styles.legendItem} style={{ cursor: 'default' }}>
          <span className={styles.legendLine} style={{ background: '#ffffff' }} />
          <span style={{ color: '#94A3B8' }}>{parentLabel}</span>
        </span>
      </div>
    </div>
  )
}

// ── ContribPair — self-contained QoQ/YoY pair ────────────────────────────────

function ContribPair({
  config,
  allData,
}: {
  config:  ContribPairConfig
  allData: AllData
}) {
  const parentData = allData[config.parentId] ?? []

  // Active series
  const [activeSeries, setActiveSeries] = useState<Set<string>>(
    () => new Set(config.components.map(c => c.id))
  )
  const toggleSeries = useCallback((id: string) => {
    setActiveSeries(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Decomp data
  const decompQoQ = useMemo(
    () => buildContribData(allData, config.parentId, config.components, 1),
    [allData, config.parentId, config.components]
  )
  const decompYoY = useMemo(
    () => buildContribData(allData, config.parentId, config.components, 4),
    [allData, config.parentId, config.components]
  )

  // Brush state
  const [brushQoQ, setBrushQoQ] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [brushYoY, setBrushYoY] = useState<BrushState>({ start: 0, end: 0, period: '' })

  // Initialize to 2017 onward
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current || !parentData.length) return
    initRef.current = true
    const endIdx = parentData.length - 1
    const from2017 = parentData.findIndex(d => d.date >= '2017-01-01')
    const startIdx = from2017 >= 0 ? from2017 : 0
    setBrushQoQ({ start: startIdx, end: endIdx, period: '' })
    setBrushYoY({ start: startIdx, end: endIdx, period: '' })
  }, [parentData])

  // Y domains
  const qoqDomain = useMemo(
    () => computeDecompDomain(decompQoQ, brushQoQ.start, brushQoQ.end, config.components, activeSeries),
    [decompQoQ, brushQoQ.start, brushQoQ.end, config.components, activeSeries]
  )
  const yoyDomain = useMemo(
    () => computeDecompDomain(decompYoY, brushYoY.start, brushYoY.end, config.components, activeSeries),
    [decompYoY, brushYoY.start, brushYoY.end, config.components, activeSeries]
  )

  // Brush handlers
  const handleBrushQoQ = useCallback((startIndex?: number, endIndex?: number) => {
    setBrushQoQ(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  const handleBrushYoY = useCallback((startIndex?: number, endIndex?: number) => {
    setBrushYoY(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  const handleQSQoQ = useCallback((label: string, count: number) => {
    const end = decompQoQ.length - 1
    setBrushQoQ({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
  }, [decompQoQ.length])
  const handleQSYoY = useCallback((label: string, count: number) => {
    const end = decompYoY.length - 1
    setBrushYoY({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
  }, [decompYoY.length])

  if (!parentData.length) return null

  return (
    <div className={styles.twoColGrid}>
      {/* QoQ */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>{config.titleQoQ}</div>
            {config.subtitle && <div className={styles.sectionSubtitle}>{config.subtitle}</div>}
          </div>
        </div>
        <DecompLegend items={config.components} parentLabel={config.parentLabel} activeSeries={activeSeries} onToggle={toggleSeries} />
        <div className={styles.chartWrap}>
          <DecompChart
            data={decompQoQ}
            visibleStart={brushQoQ.start}
            visibleEnd={brushQoQ.end}
            items={config.components}
            parentLabel={config.parentLabel}
            activeSeries={activeSeries}
            yDomain={qoqDomain}
          />
        </div>
        <div className={styles.brushWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={decompQoQ} margin={{ top: 0, right: CM.right, bottom: 0, left: CM.left }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="total" stroke="rgba(255,255,255,0.18)"
                strokeWidth={1} dot={false} isAnimationActive={false} legendType="none" connectNulls />
              <Brush dataKey="date"
                startIndex={brushQoQ.start}
                endIndex={brushQoQ.end}
                onChange={({ startIndex, endIndex }) => handleBrushQoQ(startIndex, endIndex)}
                height={40} stroke="rgba(255,255,255,0.10)" fill="#070b10"
                travellerWidth={7} tickFormatter={fmtAxisDate} gap={4}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <QuickSelectRow period={brushQoQ.period} onSelect={handleQSQoQ} periods={QUICK_PERIODS_Q} />
      </div>

      {/* YoY */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>{config.titleYoY}</div>
            {config.subtitle && <div className={styles.sectionSubtitle}>{config.subtitle}</div>}
          </div>
        </div>
        <DecompLegend items={config.components} parentLabel={config.parentLabel} activeSeries={activeSeries} onToggle={toggleSeries} />
        <div className={styles.chartWrap}>
          <DecompChart
            data={decompYoY}
            visibleStart={brushYoY.start}
            visibleEnd={brushYoY.end}
            items={config.components}
            parentLabel={config.parentLabel}
            activeSeries={activeSeries}
            yDomain={yoyDomain}
          />
        </div>
        <div className={styles.brushWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={decompYoY} margin={{ top: 0, right: CM.right, bottom: 0, left: CM.left }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="total" stroke="rgba(255,255,255,0.18)"
                strokeWidth={1} dot={false} isAnimationActive={false} legendType="none" connectNulls />
              <Brush dataKey="date"
                startIndex={brushYoY.start}
                endIndex={brushYoY.end}
                onChange={({ startIndex, endIndex }) => handleBrushYoY(startIndex, endIndex)}
                height={40} stroke="rgba(255,255,255,0.10)" fill="#070b10"
                travellerWidth={7} tickFormatter={fmtAxisDate} gap={4}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <QuickSelectRow period={brushYoY.period} onSelect={handleQSYoY} periods={QUICK_PERIODS_Q} />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function NGDPDashboardContent() {
  // ── Data fetch ────────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          ALL_SERIES_IDS.map(async (id) => {
            const obs = await fetchFredSeries(id, { frequency: 'q' })
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

  const gdp = allData['GDP'] ?? []

  // ── Explorer state ────────────────────────────────────────────────────────

  const [selectedGdpKey, setSelectedGdpKey] = useState('GDP1')

  const selectedItem = useMemo(
    () => NIPA_HIERARCHY.find(n => `GDP${n.line}` === selectedGdpKey),
    [selectedGdpKey]
  )

  const selectedFredId = selectedItem?.id ?? 'GDP'
  const selectedLabel  = selectedItem?.label ?? 'GDP'
  const selectedData   = useMemo(() => allData[selectedFredId] ?? [], [allData, selectedFredId])

  // Explorer user-controlled parameters
  const [regimeMa, setRegimeMa]       = useState(4)
  const [deltaWindow, setDeltaWindow] = useState(1)
  const [deltaMa, setDeltaMa]         = useState(12)
  const [qoqMa1, setQoqMa1]          = useState(3)
  const [qoqMa2, setQoqMa2]          = useState(6)

  // Explorer computed data
  const exYoY          = useMemo(() => computeYoY(selectedData), [selectedData])
  const exQoQ          = useMemo(() => computeQoQ(selectedData), [selectedData])
  const exAnnQoQ       = useMemo(() => computeAnnualizedQoQ(selectedData), [selectedData])
  const exYoYDelta     = useMemo(() => computeYoYDelta(exYoY, deltaWindow), [exYoY, deltaWindow])
  const exYoYDeltaMa   = useMemo(() => computeMA(exYoYDelta, deltaMa), [exYoYDelta, deltaMa])
  const exQoQMa1       = useMemo(() => computeMA(exQoQ, qoqMa1), [exQoQ, qoqMa1])
  const exQoQMa2       = useMemo(() => computeMA(exQoQ, qoqMa2), [exQoQ, qoqMa2])

  const exLevelData = useMemo(
    () => selectedData.map(d => ({ date: d.date, value: d.value / 1000 })),
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

  const exQoQData = useMemo(() =>
    exQoQ.map((d, i) => ({ date: d.date, qoq: d.value, ma1: exQoQMa1[i]?.value ?? null, ma2: exQoQMa2[i]?.value ?? null })),
    [exQoQ, exQoQMa1, exQoQMa2]
  )

  const exAnnQoQData = useMemo(() =>
    exAnnQoQ.map(d => ({ date: d.date, value: d.value })),
    [exAnnQoQ]
  )

  // ── Explorer brush state ────────────────────────────────────────────────

  const [brushes, setBrushes] = useState<Record<ExplorerChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: 'Max' },
    xRegime:   { start: 0, end: 0, period: 'Max' },
    xYoyDelta: { start: 0, end: 0, period: 'Max' },
    xQoq:      { start: 0, end: 0, period: 'Max' },
    xAnnQoq:   { start: 0, end: 0, period: 'Max' },
  })

  // Reset all explorer brushes to Max when selected component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endQ = selectedData.length - 1
    const maxBrush = { start: 0, end: endQ, period: 'Max' }
    setBrushes({
      xLevel:    { ...maxBrush },
      xRegime:   { ...maxBrush },
      xYoyDelta: { ...maxBrush },
      xQoq:      { ...maxBrush },
      xAnnQoq:   { ...maxBrush },
    })
  }, [selectedGdpKey, selectedData.length])

  // Synchronized explorer brush — changing one updates all 5
  const handleExplorerBrush = useCallback(
    (_key: ExplorerChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => {
        const newBrush = {
          period: '',
          start:  startIndex ?? prev[_key].start,
          end:    endIndex   ?? prev[_key].end,
        }
        const update = {} as Record<ExplorerChartKey, BrushState>
        for (const k of EXPLORER_KEYS) update[k] = { ...newBrush }
        return update
      })
    },
    []
  )

  // Synchronized explorer quick-select
  const handleExplorerQuickSelect = useCallback(
    (_key: ExplorerChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      const newBrush = {
        start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
        end,
        period: label,
      }
      const update = {} as Record<ExplorerChartKey, BrushState>
      for (const k of EXPLORER_KEYS) update[k] = { ...newBrush }
      setBrushes(update)
    },
    []
  )

  // ════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <>
        <div className={styles.majorHeader}>Nominal GDP Dashboard</div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading 49 NIPA series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && gdp.length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                Section A: Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Component Explorer</div>

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>GDP Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedGdpKey}
                  onChange={e => setSelectedGdpKey(e.target.value)}
                >
                  {NIPA_HIERARCHY.map(item => (
                    <option key={item.id} value={`GDP${item.line}`}>
                      {'— '.repeat(item.depth)}{item.label}
                    </option>
                  ))}
                </select>
                <span className={styles.fredId}>{selectedGdpKey}</span>
              </div>
            </div>

            {selectedData.length === 0 ? (
              <div className={styles.statusBlock}>No data for {selectedGdpKey}</div>
            ) : (
              <>
                {/* E1: Level */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — Level</div>
                      <div className={styles.sectionSubtitle}>$ Billions SAAR</div>
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
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
                          tickFormatter={(v: number) => fmtBillions(v * 1000)} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtBillions(v * 1000) : '-', ''] as [string, string]} />
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
                    periods={QUICK_PERIODS_Q}
                  />
                </div>

                {/* E2: YoY % Change with Regime Shading */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — YoY % Change</div>
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
                    periods={QUICK_PERIODS_Q}
                  />
                </div>

                {/* E3: YoY Δ */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — YoY &Delta;</div>
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
                            const lbl = name === 'ma' ? `${deltaMa}-pd MA` : `YoY Δ(${deltaWindow})`
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
                    periods={QUICK_PERIODS_Q}
                  />
                </div>

                {/* E4: QoQ %Δ */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — QoQ %&Delta;</div>
                      <div className={styles.sectionSubtitle}>Quarter-over-Quarter</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA1</span>
                        <input type="number" min={1} max={16} value={qoqMa1}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 16) setQoqMa1(n) }}
                          className={styles.lookbackInput} />
                      </div>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA2</span>
                        <input type="number" min={1} max={16} value={qoqMa2}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 16) setQoqMa2(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(147,197,253,0.75)' }} />
                        QoQ %
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#4ade80' }} />
                        {qoqMa1}-pd MA
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#f97316' }} />
                        {qoqMa2}-pd MA
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exQoQData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (typeof v !== 'number') return ['-', '']
                            const lbl = name === 'ma1' ? `${qoqMa1}-pd MA` : name === 'ma2' ? `${qoqMa2}-pd MA` : 'QoQ'
                            return [fmtPctTooltip(v), lbl] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="qoq" name="QoQ" isAnimationActive={false} legendType="none" maxBarSize={16}
                          fill="rgba(147,197,253,0.75)" />
                        <Line type="monotone" dataKey="ma1" name={`${qoqMa1}-pd MA`}
                          stroke="#4ade80" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Line type="monotone" dataKey="ma2" name={`${qoqMa2}-pd MA`}
                          stroke="#f97316" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xQoq.start}
                          endIndex={brushes.xQoq.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xQoq', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xQoq.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xQoq', l, c, exQoQData.length)}
                    periods={QUICK_PERIODS_Q}
                  />
                </div>

                {/* E5: Annualized QoQ %Δ */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — Annualized QoQ %&Delta;</div>
                      <div className={styles.sectionSubtitle}>(Q/Q)^4 − 1</div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#fdba74' }} />
                        Annualized QoQ %
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exAnnQoQData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtPctTooltip(v) : '-', ''] as [string, string]} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Line type="monotone" dataKey="value" name="Ann. QoQ"
                          stroke="#fdba74" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xAnnQoq.start}
                          endIndex={brushes.xAnnQoq.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xAnnQoq', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xAnnQoq.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xAnnQoq', l, c, exAnnQoQData.length)}
                    periods={QUICK_PERIODS_Q}
                  />
                </div>
              </>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                Section B: GDP Components
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>GDP Components</div>
            <ContribPair config={GDP_PAIR} allData={allData} />

            {/* ═══════════════════════════════════════════════════════════════
                Section C: PCE
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>PCE</div>
            {PCE_PAIRS.map(cfg => (
              <ContribPair key={cfg.key} config={cfg} allData={allData} />
            ))}

            {/* ═══════════════════════════════════════════════════════════════
                Section D: Private Investment
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Private Investment</div>
            {INVESTMENT_PAIRS.map(cfg => (
              <ContribPair key={cfg.key} config={cfg} allData={allData} />
            ))}
          </>
        )}
    </>
  )
}

export function NGDPDashboardPage() {
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
        <Link to="/models/growth" className={styles.breadcrumbLink}>Growth</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Nominal GDP Dashboard</span>
      </nav>
      <div className={styles.body}>
        <NGDPDashboardContent />
      </div>
    </div>
  )
}
