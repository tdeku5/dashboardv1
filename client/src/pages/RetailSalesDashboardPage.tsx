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
import styles from './RetailSalesDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

type ContribRow = { date: string; [key: string]: number | null | string }

// ── Retail hierarchy ─────────────────────────────────────────────────────────

interface RetailItem {
  id:    string
  label: string
  depth: number
}

const RETAIL_HIERARCHY: RetailItem[] = [
  { id: 'RSAFS',            label: 'Retail Trade and Food Services',                              depth: 0 },
  { id: 'RSFSXMV',          label: 'Retail Trade and Food Services, ex Auto',                     depth: 0 },
  { id: 'MRTSSM44W72USS',   label: 'Retail Trade and Food Services, ex Auto and Gas',             depth: 0 },
  { id: 'RSMVPD',           label: 'Motor Vehicle and Parts Dealers',                             depth: 0 },
  { id: 'RSGASS',           label: 'Gasoline Stations',                                           depth: 0 },
  { id: 'MRTSSM4413USS',    label: 'Auto Parts, Accessories, and Tires Stores',                   depth: 0 },
  { id: 'RSFHFS',           label: 'Furniture and Home Furnishings Stores',                       depth: 0 },
  { id: 'RSEAS',            label: 'Electronics and Appliance Stores',                            depth: 0 },
  { id: 'RSBMGESD',         label: 'Building Material and Garden Equipment & Supplies Dealers',   depth: 0 },
  { id: 'RSDBS',            label: 'Food and Beverage Stores',                                    depth: 0 },
  { id: 'RSHPCS',           label: 'Health and Personal Care Stores',                             depth: 0 },
  { id: 'RSCCAS',           label: 'Clothing and Clothing Access. Stores',                        depth: 0 },
  { id: 'RSSGHBMS',         label: 'Sporting Goods, Hobby, Book, and Music Stores',               depth: 0 },
  { id: 'RSGMS',            label: 'General Merchandise Stores',                                  depth: 0 },
  { id: 'RSMSR',            label: 'Miscellaneous Store Retailers',                               depth: 0 },
  { id: 'RSNSR',            label: 'Nonstore Retailers',                                          depth: 0 },
  { id: 'RSFSDP',           label: 'Food Services and Drinking Places',                           depth: 0 },
]

const FRED_SERIES_IDS = RETAIL_HIERARCHY.map(n => n.id)

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

const RETAIL_CONTRIB_ITEMS = [
  { id: 'mvpd',     label: 'Motor Vehicle & Parts',       color: '#60a5fa' },
  { id: 'gas',      label: 'Gasoline Stations',           color: '#f59e0b' },
  { id: 'foodServices', label: 'Food Services & Drinking Places', color: '#fb7185' },
  { id: 'furn',     label: 'Furniture & Home Furnishings', color: '#a78bfa' },
  { id: 'elec',     label: 'Electronics & Appliance',      color: '#f87171' },
  { id: 'bldg',     label: 'Building Material & Garden',   color: '#fb923c' },
  { id: 'food',     label: 'Food & Beverage Stores',       color: '#4ade80' },
  { id: 'health',   label: 'Health & Personal Care',       color: '#38bdf8' },
  { id: 'clothing', label: 'Clothing & Accessories',       color: '#e879f9' },
  { id: 'sport',    label: 'Sporting/Hobby/Book/Music',    color: '#fbbf24' },
  { id: 'genmerch', label: 'General Merchandise',          color: '#818cf8' },
  { id: 'misc',     label: 'Miscellaneous Retailers',      color: '#94a3b8' },
  { id: 'nonstore', label: 'Nonstore Retailers',           color: '#2dd4bf' },
] as const

const RETAIL_CONTRIB_COMPONENTS = [
  { key: 'mvpd',     fredId: 'RSMVPD'           },
  { key: 'gas',      fredId: 'RSGASS'           },
  { key: 'foodServices', fredId: 'RSFSDP'        },
  { key: 'furn',     fredId: 'RSFHFS'           },
  { key: 'elec',     fredId: 'RSEAS'            },
  { key: 'bldg',     fredId: 'RSBMGESD'         },
  { key: 'food',     fredId: 'RSDBS'            },
  { key: 'health',   fredId: 'RSHPCS'           },
  { key: 'clothing', fredId: 'RSCCAS'           },
  { key: 'sport',    fredId: 'RSSGHBMS'         },
  { key: 'genmerch', fredId: 'RSGMS'            },
  { key: 'misc',     fredId: 'RSMSR'            },
  { key: 'nonstore', fredId: 'RSNSR'            },
] as const

