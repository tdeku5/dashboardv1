import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
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
import { PPI_ITEMS } from '../data/ppiSeriesConfig'
import styles from './PPIDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }
type ChartKey   = 'contribYoy' | 'contribMom' | 'index' | 'regime' | 'yoyDelta' | 'mom' | 'annMom'

type NullableRow = { date: string; value: number | null }

type PpiContribRow = {
  date: string
  services: number | null
  goodsExFE: number | null
  energy: number | null
  foods: number | null
  construction: number | null
  ppiAll: number | null
  corePpi: number | null
}

// ── Chart constants ─────────────────────────────────────────────────────────

const QUICK_PERIODS = [
  { label: '6M',  count: 6        },
  { label: '1Y',  count: 12       },
  { label: '3Y',  count: 36       },
  { label: '5Y',  count: 60       },
  { label: 'All', count: Infinity },
] as const

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

// ── PPI Contribution decomposition constants ────────────────────────────────

const PPI_CONTRIB_SERIES = [
  { key: 'ppiAll',       id: 'PPIFIS'   },
  { key: 'services',     id: 'PPIDSS'   },
  { key: 'goodsExFE',    id: 'WPSFD413' },
  { key: 'energy',       id: 'PPIDES'   },
  { key: 'foods',        id: 'PPIDFS'   },
  { key: 'construction', id: 'PPIDCS'   },
  { key: 'corePpi',      id: 'PPIFES'   },
] as const

const PPI_CONTRIB_WEIGHTS: Record<string, number> = {
  services:     67.520,
  goodsExFE:    18.852,
  energy:        5.265,
  foods:         5.743,
  construction:  2.621,
}

const PPI_CONTRIB_LABELS: Record<string, string> = {
  services:     'Services',
  goodsExFE:    'Goods ex Food & Energy',
  energy:       'Energy',
  foods:        'Foods',
  construction: 'Construction',
  ppiAll:       'PPI',
  corePpi:      'Core PPI',
}

const PPI_CONTRIB_ITEMS = [
  { id: 'services',     label: 'Services',              color: '#60a5fa' },
  { id: 'goodsExFE',    label: 'Goods ex Food & Energy', color: '#84cc16' },
  { id: 'energy',       label: 'Energy',                color: '#ef4444' },
  { id: 'foods',        label: 'Foods',                 color: '#a855f7' },
  { id: 'construction', label: 'Construction',          color: '#fb923c' },
] as const

// ── Sub-category decomposition configs ──────────────────────────────────────

type SubCatComponent = {
  key: string
  id: string       // FRED series code
  label: string
  weight: number   // within-category relative weight (sums to ~1.0)
  color: string
}

type SubCatConfig = {
  key: string
  title: string
  parentId: string     // FRED series for line overlay (parent category total)
  parentLabel: string
  components: SubCatComponent[]
}

// NOTE: Some sub-component series (PPITSS, PPITAW, PPITTW, WPSFD4132, etc.)
// may be NSA on FRED. Fetched on-demand via FRED proxy and cached in DB.
const SUB_CAT_CONFIGS: SubCatConfig[] = [
  {
    key: 'services',
    title: 'Services',
    parentId: 'PPIDSS',
    parentLabel: 'Services',
    components: [
      { key: 'trade',     id: 'PPITSS', label: 'Trade Services',             weight: 0.286, color: '#60a5fa' },
      { key: 'transport', id: 'PPITAW', label: 'Transport & Warehousing',    weight: 0.073, color: '#4ade80' },
      { key: 'svcOther',  id: 'PPITTW', label: 'Svcs less Trade/Trans/Whsg', weight: 0.641, color: '#fb923c' },
    ],
  },
  {
    key: 'goodsExFE',
    title: 'Goods less Food & Energy',
    parentId: 'WPSFD413',
    parentLabel: 'Goods ex F&E',
    components: [
      { key: 'finished', id: 'WPSFD4131', label: 'Finished Goods (less F&E)',  weight: 0.575, color: '#60a5fa' },
      { key: 'govt',     id: 'WPSFD4132', label: "Gov't Purchased (ex F&E)",   weight: 0.104, color: '#4ade80' },
      { key: 'export',   id: 'WPSFD4133', label: 'For Export (ex F&E)',        weight: 0.321, color: '#fb923c' },
    ],
  },
  {
    key: 'foods',
    title: 'Foods',
    parentId: 'PPIDFS',
    parentLabel: 'Foods',
    components: [
      { key: 'consumer', id: 'WPSFD4111', label: 'Finished Consumer Foods',   weight: 0.765, color: '#60a5fa' },
      { key: 'govt',     id: 'WPSFD4112', label: "Gov't Purchased Foods",     weight: 0.073, color: '#4ade80' },
      { key: 'export',   id: 'WPSFD4113', label: 'Foods for Export',          weight: 0.163, color: '#fb923c' },
    ],
  },
  {
    key: 'energy',
    title: 'Energy',
    parentId: 'PPIDES',
    parentLabel: 'Energy',
    components: [
      { key: 'consumer', id: 'WPSFD4121', label: 'Finished Consumer Energy',  weight: 0.778, color: '#60a5fa' },
      { key: 'govt',     id: 'WPSFD4122', label: "Gov't Purchased Energy",    weight: 0.151, color: '#4ade80' },
      { key: 'export',   id: 'WPSFD4123', label: 'Energy for Export',         weight: 0.071, color: '#fb923c' },
    ],
  },
  {
    key: 'construction',
    title: 'Construction',
    parentId: 'PPIDCS',
    parentLabel: 'Construction',
    components: [
      { key: 'private', id: 'WPSFD431', label: 'Private Capital Investment',  weight: 0.695, color: '#60a5fa' },
      { key: 'govt',    id: 'WPSFD432', label: "For Gov't",                   weight: 0.305, color: '#4ade80' },
    ],
  },
]

// ── Pure helpers ────────────────────────────────────────────────────────────

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

function fmtPct(v: number): string {
  return `${v.toFixed(2)}%`
}

function fmtIndex(v: number): string {
  return v.toFixed(1)
}

