import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
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
import { fetchBEANPCESeries } from '../lib/bea'
import type { FredObservation } from '../lib/fred'
import { NPCE_SERIES } from '../data/nPCESeriesConfig'
import styles from './NPCEDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

type ContribRow = { date: string; [key: string]: number | null | string }

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

// ── Contribution item arrays ────────────────────────────────────────────────

const NPCE_TOP_ITEMS = [
  { id: 'services',     label: 'Services',        color: '#93c5fd' },
  { id: 'durables',     label: 'Durable Goods',   color: '#86efac' },
  { id: 'nondurables',  label: 'Nondurable Goods', color: '#fca5a5' },
] as const

const NPCE_SERVICES_ITEMS = [
  { id: 'hhServices',  label: 'HH Services Consumption', color: '#86efac' },
  { id: 'nonprofits',  label: 'Nonprofits',               color: '#c4b5fd' },
] as const

const NPCE_HH_SERVICES_ITEMS = [
  { id: 'housing',       label: 'Housing & Utilities',           color: '#93c5fd' },
  { id: 'healthCare',    label: 'Health Care',                   color: '#fdba74' },
  { id: 'transport',     label: 'Transportation Services',       color: '#86efac' },
  { id: 'recreation',    label: 'Recreation Services',           color: '#fcd34d' },
  { id: 'foodSvc',       label: 'Food Services & Accommodations', color: '#fca5a5' },
  { id: 'financial',     label: 'Financial Services & Insurance', color: '#c4b5fd' },
  { id: 'otherSvc',      label: 'Other Services',                color: '#fde68a' },
] as const

const NPCE_GOODS_ITEMS = [
  { id: 'durables',    label: 'Durables',    color: '#93c5fd' },
  { id: 'nondurables', label: 'Nondurables', color: '#fca5a5' },
] as const

const NPCE_DURABLES_ITEMS = [
  { id: 'motorVehicles', label: 'Motor Vehicles & Parts',           color: '#93c5fd' },
  { id: 'furnishings',   label: 'Furnishings & Durable HH Equipment', color: '#fdba74' },
  { id: 'recreational',  label: 'Recreational Goods & Vehicles',    color: '#86efac' },
  { id: 'otherDur',      label: 'Other Durable Goods',              color: '#fca5a5' },
] as const

const NPCE_NONDURABLES_ITEMS = [
  { id: 'foodBev',     label: 'Food & Beverage',         color: '#93c5fd' },
  { id: 'clothing',    label: 'Clothing & Footwear',     color: '#fdba74' },
  { id: 'gasEnergy',   label: 'Gasoline & Energy Goods', color: '#86efac' },
  { id: 'otherNonDur', label: 'Other Nondurable Goods',  color: '#fca5a5' },
] as const

// ── Chart key types ──────────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xMom' | 'xAnnMom'
type ContribChartKey =
  | 'npceTopYoy' | 'npceTopMom'
  | 'npceSvcYoy' | 'npceSvcMom'
  | 'npceHhSvcYoy' | 'npceHhSvcMom'
  | 'npceGoodsYoy' | 'npceGoodsMom'
  | 'npceDurYoy' | 'npceDurMom'
  | 'npceNonDurYoy' | 'npceNonDurMom'