// ── Chart key types ──────────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xMom' | 'xAnnMom'
type ContribChartKey  = 'retailContribYoy' | 'retailContribMom'
type RatesChartKey    = 'rsafsRates' | 'rsfsxmvRates'
type ChartKey = ExplorerChartKey | ContribChartKey | RatesChartKey

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

function fmtMillions(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}B`
  return `${v.toFixed(0)}M`
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

function computeAnnNm(data: WD[], n: number): { date: string; value: number | null }[] {
  const exp = 12 / n
  return data.map((d, i) => {
    if (i < n) return { date: d.date, value: null }
    const prev = data[i - n].value
    if (prev <= 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, exp) - 1) * 100 }
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

// ── buildRetailContribSeries ─────────────────────────────────────────────────

function buildRetailContribSeries(
  allData: AllData,
  components: readonly { key: string; fredId: string }[],
  lineKey: string,
  mode: 'yoy' | 'mom',
): ContribRow[] {
  const parentData = allData['RSAFS'] ?? []
  const compMaps = components.map(c => ({
    key: c.key,
    map: new Map((allData[c.fredId] ?? []).map(r => [r.date, r.value])),
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

// ── RetailContribTooltip ─────────────────────────────────────────────────────

function RetailContribTooltip({
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

// ── RetailContribChart (custom SVG diverging stacked bar) ────────────────────

function RetailContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'retailcontrib',
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
        <RetailContribTooltip
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

export function RetailSalesDashboardContent() {
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

  const [selectedId, setSelectedId] = useState('RSAFS')

  const selectedItem = useMemo(
    () => RETAIL_HIERARCHY.find(n => n.id === selectedId),
    [selectedId]
  )

  const selectedLabel = selectedItem?.label ?? 'Retail Trade and Food Services'
  const selectedData  = useMemo(() => allData[selectedId] ?? [], [allData, selectedId])

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

  // ── Brush states ────────────────────────────────────────────────────────

  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: '10Y' },
    xRegime:   { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xMom:      { start: 0, end: 0, period: '10Y' },
    xAnnMom:   { start: 0, end: 0, period: '10Y' },
    retailContribYoy: { start: 0, end: 0, period: '5Y' },
    retailContribMom: { start: 0, end: 0, period: '5Y' },
    rsafsRates:       { start: 0, end: 0, period: '10Y' },
    rsfsxmvRates:     { start: 0, end: 0, period: '10Y' },
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
  }, [selectedId, selectedData.length])

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

  // ── Contribution chart data ────────────────────────────────────────────────

  const retailContribYoyData = useMemo(
    () => Object.keys(allData).length > 0
      ? buildRetailContribSeries(allData, RETAIL_CONTRIB_COMPONENTS, 'line', 'yoy')
      : [],
    [allData]
  )

  const retailContribMomData = useMemo(
    () => Object.keys(allData).length > 0
      ? buildRetailContribSeries(allData, RETAIL_CONTRIB_COMPONENTS, 'line', 'mom')
      : [],
    [allData]
  )

  // ── Contribution visibility states ────────────────────────────────────────

  const mkVis = (items: readonly { id: string }[]) => {
    const all = new Set(items.map(s => s.id))
    all.add('line')
    return all
  }

  const [visRetailYoy, setVisRetailYoy] = useState(() => mkVis(RETAIL_CONTRIB_ITEMS))
  const [visRetailMom, setVisRetailMom] = useState(() => mkVis(RETAIL_CONTRIB_ITEMS))

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleRetailYoy = mkToggle(setVisRetailYoy)
  const toggleRetailMom = mkToggle(setVisRetailMom)

  // ── Contribution brush initialization ─────────────────────────────────────

  useEffect(() => {
    if (retailContribYoyData.length === 0) return
    const endIdx = retailContribYoyData.length - 1
    const startIdx = Math.max(0, endIdx - 59)
    setBrushes(prev => ({
      ...prev,
      retailContribYoy: { start: startIdx, end: endIdx, period: '5Y' },
      retailContribMom: { start: startIdx, end: endIdx, period: '5Y' },
    }))
  }, [retailContribYoyData.length])

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

  // ── Growth rate chart data ─────────────────────────────────────────────────

  const rsafsRatesData = useMemo(() => {
    const data = allData['RSAFS'] ?? []
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

  const rsfsxmvRatesData = useMemo(() => {
    const data = allData['RSFSXMV'] ?? []
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

  // ── Growth rate visibility states ─────────────────────────────────────────

  const [visRSAFS,    setVisRSAFS]    = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))
  const [visRSFSXMV,  setVisRSFSXMV]  = useState(() => new Set(['yoy', 'ann6m', 'ann3m']))

  const toggleRSAFS    = mkToggle(setVisRSAFS)
  const toggleRSFSXMV  = mkToggle(setVisRSFSXMV)

  // ── Growth rate brush initialization ──────────────────────────────────────

  useEffect(() => {
    const data = allData['RSAFS'] ?? []
    if (!data.length) return
    const endIdx = data.length - 1
    const startIdx = Math.max(0, endIdx - 119)
    setBrushes(prev => ({
      ...prev,
      rsafsRates:   { start: startIdx, end: endIdx, period: '10Y' },
      rsfsxmvRates: { start: startIdx, end: endIdx, period: '10Y' },
    }))
  }, [allData])

  // ── Growth rate brush handlers ────────────────────────────────────────────

  const handleRateBrush = useCallback(
    (key: RatesChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: { period: '', start: startIndex ?? prev[key].start, end: endIndex ?? prev[key].end },
      }))
    },
    []
  )

  const handleRateQuickSelect = useCallback(
    (key: RatesChartKey, label: string, count: number, dataLen: number) => {
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
    <>
        <div className={styles.majorHeader}>Retail Sales Dashboard</div>
        <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
          U.S. Census Bureau &mdash; monthly, millions of dollars, seasonally adjusted
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading {FRED_SERIES_IDS.length} retail sales series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && Object.keys(allData).length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                Contribution Charts — YoY and MoM
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.twoColGrid}>
              {/* YoY Contribution */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Retail Sales &mdash; YoY Contribution</div>
                    <div className={styles.sectionSubtitle}>Weighted contribution to Total Retail Sales (RSAFS) YoY %&Delta;</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {RETAIL_CONTRIB_ITEMS.map(s => (
                      <button key={s.id} type="button"
                        className={`${styles.legendItem} ${visRetailYoy.has(s.id) ? '' : styles.legendItemOff}`}
                        onClick={() => toggleRetailYoy(s.id)}>
                        <span className={styles.legendSwatch} style={{ background: s.color }} />
                        {s.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${visRetailYoy.has('line') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRetailYoy('line')}>
                      <span className={styles.legendLine} style={{ background: '#fff' }} />
                      Total YoY
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <RetailContribChart
                    data={retailContribYoyData}
                    visibleStart={brushes.retailContribYoy.start}
                    visibleEnd={brushes.retailContribYoy.end}
                    activeSeries={visRetailYoy}
                    clipPrefix="rcyoy"
                    seriesItems={RETAIL_CONTRIB_ITEMS}
                    lineKey="line"
                    lineLabel="Total YoY"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={retailContribYoyData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <Brush dataKey="date"
                        startIndex={brushes.retailContribYoy.start}
                        endIndex={brushes.retailContribYoy.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('retailContribYoy', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.retailContribYoy.period}
                  onSelect={(l, c) => handleContribQuickSelect('retailContribYoy', l, c, retailContribYoyData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>

              {/* MoM Contribution */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Retail Sales &mdash; MoM Contribution</div>
                    <div className={styles.sectionSubtitle}>Weighted contribution to Total Retail Sales (RSAFS) MoM %&Delta;</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    {RETAIL_CONTRIB_ITEMS.map(s => (
                      <button key={s.id} type="button"
                        className={`${styles.legendItem} ${visRetailMom.has(s.id) ? '' : styles.legendItemOff}`}
                        onClick={() => toggleRetailMom(s.id)}>
                        <span className={styles.legendSwatch} style={{ background: s.color }} />
                        {s.label}
                      </button>
                    ))}
                    <button type="button"
                      className={`${styles.legendItem} ${visRetailMom.has('line') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRetailMom('line')}>
                      <span className={styles.legendLine} style={{ background: '#fff' }} />
                      Total MoM
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <RetailContribChart
                    data={retailContribMomData}
                    visibleStart={brushes.retailContribMom.start}
                    visibleEnd={brushes.retailContribMom.end}
                    activeSeries={visRetailMom}
                    clipPrefix="rcmom"
                    seriesItems={RETAIL_CONTRIB_ITEMS}
                    lineKey="line"
                    lineLabel="Total MoM"
                  />
                </div>
                <div className={styles.brushWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={retailContribMomData} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <Brush dataKey="date"
                        startIndex={brushes.retailContribMom.start}
                        endIndex={brushes.retailContribMom.end}
                        onChange={({ startIndex, endIndex }) => handleContribBrush('retailContribMom', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.retailContribMom.period}
                  onSelect={(l, c) => handleContribQuickSelect('retailContribMom', l, c, retailContribMomData.length)}
                  periods={QUICK_PERIODS_CONTRIB}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Retail Sales Growth Rates
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Retail Sales Growth Rates</div>

            <div className={styles.twoColGrid}>
              {/* Retail Sales */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Retail Sales</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSAFS.has('yoy') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSAFS('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSAFS.has('ann6m') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSAFS('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta; ann.
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSAFS.has('ann3m') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSAFS('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta; ann.
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rsafsRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann6m' ? '6mo\u0394 ann.' : '3mo\u0394 ann.'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visRSAFS.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="3moΔ ann."
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRSAFS.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="6moΔ ann."
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRSAFS.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.rsafsRates.start}
                        endIndex={brushes.rsafsRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('rsafsRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.rsafsRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('rsafsRates', l, c, rsafsRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>

              {/* Retail Sales ex Auto */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Retail Sales ex Auto</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSFSXMV.has('yoy') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSFSXMV('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />
                      YoY
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSFSXMV.has('ann6m') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSFSXMV('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.7 }} />
                      6mo&Delta; ann.
                    </button>
                    <button type="button"
                      className={`${styles.legendItem} ${visRSFSXMV.has('ann3m') ? '' : styles.legendItemOff}`}
                      onClick={() => toggleRSFSXMV('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#94a3b8', opacity: 0.5 }} />
                      3mo&Delta; ann.
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rsfsxmvRatesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                        tickFormatter={fmtAxisDate} minTickGap={60} />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                      <Tooltip {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          if (typeof v !== 'number') return ['-', '']
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann6m' ? '6mo\u0394 ann.' : '3mo\u0394 ann.'
                          return [fmtPctTooltip(v), lbl] as [string, string]
                        }} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      {visRSFSXMV.has('ann3m') && (
                        <Line type="monotone" dataKey="ann3m" name="3moΔ ann."
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 3" strokeOpacity={0.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRSFSXMV.has('ann6m') && (
                        <Line type="monotone" dataKey="ann6m" name="6moΔ ann."
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.7}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      {visRSFSXMV.has('yoy') && (
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#ec4899" strokeWidth={2.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                      )}
                      <Brush dataKey="date"
                        startIndex={brushes.rsfsxmvRates.start}
                        endIndex={brushes.rsfsxmvRates.end}
                        onChange={({ startIndex, endIndex }) => handleRateBrush('rsfsxmvRates', startIndex, endIndex)}
                        {...BRUSH_STYLE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.rsfsxmvRates.period}
                  onSelect={(l, c) => handleRateQuickSelect('rsfsxmvRates', l, c, rsfsxmvRatesData.length)}
                  periods={QUICK_PERIODS_M}
                />
              </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>Retail Sales Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Category</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                >
                  {RETAIL_HIERARCHY.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
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
                      <div className={styles.sectionSubtitle}>Millions of dollars, seasonally adjusted</div>
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
                          tickFormatter={fmtMillions} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtMillions(v) : '-', ''] as [string, string]} />
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
          </>
        )}
    </>
  )
}

export function RetailSalesDashboardPage() {
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
        <span className={styles.breadcrumbCurrent}>Retail Sales</span>
      </nav>
      <div className={styles.body}>
        <RetailSalesDashboardContent />
      </div>
    </div>
  )
}
