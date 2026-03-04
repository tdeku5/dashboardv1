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
import { fetchBEAGdpContrib } from '../lib/bea'
import styles from './RGDPDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

type GdpContribRow = {
  date: string
  [key: string]: number | null | string
}

// ── Real GDP hierarchy (chained 2017 $) ───────────────────────────────────────

interface RgdpItem {
  id:    string
  label: string
  depth: number
}

const RGDP_HIERARCHY: RgdpItem[] = [
  { id: 'GDPC1',             label: 'Total Real GDP',                                       depth: 0 },
  { id: 'PCECC96',           label: 'Personal Consumption Expenditures',                    depth: 1 },
  { id: 'DGDSRX1Q020SBEA',  label: 'Goods',                                                depth: 2 },
  { id: 'PCDGCC96',          label: 'Durable Goods',                                        depth: 3 },
  { id: 'DMOTRX1Q020SBEA',  label: 'Motor vehicles and parts',                             depth: 4 },
  { id: 'DFDHRX1Q020SBEA',  label: 'Furnishings and durable household equipment',          depth: 4 },
  { id: 'DREQRX1Q020SBEA',  label: 'Recreational goods and vehicles',                      depth: 4 },
  { id: 'DODGRX1Q020SBEA',  label: 'Other durable goods',                                  depth: 4 },
  { id: 'PCNDGC96',          label: 'Nondurable Goods',                                     depth: 3 },
  { id: 'DFXARX1Q020SBEA',  label: 'Food and beverages for off-premises consumption',      depth: 4 },
  { id: 'DCLORX1Q020SBEA',  label: 'Clothing and footwear',                                depth: 4 },
  { id: 'DGOERX1Q020SBEA',  label: 'Gasoline and other energy goods',                      depth: 4 },
  { id: 'DONGRX1Q020SBEA',  label: 'Other nondurable goods',                               depth: 4 },
  { id: 'PCESVC96',          label: 'Services',                                             depth: 2 },
  { id: 'DHCERX1Q020SBEA',  label: 'Household consumption expenditures (for services)',    depth: 3 },
  { id: 'DHUTRX1Q020SBEA',  label: 'Housing and utilities',                                depth: 4 },
  { id: 'DHLCRX1Q020SBEA',  label: 'Health care',                                          depth: 4 },
  { id: 'DTRSRX1Q020SBEA',  label: 'Transportation services',                              depth: 4 },
  { id: 'DRCARX1Q020SBEA',  label: 'Recreation services',                                  depth: 4 },
  { id: 'DFSARX1Q020SBEA',  label: 'Food services and accommodations',                     depth: 4 },
  { id: 'DIFSRX1Q020SBEA',  label: 'Financial services and accommodations',                depth: 4 },
  { id: 'DOTSRX1Q020SBEA',  label: 'Other services',                                       depth: 4 },
  { id: 'GPDIC1',            label: 'Gross Private Domestic Investment',                    depth: 1 },
  { id: 'FPIC1',             label: 'Fixed Investment',                                     depth: 2 },
  { id: 'PNFIC1',            label: 'Nonresidential',                                      depth: 3 },
  { id: 'B009RX1Q020SBEA',  label: 'Structures',                                           depth: 4 },
  { id: 'Y033RX1Q020SBEA',  label: 'Equipment',                                            depth: 4 },
  { id: 'Y034RX1Q020SBEA',  label: 'Information processing equipment',                     depth: 5 },
  { id: 'A680RX1Q020SBEA',  label: 'Industrial equipment',                                 depth: 5 },
  { id: 'A681RX1Q020SBEA',  label: 'Transportation equipment',                             depth: 5 },
  { id: 'A862RX1Q020SBEA',  label: 'Other equipment',                                      depth: 5 },
  { id: 'Y001RX1Q020SBEA',  label: 'Intellectual Property Products',                       depth: 4 },
  { id: 'B985RX1Q020SBEA',  label: 'Software',                                             depth: 5 },
  { id: 'Y006RX1Q020SBEA',  label: 'Research and development',                             depth: 5 },
  { id: 'Y020RX1Q020SBEA',  label: 'Entertainment, literary, and artistic originals',      depth: 5 },
  { id: 'PRFIC1',            label: 'Residential',                                          depth: 3 },
  { id: 'CBIC1',             label: 'Change in Private Inventories',                        depth: 2 },
  { id: 'NETEXC',            label: 'Net Exports of Goods and Services',                    depth: 1 },
  { id: 'EXPGSC1',           label: 'Exports',                                              depth: 2 },
  { id: 'A253RX1Q020SBEA',  label: 'Goods',                                                depth: 3 },
  { id: 'A646RX1Q020SBEA',  label: 'Services',                                             depth: 3 },
  { id: 'IMPGSC1',           label: 'Imports',                                              depth: 2 },
  { id: 'A255RX1Q020SBEA',  label: 'Goods',                                                depth: 3 },
  { id: 'B656RX1Q020SBEA',  label: 'Services',                                             depth: 3 },
  { id: 'GCEC1',             label: "Gov't Consumption Expenditures and Gross Investment",  depth: 1 },
  { id: 'FGCEC1',            label: 'Federal',                                              depth: 2 },
  { id: 'A824RX1Q020SBEA',  label: 'National Defense',                                     depth: 3 },
  { id: 'A825RX1Q020SBEA',  label: 'Nondefense',                                           depth: 3 },
  { id: 'SLCEC1',            label: 'State and Local',                                      depth: 2 },
]