type GvsChartKey = 'gvsRatio' | 'gvsLevel' | 'gvsYoy' | 'gvsMom'
type ChartKey = ExplorerChartKey | ContribChartKey | GvsChartKey

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
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}T`
  return `${v.toFixed(0)}B`
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

// ── Addenda divider index ────────────────────────────────────────────────────

const ADDENDA_START_INDEX = NPCE_SERIES.findIndex(s => s.lineNumber === 25)

// ── contribNiceTicks ─────────────────────────────────────────────────────────

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

// ── Contribution data builders ──────────────────────────────────────────────

function makeMap(data: WD[] | undefined): Map<string, number> {
  return new Map((data ?? []).map(d => [d.date, d.value]))
}

function buildNPCEContribData(
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

    const row: ContribRow = { date: pt.date }
    for (const [k, cMap] of Object.entries(compMaps)) {
      const cNow   = cMap.get(pt.date)
      const cPrior = cMap.get(priorDate)
      if (cNow == null || cPrior == null || cPrior === 0 || pPrior == null || pPrior === 0) {
        row[k] = null
      } else {
        row[k] = (cPrior / pPrior) * ((cNow / cPrior) - 1) * 100
      }
    }

    row.line = (pNow != null && pPrior != null && pPrior !== 0)
      ? (pNow / pPrior - 1) * 100
      : null

    return row
  })
}

// ── NPCEContribTooltip ──────────────────────────────────────────────────────

function NPCEContribTooltip({
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

// ── NPCEContribChart (custom SVG diverging stacked bar) ─────────────────────

function NPCEContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'npcecontrib',
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
        <NPCEContribTooltip
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

export function NPCEDashboardPage() {
  // ── BEA data fetch ────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          NPCE_SERIES.map(async (item) => {
            const obs = await fetchBEANPCESeries(item.lineNumber)
            return [String(item.lineNumber), parseObs(obs)] as [string, WD[]]
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

  const [selectedLine, setSelectedLine] = useState(1)

  const selectedItem = useMemo(
    () => NPCE_SERIES.find(n => n.lineNumber === selectedLine),
    [selectedLine]
  )

  const selectedLabel = selectedItem?.label ?? 'Personal Consumption Expenditures (PCE)'
  const selectedData  = useMemo(() => allData[String(selectedLine)] ?? [], [allData, selectedLine])

  // Explorer user-controlled parameters
  const [regimeMa, setRegimeMa]       = useState(12)
  const [deltaWindow, setDeltaWindow] = useState(1)
  const [deltaMa, setDeltaMa]         = useState(12)
  const [momMa1, setMomMa1]           = useState(3)
  const [momMa2, setMomMa2]           = useState(6)

  // Explorer computed data — Level displayed in billions (BEA values are millions)
  const exYoY          = useMemo(() => computeYoY(selectedData), [selectedData])
  const exMoM          = useMemo(() => computeMoM(selectedData), [selectedData])
  const exAnnMoM       = useMemo(() => computeAnnualizedMoM(selectedData), [selectedData])
  const exYoYDelta     = useMemo(() => computeYoYDelta(exYoY, deltaWindow), [exYoY, deltaWindow])
  const exYoYDeltaMa   = useMemo(() => computeMA(exYoYDelta, deltaMa), [exYoYDelta, deltaMa])
  const exMoMMa1       = useMemo(() => computeMA(exMoM, momMa1), [exMoM, momMa1])
  const exMoMMa2       = useMemo(() => computeMA(exMoM, momMa2), [exMoM, momMa2])

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

  const exMoMData = useMemo(() =>
    exMoM.map((d, i) => ({ date: d.date, mom: d.value, ma1: exMoMMa1[i]?.value ?? null, ma2: exMoMMa2[i]?.value ?? null })),
    [exMoM, exMoMMa1, exMoMMa2]
  )

  const exAnnMoMData = useMemo(() =>
    exAnnMoM.map(d => ({ date: d.date, value: d.value })),
    [exAnnMoM]
  )

  // ── Brush states ────────────────────────────────────────────────────────

  const CB: BrushState = { start: 0, end: 1, period: '5Y' }
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: '10Y' },
    xRegime:   { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xMom:      { start: 0, end: 0, period: '10Y' },
    xAnnMom:   { start: 0, end: 0, period: '10Y' },
    npceTopYoy: { ...CB }, npceTopMom: { ...CB },
    npceSvcYoy: { ...CB }, npceSvcMom: { ...CB },
    npceHhSvcYoy: { ...CB }, npceHhSvcMom: { ...CB },
    npceGoodsYoy: { ...CB }, npceGoodsMom: { ...CB },
    npceDurYoy: { ...CB }, npceDurMom: { ...CB },
    npceNonDurYoy: { ...CB }, npceNonDurMom: { ...CB },
    gvsRatio: { ...CB }, gvsLevel: { ...CB }, gvsYoy: { ...CB }, gvsMom: { ...CB },
  })

  // Initialize explorer brushes when data arrives or component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endM = selectedData.length - 1
    const start = Math.max(0, endM - 119)
    const newBrush: BrushState = { start, end: endM, period: '10Y' }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [selectedLine, selectedData.length])

  // Initialize contribution brushes when PCE data arrives
  useEffect(() => {
    const pceData = allData['1']
    if (!pceData?.length) return
    const endIdx = pceData.length - 1
    const startIdx = Math.max(0, endIdx - 59)
    const cb: BrushState = { start: startIdx, end: endIdx, period: '5Y' }
    const contribKeys: ContribChartKey[] = [
      'npceTopYoy', 'npceTopMom', 'npceSvcYoy', 'npceSvcMom',
      'npceHhSvcYoy', 'npceHhSvcMom', 'npceGoodsYoy', 'npceGoodsMom',
      'npceDurYoy', 'npceDurMom', 'npceNonDurYoy', 'npceNonDurMom',
    ]
    const gvsMax: BrushState = { start: 0, end: endIdx, period: 'Max' }
    const gvsKeys: GvsChartKey[] = ['gvsRatio', 'gvsLevel', 'gvsYoy', 'gvsMom']
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of contribKeys) next[k] = { ...cb }
      for (const k of gvsKeys) next[k] = { ...gvsMax }
      return next
    })
  }, [allData])

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
    (_key: ChartKey, startIndex?: number, endIndex?: number) => {
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
    (_key: ChartKey, label: string, count: number, dataLen: number) => {
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

  // ── Contribution data memos ───────────────────────────────────────────────

  const npceTopYoyData = useMemo(() => buildNPCEContribData(
    allData['1'] ?? [], { services: makeMap(allData['13']), durables: makeMap(allData['3']), nondurables: makeMap(allData['8']) }, 12
  ), [allData])

  const npceTopMomData = useMemo(() => buildNPCEContribData(
    allData['1'] ?? [], { services: makeMap(allData['13']), durables: makeMap(allData['3']), nondurables: makeMap(allData['8']) }, 1
  ), [allData])

  const npceSvcYoyData = useMemo(() => buildNPCEContribData(
    allData['13'] ?? [], { hhServices: makeMap(allData['14']), nonprofits: makeMap(allData['22']) }, 12
  ), [allData])

  const npceSvcMomData = useMemo(() => buildNPCEContribData(
    allData['13'] ?? [], { hhServices: makeMap(allData['14']), nonprofits: makeMap(allData['22']) }, 1
  ), [allData])

  const npceHhSvcYoyData = useMemo(() => buildNPCEContribData(
    allData['14'] ?? [], {
      housing: makeMap(allData['15']), healthCare: makeMap(allData['16']),
      transport: makeMap(allData['17']), recreation: makeMap(allData['18']),
      foodSvc: makeMap(allData['19']), financial: makeMap(allData['20']),
      otherSvc: makeMap(allData['21']),
    }, 12
  ), [allData])

  const npceHhSvcMomData = useMemo(() => buildNPCEContribData(
    allData['14'] ?? [], {
      housing: makeMap(allData['15']), healthCare: makeMap(allData['16']),
      transport: makeMap(allData['17']), recreation: makeMap(allData['18']),
      foodSvc: makeMap(allData['19']), financial: makeMap(allData['20']),
      otherSvc: makeMap(allData['21']),
    }, 1
  ), [allData])

  const npceGoodsYoyData = useMemo(() => buildNPCEContribData(
    allData['2'] ?? [], { durables: makeMap(allData['3']), nondurables: makeMap(allData['8']) }, 12
  ), [allData])

  const npceGoodsMomData = useMemo(() => buildNPCEContribData(
    allData['2'] ?? [], { durables: makeMap(allData['3']), nondurables: makeMap(allData['8']) }, 1
  ), [allData])

  const npceDurYoyData = useMemo(() => buildNPCEContribData(
    allData['3'] ?? [], {
      motorVehicles: makeMap(allData['4']), furnishings: makeMap(allData['5']),
      recreational: makeMap(allData['6']), otherDur: makeMap(allData['7']),
    }, 12
  ), [allData])

  const npceDurMomData = useMemo(() => buildNPCEContribData(
    allData['3'] ?? [], {
      motorVehicles: makeMap(allData['4']), furnishings: makeMap(allData['5']),
      recreational: makeMap(allData['6']), otherDur: makeMap(allData['7']),
    }, 1
  ), [allData])

  const npceNonDurYoyData = useMemo(() => buildNPCEContribData(
    allData['8'] ?? [], {
      foodBev: makeMap(allData['9']), clothing: makeMap(allData['10']),
      gasEnergy: makeMap(allData['11']), otherNonDur: makeMap(allData['12']),
    }, 12
  ), [allData])

  const npceNonDurMomData = useMemo(() => buildNPCEContribData(
    allData['8'] ?? [], {
      foodBev: makeMap(allData['9']), clothing: makeMap(allData['10']),
      gasEnergy: makeMap(allData['11']), otherNonDur: makeMap(allData['12']),
    }, 1
  ), [allData])

  // ── Goods vs Services data memos ──────────────────────────────────────────

  const gvsRatioData = useMemo(() => {
    const svc = allData['13'] ?? []
    const goodsMap = makeMap(allData['2'])
    return svc
      .map(d => ({ date: d.date, ratio: goodsMap.has(d.date) ? d.value / goodsMap.get(d.date)! : null }))
      .filter(d => d.ratio != null && isFinite(d.ratio!)) as { date: string; ratio: number }[]
  }, [allData])

  const gvsLevelData = useMemo(() => {
    const svc = allData['13'] ?? []
    const goodsMap = makeMap(allData['2'])
    return svc.map(d => ({
      date:     d.date,
      services: d.value / 1000,
      goods:    goodsMap.has(d.date) ? goodsMap.get(d.date)! / 1000 : null,
    }))
  }, [allData])

  const gvsYoyData = useMemo(() => {
    const svcYoY   = computeYoY(allData['13'] ?? [])
    const goodsYoY = computeYoY(allData['2'] ?? [])
    const gMap = new Map(goodsYoY.map(d => [d.date, d.value]))
    return svcYoY.map(d => ({
      date:     d.date,
      services: d.value,
      goods:    gMap.get(d.date) ?? null,
    }))
  }, [allData])

  const gvsMomData = useMemo(() => {
    const svcMoM   = computeMoM(allData['13'] ?? [])
    const goodsMoM = computeMoM(allData['2'] ?? [])
    const gMap = new Map(goodsMoM.map(d => [d.date, d.value]))
    return svcMoM.map(d => ({
      date:     d.date,
      services: d.value,
      goods:    gMap.get(d.date) ?? null,
    }))
  }, [allData])

  // ── GVS Y-domains ────────────────────────────────────────────────────────

  const yDomainGvsRatio = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.gvsRatio
    if (!gvsRatioData.length || end < start) return undefined
    const visible = gvsRatioData.slice(Math.max(0, start), Math.min(gvsRatioData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.map(d => d.ratio)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [gvsRatioData, brushes.gvsRatio.start, brushes.gvsRatio.end])

  const yDomainGvsLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.gvsLevel
    if (!gvsLevelData.length || end < start) return undefined
    const visible = gvsLevelData.slice(Math.max(0, start), Math.min(gvsLevelData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.flatMap(d => [d.services, d.goods]).filter(v => v != null) as number[]
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [gvsLevelData, brushes.gvsLevel.start, brushes.gvsLevel.end])

  // ── GVS brush handlers ─────────────────────────────────────────────────

  const handleGvsBrush = useCallback(
    (key: GvsChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: { period: '', start: startIndex ?? prev[key].start, end: endIndex ?? prev[key].end },
      }))
    },
    []
  )

  const handleGvsQuickSelect = useCallback(
    (key: GvsChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      setBrushes(prev => ({
        ...prev,
        [key]: { start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label },
      }))
    },
    []
  )

  // ── Contribution visibility states ────────────────────────────────────────

  const mkVis = (items: readonly { id: string }[]) => new Set([...items.map(s => s.id), 'line'])
  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const [visNpceTopYoy,    setVisNpceTopYoy]    = useState(() => mkVis(NPCE_TOP_ITEMS))
  const [visNpceTopMom,    setVisNpceTopMom]    = useState(() => mkVis(NPCE_TOP_ITEMS))
  const [visNpceSvcYoy,    setVisNpceSvcYoy]    = useState(() => mkVis(NPCE_SERVICES_ITEMS))
  const [visNpceSvcMom,    setVisNpceSvcMom]    = useState(() => mkVis(NPCE_SERVICES_ITEMS))
  const [visNpceHhSvcYoy,  setVisNpceHhSvcYoy]  = useState(() => mkVis(NPCE_HH_SERVICES_ITEMS))
  const [visNpceHhSvcMom,  setVisNpceHhSvcMom]  = useState(() => mkVis(NPCE_HH_SERVICES_ITEMS))
  const [visNpceGoodsYoy,  setVisNpceGoodsYoy]  = useState(() => mkVis(NPCE_GOODS_ITEMS))
  const [visNpceGoodsMom,  setVisNpceGoodsMom]  = useState(() => mkVis(NPCE_GOODS_ITEMS))
  const [visNpceDurYoy,    setVisNpceDurYoy]    = useState(() => mkVis(NPCE_DURABLES_ITEMS))
  const [visNpceDurMom,    setVisNpceDurMom]    = useState(() => mkVis(NPCE_DURABLES_ITEMS))
  const [visNpceNonDurYoy, setVisNpceNonDurYoy] = useState(() => mkVis(NPCE_NONDURABLES_ITEMS))
  const [visNpceNonDurMom, setVisNpceNonDurMom] = useState(() => mkVis(NPCE_NONDURABLES_ITEMS))

  const toggleNpceTopYoy    = mkToggle(setVisNpceTopYoy)
  const toggleNpceTopMom    = mkToggle(setVisNpceTopMom)
  const toggleNpceSvcYoy    = mkToggle(setVisNpceSvcYoy)
  const toggleNpceSvcMom    = mkToggle(setVisNpceSvcMom)
  const toggleNpceHhSvcYoy  = mkToggle(setVisNpceHhSvcYoy)
  const toggleNpceHhSvcMom  = mkToggle(setVisNpceHhSvcMom)
  const toggleNpceGoodsYoy  = mkToggle(setVisNpceGoodsYoy)
  const toggleNpceGoodsMom  = mkToggle(setVisNpceGoodsMom)
  const toggleNpceDurYoy    = mkToggle(setVisNpceDurYoy)
  const toggleNpceDurMom    = mkToggle(setVisNpceDurMom)
  const toggleNpceNonDurYoy = mkToggle(setVisNpceNonDurYoy)
  const toggleNpceNonDurMom = mkToggle(setVisNpceNonDurMom)

  // ── GVS visibility states ──────────────────────────────────────────────

  const [visGvsLevel, setVisGvsLevel] = useState<Set<string>>(() => new Set(['services', 'goods']))
  const [visGvsYoy,   setVisGvsYoy]   = useState<Set<string>>(() => new Set(['services', 'goods']))
  const [visGvsMom,   setVisGvsMom]   = useState<Set<string>>(() => new Set(['services', 'goods']))

  const toggleGvsLevel = mkToggle(setVisGvsLevel)
  const toggleGvsYoy   = mkToggle(setVisGvsYoy)
  const toggleGvsMom   = mkToggle(setVisGvsMom)

  // ── Contribution brush handlers ───────────────────────────────────────────

  const handleContribBrush = useCallback(
    (key: ContribChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: { period: '', start: startIndex ?? prev[key].start, end: endIndex ?? prev[key].end },
      }))
    },
    []
  )

  const handleContribQuickSelect = useCallback(
    (key: ContribChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      setBrushes(prev => ({
        ...prev,
        [key]: { start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label },
      }))
    },
    []
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
        <span className={styles.breadcrumbCurrent}>Nominal PCE</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>
        <div className={styles.majorHeader}>Nominal PCE Dashboard</div>
        <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
          Bureau of Economic Analysis &mdash; BEA Table 2.8.5 &mdash; monthly, millions of dollars, SAAR
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading {NPCE_SERIES.length} nPCE series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && Object.keys(allData).length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                PCE Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>PCE Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedLine}
                  onChange={e => setSelectedLine(parseInt(e.target.value))}
                >
                  {NPCE_SERIES.map((item, idx) => {
                    const indent = item.depth * 16
                    const prefix = '\u00A0'.repeat(item.depth * 3)
                    const els: React.ReactNode[] = []

                    if (idx === ADDENDA_START_INDEX) {
                      els.push(
                        <option key="addenda-divider" disabled value="">
                          ── Addenda ──
                        </option>
                      )
                    }

                    els.push(
                      <option
                        key={item.lineNumber}
                        value={item.lineNumber}
                        style={{ paddingLeft: indent }}
                      >
                        {prefix}{item.label}
                      </option>
                    )

                    return els
                  })}
                </select>
                <span className={styles.fredId}>Line {selectedLine}</span>
              </div>
            </div>

            {selectedData.length === 0 ? (
              <div className={styles.statusBlock}>No data for Line {selectedLine}</div>
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
                          formatter={(v: unknown) => [typeof v === 'number' ? `$${fmtBillions(v)}` : '-', ''] as [string, string]} />
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
                nPCE Contribution Decompositions
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>nPCE Contribution Decompositions</div>

            {/* ── Top-Level PCE Decomposition ──────────────────────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Top-Level PCE Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to MoM nPCE</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {NPCE_TOP_ITEMS.map(s => (
                      <button key={s.id} type="button" className={`${styles.legendItem} ${visNpceTopMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceTopMom(s.id)}>
                        <span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}
                      </button>
                    ))}
                    <button type="button" className={`${styles.legendItem} ${visNpceTopMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceTopMom('line')}>
                      <span className={styles.legendLine} style={{ background: '#fff' }} /> nPCE
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <NPCEContribChart data={npceTopMomData} visibleStart={brushes.npceTopMom.start} visibleEnd={brushes.npceTopMom.end} activeSeries={visNpceTopMom} clipPrefix="ntmom" seriesItems={NPCE_TOP_ITEMS} lineKey="line" lineLabel="nPCE" />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={npceTopMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <XAxis dataKey="date" hide /><YAxis hide />
                      <Brush dataKey="date" startIndex={brushes.npceTopMom.start} endIndex={brushes.npceTopMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceTopMom', startIndex, endIndex)} {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow period={brushes.npceTopMom.period} onSelect={(l, c) => handleContribQuickSelect('npceTopMom', l, c, npceTopMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Contributions to YoY nPCE</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {NPCE_TOP_ITEMS.map(s => (
                      <button key={s.id} type="button" className={`${styles.legendItem} ${visNpceTopYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceTopYoy(s.id)}>
                        <span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}
                      </button>
                    ))}
                    <button type="button" className={`${styles.legendItem} ${visNpceTopYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceTopYoy('line')}>
                      <span className={styles.legendLine} style={{ background: '#fff' }} /> nPCE
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <NPCEContribChart data={npceTopYoyData} visibleStart={brushes.npceTopYoy.start} visibleEnd={brushes.npceTopYoy.end} activeSeries={visNpceTopYoy} clipPrefix="ntyoy" seriesItems={NPCE_TOP_ITEMS} lineKey="line" lineLabel="nPCE" />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={npceTopYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <XAxis dataKey="date" hide /><YAxis hide />
                      <Brush dataKey="date" startIndex={brushes.npceTopYoy.start} endIndex={brushes.npceTopYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceTopYoy', startIndex, endIndex)} {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow period={brushes.npceTopYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceTopYoy', l, c, npceTopYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ── Goods Decomposition ─────────────────────────────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Goods Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to MoM Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_GOODS_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceGoodsMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceGoodsMom(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceGoodsMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceGoodsMom('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceGoodsMomData} visibleStart={brushes.npceGoodsMom.start} visibleEnd={brushes.npceGoodsMom.end} activeSeries={visNpceGoodsMom} clipPrefix="ngmom" seriesItems={NPCE_GOODS_ITEMS} lineKey="line" lineLabel="Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceGoodsMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceGoodsMom.start} endIndex={brushes.npceGoodsMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceGoodsMom', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceGoodsMom.period} onSelect={(l, c) => handleContribQuickSelect('npceGoodsMom', l, c, npceGoodsMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to YoY Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_GOODS_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceGoodsYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceGoodsYoy(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceGoodsYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceGoodsYoy('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceGoodsYoyData} visibleStart={brushes.npceGoodsYoy.start} visibleEnd={brushes.npceGoodsYoy.end} activeSeries={visNpceGoodsYoy} clipPrefix="ngyoy" seriesItems={NPCE_GOODS_ITEMS} lineKey="line" lineLabel="Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceGoodsYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceGoodsYoy.start} endIndex={brushes.npceGoodsYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceGoodsYoy', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceGoodsYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceGoodsYoy', l, c, npceGoodsYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ── Durable Goods Decomposition ─────────────────────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Durable Goods Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to MoM Durable Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_DURABLES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceDurMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceDurMom(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceDurMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceDurMom('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Durable Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceDurMomData} visibleStart={brushes.npceDurMom.start} visibleEnd={brushes.npceDurMom.end} activeSeries={visNpceDurMom} clipPrefix="ndmom" seriesItems={NPCE_DURABLES_ITEMS} lineKey="line" lineLabel="Durable Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceDurMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceDurMom.start} endIndex={brushes.npceDurMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceDurMom', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceDurMom.period} onSelect={(l, c) => handleContribQuickSelect('npceDurMom', l, c, npceDurMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to YoY Durable Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_DURABLES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceDurYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceDurYoy(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceDurYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceDurYoy('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Durable Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceDurYoyData} visibleStart={brushes.npceDurYoy.start} visibleEnd={brushes.npceDurYoy.end} activeSeries={visNpceDurYoy} clipPrefix="ndyoy" seriesItems={NPCE_DURABLES_ITEMS} lineKey="line" lineLabel="Durable Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceDurYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceDurYoy.start} endIndex={brushes.npceDurYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceDurYoy', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceDurYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceDurYoy', l, c, npceDurYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ── Nondurable Goods Decomposition ──────────────────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Nondurable Goods Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to MoM Nondurable Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_NONDURABLES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceNonDurMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceNonDurMom(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceNonDurMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceNonDurMom('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Nondurable Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceNonDurMomData} visibleStart={brushes.npceNonDurMom.start} visibleEnd={brushes.npceNonDurMom.end} activeSeries={visNpceNonDurMom} clipPrefix="nnmom" seriesItems={NPCE_NONDURABLES_ITEMS} lineKey="line" lineLabel="Nondurable Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceNonDurMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceNonDurMom.start} endIndex={brushes.npceNonDurMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceNonDurMom', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceNonDurMom.period} onSelect={(l, c) => handleContribQuickSelect('npceNonDurMom', l, c, npceNonDurMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to YoY Nondurable Goods nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_NONDURABLES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceNonDurYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceNonDurYoy(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceNonDurYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceNonDurYoy('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Nondurable Goods</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceNonDurYoyData} visibleStart={brushes.npceNonDurYoy.start} visibleEnd={brushes.npceNonDurYoy.end} activeSeries={visNpceNonDurYoy} clipPrefix="nnyoy" seriesItems={NPCE_NONDURABLES_ITEMS} lineKey="line" lineLabel="Nondurable Goods" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceNonDurYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceNonDurYoy.start} endIndex={brushes.npceNonDurYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceNonDurYoy', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceNonDurYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceNonDurYoy', l, c, npceNonDurYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ── Services Decomposition ──────────────────────────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Services Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to MoM Services nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_SERVICES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceSvcMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceSvcMom(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceSvcMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceSvcMom('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Services</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceSvcMomData} visibleStart={brushes.npceSvcMom.start} visibleEnd={brushes.npceSvcMom.end} activeSeries={visNpceSvcMom} clipPrefix="nsmom" seriesItems={NPCE_SERVICES_ITEMS} lineKey="line" lineLabel="Services" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceSvcMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceSvcMom.start} endIndex={brushes.npceSvcMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceSvcMom', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceSvcMom.period} onSelect={(l, c) => handleContribQuickSelect('npceSvcMom', l, c, npceSvcMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to YoY Services nPCE</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_SERVICES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceSvcYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceSvcYoy(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceSvcYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceSvcYoy('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> Services</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceSvcYoyData} visibleStart={brushes.npceSvcYoy.start} visibleEnd={brushes.npceSvcYoy.end} activeSeries={visNpceSvcYoy} clipPrefix="nsyoy" seriesItems={NPCE_SERVICES_ITEMS} lineKey="line" lineLabel="Services" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceSvcYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceSvcYoy.start} endIndex={brushes.npceSvcYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceSvcYoy', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceSvcYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceSvcYoy', l, c, npceSvcYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ── Household Services Consumption Decomposition ─────────── */}
            <div className={styles.sectionSubtitle} style={{ padding: '0 2px' }}>Household Services Consumption Decomposition</div>
            <div className={styles.twoColGrid}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to MoM HH Services Consumption</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_HH_SERVICES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceHhSvcMom.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceHhSvcMom(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceHhSvcMom.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceHhSvcMom('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> HH Services Consumption</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceHhSvcMomData} visibleStart={brushes.npceHhSvcMom.start} visibleEnd={brushes.npceHhSvcMom.end} activeSeries={visNpceHhSvcMom} clipPrefix="nhmom" seriesItems={NPCE_HH_SERVICES_ITEMS} lineKey="line" lineLabel="HH Services Consumption" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceHhSvcMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceHhSvcMom.start} endIndex={brushes.npceHhSvcMom.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceHhSvcMom', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceHhSvcMom.period} onSelect={(l, c) => handleContribQuickSelect('npceHhSvcMom', l, c, npceHhSvcMomData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Contributions to YoY HH Services Consumption</div></div></div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  {NPCE_HH_SERVICES_ITEMS.map(s => (<button key={s.id} type="button" className={`${styles.legendItem} ${visNpceHhSvcYoy.has(s.id) ? '' : styles.legendItemOff}`} onClick={() => toggleNpceHhSvcYoy(s.id)}><span className={styles.legendSwatch} style={{ background: s.color }} /> {s.label}</button>))}
                  <button type="button" className={`${styles.legendItem} ${visNpceHhSvcYoy.has('line') ? '' : styles.legendItemOff}`} onClick={() => toggleNpceHhSvcYoy('line')}><span className={styles.legendLine} style={{ background: '#fff' }} /> HH Services Consumption</button>
                </div></div>
                <div className={styles.chartWrap}><NPCEContribChart data={npceHhSvcYoyData} visibleStart={brushes.npceHhSvcYoy.start} visibleEnd={brushes.npceHhSvcYoy.end} activeSeries={visNpceHhSvcYoy} clipPrefix="nhyoy" seriesItems={NPCE_HH_SERVICES_ITEMS} lineKey="line" lineLabel="HH Services Consumption" /></div>
                <div className={styles.brushWrap}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={npceHhSvcYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}><XAxis dataKey="date" hide /><YAxis hide /><Brush dataKey="date" startIndex={brushes.npceHhSvcYoy.start} endIndex={brushes.npceHhSvcYoy.end} onChange={({ startIndex, endIndex }) => handleContribBrush('npceHhSvcYoy', startIndex, endIndex)} {...BRUSH_STYLE} /></ComposedChart></ResponsiveContainer></div>
                <QuickSelectRow period={brushes.npceHhSvcYoy.period} onSelect={(l, c) => handleContribQuickSelect('npceHhSvcYoy', l, c, npceHhSvcYoyData.length)} periods={QUICK_PERIODS_CONTRIB} />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Goods vs Services
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Goods vs Services</div>

            {/* GVS1: Ratio — full width */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Services / Goods Ratio</div>
                  <div className={styles.sectionSubtitle}>Services nPCE &divide; Goods nPCE</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <span className={styles.legendItem} style={{ cursor: 'default' }}>
                    <span className={styles.legendLine} style={{ background: '#f472b6' }} />
                    Services / Goods
                  </span>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={gvsRatioData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis domain={yDomainGvsRatio} tick={TICK} tickLine={false} axisLine={false} width={58}
                      tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(3) : '-', 'Ratio'] as [string, string]} />
                    <Line type="monotone" dataKey="ratio" name="Ratio"
                      stroke="#f472b6" strokeWidth={1.8}
                      dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    <Brush dataKey="date"
                      startIndex={brushes.gvsRatio.start}
                      endIndex={brushes.gvsRatio.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsRatio', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsRatio.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsRatio', l, c, gvsRatioData.length)}
                periods={QUICK_PERIODS_CONTRIB}
              />
            </div>

            {/* GVS2: Level */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>LEVEL ($B, SAAR)</div></div>
                </div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visGvsLevel.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsLevel('services')}>
                    <span className={styles.legendLine} style={{ background: '#60a5fa' }} /> Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visGvsLevel.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsLevel('goods')}>
                    <span className={styles.legendLine} style={{ background: '#4ade80' }} /> Goods
                  </button>
                </div></div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={gvsLevelData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis domain={yDomainGvsLevel} tick={TICK} tickLine={false} axisLine={false} width={58}
                        tickFormatter={fmtBillions} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          return [`$${fmtBillions(v)}`, name === 'services' ? 'Services' : 'Goods'] as [string, string]
                        }} />
                      {visGvsLevel.has('services') && (
                        <Line type="monotone" dataKey="services" name="services"
                          stroke="#60a5fa" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visGvsLevel.has('goods') && (
                        <Line type="monotone" dataKey="goods" name="goods"
                          stroke="#4ade80" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.gvsLevel.start}
                        endIndex={brushes.gvsLevel.end}
                        onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsLevel', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.gvsLevel.period}
                  onSelect={(l, c) => handleGvsQuickSelect('gvsLevel', l, c, gvsLevelData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
            </div>

            {/* GVS3: YoY */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>YOY % CHANGE</div></div>
                </div>
                <div className={styles.legendRow}><div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visGvsYoy.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsYoy('services')}>
                    <span className={styles.legendLine} style={{ background: '#60a5fa' }} /> Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visGvsYoy.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsYoy('goods')}>
                    <span className={styles.legendLine} style={{ background: '#4ade80' }} /> Goods
                  </button>
                </div></div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={gvsYoyData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          return [fmtPctTooltip(v), name === 'services' ? 'Services' : 'Goods'] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visGvsYoy.has('services') && (
                        <Line type="monotone" dataKey="services" name="services"
                          stroke="#60a5fa" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visGvsYoy.has('goods') && (
                        <Line type="monotone" dataKey="goods" name="goods"
                          stroke="#4ade80" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.gvsYoy.start}
                        endIndex={brushes.gvsYoy.end}
                        onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.gvsYoy.period}
                  onSelect={(l, c) => handleGvsQuickSelect('gvsYoy', l, c, gvsYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
            </div>

            {/* GVS4: MoM (side-by-side bars) */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>MOM %&Delta;</div></div>
              </div>
              <div className={styles.legendRow}><div className={styles.legend}>
                <button type="button" className={`${styles.legendItem} ${visGvsMom.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsMom('services')}>
                  <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} /> Services
                </button>
                <button type="button" className={`${styles.legendItem} ${visGvsMom.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsMom('goods')}>
                  <span className={styles.legendSwatch} style={{ background: '#4ade80' }} /> Goods
                </button>
              </div></div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gvsMomData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                    barCategoryGap="20%" barGap={2}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        if (typeof v !== 'number') return ['-', '']
                        return [fmtPctTooltip(v), name === 'services' ? 'Services' : 'Goods'] as [string, string]
                      }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    {visGvsMom.has('services') && (
                      <Bar dataKey="services" name="services" fill="#60a5fa" fillOpacity={0.75}
                        isAnimationActive={false} legendType="none" />
                    )}
                    {visGvsMom.has('goods') && (
                      <Bar dataKey="goods" name="goods" fill="#4ade80" fillOpacity={0.75}
                        isAnimationActive={false} legendType="none" />
                    )}
                    <Brush dataKey="date"
                      startIndex={brushes.gvsMom.start}
                      endIndex={brushes.gvsMom.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsMom', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsMom.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsMom', l, c, gvsMomData.length)}
                periods={QUICK_PERIODS_CONTRIB}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
