import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries } from '../lib/fred'
import type { FredObservation } from '../lib/fred'
import { fetchCensusTradeSeries } from '../lib/censusTrade'
import styles from './TradeDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }
type ChartKey   = 'expImp' | 'gvs' | 'goodsBalance' | 'goodsCategories' | 'goodsExports' | 'goodsImports' | 'svcBalance' | 'svcCategories' | 'svcExports' | 'svcImports'
type ContribRow = Record<string, string | number | null> & { date: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:   '#090e15',
    border:       '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:   'var(--font-mono)',
    fontSize:     11,
    padding:      '6px 10px',
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

const QUICK_PERIODS = [
  { label: '5Y',  count: 60   },
  { label: '10Y', count: 120  },
  { label: '20Y', count: 240  },
  { label: 'Max', count: Infinity },
] as const

const ALL_IDS = [
  'BOPTEXP', 'BOPTIMP', 'BOPGSTB', 'BOPGTB', 'BOPSTB',
  // Services totals
  'BOPSEXP', 'BOPSIMP',
  // Services categories — exports
  'ITXMARM133S', 'ITXTRAM133S', 'ITXTAEM133S', 'ITXINSM133S', 'ITXFISM133S',
  'ITXCIPM133S', 'ITXTCIM133S', 'ITXOBSM133S', 'ITXGGSM133S',
  // Services categories — imports
  'ITMMARM133S', 'ITMTRAM133S', 'ITMTAEM133S', 'ITMINSM133S', 'ITMFISM133S',
  'ITMCIPM133S', 'ITMTCIM133S', 'ITMOBSM133S', 'ITMGGSM133S',
] as const

// ── Formatters ────────────────────────────────────────────────────────────────

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

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
}

// ── Compute helpers ───────────────────────────────────────────────────────────

function trailingSum(data: WD[], window: number): WD[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null as unknown as number }
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) {
      if (data[j].value == null) return { date: d.date, value: null as unknown as number }
      sum += data[j].value
    }
    return { date: d.date, value: sum }
  })
}

function computeBalance(expData: WD[], impData: WD[]): WD[] {
  const impMap = new Map(impData.map(d => [d.date, d.value]))
  return expData.map(d => ({
    date:  d.date,
    value: impMap.has(d.date) ? d.value - impMap.get(d.date)! : null as unknown as number,
  }))
}

const GOODS_CAT_COLORS: Record<string, string> = {
  foods:    '#fcd34d',
  indus:    '#c4b5fd',
  capital:  '#86efac',
  autos:    '#fdba74',
  consumer: '#93c5fd',
  other:    '#fca5a5',
}

const GOODS_CAT_LABELS: Record<string, string> = {
  foods:    'Foods, Feeds & Bev.',
  indus:    'Industrial Supplies',
  capital:  'Capital Goods',
  autos:    'Autos & Parts',
  consumer: 'Consumer Goods',
  other:    'Other Goods',
}

const CENSUS_EXP_IDS = [
  'CENSUS_EXP_FOODS', 'CENSUS_EXP_INDUS', 'CENSUS_EXP_CAPITAL',
  'CENSUS_EXP_AUTOS', 'CENSUS_EXP_CONSUMER', 'CENSUS_EXP_OTHER',
] as const

const CENSUS_IMP_IDS = [
  'CENSUS_IMP_FOODS', 'CENSUS_IMP_INDUS', 'CENSUS_IMP_CAPITAL',
  'CENSUS_IMP_AUTOS', 'CENSUS_IMP_CONSUMER', 'CENSUS_IMP_OTHER',
] as const

const CENSUS_ALL_IDS = [
  'CENSUS_GOODS_EXP_TOTAL', 'CENSUS_GOODS_IMP_TOTAL',
  ...CENSUS_EXP_IDS, ...CENSUS_IMP_IDS,
] as const

const CAT_KEYS = ['foods', 'indus', 'capital', 'autos', 'consumer', 'other'] as const

const SVC_CATEGORIES = [
  { id: 'maint',     label: 'Maintenance & Repair',                     expId: 'ITXMARM133S', impId: 'ITMMARM133S', color: '#fcd34d' },
  { id: 'transport', label: 'Transport',                                 expId: 'ITXTRAM133S', impId: 'ITMTRAM133S', color: '#c4b5fd' },
  { id: 'travel',    label: 'Travel',                                    expId: 'ITXTAEM133S', impId: 'ITMTAEM133S', color: '#86efac' },
  { id: 'insurance', label: 'Insurance Services',                        expId: 'ITXINSM133S', impId: 'ITMINSM133S', color: '#f87171' },
  { id: 'financial', label: 'Financial Services',                        expId: 'ITXFISM133S', impId: 'ITMFISM133S', color: '#93c5fd' },
  { id: 'charges',   label: 'Charges for IP Use',                        expId: 'ITXCIPM133S', impId: 'ITMCIPM133S', color: '#fdba74' },
  { id: 'telecom',   label: 'Telecom, Computer, & Information Services', expId: 'ITXTCIM133S', impId: 'ITMTCIM133S', color: '#94a3b8' },
  { id: 'other',     label: 'Other Business Services',                   expId: 'ITXOBSM133S', impId: 'ITMOBSM133S', color: '#d1d5db' },
  { id: 'govt',      label: "Gov't Goods & Services",                    expId: 'ITXGGSM133S', impId: 'ITMGGSM133S', color: '#f0abfc' },
] as const

const SVC_CAT_IDS = SVC_CATEGORIES.map(c => c.id)

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 }

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