const ALL_SERIES_IDS = RGDP_HIERARCHY.map(n => n.id)

// ── BEA Table 1.5.2 line numbers ─────────────────────────────────────────────

const GDP_CONTRIB_LINES: number[] = [
  1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
  39, 40, 41, 42, 43, 44,
]

// ── Contribution chart pair definitions ──────────────────────────────────────

interface ContribSeriesItem {
  id:    string   // key in GdpContribRow = `L${lineNumber}`
  line:  number   // BEA line number
  label: string
  color: string
}

interface ContribPairDef {
  key:       string
  title:     string
  lineLine:  number   // BEA line number for white parent line
  lineLabel: string
  items:     ContribSeriesItem[]
}

const CONTRIB_PAIRS: ContribPairDef[][] = [
  // Pair 1 — GDP Components
  [
    {
      key: 'gdpC1L', title: '%-pt Contributions to rGDP',
      lineLine: 1, lineLabel: 'GDP',
      items: [
        { id: 'L2',  line: 2,  label: 'PCE',                     color: '#60a5fa' },
        { id: 'L25', line: 25, label: 'Fixed Investment',         color: '#f59e0b' },
        { id: 'L38', line: 38, label: 'Change in Priv. Inventories', color: '#4ade80' },
        { id: 'L40', line: 40, label: "Gov't Spending",          color: '#a78bfa' },
        { id: 'L39', line: 39, label: 'Net Exports',             color: '#f87171' },
      ],
    },
    {
      key: 'gdpC1R', title: '%-pt Contributions to rGDP \u2013 PCE',
      lineLine: 2, lineLabel: 'PCE',
      items: [
        { id: 'L16', line: 16, label: 'Services', color: '#60a5fa' },
        { id: 'L5',  line: 5,  label: 'Goods',    color: '#4ade80' },
      ],
    },
  ],
  // Pair 2 — PCE Breakdown
  [
    {
      key: 'gdpC2L', title: '%-pt Contributions to rGDP \u2013 HH Services Consumption',
      lineLine: 16, lineLabel: 'Services',
      items: [
        { id: 'L17', line: 17, label: 'Housing & Utilities',        color: '#60a5fa' },
        { id: 'L18', line: 18, label: 'Health Care',                color: '#4ade80' },
        { id: 'L19', line: 19, label: 'Transportation Services',    color: '#f59e0b' },
        { id: 'L20', line: 20, label: 'Recreation Services',        color: '#f87171' },
        { id: 'L21', line: 21, label: 'Food Services & Accommodations', color: '#a78bfa' },
        { id: 'L22', line: 22, label: 'Financial Services',         color: '#2dd4bf' },
        { id: 'L23', line: 23, label: 'Other Services',             color: '#facc15' },
      ],
    },
    {
      key: 'gdpC2R', title: '%-pt Contributions to rGDP \u2013 Goods PCE',
      lineLine: 5, lineLabel: 'Goods',
      items: [
        { id: 'L6',  line: 6,  label: 'Durables',    color: '#fdba74' },
        { id: 'L11', line: 11, label: 'Nondurables', color: '#a78bfa' },
      ],
    },
  ],
  // Pair 3 — Goods Detail
  [
    {
      key: 'gdpC3L', title: '%-pt Contributions to rGDP \u2013 Durable Goods PCE',
      lineLine: 6, lineLabel: 'Durable Goods',
      items: [
        { id: 'L7',  line: 7,  label: 'Motor Vehicles & Parts',       color: '#60a5fa' },
        { id: 'L8',  line: 8,  label: 'Furnishings & HH Equipment',   color: '#4ade80' },
        { id: 'L9',  line: 9,  label: 'Recreational Goods & Vehicles', color: '#f59e0b' },
        { id: 'L10', line: 10, label: 'Other Durable Goods',          color: '#a78bfa' },
      ],
    },
    {
      key: 'gdpC3R', title: '%-pt Contributions to rGDP \u2013 Nondurable Goods PCE',
      lineLine: 11, lineLabel: 'Nondurable Goods',
      items: [
        { id: 'L12', line: 12, label: 'Food & Beverage (Off-Premise)', color: '#60a5fa' },
        { id: 'L13', line: 13, label: 'Clothing & Footwear',           color: '#4ade80' },
        { id: 'L14', line: 14, label: 'Gas & Other Energy Goods',      color: '#f59e0b' },
        { id: 'L15', line: 15, label: 'Other Nondurable Goods',        color: '#a78bfa' },
      ],
    },
  ],
  // Pair 4 — Investment
  [
    {
      key: 'gdpC4L', title: '%-pt Contributions to rGDP \u2013 Fixed Investment',
      lineLine: 25, lineLabel: 'Fixed Investment',
      items: [
        { id: 'L26', line: 26, label: 'Nonresidential', color: '#f59e0b' },
        { id: 'L37', line: 37, label: 'Residential',    color: '#60a5fa' },
      ],
    },
    {
      key: 'gdpC4R', title: '%-pt Contributions to rGDP \u2013 Nonresidential Investment',
      lineLine: 26, lineLabel: 'Nonresidential',
      items: [
        { id: 'L27', line: 27, label: 'Structures',  color: '#60a5fa' },
        { id: 'L28', line: 28, label: 'Equipment',   color: '#4ade80' },
        { id: 'L33', line: 33, label: 'IP Products', color: '#f87171' },
      ],
    },
  ],
  // Pair 5 — Investment Detail + IP
  [
    {
      key: 'gdpC5L', title: '%-pt Contributions to rGDP \u2013 Equipment Investment',
      lineLine: 28, lineLabel: 'Equipment',
      items: [
        { id: 'L29', line: 29, label: 'Information Processing', color: '#60a5fa' },
        { id: 'L30', line: 30, label: 'Industrial',             color: '#4ade80' },
        { id: 'L31', line: 31, label: 'Transportation',         color: '#f59e0b' },
        { id: 'L32', line: 32, label: 'Other',                  color: '#a78bfa' },
      ],
    },
    {
      key: 'gdpC5R', title: '%-pt Contributions to rGDP \u2013 IP Investment',
      lineLine: 33, lineLabel: 'IP Products',
      items: [
        { id: 'L34', line: 34, label: 'Software',                                    color: '#60a5fa' },
        { id: 'L35', line: 35, label: 'R&D',                                         color: '#4ade80' },
        { id: 'L36', line: 36, label: 'Entertainment, Literary, & Artistic Originals', color: '#f59e0b' },
      ],
    },
  ],
  // Pair 6 — Government
  [
    {
      key: 'gdpC6L', title: "%-pt Contributions to rGDP \u2013 Gov't Spending",
      lineLine: 40, lineLabel: "Gov't Spending",
      items: [
        { id: 'L41', line: 41, label: 'Federal',       color: '#4ade80' },
        { id: 'L44', line: 44, label: 'State & Local', color: '#a78bfa' },
      ],
    },
    {
      key: 'gdpC6R', title: "%-pt Contributions to rGDP \u2013 Federal Gov't Spending",
      lineLine: 41, lineLabel: "Federal Gov't Spending",
      items: [
        { id: 'L42', line: 42, label: 'Defense',    color: '#60a5fa' },
        { id: 'L43', line: 43, label: 'Nondefense', color: '#f87171' },
      ],
    },
  ],
]