// ── Data transforms ─────────────────────────────────────────────────────────

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.' && o.value.trim() !== '')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !isNaN(o.value))
}

function computeYoY(data: WD[]): NullableRow[] {
  const map = new Map(data.map(d => [d.date, d.value]))
  return data.map(d => {
    const [y, m] = d.date.split('-').map(Number)
    const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const pv = map.get(prior)
    if (pv == null || pv === 0) return { date: d.date, value: null }
    return { date: d.date, value: (d.value / pv - 1) * 100 }
  })
}

function computeMA(data: NullableRow[], window: number): NullableRow[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null }
    const slice = data.slice(i - window + 1, i + 1)
    const valid = slice.filter(s => s.value != null).map(s => s.value as number)
    if (valid.length < window) return { date: d.date, value: null }
    return { date: d.date, value: valid.reduce((a, b) => a + b, 0) / window }
  })
}

function computeMoMPct(data: WD[]): NullableRow[] {
  return data.map((d, i) => ({
    date:  d.date,
    value: i === 0 || data[i - 1].value === 0
      ? null
      : ((d.value - data[i - 1].value) / data[i - 1].value) * 100,
  }))
}

function computeAnnualizedMoM(data: WD[]): NullableRow[] {
  return data.map((d, i) => {
    if (i === 0 || data[i - 1].value === 0) return { date: d.date, value: null }
    const ratio = d.value / data[i - 1].value
    return { date: d.date, value: (Math.pow(ratio, 12) - 1) * 100 }
  })
}

// ── Regime computation ──────────────────────────────────────────────────────