// ── SvcContribTooltip ────────────────────────────────────────────────────────

function SvcContribTooltip({
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
            ${Math.abs(item.value!).toFixed(1)}B
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
            ${Math.abs(lineVal).toFixed(1)}B
          </span>
        </div>
      )}
    </div>
  )
}

// ── SvcContribChart (custom SVG diverging stacked bar) ───────────────────────

function SvcContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'svccontrib',
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
              ${Math.abs(t).toFixed(0)}B
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
        <SvcContribTooltip
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

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function TradeDashboardContent() {
  // ── Data fetch ───────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [fredEntries, censusEntries] = await Promise.all([
          Promise.all(
            ALL_IDS.map(async (id) => {
              const obs = await fetchFredSeries(id)
              return [id, parseObs(obs)] as [string, WD[]]
            })
          ),
          Promise.all(
            CENSUS_ALL_IDS.map(async (id) => {
              const obs = await fetchCensusTradeSeries(id)
              return [id, parseObs(obs)] as [string, WD[]]
            })
          ),
        ])
        if (cancelled) return
        const merged = Object.fromEntries([...fredEntries, ...censusEntries])
        // DEBUG: verify Census data arrived
        console.log('[TradeDashboard] allData keys:', Object.keys(merged))
        for (const k of Object.keys(merged)) {
          if (k.startsWith('CENSUS_')) console.log(`  ${k}: ${merged[k].length} obs`)
        }
        setAllData(merged)
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

  // ── Chart 1: Exports vs Imports ─────────────────────────────────────────
  const [window1, setWindow1] = useState(3)

  const chart1Data = useMemo(() => {
    const exp = trailingSum((allData['BOPTEXP'] ?? []).map(d => ({ ...d, value: d.value / 1000 })), window1)
    const imp = trailingSum((allData['BOPTIMP'] ?? []).map(d => ({ ...d, value: d.value / 1000 })), window1)
    const bal = trailingSum((allData['BOPGSTB'] ?? []).map(d => ({ ...d, value: d.value / 1000 })), window1)
    const expMap = new Map(exp.map(d => [d.date, d.value]))
    const impMap = new Map(imp.map(d => [d.date, d.value]))
    return bal.map(d => ({
      date:    d.date,
      exports: expMap.get(d.date) ?? null,
      imports: impMap.get(d.date) != null ? -(impMap.get(d.date)!) : null,
      balance: d.value ?? null,
    }))
  }, [allData, window1])

  const [vis1, setVis1] = useState(() => new Set(['exports', 'imports', 'balance']))

  // ── Chart 2: Goods vs Services ──────────────────────────────────────────
  const [window2, setWindow2] = useState(3)

  const chart2Data = useMemo(() => {
    const goods    = trailingSum((allData['BOPGTB']  ?? []).map(d => ({ ...d, value: d.value / 1000 })), window2)
    const services = trailingSum((allData['BOPSTB']  ?? []).map(d => ({ ...d, value: d.value / 1000 })), window2)
    const total    = trailingSum((allData['BOPGSTB'] ?? []).map(d => ({ ...d, value: d.value / 1000 })), window2)
    const goodsMap = new Map(goods.map(d => [d.date, d.value]))
    const svcMap   = new Map(services.map(d => [d.date, d.value]))
    return total.map(d => ({
      date:     d.date,
      goods:    goodsMap.get(d.date) ?? null,
      services: svcMap.get(d.date)   ?? null,
      balance:  d.value ?? null,
    }))
  }, [allData, window2])

  const [vis2, setVis2] = useState(() => new Set(['goods', 'services', 'balance']))

  // ── Chart A: Goods Balance (Exports vs Imports) ───────────────────────
  const [windowGoodsBalance, setWindowGoodsBalance] = useState(3)

  const chartGoodsBalanceData = useMemo(() => {
    const toBn = (arr: WD[]) => arr.map(d => ({ ...d, value: d.value / 1000 }))
    const exp = trailingSum(toBn(allData['CENSUS_GOODS_EXP_TOTAL'] ?? []), windowGoodsBalance)
    const imp = trailingSum(toBn(allData['CENSUS_GOODS_IMP_TOTAL'] ?? []), windowGoodsBalance)
    const bal = trailingSum(toBn(computeBalance(
      allData['CENSUS_GOODS_EXP_TOTAL'] ?? [],
      allData['CENSUS_GOODS_IMP_TOTAL'] ?? []
    )), windowGoodsBalance)
    const expMap = new Map(exp.map(d => [d.date, d.value]))
    const balMap = new Map(bal.map(d => [d.date, d.value]))
    return imp.map(d => ({
      date:    d.date,
      exports: expMap.get(d.date) ?? null,
      imports: d.value != null ? -d.value : null,
      balance: balMap.get(d.date) ?? null,
    }))
  }, [allData, windowGoodsBalance])

  const [visGoodsBalance, setVisGoodsBalance] = useState(() => new Set(['exports', 'imports', 'balance']))

  // ── Chart B: Goods Balance by Category ────────────────────────────────
  const [windowGoodsCategories, setWindowGoodsCategories] = useState(3)

  const chartGoodsCategoriesData = useMemo(() => {
    const toBn = (arr: WD[]) => arr.map(d => ({ ...d, value: d.value / 1000 }))
    const bal = (expId: string, impId: string) =>
      trailingSum(toBn(computeBalance(allData[expId] ?? [], allData[impId] ?? [])), windowGoodsCategories)

    const foods    = bal('CENSUS_EXP_FOODS',    'CENSUS_IMP_FOODS')
    const indus    = bal('CENSUS_EXP_INDUS',    'CENSUS_IMP_INDUS')
    const capital  = bal('CENSUS_EXP_CAPITAL',  'CENSUS_IMP_CAPITAL')
    const autos    = bal('CENSUS_EXP_AUTOS',    'CENSUS_IMP_AUTOS')
    const consumer = bal('CENSUS_EXP_CONSUMER', 'CENSUS_IMP_CONSUMER')
    const other    = bal('CENSUS_EXP_OTHER',    'CENSUS_IMP_OTHER')
    const goodsBal = trailingSum(toBn(computeBalance(
      allData['CENSUS_GOODS_EXP_TOTAL'] ?? [],
      allData['CENSUS_GOODS_IMP_TOTAL'] ?? []
    )), windowGoodsCategories)

    const maps = [foods, indus, capital, autos, consumer, other, goodsBal].map(
      arr => new Map(arr.map(d => [d.date, d.value]))
    )
    const [foodsMap, indusMap, capitalMap, autosMap, consumerMap, otherMap, balMap] = maps

    return goodsBal.map(d => ({
      date:     d.date,
      foods:    foodsMap.get(d.date)    ?? null,
      indus:    indusMap.get(d.date)    ?? null,
      capital:  capitalMap.get(d.date)  ?? null,
      autos:    autosMap.get(d.date)    ?? null,
      consumer: consumerMap.get(d.date) ?? null,
      other:    otherMap.get(d.date)    ?? null,
      goodsBal: balMap.get(d.date)      ?? null,
    }))
  }, [allData, windowGoodsCategories])

  const [visGoodsCategories, setVisGoodsCategories] = useState(() => new Set([...CAT_KEYS, 'goodsBal']))

  // ── Chart C: Goods Exports by Category ────────────────────────────────
  const [windowGoodsExports, setWindowGoodsExports] = useState(3)

  const chartGoodsExportsData = useMemo(() => {
    const toBn = (arr: WD[]) => arr.map(d => ({ ...d, value: d.value / 1000 }))
    const cat = (id: string) => trailingSum(toBn(allData[id] ?? []), windowGoodsExports)
    const total = trailingSum(toBn(allData['CENSUS_GOODS_EXP_TOTAL'] ?? []), windowGoodsExports)

    const foods    = cat('CENSUS_EXP_FOODS')
    const indus    = cat('CENSUS_EXP_INDUS')
    const capital  = cat('CENSUS_EXP_CAPITAL')
    const autos    = cat('CENSUS_EXP_AUTOS')
    const consumer = cat('CENSUS_EXP_CONSUMER')
    const other    = cat('CENSUS_EXP_OTHER')

    const totalMap    = new Map(total.map(d => [d.date, d.value]))
    const foodsMap    = new Map(foods.map(d => [d.date, d.value]))
    const indusMap    = new Map(indus.map(d => [d.date, d.value]))
    const capitalMap  = new Map(capital.map(d => [d.date, d.value]))
    const autosMap    = new Map(autos.map(d => [d.date, d.value]))
    const consumerMap = new Map(consumer.map(d => [d.date, d.value]))
    const otherMap    = new Map(other.map(d => [d.date, d.value]))

    return total.map(d => ({
      date:     d.date,
      foods:    foodsMap.get(d.date)    ?? null,
      indus:    indusMap.get(d.date)    ?? null,
      capital:  capitalMap.get(d.date)  ?? null,
      autos:    autosMap.get(d.date)    ?? null,
      consumer: consumerMap.get(d.date) ?? null,
      other:    otherMap.get(d.date)    ?? null,
      total:    totalMap.get(d.date)    ?? null,
    }))
  }, [allData, windowGoodsExports])

  const [visGoodsExports, setVisGoodsExports] = useState(() => new Set([...CAT_KEYS, 'total']))

  // ── Chart D: Goods Imports by Category ────────────────────────────────
  const [windowGoodsImports, setWindowGoodsImports] = useState(3)

  const chartGoodsImportsData = useMemo(() => {
    const toBn = (arr: WD[]) => arr.map(d => ({ ...d, value: d.value / 1000 }))
    const cat = (id: string) => trailingSum(toBn(allData[id] ?? []), windowGoodsImports)
    const total = trailingSum(toBn(allData['CENSUS_GOODS_IMP_TOTAL'] ?? []), windowGoodsImports)

    const foods    = cat('CENSUS_IMP_FOODS')
    const indus    = cat('CENSUS_IMP_INDUS')
    const capital  = cat('CENSUS_IMP_CAPITAL')
    const autos    = cat('CENSUS_IMP_AUTOS')
    const consumer = cat('CENSUS_IMP_CONSUMER')
    const other    = cat('CENSUS_IMP_OTHER')

    const totalMap    = new Map(total.map(d => [d.date, d.value]))
    const foodsMap    = new Map(foods.map(d => [d.date, d.value]))
    const indusMap    = new Map(indus.map(d => [d.date, d.value]))
    const capitalMap  = new Map(capital.map(d => [d.date, d.value]))
    const autosMap    = new Map(autos.map(d => [d.date, d.value]))
    const consumerMap = new Map(consumer.map(d => [d.date, d.value]))
    const otherMap    = new Map(other.map(d => [d.date, d.value]))

    return total.map(d => ({
      date:     d.date,
      foods:    foodsMap.get(d.date)    ?? null,
      indus:    indusMap.get(d.date)    ?? null,
      capital:  capitalMap.get(d.date)  ?? null,
      autos:    autosMap.get(d.date)    ?? null,
      consumer: consumerMap.get(d.date) ?? null,
      other:    otherMap.get(d.date)    ?? null,
      total:    totalMap.get(d.date)    ?? null,
    }))
  }, [allData, windowGoodsImports])

  const [visGoodsImports, setVisGoodsImports] = useState(() => new Set([...CAT_KEYS, 'total']))

  // ── Services Chart A: Services Balance (Exports vs Imports) ───────────
  const [windowSvcBalance, setWindowSvcBalance] = useState(3)

  const toBn = useCallback((arr: WD[]) => arr.map(d => ({ ...d, value: d.value / 1000 })), [])

  const chartSvcBalanceData = useMemo(() => {
    const exp = trailingSum(toBn(allData['BOPSEXP'] ?? []), windowSvcBalance)
    const imp = trailingSum(toBn(allData['BOPSIMP'] ?? []), windowSvcBalance)
    const bal = trailingSum(toBn(allData['BOPSTB']  ?? []), windowSvcBalance)
    const expMap = new Map(exp.map(d => [d.date, d.value]))
    const balMap = new Map(bal.map(d => [d.date, d.value]))
    return imp.map(d => ({
      date:    d.date,
      exports: expMap.get(d.date) ?? null,
      imports: d.value != null ? -d.value : null,
      balance: balMap.get(d.date) ?? null,
    }))
  }, [allData, windowSvcBalance, toBn])

  const [visSvcBalance, setVisSvcBalance] = useState(() => new Set(['exports', 'imports', 'balance']))

  // ── Services Chart B: Services Balance by Category ────────────────────
  const [windowSvcCategories, setWindowSvcCategories] = useState(3)

  const chartSvcCategoriesData = useMemo((): ContribRow[] => {
    const balSeries = SVC_CATEGORIES.map(cat =>
      trailingSum(toBn(computeBalance(allData[cat.expId] ?? [], allData[cat.impId] ?? [])), windowSvcCategories)
    )
    const totalBal = trailingSum(toBn(allData['BOPSTB'] ?? []), windowSvcCategories)
    const maps = balSeries.map(s => new Map(s.map(d => [d.date, d.value])))
    const totalMap = new Map(totalBal.map(d => [d.date, d.value]))
    return totalBal.map(d => ({
      date:    d.date,
      ...Object.fromEntries(SVC_CATEGORIES.map((cat, i) => [cat.id, maps[i].get(d.date) ?? null])),
      balance: totalMap.get(d.date) ?? null,
    }))
  }, [allData, windowSvcCategories, toBn])

  const [visSvcCategories, setVisSvcCategories] = useState(() => new Set([...SVC_CAT_IDS, 'balance']))

  // ── Services Chart C: Services Exports by Category ────────────────────
  const [windowSvcExports, setWindowSvcExports] = useState(3)

  const chartSvcExportsData = useMemo(() => {
    const catSeries = SVC_CATEGORIES.map(cat =>
      trailingSum(toBn(allData[cat.expId] ?? []), windowSvcExports)
    )
    const total = trailingSum(toBn(allData['BOPSEXP'] ?? []), windowSvcExports)
    const maps = catSeries.map(s => new Map(s.map(d => [d.date, d.value])))
    const totalMap = new Map(total.map(d => [d.date, d.value]))
    return total.map(d => ({
      date:  d.date,
      ...Object.fromEntries(SVC_CATEGORIES.map((cat, i) => [cat.id, maps[i].get(d.date) ?? null])),
      total: totalMap.get(d.date) ?? null,
    }))
  }, [allData, windowSvcExports, toBn])

  const [visSvcExports, setVisSvcExports] = useState(() => new Set([...SVC_CAT_IDS, 'total']))

  // ── Services Chart D: Services Imports by Category ────────────────────
  const [windowSvcImports, setWindowSvcImports] = useState(3)

  const chartSvcImportsData = useMemo(() => {
    const catSeries = SVC_CATEGORIES.map(cat =>
      trailingSum(toBn(allData[cat.impId] ?? []), windowSvcImports)
    )
    const total = trailingSum(toBn(allData['BOPSIMP'] ?? []), windowSvcImports)
    const maps = catSeries.map(s => new Map(s.map(d => [d.date, d.value])))
    const totalMap = new Map(total.map(d => [d.date, d.value]))
    return total.map(d => ({
      date:  d.date,
      ...Object.fromEntries(SVC_CATEGORIES.map((cat, i) => [cat.id, maps[i].get(d.date) ?? null])),
      total: totalMap.get(d.date) ?? null,
    }))
  }, [allData, windowSvcImports, toBn])

  const [visSvcImports, setVisSvcImports] = useState(() => new Set([...SVC_CAT_IDS, 'total']))

  // ── Visibility toggle factory ──────────────────────────────────────────
  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggle1 = mkToggle(setVis1)
  const toggle2 = mkToggle(setVis2)
  const toggleGoodsBalance    = mkToggle(setVisGoodsBalance)
  const toggleGoodsCategories = mkToggle(setVisGoodsCategories)
  const toggleGoodsExports    = mkToggle(setVisGoodsExports)
  const toggleGoodsImports    = mkToggle(setVisGoodsImports)
  const toggleSvcBalance      = mkToggle(setVisSvcBalance)
  const toggleSvcCategories   = mkToggle(setVisSvcCategories)
  const toggleSvcExports      = mkToggle(setVisSvcExports)
  const toggleSvcImports      = mkToggle(setVisSvcImports)

  // ── Brush states ──────────────────────────────────────────────────────
  const MAX: BrushState = { start: 0, end: 0, period: 'Max' }
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    expImp:          { ...MAX },
    gvs:             { ...MAX },
    goodsBalance:    { ...MAX },
    goodsCategories: { ...MAX },
    goodsExports:    { ...MAX },
    goodsImports:    { ...MAX },
    svcBalance:      { ...MAX },
    svcCategories:   { ...MAX },
    svcExports:      { ...MAX },
    svcImports:      { ...MAX },
  })

  useEffect(() => {
    if (!Object.keys(allData).length) return
    setBrushes({
      expImp:          { start: 0, end: Math.max(0, chart1Data.length - 1),              period: 'Max' },
      gvs:             { start: 0, end: Math.max(0, chart2Data.length - 1),              period: 'Max' },
      goodsBalance:    { start: 0, end: Math.max(0, chartGoodsBalanceData.length - 1),   period: 'Max' },
      goodsCategories: { start: 0, end: Math.max(0, chartGoodsCategoriesData.length - 1),period: 'Max' },
      goodsExports:    { start: 0, end: Math.max(0, chartGoodsExportsData.length - 1),   period: 'Max' },
      goodsImports:    { start: 0, end: Math.max(0, chartGoodsImportsData.length - 1),   period: 'Max' },
      svcBalance:      { start: 0, end: Math.max(0, chartSvcBalanceData.length - 1),     period: 'Max' },
      svcCategories:   { start: 0, end: Math.max(0, chartSvcCategoriesData.length - 1),  period: 'Max' },
      svcExports:      { start: 0, end: Math.max(0, chartSvcExportsData.length - 1),     period: 'Max' },
      svcImports:      { start: 0, end: Math.max(0, chartSvcImportsData.length - 1),     period: 'Max' },
    })
  }, [allData, chart1Data.length, chart2Data.length, chartGoodsBalanceData.length, chartGoodsCategoriesData.length, chartGoodsExportsData.length, chartGoodsImportsData.length, chartSvcBalanceData.length, chartSvcCategoriesData.length, chartSvcExportsData.length, chartSvcImportsData.length])

  const handleBrush = useCallback(
    (key: ChartKey, startIndex?: number, endIndex?: number) => {
      if (startIndex == null || endIndex == null) return
      setBrushes(prev => ({
        ...prev,
        [key]: { start: startIndex, end: endIndex, period: '' },
      }))
    },
    []
  )

  const handleQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      setBrushes(prev => ({
        ...prev,
        [key]: { start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label },
      }))
    },
    []
  )

  // ── Y-domain helpers ───────────────────────────────────────────────────

  function autoDomain(
    data: Record<string, unknown>[],
    keys: string[],
    brush: BrushState,
  ): [number, number] | undefined {
    if (!data.length || brush.end < brush.start) return undefined
    const visible = data.slice(Math.max(0, brush.start), Math.min(data.length, brush.end + 1))
    if (!visible.length) return undefined
    const vals: number[] = []
    for (const d of visible) {
      for (const k of keys) {
        const v = d[k]
        if (typeof v === 'number' && isFinite(v)) vals.push(v)
      }
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.02
    return [min - pad, max + pad]
  }

  const yDomain1 = useMemo(() => autoDomain(chart1Data, ['exports', 'imports', 'balance'], brushes.expImp), [chart1Data, brushes.expImp])
  const yDomain2 = useMemo(() => autoDomain(chart2Data, ['goods', 'services', 'balance'], brushes.gvs),    [chart2Data, brushes.gvs])
  const yDomainGoodsBalance    = useMemo(() => autoDomain(chartGoodsBalanceData,    ['exports', 'imports', 'balance'], brushes.goodsBalance),    [chartGoodsBalanceData, brushes.goodsBalance])
  const yDomainGoodsCategories = useMemo(() => autoDomain(chartGoodsCategoriesData, [...CAT_KEYS, 'goodsBal'],        brushes.goodsCategories), [chartGoodsCategoriesData, brushes.goodsCategories])
  const yDomainGoodsExports    = useMemo(() => {
    const d = autoDomain(chartGoodsExportsData, [...CAT_KEYS, 'total'], brushes.goodsExports)
    return d ? [0, d[1]] as [number, number] : undefined
  }, [chartGoodsExportsData, brushes.goodsExports])
  const yDomainGoodsImports    = useMemo(() => {
    const d = autoDomain(chartGoodsImportsData, [...CAT_KEYS, 'total'], brushes.goodsImports)
    return d ? [0, d[1]] as [number, number] : undefined
  }, [chartGoodsImportsData, brushes.goodsImports])
  const yDomainSvcBalance     = useMemo(() => autoDomain(chartSvcBalanceData, ['exports', 'imports', 'balance'], brushes.svcBalance), [chartSvcBalanceData, brushes.svcBalance])
  const yDomainSvcExports     = useMemo(() => {
    const d = autoDomain(chartSvcExportsData, [...SVC_CAT_IDS, 'total'], brushes.svcExports)
    return d ? [0, d[1]] as [number, number] : undefined
  }, [chartSvcExportsData, brushes.svcExports])
  const yDomainSvcImports     = useMemo(() => {
    const d = autoDomain(chartSvcImportsData, [...SVC_CAT_IDS, 'total'], brushes.svcImports)
    return d ? [0, d[1]] as [number, number] : undefined
  }, [chartSvcImportsData, brushes.svcImports])

  // ════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <>
        <div className={styles.majorHeader}>US Trade Balances</div>

        {loading && (
          <div className={styles.statusBlock}>Loading trade data&hellip;</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && (<>

          {/* ── Chart 1: Exports vs Imports ───────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Trade Balances</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {window1}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input
                  type="number"
                  min={1}
                  value={window1}
                  onChange={e => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v >= 1) setWindow1(v)
                  }}
                  className={styles.windowInput}
                />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <button type="button"
                  className={`${styles.legendItem} ${!vis1.has('exports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle1('exports')}>
                  <span className={styles.legendSwatch} style={{ background: '#fca5a5' }} />
                  Exports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!vis1.has('imports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle1('imports')}>
                  <span className={styles.legendSwatch} style={{ background: '#86efac' }} />
                  Imports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!vis1.has('balance') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle1('balance')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Overall Trade Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart1Data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomain1} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + Math.abs(v).toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label =
                        name === 'exports' ? 'Exports' :
                        name === 'imports' ? 'Imports' :
                        name === 'balance' ? 'Balance' : ''
                      const display = name === 'imports'
                        ? `$${Math.abs(v).toFixed(1)}B`
                        : `$${v.toFixed(1)}B`
                      return [display, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                  {vis1.has('exports') && (
                    <Area type="monotone" dataKey="exports" name="exports"
                      fill="#fca5a5" fillOpacity={0.7} stroke="#fca5a5" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {vis1.has('imports') && (
                    <Area type="monotone" dataKey="imports" name="imports"
                      fill="#86efac" fillOpacity={0.7} stroke="#86efac" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {vis1.has('balance') && (
                    <Line type="monotone" dataKey="balance" name="balance"
                      stroke="#ffffff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.expImp.start} endIndex={brushes.expImp.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('expImp', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.expImp.period}
              onSelect={(l, c) => handleQuickSelect('expImp', l, c, chart1Data.length)} />
          </div>

          {/* ── Chart 2: Goods vs Services ────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Trade Balances</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {window2}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input
                  type="number"
                  min={1}
                  value={window2}
                  onChange={e => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v >= 1) setWindow2(v)
                  }}
                  className={styles.windowInput}
                />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <button type="button"
                  className={`${styles.legendItem} ${!vis2.has('goods') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle2('goods')}>
                  <span className={styles.legendSwatch} style={{ background: '#93c5fd' }} />
                  Goods Balance
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!vis2.has('services') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle2('services')}>
                  <span className={styles.legendSwatch} style={{ background: '#86efac' }} />
                  Services Balance
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!vis2.has('balance') ? styles.legendItemOff : ''}`}
                  onClick={() => toggle2('balance')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Overall Trade Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart2Data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomain2} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label =
                        name === 'goods'    ? 'Goods' :
                        name === 'services' ? 'Services' :
                        name === 'balance'  ? 'Balance' : ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
                  {vis2.has('goods') && (
                    <Area type="monotone" dataKey="goods" name="goods"
                      fill="#93c5fd" fillOpacity={0.6} stroke="#93c5fd" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {vis2.has('services') && (
                    <Area type="monotone" dataKey="services" name="services"
                      fill="#86efac" fillOpacity={0.6} stroke="#86efac" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {vis2.has('balance') && (
                    <Line type="monotone" dataKey="balance" name="balance"
                      stroke="#ffffff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.gvs.start} endIndex={brushes.gvs.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('gvs', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.gvs.period}
              onSelect={(l, c) => handleQuickSelect('gvs', l, c, chart2Data.length)} />
          </div>

          {/* ═══ Goods Balance ═══ */}
          <div className={styles.majorHeader}>Goods Balance</div>

          {/* ── Chart A: US Goods Balance (Exports vs Imports) ──────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Goods Balance</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowGoodsBalance}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowGoodsBalance}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowGoodsBalance(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsBalance.has('exports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsBalance('exports')}>
                  <span className={styles.legendSwatch} style={{ background: '#fca5a5' }} />
                  Exports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsBalance.has('imports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsBalance('imports')}>
                  <span className={styles.legendSwatch} style={{ background: '#86efac' }} />
                  Imports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsBalance.has('balance') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsBalance('balance')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Goods Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartGoodsBalanceData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainGoodsBalance} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + Math.abs(v).toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label = name === 'exports' ? 'Exports' : name === 'imports' ? 'Imports' : name === 'balance' ? 'Goods Balance' : ''
                      const display = name === 'imports' ? `$${Math.abs(v).toFixed(1)}B` : `$${v.toFixed(1)}B`
                      return [display, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                  {visGoodsBalance.has('exports') && (
                    <Area type="monotone" dataKey="exports" name="exports"
                      fill="#fca5a5" fillOpacity={0.7} stroke="#fca5a5" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {visGoodsBalance.has('imports') && (
                    <Area type="monotone" dataKey="imports" name="imports"
                      fill="#86efac" fillOpacity={0.7} stroke="#86efac" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {visGoodsBalance.has('balance') && (
                    <Line type="monotone" dataKey="balance" name="balance"
                      stroke="#ffffff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.goodsBalance.start} endIndex={brushes.goodsBalance.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('goodsBalance', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.goodsBalance.period}
              onSelect={(l, c) => handleQuickSelect('goodsBalance', l, c, chartGoodsBalanceData.length)} />
          </div>

          {/* ── Chart B: US Goods Balance by Category ──────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Goods Balance</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowGoodsCategories}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowGoodsCategories}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowGoodsCategories(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {CAT_KEYS.map(k => (
                  <button key={k} type="button"
                    className={`${styles.legendItem} ${!visGoodsCategories.has(k) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleGoodsCategories(k)}>
                    <span className={styles.legendSwatch} style={{ background: GOODS_CAT_COLORS[k] }} />
                    {GOODS_CAT_LABELS[k]}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsCategories.has('goodsBal') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsCategories('goodsBal')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Goods Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartGoodsCategoriesData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainGoodsCategories} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label = typeof name === 'string' && name === 'goodsBal' ? 'Goods Balance' : GOODS_CAT_LABELS[name as string] ?? ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
                  {CAT_KEYS.map(k => visGoodsCategories.has(k) ? (
                    <Area key={k} type="monotone" dataKey={k} name={k} stackId="cats"
                      fill={GOODS_CAT_COLORS[k]} fillOpacity={0.7} stroke={GOODS_CAT_COLORS[k]} strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  ) : null)}
                  {visGoodsCategories.has('goodsBal') && (
                    <Line type="monotone" dataKey="goodsBal" name="goodsBal"
                      stroke="#ffffff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.goodsCategories.start} endIndex={brushes.goodsCategories.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('goodsCategories', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.goodsCategories.period}
              onSelect={(l, c) => handleQuickSelect('goodsCategories', l, c, chartGoodsCategoriesData.length)} />
          </div>

          {/* ── Chart C: US Goods Exports by Category ──────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Goods Exports</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowGoodsExports}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowGoodsExports}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowGoodsExports(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {CAT_KEYS.map(k => (
                  <button key={k} type="button"
                    className={`${styles.legendItem} ${!visGoodsExports.has(k) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleGoodsExports(k)}>
                    <span className={styles.legendSwatch} style={{ background: GOODS_CAT_COLORS[k] }} />
                    {GOODS_CAT_LABELS[k]}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsExports.has('total') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsExports('total')}>
                  <span className={styles.legendLine} style={{ background: '#1f2937' }} />
                  Goods Exports
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartGoodsExportsData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainGoodsExports} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label = typeof name === 'string' && name === 'total' ? 'Goods Exports' : GOODS_CAT_LABELS[name as string] ?? ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  {CAT_KEYS.map(k => visGoodsExports.has(k) ? (
                    <Area key={k} type="monotone" dataKey={k} name={k} stackId="exp"
                      fill={GOODS_CAT_COLORS[k]} fillOpacity={0.7} stroke={GOODS_CAT_COLORS[k]} strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  ) : null)}
                  {visGoodsExports.has('total') && (
                    <Line type="monotone" dataKey="total" name="total"
                      stroke="#1f2937" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.goodsExports.start} endIndex={brushes.goodsExports.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('goodsExports', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.goodsExports.period}
              onSelect={(l, c) => handleQuickSelect('goodsExports', l, c, chartGoodsExportsData.length)} />
          </div>

          {/* ── Chart D: US Goods Imports by Category ──────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Goods Imports</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowGoodsImports}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowGoodsImports}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowGoodsImports(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {CAT_KEYS.map(k => (
                  <button key={k} type="button"
                    className={`${styles.legendItem} ${!visGoodsImports.has(k) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleGoodsImports(k)}>
                    <span className={styles.legendSwatch} style={{ background: GOODS_CAT_COLORS[k] }} />
                    {GOODS_CAT_LABELS[k]}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visGoodsImports.has('total') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleGoodsImports('total')}>
                  <span className={styles.legendLine} style={{ background: '#1f2937' }} />
                  Goods Imports
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartGoodsImportsData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainGoodsImports} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label = typeof name === 'string' && name === 'total' ? 'Goods Imports' : GOODS_CAT_LABELS[name as string] ?? ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  {CAT_KEYS.map(k => visGoodsImports.has(k) ? (
                    <Area key={k} type="monotone" dataKey={k} name={k} stackId="imp"
                      fill={GOODS_CAT_COLORS[k]} fillOpacity={0.7} stroke={GOODS_CAT_COLORS[k]} strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  ) : null)}
                  {visGoodsImports.has('total') && (
                    <Line type="monotone" dataKey="total" name="total"
                      stroke="#1f2937" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.goodsImports.start} endIndex={brushes.goodsImports.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('goodsImports', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.goodsImports.period}
              onSelect={(l, c) => handleQuickSelect('goodsImports', l, c, chartGoodsImportsData.length)} />
          </div>

          {/* ═══ Services Balance ═══ */}
          <div className={styles.majorHeader}>Services Balance</div>

          {/* ── Svc Chart A: US Services Balance (Exports vs Imports) ── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Services Balance</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowSvcBalance}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowSvcBalance}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowSvcBalance(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcBalance.has('exports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcBalance('exports')}>
                  <span className={styles.legendSwatch} style={{ background: '#fca5a5' }} />
                  Exports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcBalance.has('imports') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcBalance('imports')}>
                  <span className={styles.legendSwatch} style={{ background: '#86efac' }} />
                  Imports
                </button>
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcBalance.has('balance') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcBalance('balance')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Services Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartSvcBalanceData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainSvcBalance} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + Math.abs(v).toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label = name === 'exports' ? 'Exports' : name === 'imports' ? 'Imports' : name === 'balance' ? 'Services Balance' : ''
                      const display = name === 'imports' ? `$${Math.abs(v).toFixed(1)}B` : `$${v.toFixed(1)}B`
                      return [display, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                  {visSvcBalance.has('exports') && (
                    <Area type="monotone" dataKey="exports" name="exports"
                      fill="#fca5a5" fillOpacity={0.7} stroke="#fca5a5" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {visSvcBalance.has('imports') && (
                    <Area type="monotone" dataKey="imports" name="imports"
                      fill="#86efac" fillOpacity={0.7} stroke="#86efac" strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  )}
                  {visSvcBalance.has('balance') && (
                    <Line type="monotone" dataKey="balance" name="balance"
                      stroke="#ffffff" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.svcBalance.start} endIndex={brushes.svcBalance.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('svcBalance', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.svcBalance.period}
              onSelect={(l, c) => handleQuickSelect('svcBalance', l, c, chartSvcBalanceData.length)} />
          </div>

          {/* ── Svc Chart B: US Services Balance by Category ───────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Services Balance</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowSvcCategories}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowSvcCategories}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowSvcCategories(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {SVC_CATEGORIES.map(cat => (
                  <button key={cat.id} type="button"
                    className={`${styles.legendItem} ${!visSvcCategories.has(cat.id) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleSvcCategories(cat.id)}>
                    <span className={styles.legendSwatch} style={{ background: cat.color }} />
                    {cat.label}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcCategories.has('balance') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcCategories('balance')}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  Services Balance
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <SvcContribChart
                data={chartSvcCategoriesData}
                visibleStart={brushes.svcCategories.start}
                visibleEnd={brushes.svcCategories.end}
                activeSeries={visSvcCategories}
                seriesItems={SVC_CATEGORIES}
                lineKey="balance"
                lineLabel="Services Balance"
                clipPrefix="svccat"
              />
            </div>

            <QuickSelectRow period={brushes.svcCategories.period}
              onSelect={(l, c) => handleQuickSelect('svcCategories', l, c, chartSvcCategoriesData.length)} />
          </div>

          {/* ── Svc Chart C: US Services Exports by Category ───────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Services Exports</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowSvcExports}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowSvcExports}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowSvcExports(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {SVC_CATEGORIES.map(cat => (
                  <button key={cat.id} type="button"
                    className={`${styles.legendItem} ${!visSvcExports.has(cat.id) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleSvcExports(cat.id)}>
                    <span className={styles.legendSwatch} style={{ background: cat.color }} />
                    {cat.label}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcExports.has('total') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcExports('total')}>
                  <span className={styles.legendLine} style={{ background: '#1f2937' }} />
                  Services Exports
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartSvcExportsData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainSvcExports} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const cat = SVC_CATEGORIES.find(c => c.id === name)
                      const label = typeof name === 'string' && name === 'total' ? 'Services Exports' : cat?.label ?? ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  {SVC_CATEGORIES.map(cat => visSvcExports.has(cat.id) ? (
                    <Area key={cat.id} type="monotone" dataKey={cat.id} name={cat.id} stackId="svcexp"
                      fill={cat.color} fillOpacity={0.7} stroke={cat.color} strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  ) : null)}
                  {visSvcExports.has('total') && (
                    <Line type="monotone" dataKey="total" name="total"
                      stroke="#1f2937" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.svcExports.start} endIndex={brushes.svcExports.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('svcExports', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.svcExports.period}
              onSelect={(l, c) => handleQuickSelect('svcExports', l, c, chartSvcExportsData.length)} />
          </div>

          {/* ── Svc Chart D: US Services Imports by Category ───────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Services Imports</div>
                <div className={styles.sectionSubtitle}>
                  $s, billions &ndash; Trailing {windowSvcImports}mo Sum
                </div>
              </div>
              <div className={styles.windowControl}>
                <label>Trailing Window:</label>
                <input type="number" min={1} value={windowSvcImports}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setWindowSvcImports(v) }}
                  className={styles.windowInput} />
                <span>months</span>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {SVC_CATEGORIES.map(cat => (
                  <button key={cat.id} type="button"
                    className={`${styles.legendItem} ${!visSvcImports.has(cat.id) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleSvcImports(cat.id)}>
                    <span className={styles.legendSwatch} style={{ background: cat.color }} />
                    {cat.label}
                  </button>
                ))}
                <button type="button"
                  className={`${styles.legendItem} ${!visSvcImports.has('total') ? styles.legendItemOff : ''}`}
                  onClick={() => toggleSvcImports('total')}>
                  <span className={styles.legendLine} style={{ background: '#1f2937' }} />
                  Services Imports
                </button>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartSvcImportsData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainSvcImports} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const cat = SVC_CATEGORIES.find(c => c.id === name)
                      const label = typeof name === 'string' && name === 'total' ? 'Services Imports' : cat?.label ?? ''
                      return [`$${v.toFixed(1)}B`, label] as [string, string]
                    }} />
                  {SVC_CATEGORIES.map(cat => visSvcImports.has(cat.id) ? (
                    <Area key={cat.id} type="monotone" dataKey={cat.id} name={cat.id} stackId="svcimp"
                      fill={cat.color} fillOpacity={0.7} stroke={cat.color} strokeWidth={1}
                      isAnimationActive={false} connectNulls />
                  ) : null)}
                  {visSvcImports.has('total') && (
                    <Line type="monotone" dataKey="total" name="total"
                      stroke="#1f2937" strokeWidth={1.5} dot={false}
                      isAnimationActive={false} connectNulls />
                  )}
                  <Brush dataKey="date" startIndex={brushes.svcImports.start} endIndex={brushes.svcImports.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('svcImports', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brushes.svcImports.period}
              onSelect={(l, c) => handleQuickSelect('svcImports', l, c, chartSvcImportsData.length)} />
          </div>
        </>)}
    </>
  )
}

export function TradeDashboardPage() {
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
        <span className={styles.breadcrumbCurrent}>Trade</span>
      </nav>
      <main className={styles.body}>
        <TradeDashboardContent />
      </main>
    </div>
  )
}