const ALL_CONTRIB_KEYS = CONTRIB_PAIRS.flat().map(p => p.key) as ContribChartKey[]

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

const QUICK_PERIODS_Q = [
  { label: '5Y',  count: 20  },
  { label: '10Y', count: 40  },
  { label: '20Y', count: 80  },
  { label: 'Max', count: Infinity },
] as const

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

// ── Chart key types ──────────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xQoq' | 'xAnnQoq'
type ContribChartKey  = 'gdpC1L' | 'gdpC1R' | 'gdpC2L' | 'gdpC2R' | 'gdpC3L' | 'gdpC3R'
                      | 'gdpC4L' | 'gdpC4R' | 'gdpC5L' | 'gdpC5R' | 'gdpC6L' | 'gdpC6R'
type ChartKey = ExplorerChartKey | ContribChartKey

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

/** "2024-01-01" -> "Q1 2024" */
function fmtQuarterDate(d: string): string {
  const [y, m] = d.split('-')
  const q = Math.ceil(parseInt(m) / 3)
  return `Q${q} ${y}`
}

/** "2024-01-01" -> "Q1 '24" */
function fmtAxisQuarter(d: string): string {
  const [y, m] = d.split('-')
  const q = Math.ceil(parseInt(m) / 3)
  return `Q${q} '${y.slice(2)}`
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

// ── GdpContribTooltip ─────────────────────────────────────────────────────────

function GdpContribTooltip({
  row,
  activeItems,
  showLine,
  lineLabel,
  lineKey,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:         GdpContribRow
  activeItems: readonly ContribSeriesItem[]
  showLine:    boolean
  lineLabel:   string
  lineKey:     string
  mouseX:      number
  mouseY:      number
  isRightHalf: boolean
}) {
  const items = [...activeItems]
    .map(s => ({ ...s, value: row[s.id] as number | null }))
    .filter(s => s.value != null)
    .sort((a, b) => Math.abs(b.value!) - Math.abs(a.value!))

  const horizPos = isRightHalf
    ? { right: window.innerWidth - mouseX + 14 }
    : { left:  mouseX + 14 }

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
        {fmtQuarterDate(row.date as string)}
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
            {lineVal >= 0 ? '+' : ''}{lineVal.toFixed(2)} pp
          </span>
        </div>
      )}
    </div>
  )
}

