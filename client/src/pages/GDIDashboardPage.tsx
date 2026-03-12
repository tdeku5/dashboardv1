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
import styles from './GDIDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

type ContribRow = Record<string, string | number | null> & { date: string; line: number | null }

// ── GDI Hierarchy ─────────────────────────────────────────────────────────────

interface GdiItem {
  id:      string
  label:   string
  depth:   number
  divider?: string
}

const GDI_HIERARCHY: GdiItem[] = [
  { id: 'GDI',              label: 'Gross Domestic Income',                                        depth: 0 },
  { id: 'GDICOMP',          label: 'Compensation of Employees',                                    depth: 1 },
  { id: 'A4102C1Q027SBEA',  label: 'Wages & Salaries',                                             depth: 2 },
  { id: 'W270RC1Q027SBEA',  label: 'To Persons',                                                   depth: 3 },
  { id: 'B4189C1Q027SBEA',  label: 'To the RoW',                                                   depth: 3 },
  { id: 'A038RC1Q027SBEA',  label: 'Supplements to Wages & Salaries',                              depth: 2 },
  { id: 'GDITAXES',         label: 'Taxes on Production & Imports',                                depth: 1 },
  { id: 'GDISUBS',          label: '- Subsidies',                                                  depth: 1 },
  { id: 'GDINOS',           label: 'Net Operating Surplus',                                        depth: 1 },
  { id: 'W260RC1Q027SBEA',  label: 'Private Enterprises',                                          depth: 2 },
  { id: 'W272RC1Q027SBEA',  label: 'Net interest and misc. payments, domestic industries',         depth: 3 },
  { id: 'B029RC1Q027SBEA',  label: 'Business current transfer payments (net)',                     depth: 3 },
  { id: 'PROPINC',          label: "Proprietor's Income w IVCCadj",                                depth: 3 },
  { id: 'RENTIN',           label: 'Rental Income w CCadj',                                        depth: 3 },
  { id: 'A445RC1Q027SBEA',  label: 'Corporate Profits w IVCCadj',                                  depth: 3 },
  { id: 'A054RC1Q027SBEA',  label: 'Taxes on Corporate Income',                                    depth: 4 },
  { id: 'W273RC1Q027SBEA',  label: 'Profits After Tax w IVCCadj',                                  depth: 4 },
  { id: 'A449RC1Q027SBEA',  label: 'Net Dividends',                                                depth: 5 },
  { id: 'W274RC1Q027SBEA',  label: 'Undistributed Corporate Profits w IVCCadj',                    depth: 5 },
  { id: 'A108RC1Q027SBEA',  label: 'Current Surplus of Government Enterprises',                    depth: 2 },
  { id: 'COFC',             label: 'Consumption of Fixed Capital',                                 depth: 1 },
  { id: 'A024RC1Q027SBEA',  label: 'Private',                                                      depth: 2 },
  { id: 'A264RC1Q027SBEA',  label: 'Government',                                                   depth: 2 },
  { id: 'A261RX1Q020SBEA',  label: 'Real GDI*',                                                    depth: 0, divider: '── Real ──' },
]

const ALL_SERIES_IDS = GDI_HIERARCHY.map(n => n.id)

const REAL_GDI_ID = 'A261RX1Q020SBEA'

// ── Contribution item configs ────────────────────────────────────────────────

const GDI_TOP_ITEMS = [
  { id: 'comp',    label: 'Compensation of Employees',    color: '#93c5fd' },
  { id: 'taxes',   label: 'Taxes on Production & Imports', color: '#fdba74' },
  { id: 'subs',    label: '-Subsidies',                   color: '#c4b5fd' },
  { id: 'nos',     label: 'Net Operating Surplus',        color: '#86efac' },
  { id: 'cofc',    label: 'Consumption of Fixed Capital', color: '#fca5a5' },
] as const

const GDI_NOS_ITEMS = [
  { id: 'netInterest', label: 'Net Interest & Misc. Payments',        color: '#fca5a5' },
  { id: 'bizTransfer', label: 'Business Current Transfer Payments',   color: '#86efac' },
  { id: 'propInc',     label: "Proprietor's Income",                  color: '#fdba74' },
  { id: 'rentInc',     label: 'Rental Income',                        color: '#c4b5fd' },
  { id: 'corpProf',    label: 'Corporate Profits',                    color: '#93c5fd' },
] as const