function computeRegimes(
  yoy: NullableRow[],
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

// ── Sequential comparison builder ───────────────────────────────────────────

function buildSequentialData(data: WD[], yearsBack: number): {
  chartData: { month: string; [year: string]: string | number | null }[]
  years: string[]
} {
  const momPct = computeMoMPct(data)
  const currentYear = new Date().getFullYear()
  const startYear = currentYear - yearsBack + 1
  const years: string[] = []
  for (let y = startYear; y <= currentYear; y++) years.push(String(y))

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const chartData = months.map((mo, mi) => {
    const row: { month: string; [year: string]: string | number | null } = { month: mo }
    for (const yr of years) {
      const dateStr = `${yr}-${String(mi + 1).padStart(2, '0')}-01`
      const obs = momPct.find(d => d.date === dateStr)
      row[yr] = obs?.value ?? null
    }
    return row
  })

  return { chartData, years }
}

// ── YoY Contribution custom SVG chart ────────────────────────────────────────

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

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

function PpiContribYoyTooltip({
  row,
  activeItems,
  showPpiAll,
  showCorePpi,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:          PpiContribRow
  activeItems:  readonly { id: string; label: string; color: string }[]
  showPpiAll:   boolean
  showCorePpi:  boolean
  mouseX:       number
  mouseY:       number
  isRightHalf:  boolean
}) {
  const items = [...activeItems]
    .map(s => ({ ...s, value: row[s.id as keyof PpiContribRow] as number | null }))
    .filter(s => s.value != null)
    .sort((a, b) => Math.abs(b.value!) - Math.abs(a.value!))

  const horizPos = isRightHalf
    ? { right: window.innerWidth - mouseX + 14 }
    : { left:  mouseX + 14 }

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
      maxWidth: 272,
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
            {item.value! >= 0 ? '+' : ''}{item.value!.toFixed(2)}%
          </span>
        </div>
      ))}
      {showPpiAll && row.ppiAll != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>PPI YoY</span>
          <span style={{ color: row.ppiAll >= 0 ? '#4ade80' : '#f87171' }}>
            {row.ppiAll >= 0 ? '+' : ''}{row.ppiAll.toFixed(2)}%
          </span>
        </div>
      )}
      {showCorePpi && row.corePpi != null && (
        <div style={{
          marginTop: showPpiAll ? 2 : 5, paddingTop: showPpiAll ? 0 : 5,
          borderTop: showPpiAll ? 'none' : '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 0, borderTop: '2px dashed #94A3B8', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>Core PPI YoY</span>
          <span style={{ color: row.corePpi >= 0 ? '#4ade80' : '#f87171' }}>
            {row.corePpi >= 0 ? '+' : ''}{row.corePpi.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

function PpiContribYoyChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
}: {
  data:         PpiContribRow[]
  visibleStart: number
  visibleEnd:   number
  activeSeries: Set<string>
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
    () => PPI_CONTRIB_ITEMS.filter(s => activeSeries.has(s.id)),
    [activeSeries]
  )
  const showPpiAll  = activeSeries.has('ppiAll')
  const showCorePpi = activeSeries.has('corePpi')

  // Compute Y domain from visible data
  const yDomain = useMemo((): [number, number] => {
    let min = 0, max = 0
    for (const row of visible) {
      let posStack = 0, negStack = 0
      for (const s of activeItems) {
        const v = row[s.id as keyof PpiContribRow] as number | null
        if (v == null || v === 0) continue
        if (v > 0) posStack += v; else negStack += v
      }
      if (showPpiAll && row.ppiAll != null) {
        posStack = Math.max(posStack, row.ppiAll)
        negStack = Math.min(negStack, row.ppiAll)
      }
      if (showCorePpi && row.corePpi != null) {
        posStack = Math.max(posStack, row.corePpi)
        negStack = Math.min(negStack, row.corePpi)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showPpiAll, showCorePpi])

  const [yMin, yMax] = yDomain
  const yRange = yMax - yMin || 1
  const y0 = CONTRIB_CM.top + (1 - (0 - yMin) / yRange) * innerH

  const { columns, ppiLinePts, coreLinePts } = useMemo(() => {
    const toY = (v: number) => CONTRIB_CM.top + (1 - (v - yMin) / yRange) * innerH
    type Rect = { y: number; h: number; color: string; id: string; value: number }

    const cols = visible.map((row, i) => {
      const cx    = CONTRIB_CM.left + (i + 0.5) * colW
      const rects: Rect[] = []
      let posStack = 0
      let negStack = 0

      for (const s of activeItems) {
        const value = row[s.id as keyof PpiContribRow] as number | null
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

    const ppi = showPpiAll
      ? cols.filter(c => c.row.ppiAll != null).map(c => ({ cx: c.cx, cy: toY(c.row.ppiAll!) }))
      : []
    const core = showCorePpi
      ? cols.filter(c => c.row.corePpi != null).map(c => ({ cx: c.cx, cy: toY(c.row.corePpi!) }))
      : []

    return { columns: cols, ppiLinePts: ppi, coreLinePts: core }
  }, [visible, activeItems, showPpiAll, showCorePpi, colW, yMin, yRange, innerH])

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

  const ppiLinePath = ppiLinePts.length > 1
    ? `M${ppiLinePts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')}`
    : ''
  const coreLinePath = coreLinePts.length > 1
    ? `M${coreLinePts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')}`
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
  const clipId = `ppiyoy${uid.replace(/[^a-zA-Z0-9]/g, '')}`

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

        {/* Y-axis grid lines */}
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

        {/* Zero line */}
        <line
          x1={CONTRIB_CM.left} x2={CONTRIB_CM.left + innerW}
          y1={y0} y2={y0}
          stroke="rgba(255,255,255,0.25)" strokeWidth={1}
        />

        {/* Hover column highlight */}
        {hovCol && (
          <rect
            x={hovCol.cx - colW / 2} y={CONTRIB_CM.top}
            width={colW} height={innerH}
            fill="rgba(255,255,255,0.04)"
            pointerEvents="none"
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Stacked bars */}
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
                fillOpacity={0.7}
              />
            ))
          )}
        </g>

        {/* PPI headline line overlay */}
        {ppiLinePath && (
          <path
            d={ppiLinePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Core PPI line overlay */}
        {coreLinePath && (
          <path
            d={coreLinePath}
            fill="none"
            stroke="#94A3B8"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {/* Y-axis labels */}
        {yTicks.map(t => {
          const ty = CONTRIB_CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <text key={t}
              x={CONTRIB_CM.left - 6} y={ty + 4}
              textAnchor="end"
              fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
            >
              {t.toFixed(1)}%
            </text>
          )
        })}

        {/* X-axis labels */}
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

      {/* Tooltip */}
      {hovCol && (
        <PpiContribYoyTooltip
          row={hovCol.row}
          activeItems={activeItems}
          showPpiAll={showPpiAll}
          showCorePpi={showCorePpi}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRightHalf}
        />
      )}
    </div>
  )
}

// ── QuickSelectRow ──────────────────────────────────────────────────────────

function QuickSelectRow({
  period,
  onSelect,
}: {
  period:   string
  onSelect: (label: string, count: number) => void
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
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

// ── Sub-category chart (single YoY or MoM pane) ────────────────────────────

function SubCatChart({
  data,
  config,
  title,
  brush,
  onBrush,
  vis,
  onToggle,
}: {
  data:     Record<string, string | number | null>[]
  config:   SubCatConfig
  title:    string
  brush:    BrushState
  onBrush:  (b: BrushState) => void
  vis:      Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>{title}</div>
      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {config.components.map(comp => (
            <button key={comp.key} type="button"
              className={`${styles.legendItem} ${vis.has(comp.key) ? '' : styles.legendItemOff}`}
              onClick={() => onToggle(comp.key)}
            >
              <span className={styles.legendSwatch} style={{ background: comp.color }} />{comp.label}
            </button>
          ))}
          <button type="button"
            className={`${styles.legendItem} ${vis.has('total') ? '' : styles.legendItemOff}`}
            onClick={() => onToggle('total')}
          >
            <span className={styles.legendLine} style={{ background: '#ffffff' }} />{config.parentLabel}
          </button>
        </div>
      </div>
      <div className={styles.chartWrapSmall}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60}
            />
            <YAxis
              tick={TICK} tickLine={false} axisLine={false}
              width={58} tickFormatter={fmtPct}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}%` : '-'
                const comp = config.components.find(c => c.key === String(name))
                const lbl = comp ? comp.label : name === 'total' ? config.parentLabel : String(name)
                return [val, lbl] as [string, string]
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {config.components.map(comp => (
              <Bar key={comp.key} dataKey={comp.key} stackId="a"
                fill={comp.color} fillOpacity={0.8}
                isAnimationActive={false} legendType="none"
                hide={!vis.has(comp.key)}
              />
            ))}
            <Line
              type="monotone" dataKey="total" name="total"
              stroke="#ffffff" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls
              legendType="none" hide={!vis.has('total')}
            />
            <Brush
              dataKey="date"
              startIndex={brush.start} endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                onBrush({ start: startIndex ?? 0, end: endIndex ?? 0, period: '' })}
              {...BRUSH_STYLE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = data.length - 1
          onBrush({
            start: isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          })
        }}
      />
    </div>
  )
}

// ── Sub-category chart pair (YoY + MoM side-by-side) ────────────────────────

function SubCatChartPair({ config }: { config: SubCatConfig }) {
  const [raw, setRaw]         = useState<Record<string, WD[]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [brushYoy, setBrushYoy] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [brushMom, setBrushMom] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [visYoy, setVisYoy] = useState<Set<string>>(
    () => new Set([...config.components.map(c => c.key), 'total'])
  )
  const [visMom, setVisMom] = useState<Set<string>>(
    () => new Set([...config.components.map(c => c.key), 'total'])
  )

  const toggleYoy = useCallback(
    (key: string) => setVisYoy(prev => {
      const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
    }), []
  )
  const toggleMom = useCallback(
    (key: string) => setVisMom(prev => {
      const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
    }), []
  )

  useEffect(() => {
    let cancelled = false
    const seriesIds = [
      { key: 'parent', id: config.parentId },
      ...config.components.map(c => ({ key: c.key, id: c.id })),
    ]
    Promise.all(
      seriesIds.map(async s => {
        const obs = await fetchFredSeries(s.id)
        return { key: s.key, data: parseObs(obs) }
      })
    )
      .then(results => {
        if (cancelled) return
        const map: Record<string, WD[]> = {}
        for (const r of results) map[r.key] = r.data
        setRaw(map)
        const parentData = map.parent
        if (parentData?.length) {
          const end = parentData.length - 1
          const start = Math.max(0, end - 96 + 1)
          setBrushYoy({ start, end, period: '' })
          setBrushMom({ start, end, period: '' })
        }
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [config])

  const yoyData = useMemo(() => {
    if (!raw?.parent) return []
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(raw))
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    return raw.parent.map(d => {
      const [y, m] = d.date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const pc = maps.parent?.get(d.date), pp = maps.parent?.get(prior)
      const row: Record<string, string | number | null> = { date: d.date }
      for (const comp of config.components) {
        const c = maps[comp.key]?.get(d.date), p = maps[comp.key]?.get(prior)
        row[comp.key] = (c != null && p != null && p !== 0) ? comp.weight * (c / p - 1) * 100 : null
      }
      row.total = (pc != null && pp != null && pp !== 0) ? (pc / pp - 1) * 100 : null
      return row
    })
  }, [raw, config])

  const momData = useMemo(() => {
    if (!raw?.parent) return []
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(raw))
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    return raw.parent.map((d, i) => {
      const row: Record<string, string | number | null> = { date: d.date }
      if (i === 0) {
        for (const comp of config.components) row[comp.key] = null
        row.total = null
        return row
      }
      const prior = raw!.parent[i - 1].date
      const pc = maps.parent?.get(d.date), pp = maps.parent?.get(prior)
      for (const comp of config.components) {
        const c = maps[comp.key]?.get(d.date), p = maps[comp.key]?.get(prior)
        row[comp.key] = (c != null && p != null && p !== 0) ? comp.weight * (c / p - 1) * 100 : null
      }
      row.total = (pc != null && pp != null && pp !== 0) ? (pc / pp - 1) * 100 : null
      return row
    })
  }, [raw, config])

  if (loading) return <div className={styles.statusBlock}>Loading {config.title} sub-components…</div>
  if (error) return <div className={`${styles.statusBlock} ${styles.statusError}`}>Error: {error}</div>
  if (!yoyData.length) return null

  return (
    <>
      <div className={styles.explorerHeader}>
        <div className={styles.sectionTitle}>{config.title}</div>
      </div>
      <div className={styles.splitGrid}>
        <SubCatChart
          data={yoyData} config={config}
          title={`Contribution to YoY PPI — ${config.title}`}
          brush={brushYoy} onBrush={setBrushYoy}
          vis={visYoy} onToggle={toggleYoy}
        />
        <SubCatChart
          data={momData} config={config}
          title={`Contribution to MoM PPI — ${config.title}`}
          brush={brushMom} onBrush={setBrushMom}
          vis={visMom} onToggle={toggleMom}
        />
      </div>
    </>
  )
}

// ── PPI / Core PPI trend chart (YoY + annualized MoM) ───────────────────────

function PpiTrendChart({ title, data }: { title: string; data: WD[] }) {
  const [brush, setBrush] = useState<BrushState>({ start: 0, end: 0, period: '5Y' })
  const [vis, setVis] = useState<Set<string>>(() => new Set(['yoy', 'ann6m', 'ann3m']))
  const toggle = useCallback(
    (key: string) => setVis(prev => {
      const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
    }), []
  )

  const chartData = useMemo(() => {
    const map = new Map(data.map(d => [d.date, d.value]))
    return data.map(d => {
      const [y, m] = d.date.split('-').map(Number)
      // YoY: 12 months back
      const d12 = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const v12 = map.get(d12)
      // 6mo back
      let y6 = y, m6 = m - 6
      if (m6 <= 0) { m6 += 12; y6-- }
      const d6 = `${y6}-${String(m6).padStart(2, '0')}-01`
      const v6 = map.get(d6)
      // 3mo back
      let y3 = y, m3 = m - 3
      if (m3 <= 0) { m3 += 12; y3-- }
      const d3 = `${y3}-${String(m3).padStart(2, '0')}-01`
      const v3 = map.get(d3)

      return {
        date: d.date,
        yoy:   (v12 != null && v12 !== 0) ? (d.value / v12 - 1) * 100 : null,
        ann6m: (v6 != null && v6 !== 0)   ? (Math.pow(d.value / v6, 2) - 1) * 100 : null,
        ann3m: (v3 != null && v3 !== 0)   ? (Math.pow(d.value / v3, 4) - 1) * 100 : null,
      }
    })
  }, [data])

  // Initialize brush to last 5 years on data load
  useEffect(() => {
    if (chartData.length > 0) {
      const end = chartData.length - 1
      const start = Math.max(0, end - 60 + 1)
      setBrush({ start, end, period: '5Y' })
    }
  }, [chartData.length])

  if (!chartData.length) return null

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>{title}</div>
      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('yoy') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('yoy')}
          >
            <span className={styles.legendLine} style={{ background: '#ff69b4' }} />YoY
          </button>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('ann6m') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('ann6m')}
          >
            <span className={styles.legendLine} style={{ background: '#c0c0a0' }} />6mo&Delta;
          </button>
          <button type="button"
            className={`${styles.legendItem} ${vis.has('ann3m') ? '' : styles.legendItemOff}`}
            onClick={() => toggle('ann3m')}
          >
            <span className={styles.legendLine} style={{ background: '#a0a080' }} />3mo&Delta;
          </button>
        </div>
      </div>
      <div className={styles.chartWrapSmall}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60}
            />
            <YAxis
              tick={TICK} tickLine={false} axisLine={false}
              width={58} tickFormatter={fmtPct}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-'
                const lbl = name === 'yoy' ? 'YoY' : name === 'ann6m' ? '6moΔ' : '3moΔ'
                return [val, lbl] as [string, string]
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Line type="monotone" dataKey="yoy" stroke="#ff69b4" strokeWidth={2.5}
              dot={false} isAnimationActive={false} connectNulls
              legendType="none" hide={!vis.has('yoy')} />
            <Line type="monotone" dataKey="ann6m" stroke="#c0c0a0" strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false} isAnimationActive={false} connectNulls
              legendType="none" hide={!vis.has('ann6m')} />
            <Line type="monotone" dataKey="ann3m" stroke="#a0a080" strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false} isAnimationActive={false} connectNulls
              legendType="none" hide={!vis.has('ann3m')} />
            <Brush
              dataKey="date"
              startIndex={brush.start} endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush({ start: startIndex ?? 0, end: endIndex ?? 0, period: '' })}
              {...BRUSH_STYLE}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = chartData.length - 1
          setBrush({
            start: isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          })
        }}
      />
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PPIDashboardPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [seriesData, setSeriesData] = useState<WD[]>([])
  const [selectedId, setSelectedId] = useState('PPIFIS')

  // ── Chart-specific controls ─────────────────────────────────────────────────
  const [regimeMa, setRegimeMa]         = useState(12)
  const [deltaPeriod, setDeltaPeriod]    = useState(1)
  const [deltaMaPeriod, setDeltaMaPeriod] = useState(12)
  const [momMa1, setMomMa1]             = useState(3)
  const [momMa2, setMomMa2]             = useState(6)

  // ── Legend visibility sets ────────────────────────────────────────────────
  const [visYoyDelta, setVisYoyDelta] = useState<Set<string>>(() => new Set(['delta', 'ma']))
  const [visMom, setVisMom]           = useState<Set<string>>(() => new Set(['mom', 'ma1', 'ma2']))
  const [visAnnMom, setVisAnnMom]     = useState<Set<string>>(() => new Set(['value']))
  const [visSeqYears, setVisSeqYears] = useState<Set<string>>(() => new Set<string>())

  // ── Contribution decomposition state ──────────────────────────────────────
  const [contribRaw, setContribRaw]         = useState<Record<string, WD[]> | null>(null)
  const [contribLoading, setContribLoading] = useState(true)
  const [contribError, setContribError]     = useState<string | null>(null)
  const [visContribYoy, setVisContribYoy]   = useState<Set<string>>(
    () => new Set(['services', 'goodsExFE', 'energy', 'foods', 'construction', 'ppiAll'])
  )
  const [visContribMom, setVisContribMom]   = useState<Set<string>>(
    () => new Set(['services', 'goodsExFE', 'energy', 'foods', 'construction', 'ppiAll', 'corePpi'])
  )

  // ── Brush states ─────────────────────────────────────────────────────────────
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    contribYoy: { start: 0, end: 0, period: '' },
    contribMom: { start: 0, end: 0, period: '' },
    index:      { start: 0, end: 0, period: 'All' },
    regime:     { start: 0, end: 0, period: 'All' },
    yoyDelta:   { start: 0, end: 0, period: 'All' },
    mom:        { start: 0, end: 0, period: 'All' },
    annMom:     { start: 0, end: 0, period: 'All' },
  })

  // ── Selected series label ───────────────────────────────────────────────────
  const selectedLabel = useMemo(
    () => PPI_ITEMS.find(s => s.id === selectedId)?.label ?? selectedId,
    [selectedId]
  )

  // ── Data fetch (explorer) ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchFredSeries(selectedId)
      .then(raw => {
        if (cancelled) return
        const parsed = parseObs(raw)
        setSeriesData(parsed)

        const end = Math.max(0, parsed.length - 1)
        setBrushes(prev => ({
          ...prev,
          index:    { start: 0, end, period: 'All' },
          regime:   { start: 0, end, period: 'All' },
          yoyDelta: { start: 0, end, period: 'All' },
          mom:      { start: 0, end, period: 'All' },
          annMom:   { start: 0, end, period: 'All' },
        }))
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedId])

  // ── Contribution series fetch (independent of explorer dropdown) ───────────
  useEffect(() => {
    let cancelled = false
    Promise.all(
      PPI_CONTRIB_SERIES.map(async s => {
        const raw = await fetchFredSeries(s.id)
        return { key: s.key, data: parseObs(raw) }
      })
    )
      .then(results => {
        if (cancelled) return
        const map: Record<string, WD[]> = {}
        for (const r of results) map[r.key] = r.data
        setContribRaw(map)
        setContribLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setContribError(err instanceof Error ? err.message : 'Failed to load contribution data')
        setContribLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // ── Computed chart data ─────────────────────────────────────────────────────

  const yoyData      = useMemo(() => computeYoY(seriesData),          [seriesData])
  const momData      = useMemo(() => computeMoMPct(seriesData),       [seriesData])
  const momMa1Data   = useMemo(() => computeMA(momData, momMa1),     [momData, momMa1])
  const momMa2Data   = useMemo(() => computeMA(momData, momMa2),     [momData, momMa2])
  const annMomData   = useMemo(() => computeAnnualizedMoM(seriesData),[seriesData])
  const regimeData   = useMemo(() => computeRegimes(yoyData, regimeMa), [yoyData, regimeMa])

  // YoY Delta: YoY(t) - YoY(t-N)
  const yoyDeltaData = useMemo(() => {
    return yoyData.map((d, i) => {
      if (i < deltaPeriod) return { date: d.date, delta: null as number | null, ma: null as number | null }
      const prev = yoyData[i - deltaPeriod]
      const delta = (d.value != null && prev?.value != null) ? d.value - prev.value : null
      return { date: d.date, delta, ma: null as number | null }
    })
  }, [yoyData, deltaPeriod])

  // Configurable-period MA of the delta
  const yoyDeltaWithMa = useMemo(() => {
    const deltas: NullableRow[] = yoyDeltaData.map(d => ({ date: d.date, value: d.delta }))
    const ma = computeMA(deltas, deltaMaPeriod)
    return yoyDeltaData.map((d, i) => ({ ...d, ma: ma[i]?.value ?? null }))
  }, [yoyDeltaData, deltaMaPeriod])

  // MoM chart combined
  const momChartData = useMemo(() =>
    momData.map((d, i) => ({
      date: d.date,
      mom:  d.value ?? null,
      ma1:  momMa1Data[i]?.value ?? null,
      ma2:  momMa2Data[i]?.value ?? null,
    })),
    [momData, momMa1Data, momMa2Data]
  )

  // Sequential comparison
  const { chartData: seqData, years: seqYears } = useMemo(
    () => buildSequentialData(seriesData, 10),
    [seriesData]
  )

  // ── Contribution YoY data ──────────────────────────────────────────────────
  const contribYoyData = useMemo((): PpiContribRow[] => {
    if (!contribRaw?.ppiAll) return []
    const allItems = contribRaw.ppiAll
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return allItems.map(d => {
      const [y, m] = d.date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const ac = maps.ppiAll?.get(d.date), ap = maps.ppiAll?.get(prior)
      const cc = maps.corePpi?.get(d.date), cp = maps.corePpi?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? PPI_CONTRIB_WEIGHTS[k] * (c / p - 1) : null
      }
      return {
        date: d.date,
        services: contrib('services'),
        goodsExFE: contrib('goodsExFE'),
        energy: contrib('energy'),
        foods: contrib('foods'),
        construction: contrib('construction'),
        ppiAll: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
        corePpi: (cc != null && cp != null && cp !== 0) ? (cc / cp - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // ── Contribution MoM data ──────────────────────────────────────────────────
  const contribMomData = useMemo((): PpiContribRow[] => {
    if (!contribRaw?.ppiAll) return []
    const allItems = contribRaw.ppiAll
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return allItems.map((d, i) => {
      if (i === 0) return { date: d.date, services: null, goodsExFE: null, energy: null, foods: null, construction: null, ppiAll: null, corePpi: null }
      const prior = allItems[i - 1].date
      const ac = maps.ppiAll?.get(d.date), ap = maps.ppiAll?.get(prior)
      const cc = maps.corePpi?.get(d.date), cp = maps.corePpi?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? PPI_CONTRIB_WEIGHTS[k] * (c / p - 1) : null
      }
      return {
        date: d.date,
        services: contrib('services'),
        goodsExFE: contrib('goodsExFE'),
        energy: contrib('energy'),
        foods: contrib('foods'),
        construction: contrib('construction'),
        ppiAll: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
        corePpi: (cc != null && cp != null && cp !== 0) ? (cc / cp - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // Initialize sequential year visibility when years change
  useEffect(() => {
    setVisSeqYears(new Set(seqYears))
  }, [seqYears])

  // Initialize contribution brush ranges (~8 years = 96 months)
  useEffect(() => {
    if (contribYoyData.length > 0) {
      const end = contribYoyData.length - 1
      const start = Math.max(0, end - 96 + 1)
      setBrushes(prev => ({
        ...prev,
        contribYoy: { start, end, period: '' },
        contribMom: { start, end, period: '' },
      }))
    }
  }, [contribYoyData.length])

  // Y-domain for index chart (auto-fit to visible range)
  const yDomainIndex = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.index
    if (!seriesData.length || end < start) return undefined
    const visible = seriesData.slice(Math.max(0, start), Math.min(seriesData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.map(d => d.value)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [seriesData, brushes.index.start, brushes.index.end])

  // ── Brush handlers ──────────────────────────────────────────────────────────

  const handleBrush = useCallback(
    (key: ChartKey, startIndex?: number, endIndex?: number) => {
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

  const handleQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number) => {
      setBrushes(prev => {
        const end = seriesData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [seriesData.length]
  )

  const handleContribQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number) => {
      setBrushes(prev => {
        const end = contribYoyData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [contribYoyData.length]
  )

  // ── Legend toggle helper ────────────────────────────────────────────────────
  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (key: string) => setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const toggleYoyDelta    = mkToggle(setVisYoyDelta)
  const toggleMom         = mkToggle(setVisMom)
  const toggleAnnMom      = mkToggle(setVisAnnMom)
  const toggleSeqYear     = mkToggle(setVisSeqYears)
  const toggleContribYoy  = mkToggle(setVisContribYoy)
  const toggleContribMom  = mkToggle(setVisContribMom)

  // ── Sequential comparison year colors ───────────────────────────────────────
  const currentYear = new Date().getFullYear()
  const yearColors = useMemo(() => {
    const blues = ['#1e3a5f', '#1e4d7a', '#2563a0', '#3b82c6', '#60a5fa', '#7ab8fc', '#93c5fd', '#a8d4fe', '#bfdbfe']
    const map: Record<string, { color: string; width: number; opacity: number }> = {}
    seqYears.forEach((yr, i) => {
      if (yr === String(currentYear)) {
        map[yr] = { color: '#ef4444', width: 3, opacity: 1 }
      } else {
        const colorIdx = Math.min(i, blues.length - 1)
        const opacity = 0.35 + (i / (seqYears.length - 1)) * 0.55
        map[yr] = { color: blues[colorIdx], width: 1.5, opacity }
      }
    })
    return map
  }, [seqYears, currentYear])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/inflation" className={styles.breadcrumbLink}>Inflation</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>PPI</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ── PPI Contribution Decomposition ──────────────────────────────── */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>PPI Contribution Decomposition</div>
        </div>

        {contribLoading && (
          <div className={styles.statusBlock}>Loading contribution data...</div>
        )}
        {contribError && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{contribError}</div>
        )}

        {!contribLoading && !contribError && contribYoyData.length > 0 && (
          <div className={styles.splitGrid}>
            {/* ════════════════════════════════════════════════════════════════
                Contribution Chart 1: Contribution to YoY PPI
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to YoY PPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {PPI_CONTRIB_ITEMS.map(item => (
                    <button key={item.id} type="button"
                      className={`${styles.legendItem} ${visContribYoy.has(item.id) ? '' : styles.legendItemOff}`}
                      onClick={() => toggleContribYoy(item.id)}
                    >
                      <span className={styles.legendSwatch} style={{ background: item.color }} />{item.label}
                    </button>
                  ))}
                  <button type="button"
                    className={`${styles.legendItem} ${visContribYoy.has('ppiAll') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleContribYoy('ppiAll')}
                  >
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />PPI
                  </button>
                  <button type="button"
                    className={`${styles.legendItem} ${visContribYoy.has('corePpi') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleContribYoy('corePpi')}
                  >
                    <span className={styles.legendLine} style={{ background: '#94A3B8', borderTop: '2px dashed #94A3B8', height: 0 }} />Core PPI
                  </button>
                </div>
              </div>
              <div className={styles.chartWrapSmall}>
                <PpiContribYoyChart
                  data={contribYoyData}
                  visibleStart={brushes.contribYoy.start}
                  visibleEnd={brushes.contribYoy.end}
                  activeSeries={visContribYoy}
                />
              </div>
              {/* Brush via minimal Recharts chart */}
              <div style={{ height: 44 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={contribYoyData}
                    margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                  >
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.contribYoy.start}
                      endIndex={brushes.contribYoy.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('contribYoy', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.contribYoy.period}
                onSelect={(l, c) => handleContribQuickSelect('contribYoy', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Contribution Chart 2: Contribution to MoM PPI
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to MoM PPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {PPI_CONTRIB_ITEMS.map(item => (
                    <button key={item.id} type="button"
                      className={`${styles.legendItem} ${visContribMom.has(item.id) ? '' : styles.legendItemOff}`}
                      onClick={() => toggleContribMom(item.id)}
                    >
                      <span className={styles.legendSwatch} style={{ background: item.color }} />{item.label}
                    </button>
                  ))}
                  <button type="button"
                    className={`${styles.legendItem} ${visContribMom.has('ppiAll') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleContribMom('ppiAll')}
                  >
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />PPI
                  </button>
                  <button type="button"
                    className={`${styles.legendItem} ${visContribMom.has('corePpi') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleContribMom('corePpi')}
                  >
                    <span className={styles.legendLine} style={{ background: '#94A3B8' }} />Core PPI
                  </button>
                </div>
              </div>
              <div className={styles.chartWrapSmall}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={contribMomData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}%` : '-'
                        return [val, PPI_CONTRIB_LABELS[String(name)] ?? String(name)] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="services" stackId="contributions" fill="rgba(96,165,250,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('services')} />
                    <Bar dataKey="goodsExFE" stackId="contributions" fill="rgba(132,204,22,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('goodsExFE')} />
                    <Bar dataKey="energy" stackId="contributions" fill="rgba(239,68,68,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('energy')} />
                    <Bar dataKey="foods" stackId="contributions" fill="rgba(168,85,247,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('foods')} />
                    <Bar dataKey="construction" stackId="contributions" fill="rgba(251,146,60,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('construction')} />
                    <Line
                      type="monotone" dataKey="ppiAll" name="ppiAll"
                      stroke="#ffffff" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visContribMom.has('ppiAll')}
                    />
                    <Line
                      type="monotone" dataKey="corePpi" name="corePpi"
                      stroke="#94A3B8" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visContribMom.has('corePpi')}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Brush via minimal Recharts chart (matches YoY pattern) */}
              <div style={{ height: 44 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={contribMomData}
                    margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                  >
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.contribMom.start}
                      endIndex={brushes.contribMom.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('contribMom', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.contribMom.period}
                onSelect={(l, c) => handleContribQuickSelect('contribMom', l, c)}
              />
            </div>
          </div>
        )}

        {/* ── Sub-category decomposition charts ──────────────────────────── */}
        {!contribLoading && !contribError && (
          SUB_CAT_CONFIGS.map(cfg => (
            <SubCatChartPair key={cfg.key} config={cfg} />
          ))
        )}

        {/* ── PPI & Core PPI Trend Charts ──────────────────────────────────── */}
        {!contribLoading && !contribError && contribRaw && (
          <div className={styles.splitGrid}>
            {contribRaw.ppiAll && (
              <PpiTrendChart title="PPI" data={contribRaw.ppiAll} />
            )}
            {contribRaw.corePpi && (
              <PpiTrendChart title="Core PPI" data={contribRaw.corePpi} />
            )}
          </div>
        )}

        {/* ── Explorer header ──────────────────────────────────────────────── */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>PPI Series Explorer</div>
          <div className={styles.sectorSelectWrap}>
            <span className={styles.lookbackLabel}>Series</span>
            <select
              className={styles.sectorSelect}
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              {PPI_ITEMS.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <span className={styles.fredId}>{selectedId}</span>
          </div>
        </div>

        {/* ── Loading / Error / Empty ──────────────────────────────────────── */}
        {loading && (
          <div className={styles.statusBlock}>Loading {selectedId}...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}
        {!loading && !error && seriesData.length === 0 && (
          <div className={styles.statusBlock}>No data available for {selectedId}</div>
        )}

        {/* ── Charts ───────────────────────────────────────────────────────── */}
        {!loading && !error && seriesData.length > 0 && (
          <>
            {/* ════════════════════════════════════════════════════════════════
                Chart 1: Outright Index Level
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>{selectedLabel} Index</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#34d399' }} />
                    {selectedLabel} Outright Index
                  </span>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={seriesData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtIndex}
                      domain={yDomainIndex}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(3) : '-', ''] as [string, string]}
                    />
                    <Line
                      type="monotone" dataKey="value" name={`${selectedLabel} Outright Index`}
                      stroke="#34d399" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none"
                    />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.index.start}
                      endIndex={brushes.index.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('index', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.index.period}
                onSelect={(l, c) => handleQuickSelect('index', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Chart 2: YoY % with Regime Shading
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>{selectedLabel} Regimes</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
                <div className={styles.controls}>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>Regime MA</span>
                    <input
                      type="number" min={1} max={60} value={regimeMa}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setRegimeMa(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ background: 'rgba(74,222,128,0.4)' }} />
                    +
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ background: 'rgba(239,68,68,0.4)' }} />
                    &minus;
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#1e1e1e' }} />
                    {selectedLabel}
                  </span>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={regimeData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        if (name === 'regime') return [null, null]
                        return [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-', ''] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="yoy" isAnimationActive={false} legendType="none" maxBarSize={8000} barSize={4}>
                      {regimeData.map((entry, idx) => (
                        <Cell
                          key={`regime-${idx}`}
                          fill={
                            entry.regime === '+' ? 'rgba(74,222,128,0.30)'
                            : entry.regime === '-' ? 'rgba(239,68,68,0.30)'
                            : 'rgba(148,163,184,0.08)'
                          }
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone" dataKey="yoy" name={selectedLabel}
                      stroke="#e2e8f0" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none"
                    />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.regime.start}
                      endIndex={brushes.regime.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('regime', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.regime.period}
                onSelect={(l, c) => handleQuickSelect('regime', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Chart 3: YoY Delta
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>{selectedLabel} YoY &Delta;</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
                <div className={styles.controls}>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>Delta Period</span>
                    <input
                      type="number" min={1} max={24} value={deltaPeriod}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setDeltaPeriod(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA Period</span>
                    <input
                      type="number" min={1} max={60} value={deltaMaPeriod}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setDeltaMaPeriod(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visYoyDelta.has('delta') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleYoyDelta('delta')}
                  >
                    <span className={styles.legendSwatch} style={{ background: '#4ade80' }} />
                    {selectedLabel} YoY {deltaPeriod}pd&Delta;
                  </button>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visYoyDelta.has('ma') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleYoyDelta('ma')}
                  >
                    <span className={styles.legendLine} style={{ background: '#60a5fa' }} />
                    {deltaMaPeriod} per. Mov. Avg.
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={yoyDeltaWithMa}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-'
                        const lbl = name === 'delta' ? `YoY ${deltaPeriod}pdΔ` : `${deltaMaPeriod}pd MA`
                        return [val, lbl] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="delta" isAnimationActive={false} legendType="none" maxBarSize={16} hide={!visYoyDelta.has('delta')}>
                      {yoyDeltaWithMa.map((entry, idx) => (
                        <Cell
                          key={`delta-${idx}`}
                          fill={(entry.delta ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(74,222,128,0.40)'}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone" dataKey="ma" name={`${deltaMaPeriod}pd MA`}
                      stroke="#60a5fa" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visYoyDelta.has('ma')}
                    />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.yoyDelta.start}
                      endIndex={brushes.yoyDelta.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('yoyDelta', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.yoyDelta.period}
                onSelect={(l, c) => handleQuickSelect('yoyDelta', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Chart 4: MoM % Change with Moving Averages
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>{selectedLabel} Index MoM %&Delta;</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
                <div className={styles.controls}>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA 1</span>
                    <input
                      type="number" min={1} max={60} value={momMa1}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setMomMa1(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA 2</span>
                    <input
                      type="number" min={1} max={60} value={momMa2}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setMomMa2(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visMom.has('mom') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleMom('mom')}
                  >
                    <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} />
                    {selectedLabel} MoM &Delta;
                  </button>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visMom.has('ma1') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleMom('ma1')}
                  >
                    <span className={styles.legendLine} style={{ background: '#4ade80' }} />
                    {selectedLabel} MoM&Delta; {momMa1}pd MA
                  </button>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visMom.has('ma2') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleMom('ma2')}
                  >
                    <span className={styles.legendLine} style={{ background: '#f97316' }} />
                    {selectedLabel} MoM&Delta; {momMa2}pd MA
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={momChartData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}%` : '-'
                        const lbl = name === 'mom' ? 'MoM Δ'
                          : name === 'ma1' ? `${momMa1}pd MA`
                          : `${momMa2}pd MA`
                        return [val, lbl] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16} hide={!visMom.has('mom')}>
                      {momChartData.map((_, idx) => (
                        <Cell key={`mom-${idx}`} fill="rgba(96,165,250,0.75)" />
                      ))}
                    </Bar>
                    <Line
                      type="monotone" dataKey="ma1" name={`${momMa1}pd MA`}
                      stroke="#4ade80" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visMom.has('ma1')}
                    />
                    <Line
                      type="monotone" dataKey="ma2" name={`${momMa2}pd MA`}
                      stroke="#f97316" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visMom.has('ma2')}
                    />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.mom.start}
                      endIndex={brushes.mom.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('mom', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.mom.period}
                onSelect={(l, c) => handleQuickSelect('mom', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Chart 5: Annualized MoM % Change
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Annualized MoM &Delta;</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button
                    type="button"
                    className={`${styles.legendItem} ${visAnnMom.has('value') ? '' : styles.legendItemOff}`}
                    onClick={() => toggleAnnMom('value')}
                  >
                    <span className={styles.legendLine} style={{ background: '#fdba74' }} />
                    {selectedLabel}
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={annMomData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-', ''] as [string, string]}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Line
                      type="monotone" dataKey="value" name={selectedLabel}
                      stroke="#fdba74" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visAnnMom.has('value')}
                    />
                    <Brush
                      dataKey="date"
                      startIndex={brushes.annMom.start}
                      endIndex={brushes.annMom.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('annMom', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.annMom.period}
                onSelect={(l, c) => handleQuickSelect('annMom', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                Chart 6: MoM Sequential Comparison
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>MoM Sequential Comparison</div>
                  <div className={styles.sectionSubtitle}>month-over-month % change by year</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {seqYears.map(yr => (
                    <button
                      key={yr}
                      type="button"
                      className={`${styles.legendItem} ${visSeqYears.has(yr) ? '' : styles.legendItemOff}`}
                      onClick={() => toggleSeqYear(yr)}
                    >
                      <span
                        className={styles.legendLine}
                        style={{
                          background: yearColors[yr]?.color ?? '#64748B',
                          opacity:    yearColors[yr]?.opacity ?? 0.5,
                        }}
                      />
                      {yr}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={seqData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="month"
                      tick={TICK} tickLine={false} axisLine={false}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      labelFormatter={(v: unknown) => typeof v === 'string' ? v : ''}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}%` : '-'
                        return [val, String(name)] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    {seqYears.map(yr => (
                      <Line
                        key={yr}
                        type="monotone"
                        dataKey={yr}
                        name={yr}
                        stroke={yearColors[yr]?.color ?? '#64748B'}
                        strokeWidth={yearColors[yr]?.width ?? 1.5}
                        strokeOpacity={yearColors[yr]?.opacity ?? 0.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                        legendType="none"
                        hide={!visSeqYears.has(yr)}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