// ── GdpContribChart (custom SVG diverging stacked bar) ────────────────────────

function GdpContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  seriesItems,
  lineKey,
  lineLabel,
  lineWidth = 1.5,
  clipPrefix = 'gdpcontrib',
}: {
  data:         GdpContribRow[]
  visibleStart: number
  visibleEnd:   number
  activeSeries: Set<string>
  seriesItems:  readonly ContribSeriesItem[]
  lineKey:      string
  lineLabel:    string
  lineWidth?:   number
  clipPrefix?:  string
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
    [seriesItems, activeSeries]
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
        const lv = row[lineKey] as number
        posStack = Math.max(posStack, lv)
        negStack = Math.min(negStack, lv)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showLine, lineKey])

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
      ? cols.filter(c => c.row[lineKey] != null).map(c => ({ cx: c.cx, cy: toY(c.row[lineKey] as number) }))
      : []

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, showLine, lineKey, colW, yMin, yRange, innerH])

  const yTicks = useMemo(() => contribNiceTicks(yMin, yMax, 6), [yMin, yMax])

  const xTicks = useMemo(() => {
    const ticks: { label: string; cx: number }[] = []
    let lastX = -Infinity
    visible.forEach((row, i) => {
      const cx = CONTRIB_CM.left + (i + 0.5) * colW
      if (cx - lastX >= 60) {
        ticks.push({ label: fmtAxisQuarter(row.date as string), cx })
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
                key={`${(col.row.date as string)}-${r.id}`}
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
        <GdpContribTooltip
          row={hovCol.row}
          activeItems={activeItems}
          showLine={showLine}
          lineLabel={lineLabel}
          lineKey={lineKey}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRightHalf}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function RGDPDashboardPage() {
  // ── FRED data fetch ────────────────────────────────────────────────────────
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

  const gdp = allData['GDPC1'] ?? []

  // ── BEA contribution data fetch ─────────────────────────────────────────
  const [gdpContribData, setGdpContribData]       = useState<Map<number, WD[]>>(new Map())
  const [gdpContribLoading, setGdpContribLoading] = useState(true)
  const [gdpContribError, setGdpContribError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          GDP_CONTRIB_LINES.map(async (line) => {
            const obs = await fetchBEAGdpContrib(line)
            return [line, parseObs(obs)] as [number, WD[]]
          })
        )
        if (cancelled) return
        setGdpContribData(new Map(entries))
      } catch (e) {
        if (cancelled) return
        setGdpContribError(e instanceof Error ? e.message : 'Failed to fetch BEA data')
      } finally {
        if (!cancelled) setGdpContribLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Explorer state ────────────────────────────────────────────────────────

  const [selectedId, setSelectedId] = useState('GDPC1')

  const selectedItem = useMemo(
    () => RGDP_HIERARCHY.find(n => n.id === selectedId),
    [selectedId]
  )

  const selectedLabel = selectedItem?.label ?? 'Total Real GDP'
  const selectedData  = useMemo(() => allData[selectedId] ?? [], [allData, selectedId])

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

  // ── Contribution chart data memos (12 charts) ──────────────────────────

  const buildContribRows = useCallback((pairDef: ContribPairDef): GdpContribRow[] => {
    const parentSeries = gdpContribData.get(pairDef.lineLine)
    if (!parentSeries?.length) return []
    return parentSeries.map(pt => {
      const row: GdpContribRow = { date: pt.date }
      // line key
      const lk = `L${pairDef.lineLine}`
      row[lk] = pt.value
      // bar items
      for (const item of pairDef.items) {
        const series = gdpContribData.get(item.line)
        const match = series?.find(s => s.date === pt.date)
        row[item.id] = match?.value ?? null
      }
      return row
    })
  }, [gdpContribData])

  // Build one data array per chart
  const contribDataMap = useMemo(() => {
    const map = new Map<string, GdpContribRow[]>()
    for (const pair of CONTRIB_PAIRS.flat()) {
      map.set(pair.key, buildContribRows(pair))
    }
    return map
  }, [buildContribRows])

  // ── Contribution visibility states (12 charts) ─────────────────────────

  const mkInitialVis = (def: ContribPairDef): Set<string> => {
    const keys = def.items.map(s => s.id)
    keys.push(`L${def.lineLine}`)
    return new Set(keys)
  }

  const [visC1L, setVisC1L] = useState(() => mkInitialVis(CONTRIB_PAIRS[0][0]))
  const [visC1R, setVisC1R] = useState(() => mkInitialVis(CONTRIB_PAIRS[0][1]))
  const [visC2L, setVisC2L] = useState(() => mkInitialVis(CONTRIB_PAIRS[1][0]))
  const [visC2R, setVisC2R] = useState(() => mkInitialVis(CONTRIB_PAIRS[1][1]))
  const [visC3L, setVisC3L] = useState(() => mkInitialVis(CONTRIB_PAIRS[2][0]))
  const [visC3R, setVisC3R] = useState(() => mkInitialVis(CONTRIB_PAIRS[2][1]))
  const [visC4L, setVisC4L] = useState(() => mkInitialVis(CONTRIB_PAIRS[3][0]))
  const [visC4R, setVisC4R] = useState(() => mkInitialVis(CONTRIB_PAIRS[3][1]))
  const [visC5L, setVisC5L] = useState(() => mkInitialVis(CONTRIB_PAIRS[4][0]))
  const [visC5R, setVisC5R] = useState(() => mkInitialVis(CONTRIB_PAIRS[4][1]))
  const [visC6L, setVisC6L] = useState(() => mkInitialVis(CONTRIB_PAIRS[5][0]))
  const [visC6R, setVisC6R] = useState(() => mkInitialVis(CONTRIB_PAIRS[5][1]))

  const visMap: Record<ContribChartKey, Set<string>> = {
    gdpC1L: visC1L, gdpC1R: visC1R,
    gdpC2L: visC2L, gdpC2R: visC2R,
    gdpC3L: visC3L, gdpC3R: visC3R,
    gdpC4L: visC4L, gdpC4R: visC4R,
    gdpC5L: visC5L, gdpC5R: visC5R,
    gdpC6L: visC6L, gdpC6R: visC6R,
  }

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (key: string) => setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const toggleMap: Record<ContribChartKey, (key: string) => void> = {
    gdpC1L: mkToggle(setVisC1L), gdpC1R: mkToggle(setVisC1R),
    gdpC2L: mkToggle(setVisC2L), gdpC2R: mkToggle(setVisC2R),
    gdpC3L: mkToggle(setVisC3L), gdpC3R: mkToggle(setVisC3R),
    gdpC4L: mkToggle(setVisC4L), gdpC4R: mkToggle(setVisC4R),
    gdpC5L: mkToggle(setVisC5L), gdpC5R: mkToggle(setVisC5R),
    gdpC6L: mkToggle(setVisC6L), gdpC6R: mkToggle(setVisC6R),
  }

  // ── Brush states ────────────────────────────────────────────────────────

  const initBrush: BrushState = { start: 0, end: 0, period: '' }

  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    // Explorer
    xLevel:    { start: 0, end: 0, period: 'Max' },
    xRegime:   { start: 0, end: 0, period: 'Max' },
    xYoyDelta: { start: 0, end: 0, period: 'Max' },
    xQoq:      { start: 0, end: 0, period: 'Max' },
    xAnnQoq:   { start: 0, end: 0, period: 'Max' },
    // Contribution charts
    gdpC1L: { ...initBrush }, gdpC1R: { ...initBrush },
    gdpC2L: { ...initBrush }, gdpC2R: { ...initBrush },
    gdpC3L: { ...initBrush }, gdpC3R: { ...initBrush },
    gdpC4L: { ...initBrush }, gdpC4R: { ...initBrush },
    gdpC5L: { ...initBrush }, gdpC5R: { ...initBrush },
    gdpC6L: { ...initBrush }, gdpC6R: { ...initBrush },
  })

  // Initialize contribution brushes when data arrives
  useEffect(() => {
    const refLen = gdpContribData.get(1)?.length ?? 0
    if (refLen === 0) return
    const end = refLen - 1
    const start = Math.max(0, end - 59) // ~15 years
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of ALL_CONTRIB_KEYS) {
        next[k] = { start, end, period: '' }
      }
      return next
    })
  }, [gdpContribData])

  // Reset all explorer brushes when selected component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endQ = selectedData.length - 1
    const maxBrush = { start: 0, end: endQ, period: 'Max' }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...maxBrush }
      return next
    })
  }, [selectedId, selectedData.length])

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

  const handleGdpContribQuickSelect = useCallback(
    (key: ContribChartKey, label: string, count: number) => {
      const end = (gdpContribData.get(1)?.length ?? 1) - 1
      setBrushes(prev => ({
        ...prev,
        [key]: {
          start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
          end,
          period: label,
        },
      }))
    },
    [gdpContribData]
  )

  // ════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className={styles.shell}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
        <span className={styles.breadcrumbCurrent}>Real GDP Dashboard</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>
        <div className={styles.majorHeader}>Real GDP Dashboard</div>
        <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
          BEA National Income &amp; Product Accounts &mdash; quarterly, chained 2017 dollars
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading 49 real GDP series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && gdp.length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Component Explorer</div>

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>GDP Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                >
                  {RGDP_HIERARCHY.map(item => (
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
                      <div className={styles.sectionSubtitle}>Billions chained 2017 $</div>
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
                    periods={QUICK_PERIODS_Q}
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
                    periods={QUICK_PERIODS_Q}
                  />
                </div>

                {/* E4: QoQ %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; QoQ %&Delta;</div>
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

                {/* E5: Annualized QoQ %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; Annualized QoQ %&Delta;</div>
                      <div className={styles.sectionSubtitle}>(Q/Q)^4 &minus; 1</div>
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
                rGDP Contribution Decomposition
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div>
                <div className={styles.sectionTitle}>rGDP Contribution Decomposition</div>
                <div className={styles.sectionSubtitle}>BEA NIPA Table 1.5.2 &middot; SAAR &middot; Annualized QoQ %-pt</div>
              </div>
            </div>

            {gdpContribLoading && (
              <div className={styles.statusBlock}>Loading contribution data...</div>
            )}
            {gdpContribError && (
              <div className={`${styles.statusBlock} ${styles.statusError}`}>{gdpContribError}</div>
            )}

            {!gdpContribLoading && !gdpContribError && gdpContribData.size > 0 && (
              <>
                {CONTRIB_PAIRS.map((pair, pairIdx) => (
                  <div key={pairIdx} className={styles.twoColGrid}>
                    {pair.map(def => {
                      const chartKey = def.key as ContribChartKey
                      const data = contribDataMap.get(def.key) ?? []
                      const vis = visMap[chartKey]
                      const toggle = toggleMap[chartKey]
                      const brush = brushes[chartKey]
                      const lineKey = `L${def.lineLine}`

                      return (
                        <div key={def.key} className={styles.section}>
                          <div className={styles.sectionHeader}>
                            <div>
                              <div className={styles.sectionTitle}>{def.title}</div>
                              <div className={styles.sectionSubtitle}>SAAR &middot; %-pt contribution to rGDP</div>
                            </div>
                          </div>
                          <div className={styles.legendRow}>
                            <div className={styles.legend}>
                              {def.items.map(item => (
                                <button key={item.id} type="button"
                                  className={`${styles.legendItem} ${!vis.has(item.id) ? styles.legendItemOff : ''}`}
                                  onClick={() => toggle(item.id)}
                                >
                                  <span className={styles.legendSwatch} style={{ background: item.color }} />
                                  {item.label}
                                </button>
                              ))}
                              <button type="button"
                                className={`${styles.legendItem} ${!vis.has(lineKey) ? styles.legendItemOff : ''}`}
                                onClick={() => toggle(lineKey)}
                              >
                                <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                                {def.lineLabel}
                              </button>
                            </div>
                          </div>
                          <div className={styles.chartWrap}>
                            <GdpContribChart
                              data={data}
                              visibleStart={brush.start}
                              visibleEnd={brush.end}
                              activeSeries={vis}
                              seriesItems={def.items}
                              lineKey={lineKey}
                              lineLabel={def.lineLabel}
                              clipPrefix={def.key}
                            />
                          </div>
                          <div className={styles.brushWrap}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={data} margin={{ top: 0, right: 16, bottom: 0, left: 62 }}>
                                <Brush
                                  dataKey="date"
                                  startIndex={brush.start}
                                  endIndex={brush.end}
                                  onChange={({ startIndex, endIndex }) =>
                                    handleContribBrush(chartKey, startIndex, endIndex)}
                                  {...BRUSH_STYLE}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                          <QuickSelectRow
                            period={brush.period}
                            onSelect={(l, c) => handleGdpContribQuickSelect(chartKey, l, c)}
                            periods={QUICK_PERIODS_Q}
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