const GDI_CORP_PROFIT_ITEMS = [
  { id: 'corpTax',       label: 'Taxes',          color: '#93c5fd' },
  { id: 'profitsAfTax',  label: 'Profits After Tax', color: '#fca5a5' },
] as const

const GDI_PROFITS_AFT_TAX_ITEMS = [
  { id: 'netDiv',    label: 'Net Dividends',                    color: '#86efac' },
  { id: 'undistrib', label: 'Undistributed Corporate Profits',  color: '#c4b5fd' },
] as const

const GDI_COFC_ITEMS = [
  { id: 'cofcPriv', label: 'Private',    color: '#93c5fd' },
  { id: 'cofcGov',  label: 'Government', color: '#fdba74' },
] as const

// ── Chart constants ──────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }
const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

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

// ── Contribution chart keys ──────────────────────────────────────────────────

type ContribChartKey =
  | 'gdiTopQoq' | 'gdiTopYoy'
  | 'gdiNosQoq' | 'gdiNosYoy'
  | 'gdiCorpQoq' | 'gdiCorpYoy'
  | 'gdiPATQoq' | 'gdiPATYoy'
  | 'gdiCofcQoq' | 'gdiCofcYoy'

type ChartKey = ExplorerChartKey | ContribChartKey

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

function fmtIndex(v: number): string {
  return v.toFixed(1)
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

// ── Contribution helpers ─────────────────────────────────────────────────────

function makeMap(data: WD[] | undefined): Map<string, number> {
  return new Map((data ?? []).map(d => [d.date, d.value]))
}

function buildGDIContribData(
  parentData: WD[],
  compMaps: Record<string, Map<string, number>>,
  lag: number,
): ContribRow[] {
  const parentMap = new Map(parentData.map(d => [d.date, d.value]))
  const compKeys = Object.keys(compMaps)
  return parentData.map((pt, i) => {
    if (i < lag) {
      const row: ContribRow = { date: pt.date, line: null }
      for (const k of compKeys) row[k] = null
      return row
    }
    const priorDate = parentData[i - lag].date
    const pNow   = parentMap.get(pt.date)
    const pPrior = parentMap.get(priorDate)
    const contrib = (cMap: Map<string, number>): number | null => {
      const cNow   = cMap.get(pt.date)
      const cPrior = cMap.get(priorDate)
      if (cNow == null || cPrior == null || cPrior === 0 || pPrior == null || pPrior === 0) return null
      return (cPrior / pPrior) * ((cNow / cPrior) - 1) * 100
    }
    const row: ContribRow = {
      date: pt.date,
      line: (pNow != null && pPrior != null && pPrior !== 0) ? (pNow / pPrior - 1) * 100 : null,
    }
    for (const [k, m] of Object.entries(compMaps)) row[k] = contrib(m)
    return row
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

// ── GDIContribTooltip ────────────────────────────────────────────────────────

function GDIContribTooltip({
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

// ── GDIContribChart (custom SVG diverging stacked bar) ───────────────────────

function GDIContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'gdicontrib',
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
      ? cols.filter(c => (c.row[lineKey] as number | null) != null).map(c => ({ cx: c.cx, cy: toY(c.row[lineKey] as number) }))
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
        <GDIContribTooltip
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

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function GDIDashboardPage() {
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

  const gdi = allData['GDI'] ?? []

  // ── Explorer state ────────────────────────────────────────────────────────

  const [selectedKey, setSelectedKey] = useState('GDI')

  const selectedItem = useMemo(
    () => GDI_HIERARCHY.find(n => n.id === selectedKey),
    [selectedKey]
  )

  const selectedFredId = selectedItem?.id ?? 'GDI'
  const selectedLabel  = selectedItem?.label ?? 'GDI'
  const selectedData   = useMemo(() => allData[selectedFredId] ?? [], [allData, selectedFredId])

  const isRealGDI = selectedFredId === REAL_GDI_ID

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
    () => isRealGDI
      ? selectedData.map(d => ({ date: d.date, value: d.value }))
      : selectedData.map(d => ({ date: d.date, value: d.value / 1000 })),
    [selectedData, isRealGDI]
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

  // ── Contribution data memos ─────────────────────────────────────────────

  const gdiTopQoqData  = useMemo(() =>
    buildGDIContribData(allData['GDI'] ?? [], { comp: makeMap(allData['GDICOMP']), taxes: makeMap(allData['GDITAXES']), subs: makeMap(allData['GDISUBS']), nos: makeMap(allData['GDINOS']), cofc: makeMap(allData['COFC']) }, 1)
      .map(row => ({ ...row, subs: row.subs != null ? -(row.subs as number) : null })),
  [allData])
  const gdiTopYoyData  = useMemo(() =>
    buildGDIContribData(allData['GDI'] ?? [], { comp: makeMap(allData['GDICOMP']), taxes: makeMap(allData['GDITAXES']), subs: makeMap(allData['GDISUBS']), nos: makeMap(allData['GDINOS']), cofc: makeMap(allData['COFC']) }, 4)
      .map(row => ({ ...row, subs: row.subs != null ? -(row.subs as number) : null })),
  [allData])

  const gdiNosQoqData  = useMemo(() => buildGDIContribData(allData['W260RC1Q027SBEA'] ?? [], { netInterest: makeMap(allData['W272RC1Q027SBEA']), bizTransfer: makeMap(allData['B029RC1Q027SBEA']), propInc: makeMap(allData['PROPINC']), rentInc: makeMap(allData['RENTIN']), corpProf: makeMap(allData['A445RC1Q027SBEA']) }, 1), [allData])
  const gdiNosYoyData  = useMemo(() => buildGDIContribData(allData['W260RC1Q027SBEA'] ?? [], { netInterest: makeMap(allData['W272RC1Q027SBEA']), bizTransfer: makeMap(allData['B029RC1Q027SBEA']), propInc: makeMap(allData['PROPINC']), rentInc: makeMap(allData['RENTIN']), corpProf: makeMap(allData['A445RC1Q027SBEA']) }, 4), [allData])

  const gdiCorpQoqData = useMemo(() => buildGDIContribData(allData['A445RC1Q027SBEA'] ?? [], { corpTax: makeMap(allData['A054RC1Q027SBEA']), profitsAfTax: makeMap(allData['W273RC1Q027SBEA']) }, 1), [allData])
  const gdiCorpYoyData = useMemo(() => buildGDIContribData(allData['A445RC1Q027SBEA'] ?? [], { corpTax: makeMap(allData['A054RC1Q027SBEA']), profitsAfTax: makeMap(allData['W273RC1Q027SBEA']) }, 4), [allData])

  const gdiPATQoqData  = useMemo(() => buildGDIContribData(allData['W273RC1Q027SBEA'] ?? [], { netDiv: makeMap(allData['A449RC1Q027SBEA']), undistrib: makeMap(allData['W274RC1Q027SBEA']) }, 1), [allData])
  const gdiPATYoyData  = useMemo(() => buildGDIContribData(allData['W273RC1Q027SBEA'] ?? [], { netDiv: makeMap(allData['A449RC1Q027SBEA']), undistrib: makeMap(allData['W274RC1Q027SBEA']) }, 4), [allData])

  const gdiCofcQoqData = useMemo(() => buildGDIContribData(allData['COFC'] ?? [], { cofcPriv: makeMap(allData['A024RC1Q027SBEA']), cofcGov: makeMap(allData['A264RC1Q027SBEA']) }, 1), [allData])
  const gdiCofcYoyData = useMemo(() => buildGDIContribData(allData['COFC'] ?? [], { cofcPriv: makeMap(allData['A024RC1Q027SBEA']), cofcGov: makeMap(allData['A264RC1Q027SBEA']) }, 4), [allData])

  // ── Contribution visibility state ───────────────────────────────────────

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (key: string) => setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const [visGdiTopQoq,  setVisGdiTopQoq]  = useState(() => new Set([...GDI_TOP_ITEMS.map(s => s.id), 'line']))
  const [visGdiTopYoy,  setVisGdiTopYoy]  = useState(() => new Set([...GDI_TOP_ITEMS.map(s => s.id), 'line']))
  const [visGdiNosQoq,  setVisGdiNosQoq]  = useState(() => new Set([...GDI_NOS_ITEMS.map(s => s.id), 'line']))
  const [visGdiNosYoy,  setVisGdiNosYoy]  = useState(() => new Set([...GDI_NOS_ITEMS.map(s => s.id), 'line']))
  const [visGdiCorpQoq, setVisGdiCorpQoq] = useState(() => new Set([...GDI_CORP_PROFIT_ITEMS.map(s => s.id), 'line']))
  const [visGdiCorpYoy, setVisGdiCorpYoy] = useState(() => new Set([...GDI_CORP_PROFIT_ITEMS.map(s => s.id), 'line']))
  const [visGdiPATQoq,  setVisGdiPATQoq]  = useState(() => new Set([...GDI_PROFITS_AFT_TAX_ITEMS.map(s => s.id), 'line']))
  const [visGdiPATYoy,  setVisGdiPATYoy]  = useState(() => new Set([...GDI_PROFITS_AFT_TAX_ITEMS.map(s => s.id), 'line']))
  const [visGdiCofcQoq, setVisGdiCofcQoq] = useState(() => new Set([...GDI_COFC_ITEMS.map(s => s.id), 'line']))
  const [visGdiCofcYoy, setVisGdiCofcYoy] = useState(() => new Set([...GDI_COFC_ITEMS.map(s => s.id), 'line']))

  const toggleGdiTopQoq  = useMemo(() => mkToggle(setVisGdiTopQoq), [])
  const toggleGdiTopYoy  = useMemo(() => mkToggle(setVisGdiTopYoy), [])
  const toggleGdiNosQoq  = useMemo(() => mkToggle(setVisGdiNosQoq), [])
  const toggleGdiNosYoy  = useMemo(() => mkToggle(setVisGdiNosYoy), [])
  const toggleGdiCorpQoq = useMemo(() => mkToggle(setVisGdiCorpQoq), [])
  const toggleGdiCorpYoy = useMemo(() => mkToggle(setVisGdiCorpYoy), [])
  const toggleGdiPATQoq  = useMemo(() => mkToggle(setVisGdiPATQoq), [])
  const toggleGdiPATYoy  = useMemo(() => mkToggle(setVisGdiPATYoy), [])
  const toggleGdiCofcQoq = useMemo(() => mkToggle(setVisGdiCofcQoq), [])
  const toggleGdiCofcYoy = useMemo(() => mkToggle(setVisGdiCofcYoy), [])

  // ── Brush state ─────────────────────────────────────────────────────────

  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: '10Y' },
    xRegime:   { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xQoq:      { start: 0, end: 0, period: '10Y' },
    xAnnQoq:   { start: 0, end: 0, period: '10Y' },
    gdiTopQoq:  { start: 0, end: 0, period: '' },
    gdiTopYoy:  { start: 0, end: 0, period: '' },
    gdiNosQoq:  { start: 0, end: 0, period: '' },
    gdiNosYoy:  { start: 0, end: 0, period: '' },
    gdiCorpQoq: { start: 0, end: 0, period: '' },
    gdiCorpYoy: { start: 0, end: 0, period: '' },
    gdiPATQoq:  { start: 0, end: 0, period: '' },
    gdiPATYoy:  { start: 0, end: 0, period: '' },
    gdiCofcQoq: { start: 0, end: 0, period: '' },
    gdiCofcYoy: { start: 0, end: 0, period: '' },
  })

  // Reset explorer brushes to 10Y when selected component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endQ = selectedData.length - 1
    const startQ = Math.max(0, endQ - 40 + 1)
    const brush10Y = { start: startQ, end: endQ, period: '10Y' }
    setBrushes(prev => ({
      ...prev,
      xLevel:    { ...brush10Y },
      xRegime:   { ...brush10Y },
      xYoyDelta: { ...brush10Y },
      xQoq:      { ...brush10Y },
      xAnnQoq:   { ...brush10Y },
    }))
  }, [selectedKey, selectedData.length])

  // Initialize contribution brushes to last 40 quarters (10Y)
  useEffect(() => {
    const initBrush = (len: number) => {
      if (len === 0) return { start: 0, end: 0, period: '' }
      const end = len - 1
      return { start: Math.max(0, end - 39), end, period: '' }
    }
    if (!gdiTopQoqData.length) return
    setBrushes(prev => ({
      ...prev,
      gdiTopQoq:  initBrush(gdiTopQoqData.length),
      gdiTopYoy:  initBrush(gdiTopYoyData.length),
      gdiNosQoq:  initBrush(gdiNosQoqData.length),
      gdiNosYoy:  initBrush(gdiNosYoyData.length),
      gdiCorpQoq: initBrush(gdiCorpQoqData.length),
      gdiCorpYoy: initBrush(gdiCorpYoyData.length),
      gdiPATQoq:  initBrush(gdiPATQoqData.length),
      gdiPATYoy:  initBrush(gdiPATYoyData.length),
      gdiCofcQoq: initBrush(gdiCofcQoqData.length),
      gdiCofcYoy: initBrush(gdiCofcYoyData.length),
    }))
  }, [gdiTopQoqData.length, gdiTopYoyData.length, gdiNosQoqData.length, gdiNosYoyData.length,
      gdiCorpQoqData.length, gdiCorpYoyData.length, gdiPATQoqData.length, gdiPATYoyData.length,
      gdiCofcQoqData.length, gdiCofcYoyData.length])

  // Synchronized explorer brush — changing one updates all 5
  const handleExplorerBrush = useCallback(
    (_key: ExplorerChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => {
        const newBrush = {
          period: '',
          start:  startIndex ?? prev[_key].start,
          end:    endIndex   ?? prev[_key].end,
        }
        return {
          ...prev,
          xLevel:    { ...newBrush },
          xRegime:   { ...newBrush },
          xYoyDelta: { ...newBrush },
          xQoq:      { ...newBrush },
          xAnnQoq:   { ...newBrush },
        }
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
      setBrushes(prev => ({
        ...prev,
        xLevel:    { ...newBrush },
        xRegime:   { ...newBrush },
        xYoyDelta: { ...newBrush },
        xQoq:      { ...newBrush },
        xAnnQoq:   { ...newBrush },
      }))
    },
    []
  )

  // Contribution brush handler (per chart)
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

  // Contribution quick-select (per chart)
  const handleContribQuickSelect = useCallback(
    (key: ContribChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
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

  // Level chart formatters — conditional on Real GDI*
  const levelTickFmt = isRealGDI
    ? (v: number) => fmtIndex(v)
    : (v: number) => fmtBillions(v * 1000)

  const levelTooltipFmt = isRealGDI
    ? (v: unknown) => [typeof v === 'number' ? fmtIndex(v) : '-', ''] as [string, string]
    : (v: unknown) => [typeof v === 'number' ? fmtBillions(v * 1000) : '-', ''] as [string, string]

  const levelSubtitle = isRealGDI ? 'Quantity Index, 2017=100' : '$ Billions SAAR'

  // ── Contrib cell renderer helper ────────────────────────────────────────

  function renderContribCell(
    title: string,
    data: ContribRow[],
    items: readonly { id: string; label: string; color: string }[],
    lineLabel: string,
    vis: Set<string>,
    toggle: (key: string) => void,
    brushKey: ContribChartKey,
    clipPrefix: string,
  ) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>{title}</div>
        </div>
        <div className={styles.legendRow}>
          <div className={styles.legend}>
            {items.map(item => (
              <button key={item.id} type="button"
                className={`${styles.legendItem} ${!vis.has(item.id) ? styles.legendItemOff : ''}`}
                onClick={() => toggle(item.id)}
              >
                <span className={styles.legendSwatch} style={{ background: item.color }} />
                {item.label}
              </button>
            ))}
            <button type="button"
              className={`${styles.legendItem} ${!vis.has('line') ? styles.legendItemOff : ''}`}
              onClick={() => toggle('line')}
            >
              <span className={styles.legendLine} style={{ background: '#ffffff' }} />
              {lineLabel}
            </button>
          </div>
        </div>
        <div className={styles.chartWrap}>
          <GDIContribChart
            data={data}
            visibleStart={brushes[brushKey].start}
            visibleEnd={brushes[brushKey].end}
            activeSeries={vis}
            seriesItems={items}
            lineKey="line"
            lineLabel={lineLabel}
            clipPrefix={clipPrefix}
          />
        </div>
        <div className={styles.brushWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 0, right: CONTRIB_CM.right, bottom: 0, left: CONTRIB_CM.left }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="line" stroke="rgba(255,255,255,0.18)"
                strokeWidth={1} dot={false} isAnimationActive={false} legendType="none" connectNulls />
              <Brush dataKey="date"
                startIndex={brushes[brushKey].start}
                endIndex={brushes[brushKey].end}
                onChange={({ startIndex, endIndex }) => handleContribBrush(brushKey, startIndex, endIndex)}
                height={40} stroke="rgba(255,255,255,0.10)" fill="#070b10"
                travellerWidth={7} tickFormatter={fmtAxisDate} gap={4}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <QuickSelectRow
          period={brushes[brushKey].period}
          onSelect={(l, c) => handleContribQuickSelect(brushKey, l, c, data.length)}
          periods={QUICK_PERIODS_Q}
        />
      </div>
    )
  }

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
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/growth" className={styles.breadcrumbLink}>Growth</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>Gross Domestic Income</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>
        <div className={styles.majorHeader}>Gross Domestic Income</div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading 24 GDI series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && gdi.length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>GDI Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedKey}
                  onChange={e => setSelectedKey(e.target.value)}
                >
                  {GDI_HIERARCHY.map(item => (
                    <option key={item.id} value={item.id}
                      {...(item.divider ? { 'data-divider': item.divider } : {})}
                    >
                      {item.divider ? `${item.divider} ` : ''}{'— '.repeat(item.depth)}{item.label}
                    </option>
                  ))}
                </select>
                <span className={styles.fredId}>{selectedFredId}</span>
              </div>
            </div>

            {selectedData.length === 0 ? (
              <div className={styles.statusBlock}>No data for {selectedFredId}</div>
            ) : (
              <>
                {/* E1: Level */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} — Level</div>
                      <div className={styles.sectionSubtitle}>{levelSubtitle}</div>
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
                          tickFormatter={levelTickFmt} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={levelTooltipFmt} />
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
                GDI Contribution Decompositions
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>GDI Contribution Decompositions</div>

            {/* 1. Top-Level GDI Decomposition */}
            <div className={styles.twoColGrid}>
              {renderContribCell('Contributions to QoQ GDI', gdiTopQoqData, GDI_TOP_ITEMS, 'GDI', visGdiTopQoq, toggleGdiTopQoq, 'gdiTopQoq', 'gditopqoq')}
              {renderContribCell('Contributions to YoY GDI', gdiTopYoyData, GDI_TOP_ITEMS, 'GDI', visGdiTopYoy, toggleGdiTopYoy, 'gdiTopYoy', 'gditopyoy')}
            </div>

            {/* 2. Private Enterprise NOS */}
            <div className={styles.twoColGrid}>
              {renderContribCell('Contributions to QoQ Private Enterprise NOS', gdiNosQoqData, GDI_NOS_ITEMS, 'Private Enterprises Net Operating Surplus', visGdiNosQoq, toggleGdiNosQoq, 'gdiNosQoq', 'gdinosqoq')}
              {renderContribCell('Contributions to YoY Private Enterprise NOS', gdiNosYoyData, GDI_NOS_ITEMS, 'Private Enterprises Net Operating Surplus', visGdiNosYoy, toggleGdiNosYoy, 'gdiNosYoy', 'gdinosyoy')}
            </div>

            {/* 3. Corporate Profits */}
            <div className={styles.twoColGrid}>
              {renderContribCell('Contributions to QoQ Corporate Profits', gdiCorpQoqData, GDI_CORP_PROFIT_ITEMS, 'Corporate Profits', visGdiCorpQoq, toggleGdiCorpQoq, 'gdiCorpQoq', 'gdicorpqoq')}
              {renderContribCell('Contributions to YoY Corporate Profits', gdiCorpYoyData, GDI_CORP_PROFIT_ITEMS, 'Corporate Profits', visGdiCorpYoy, toggleGdiCorpYoy, 'gdiCorpYoy', 'gdicorpyoy')}
            </div>

            {/* 4. Corporate Profits After Tax */}
            <div className={styles.twoColGrid}>
              {renderContribCell('Contributions to QoQ Corporate Profits After Tax', gdiPATQoqData, GDI_PROFITS_AFT_TAX_ITEMS, 'Corporate Profits After Tax', visGdiPATQoq, toggleGdiPATQoq, 'gdiPATQoq', 'gdipatqoq')}
              {renderContribCell('Contributions to YoY Corporate Profits After Tax', gdiPATYoyData, GDI_PROFITS_AFT_TAX_ITEMS, 'Corporate Profits After Tax', visGdiPATYoy, toggleGdiPATYoy, 'gdiPATYoy', 'gdipatyoy')}
            </div>

            {/* 5. Consumption of Fixed Capital */}
            <div className={styles.twoColGrid}>
              {renderContribCell('Contributions to QoQ Consumption of Fixed Capital', gdiCofcQoqData, GDI_COFC_ITEMS, 'Consumption of Fixed Capital', visGdiCofcQoq, toggleGdiCofcQoq, 'gdiCofcQoq', 'gdicofcqoq')}
              {renderContribCell('Contributions to YoY Consumption of Fixed Capital', gdiCofcYoyData, GDI_COFC_ITEMS, 'Consumption of Fixed Capital', visGdiCofcYoy, toggleGdiCofcYoy, 'gdiCofcYoy', 'gdicofcyoy')}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
