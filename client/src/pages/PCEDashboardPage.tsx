import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
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
import { fetchBEASeries } from '../lib/bea'
import type { FredObservation } from '../lib/fred'
import { PCE_ITEMS } from '../data/pceSeriesConfig'
import styles from './PCEDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }
type NullableRow = { date: string; value: number | null }
type ChartKey   = 'contribYoy' | 'contribMom' | 'distV1' | 'distV2' | 'corePce' | 'headlinePce' | 'index' | 'regime' | 'yoyDelta' | 'mom' | 'annMom'

type PceContribRow = {
  date: string
  services: number | null
  durables: number | null
  nondurables: number | null
  nonprofits: number | null
  pce: number | null
}

type RateRow = { date: string; yoy: number | null; ann3m: number | null; ann6m: number | null }
type DistRow = { date: string; [bucket: string]: number | string }

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

// ── Contribution decomposition constants ─────────────────────────────────────

const PCE_CONTRIB_SERIES = [
  { key: 'pce',         lineNumber: 1  },
  { key: 'durables',    lineNumber: 3  },
  { key: 'nondurables', lineNumber: 8  },
  { key: 'services',    lineNumber: 13 },
  { key: 'nonprofits',  lineNumber: 22 },
  { key: 'corePce',     lineNumber: 25 },
] as const

const PCE_CONTRIB_WEIGHTS: Record<string, number> = {
  services:    0.668553853,
  durables:    0.11699739,
  nondurables: 0.214448757,
  nonprofits:  0.029634604,
}

const PCE_CONTRIB_ITEMS = [
  { id: 'services',    label: 'Services',    color: '#6366f1' },
  { id: 'durables',    label: 'Durables',    color: '#84cc16' },
  { id: 'nondurables', label: 'Nondurables', color: '#a78bfa' },
  { id: 'nonprofits',  label: 'Nonprofits',  color: '#f87171' },
] as const

// ── Distribution constants ──────────────────────────────────────────────────

const PCE_DIST_LINES = [4, 5, 6, 7, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21, 22] as const

const DIST_V1_BUCKETS = [
  { key: 'ltNeg10',  label: '< -10%',      color: '#1e3a5f', test: (v: number) => v < -10 },
  { key: 'neg10to5', label: '-10% to -5%', color: '#3b82f6', test: (v: number) => v >= -10 && v < -5 },
  { key: 'neg5to0',  label: '-5% to 0%',   color: '#93c5fd', test: (v: number) => v >= -5 && v < 0 },
  { key: 'pos0to5',  label: '0% to 5%',    color: '#9ca3af', test: (v: number) => v >= 0 && v < 5 },
  { key: 'pos5to10', label: '5% to 10%',   color: '#fca5a5', test: (v: number) => v >= 5 && v < 10 },
  { key: 'gt10',     label: '> 10%',       color: '#ef4444', test: (v: number) => v >= 10 },
] as const

const DIST_V2_BUCKETS = [
  { key: 'ltNeg2',  label: '< -2%',     color: '#1e3a5f', test: (v: number) => v < -2 },
  { key: 'neg2to0', label: '-2% to 0%', color: '#60a5fa', test: (v: number) => v >= -2 && v < 0 },
  { key: 'pos0to2', label: '0% to 2%',  color: '#d1d5db', test: (v: number) => v >= 0 && v < 2 },
  { key: 'pos2to4', label: '2% to 4%',  color: '#9ca3af', test: (v: number) => v >= 2 && v < 4 },
  { key: 'pos4to6', label: '4% to 6%',  color: '#fca5a5', test: (v: number) => v >= 4 && v < 6 },
  { key: 'gt6',     label: '> 6%',      color: '#ef4444', test: (v: number) => v >= 6 },
] as const

// ── Custom SVG chart margins ─────────────────────────────────────────────────

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

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

function computeRates(data: WD[]): RateRow[] {
  const map = new Map(data.map(d => [d.date, d.value]))
  return data.map(d => {
    const [y, m] = d.date.split('-').map(Number)
    const mk = (dy: number, dm: number) => {
      let ty = y + dy, tm = m + dm
      while (tm < 1) { ty--; tm += 12 }
      while (tm > 12) { ty++; tm -= 12 }
      return `${ty}-${String(tm).padStart(2, '0')}-01`
    }
    const p12 = map.get(mk(-1, 0))
    const p3  = map.get(mk(0, -3))
    const p6  = map.get(mk(0, -6))
    const v   = d.value
    return {
      date: d.date,
      yoy:   (p12 != null && p12 !== 0) ? (v / p12 - 1) * 100 : null,
      ann3m: (p3  != null && p3  !== 0) ? (Math.pow(v / p3, 4) - 1) * 100 : null,
      ann6m: (p6  != null && p6  !== 0) ? (Math.pow(v / p6, 2) - 1) * 100 : null,
    }
  })
}

function computeDistribution(
  allSeriesData: WD[][],
  buckets: readonly { key: string; test: (v: number) => boolean }[],
): DistRow[] {
  const yoyMaps: Map<string, number>[] = allSeriesData.map(data => {
    const indexMap = new Map(data.map(d => [d.date, d.value]))
    const yoyMap = new Map<string, number>()
    for (const d of data) {
      const [y, m] = d.date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const pv = indexMap.get(prior)
      if (pv != null && pv !== 0) {
        yoyMap.set(d.date, (d.value / pv - 1) * 100)
      }
    }
    return yoyMap
  })

  const dateSet = new Set<string>()
  for (const m of yoyMaps) for (const d of m.keys()) dateSet.add(d)
  const dates = [...dateSet].sort()

  return dates.map(date => {
    const values: number[] = []
    for (const m of yoyMaps) {
      const v = m.get(date)
      if (v != null) values.push(v)
    }
    const total = values.length
    const row: DistRow = { date }
    if (total === 0) {
      for (const b of buckets) row[b.key] = 0
      return row
    }
    for (const b of buckets) {
      row[b.key] = (values.filter(b.test).length / total) * 100
    }
    return row
  })
}

// ── MoM Contribution custom SVG chart ────────────────────────────────────────

function ContribTooltip({
  row,
  activeItems,
  showPce,
  totalLabel,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:         PceContribRow
  activeItems: readonly { id: string; label: string; color: string }[]
  showPce:     boolean
  totalLabel:  string
  mouseX:      number
  mouseY:      number
  isRightHalf: boolean
}) {
  const items = [...activeItems]
    .map(s => ({ ...s, value: row[s.id as keyof PceContribRow] as number | null }))
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
            {item.value! >= 0 ? '+' : ''}{item.value!.toFixed(3)}%
          </span>
        </div>
      ))}
      {showPce && row.pce != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>{totalLabel}</span>
          <span style={{ color: row.pce >= 0 ? '#4ade80' : '#f87171' }}>
            {row.pce >= 0 ? '+' : ''}{row.pce.toFixed(3)}%
          </span>
        </div>
      )}
    </div>
  )
}

function ContribChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
  lineWidth = 1.5,
  clipPrefix = 'pcecontrib',
  totalLabel = 'PCEPI MoM',
}: {
  data:         PceContribRow[]
  visibleStart: number
  visibleEnd:   number
  activeSeries: Set<string>
  lineWidth?:   number
  clipPrefix?:  string
  totalLabel?:  string
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
    () => PCE_CONTRIB_ITEMS.filter(s => activeSeries.has(s.id)),
    [activeSeries]
  )
  const showPce = activeSeries.has('pce')

  const yDomain = useMemo((): [number, number] => {
    let min = 0, max = 0
    for (const row of visible) {
      let posStack = 0, negStack = 0
      for (const s of activeItems) {
        const v = row[s.id as keyof PceContribRow] as number | null
        if (v == null || v === 0) continue
        if (v > 0) posStack += v; else negStack += v
      }
      if (showPce && row.pce != null) {
        posStack = Math.max(posStack, row.pce)
        negStack = Math.min(negStack, row.pce)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showPce])

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
        const value = row[s.id as keyof PceContribRow] as number | null
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

    const pts = showPce
      ? cols.filter(c => c.row.pce != null).map(c => ({ cx: c.cx, cy: toY(c.row.pce!) }))
      : []

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, showPce, colW, yMin, yRange, innerH])

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
                fillOpacity={r.id === 'nonprofits' ? 0.7 : 0.8}
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
              {t.toFixed(2)}%
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
        <ContribTooltip
          row={hovCol.row}
          activeItems={activeItems}
          showPce={showPce}
          totalLabel={totalLabel}
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

// ── Main Component ──────────────────────────────────────────────────────────

export function PCEDashboardContent() {
  // ── Core explorer state ───────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [seriesData, setSeriesData] = useState<WD[]>([])
  const [selectedLine, setSelectedLine] = useState(1)

  // ── Explorer chart controls ───────────────────────────────────────────────
  const [regimeMa, setRegimeMa]         = useState(12)
  const [deltaPeriod, setDeltaPeriod]    = useState(1)
  const [deltaMaPeriod, setDeltaMaPeriod] = useState(12)
  const [momMa1, setMomMa1]             = useState(3)
  const [momMa2, setMomMa2]             = useState(6)

  // ── Explorer legend visibility sets ───────────────────────────────────────
  const [visYoyDelta, setVisYoyDelta] = useState<Set<string>>(() => new Set(['delta', 'ma']))
  const [visMom, setVisMom]           = useState<Set<string>>(() => new Set(['mom', 'ma1', 'ma2']))
  const [visAnnMom, setVisAnnMom]     = useState<Set<string>>(() => new Set(['value']))
  const [visSeqYears, setVisSeqYears] = useState<Set<string>>(() => new Set<string>())

  // ── Contribution decomposition state ──────────────────────────────────────
  const [contribRaw, setContribRaw]       = useState<Record<string, WD[]> | null>(null)
  const [contribLoading, setContribLoading] = useState(true)
  const [contribError, setContribError]     = useState<string | null>(null)
  const [visContribYoy, setVisContribYoy] = useState<Set<string>>(() => new Set(['services', 'durables', 'nondurables', 'nonprofits', 'pce']))
  const [visContribMom, setVisContribMom] = useState<Set<string>>(() => new Set(['services', 'durables', 'nondurables', 'nonprofits', 'pce']))

  // ── Distribution state ────────────────────────────────────────────────────
  const [distSeriesData, setDistSeriesData] = useState<WD[][] | null>(null)
  const [distLoading, setDistLoading]       = useState(true)
  const [distProgress, setDistProgress]     = useState(0)
  const [distError, setDistError]           = useState<string | null>(null)
  const [visDistV1, setVisDistV1] = useState<Set<string>>(() => new Set(DIST_V1_BUCKETS.map(b => b.key)))
  const [visDistV2, setVisDistV2] = useState<Set<string>>(() => new Set(DIST_V2_BUCKETS.map(b => b.key)))

  // ── Core vs Headline state ────────────────────────────────────────────────
  const [visCorePce, setVisCorePce]         = useState<Set<string>>(() => new Set(['yoy', 'ann3m', 'ann6m']))
  const [visHeadlinePce, setVisHeadlinePce] = useState<Set<string>>(() => new Set(['yoy', 'ann3m', 'ann6m']))

  // ── Brush states ──────────────────────────────────────────────────────────
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    contribYoy:  { start: 0, end: 0, period: '' },
    contribMom:  { start: 0, end: 0, period: '' },
    distV1:      { start: 0, end: 0, period: 'All' },
    distV2:      { start: 0, end: 0, period: 'All' },
    corePce:     { start: 0, end: 0, period: '' },
    headlinePce: { start: 0, end: 0, period: '' },
    index:       { start: 0, end: 0, period: 'All' },
    regime:      { start: 0, end: 0, period: 'All' },
    yoyDelta:    { start: 0, end: 0, period: 'All' },
    mom:         { start: 0, end: 0, period: 'All' },
    annMom:      { start: 0, end: 0, period: 'All' },
  })

  // ── Selected series label ─────────────────────────────────────────────────
  const selectedLabel = useMemo(
    () => PCE_ITEMS.find(s => s.lineNumber === selectedLine)?.label ?? `Line ${selectedLine}`,
    [selectedLine]
  )

  // ── Explorer data fetch ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchBEASeries(selectedLine)
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
  }, [selectedLine])

  // ── Contribution series fetch (independent of explorer) ───────────────────
  useEffect(() => {
    let cancelled = false
    Promise.all(
      PCE_CONTRIB_SERIES.map(async s => {
        const raw = await fetchBEASeries(s.lineNumber)
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

  // ── Distribution series fetch (batched, independent of explorer) ──────────
  useEffect(() => {
    let cancelled = false
    const BATCH_SIZE = 4
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    ;(async () => {
      const allData: WD[][] = []
      for (let i = 0; i < PCE_DIST_LINES.length; i += BATCH_SIZE) {
        if (cancelled) return
        const batch = PCE_DIST_LINES.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(async lineNum => parseObs(await fetchBEASeries(lineNum)))
        )
        allData.push(...results)
        if (!cancelled) setDistProgress(allData.length)
        if (i + BATCH_SIZE < PCE_DIST_LINES.length) await delay(300)
      }
      if (cancelled) return
      setDistSeriesData(allData)
      setDistLoading(false)
    })().catch(err => {
      if (cancelled) return
      setDistError(err instanceof Error ? err.message : 'Failed to load distribution data')
      setDistLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // ── Explorer computed chart data ──────────────────────────────────────────

  const yoyData      = useMemo(() => computeYoY(seriesData),          [seriesData])
  const momData      = useMemo(() => computeMoMPct(seriesData),       [seriesData])
  const momMa1Data   = useMemo(() => computeMA(momData, momMa1),     [momData, momMa1])
  const momMa2Data   = useMemo(() => computeMA(momData, momMa2),     [momData, momMa2])
  const annMomData   = useMemo(() => computeAnnualizedMoM(seriesData),[seriesData])
  const regimeData   = useMemo(() => computeRegimes(yoyData, regimeMa), [yoyData, regimeMa])

  const yoyDeltaData = useMemo(() => {
    return yoyData.map((d, i) => {
      if (i < deltaPeriod) return { date: d.date, delta: null as number | null, ma: null as number | null }
      const prev = yoyData[i - deltaPeriod]
      const delta = (d.value != null && prev?.value != null) ? d.value - prev.value : null
      return { date: d.date, delta, ma: null as number | null }
    })
  }, [yoyData, deltaPeriod])

  const yoyDeltaWithMa = useMemo(() => {
    const deltas: NullableRow[] = yoyDeltaData.map(d => ({ date: d.date, value: d.delta }))
    const ma = computeMA(deltas, deltaMaPeriod)
    return yoyDeltaData.map((d, i) => ({ ...d, ma: ma[i]?.value ?? null }))
  }, [yoyDeltaData, deltaMaPeriod])

  const momChartData = useMemo(() =>
    momData.map((d, i) => ({
      date: d.date,
      mom:  d.value ?? null,
      ma1:  momMa1Data[i]?.value ?? null,
      ma2:  momMa2Data[i]?.value ?? null,
    })),
    [momData, momMa1Data, momMa2Data]
  )

  const { chartData: seqData, years: seqYears } = useMemo(
    () => buildSequentialData(seriesData, 10),
    [seriesData]
  )

  // ── Contribution YoY data ─────────────────────────────────────────────────
  const contribYoyData = useMemo((): PceContribRow[] => {
    if (!contribRaw?.pce) return []
    const pce = contribRaw.pce
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return pce.map(d => {
      const [y, m] = d.date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const ac = maps.pce?.get(d.date), ap = maps.pce?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? PCE_CONTRIB_WEIGHTS[k] * (c / p - 1) * 100 : null
      }
      return {
        date: d.date,
        services: contrib('services'), durables: contrib('durables'),
        nondurables: contrib('nondurables'), nonprofits: contrib('nonprofits'),
        pce: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // ── Contribution MoM data ─────────────────────────────────────────────────
  const contribMomData = useMemo((): PceContribRow[] => {
    if (!contribRaw?.pce) return []
    const pce = contribRaw.pce
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return pce.map((d, i) => {
      if (i === 0) return { date: d.date, services: null, durables: null, nondurables: null, nonprofits: null, pce: null }
      const prior = pce[i - 1].date
      const ac = maps.pce?.get(d.date), ap = maps.pce?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? PCE_CONTRIB_WEIGHTS[k] * (c / p - 1) * 100 : null
      }
      return {
        date: d.date,
        services: contrib('services'), durables: contrib('durables'),
        nondurables: contrib('nondurables'), nonprofits: contrib('nonprofits'),
        pce: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // ── Distribution chart data ───────────────────────────────────────────────
  const distV1Data = useMemo(
    () => distSeriesData ? computeDistribution(distSeriesData, DIST_V1_BUCKETS) : [],
    [distSeriesData]
  )
  const distV2Data = useMemo(
    () => distSeriesData ? computeDistribution(distSeriesData, DIST_V2_BUCKETS) : [],
    [distSeriesData]
  )

  // ── Core vs Headline rate data ────────────────────────────────────────────
  const corePceRates = useMemo(
    () => contribRaw?.corePce ? computeRates(contribRaw.corePce) : [],
    [contribRaw]
  )
  const headlinePceRates = useMemo(
    () => contribRaw?.pce ? computeRates(contribRaw.pce) : [],
    [contribRaw]
  )

  // ── Initialize sequential year visibility ─────────────────────────────────
  useEffect(() => {
    setVisSeqYears(new Set(seqYears))
  }, [seqYears])

  // ── Initialize contribution brush ranges (~8 years = 96 months) ───────────
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

  // ── Initialize distribution brush ranges ──────────────────────────────────
  useEffect(() => {
    if (distV1Data.length > 0) {
      const end = distV1Data.length - 1
      setBrushes(prev => ({
        ...prev,
        distV1: { start: 0, end, period: 'All' },
        distV2: { start: 0, end, period: 'All' },
      }))
    }
  }, [distV1Data.length])

  // ── Initialize core/headline brush ranges (~6 years = 72 months) ──────────
  useEffect(() => {
    if (corePceRates.length > 0) {
      const end = corePceRates.length - 1
      const start = Math.max(0, end - 72 + 1)
      setBrushes(prev => ({
        ...prev,
        corePce:     { start, end, period: '' },
        headlinePce: { start, end, period: '' },
      }))
    }
  }, [corePceRates.length])

  // ── Y-domain for index chart ──────────────────────────────────────────────
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

  // ── Brush handlers ────────────────────────────────────────────────────────

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

  const handleDistQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number) => {
      setBrushes(prev => {
        const end = distV1Data.length - 1
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
    [distV1Data.length]
  )

  const handleRateQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number) => {
      const len = key === 'corePce' ? corePceRates.length : headlinePceRates.length
      setBrushes(prev => {
        const end = len - 1
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
    [corePceRates.length, headlinePceRates.length]
  )

  // ── Legend toggle helper ──────────────────────────────────────────────────
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
  const toggleDistV1      = mkToggle(setVisDistV1)
  const toggleDistV2      = mkToggle(setVisDistV2)
  const toggleCorePce     = mkToggle(setVisCorePce)
  const toggleHeadlinePce = mkToggle(setVisHeadlinePce)

  // ── Sequential comparison year colors ─────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>

        {/* ══════════════════════════════════════════════════════════════════
            PCE Contribution Decomposition
        ══════════════════════════════════════════════════════════════════ */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>PCE Contribution Decomposition</div>
        </div>

        {contribLoading && (
          <div className={styles.statusBlock}>Loading contribution data...</div>
        )}
        {contribError && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{contribError}</div>
        )}

        {!contribLoading && !contribError && contribYoyData.length > 0 && (
          <>
            {/* ════════════════════════════════════════════════════════════════
                1. Contribution to YoY PCEPI (Custom SVG)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to YoY PCEPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('services')}>
                    <span className={styles.legendSwatch} style={{ background: '#6366f1' }} />Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('durables') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('durables')}>
                    <span className={styles.legendSwatch} style={{ background: '#84cc16' }} />Durables
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('nondurables') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('nondurables')}>
                    <span className={styles.legendSwatch} style={{ background: '#a78bfa' }} />Nondurables
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('nonprofits') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('nonprofits')}>
                    <span className={styles.legendSwatch} style={{ background: '#f87171' }} />Nonprofits
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('pce') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('pce')}>
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />PCE
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ContribChart
                  data={contribYoyData}
                  visibleStart={brushes.contribYoy.start}
                  visibleEnd={brushes.contribYoy.end}
                  activeSeries={visContribYoy}
                  lineWidth={2}
                  clipPrefix="pceyoy"
                  totalLabel="PCE YoY"
                />
              </div>
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
                2. Contribution to MoM PCEPI (Custom SVG)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to MoM PCEPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('services')}>
                    <span className={styles.legendSwatch} style={{ background: '#6366f1' }} />Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('durables') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('durables')}>
                    <span className={styles.legendSwatch} style={{ background: '#84cc16' }} />Durables
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('nondurables') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('nondurables')}>
                    <span className={styles.legendSwatch} style={{ background: '#a78bfa' }} />Nondurables
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('nonprofits') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('nonprofits')}>
                    <span className={styles.legendSwatch} style={{ background: '#f87171' }} />Nonprofits
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('pce') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('pce')}>
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />PCEPI
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ContribChart
                  data={contribMomData}
                  visibleStart={brushes.contribMom.start}
                  visibleEnd={brushes.contribMom.end}
                  activeSeries={visContribMom}
                  lineWidth={1.5}
                  clipPrefix="pcemom"
                  totalLabel="PCEPI MoM"
                />
              </div>
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
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PCE Distribution Charts
        ══════════════════════════════════════════════════════════════════ */}
        {distLoading && (
          <div className={styles.statusBlock}>
            Loading distribution data ({distProgress}/{PCE_DIST_LINES.length} series)...
          </div>
        )}
        {distError && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{distError}</div>
        )}

        {!distLoading && !distError && distV1Data.length > 0 && (
          <>
            {/* ════════════════════════════════════════════════════════════════
                3. PCE Distribution v1 (Wide Buckets)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>PCE Distribution v1</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {DIST_V1_BUCKETS.map(b => (
                    <button
                      key={b.key}
                      type="button"
                      className={`${styles.legendItem} ${visDistV1.has(b.key) ? '' : styles.legendItemOff}`}
                      onClick={() => toggleDistV1(b.key)}
                    >
                      <span className={styles.legendSwatch} style={{ background: b.color }} />
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={distV1Data}
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
                      width={58} domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v.toFixed(1)}%` : '-'
                        const label = DIST_V1_BUCKETS.find(b => b.key === String(name))?.label ?? String(name)
                        return [val, label] as [string, string]
                      }}
                    />
                    {DIST_V1_BUCKETS.map(b => (
                      <Area
                        key={b.key}
                        type="monotone"
                        dataKey={b.key}
                        stackId="dist"
                        stroke="none"
                        fill={b.color}
                        fillOpacity={0.85}
                        isAnimationActive={false}
                        connectNulls
                        legendType="none"
                        hide={!visDistV1.has(b.key)}
                      />
                    ))}
                    <Brush
                      dataKey="date"
                      startIndex={brushes.distV1.start}
                      endIndex={brushes.distV1.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('distV1', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.distV1.period}
                onSelect={(l, c) => handleDistQuickSelect('distV1', l, c)}
              />
            </div>

            {/* ════════════════════════════════════════════════════════════════
                4. PCE Distribution v2 (Narrow Buckets)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>PCE Distribution v2</div>
                  <div className={styles.sectionSubtitle}>Long Term</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {DIST_V2_BUCKETS.map(b => (
                    <button
                      key={b.key}
                      type="button"
                      className={`${styles.legendItem} ${visDistV2.has(b.key) ? '' : styles.legendItemOff}`}
                      onClick={() => toggleDistV2(b.key)}
                    >
                      <span className={styles.legendSwatch} style={{ background: b.color }} />
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={distV2Data}
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
                      width={58} domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? `${v.toFixed(1)}%` : '-'
                        const label = DIST_V2_BUCKETS.find(b => b.key === String(name))?.label ?? String(name)
                        return [val, label] as [string, string]
                      }}
                    />
                    {DIST_V2_BUCKETS.map(b => (
                      <Area
                        key={b.key}
                        type="monotone"
                        dataKey={b.key}
                        stackId="dist"
                        stroke="none"
                        fill={b.color}
                        fillOpacity={0.85}
                        isAnimationActive={false}
                        connectNulls
                        legendType="none"
                        hide={!visDistV2.has(b.key)}
                      />
                    ))}
                    <Brush
                      dataKey="date"
                      startIndex={brushes.distV2.start}
                      endIndex={brushes.distV2.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleBrush('distV2', startIndex, endIndex)}
                      {...BRUSH_STYLE}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.distV2.period}
                onSelect={(l, c) => handleDistQuickSelect('distV2', l, c)}
              />
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            5. Core vs Headline PCE
        ══════════════════════════════════════════════════════════════════ */}
        {!contribLoading && !contribError && corePceRates.length > 0 && (
          <>
            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>Core vs Headline</div>
            </div>

            <div className={styles.splitGrid}>
              {/* ── Core PCE ─────────────────────────────────────────────── */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Core PCE</div>
                    <div className={styles.sectionSubtitle}>Line 25 &middot; Excluding Food &amp; Energy</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button" className={`${styles.legendItem} ${visCorePce.has('yoy') ? '' : styles.legendItemOff}`} onClick={() => toggleCorePce('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />YoY
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visCorePce.has('ann6m') ? '' : styles.legendItemOff}`} onClick={() => toggleCorePce('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.7 }} />6mo&Delta;
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visCorePce.has('ann3m') ? '' : styles.legendItemOff}`} onClick={() => toggleCorePce('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.5 }} />3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrapSmall}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={corePceRates}
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
                        width={48} tickFormatter={fmtPct}
                      />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-'
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann3m' ? '3mo\u0394' : '6mo\u0394'
                          return [val, lbl] as [string, string]
                        }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      <ReferenceLine y={2} stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="6 4" />
                      <Line
                        type="monotone" dataKey="ann3m" name="ann3m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="2 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCorePce.has('ann3m')}
                      />
                      <Line
                        type="monotone" dataKey="ann6m" name="ann6m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="6 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCorePce.has('ann6m')}
                      />
                      <Line
                        type="monotone" dataKey="yoy" name="yoy"
                        stroke="#ec4899" strokeWidth={2.5}
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCorePce.has('yoy')}
                      />
                      <Brush
                        dataKey="date"
                        startIndex={brushes.corePce.start}
                        endIndex={brushes.corePce.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleBrush('corePce', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.corePce.period}
                  onSelect={(l, c) => handleRateQuickSelect('corePce', l, c)}
                />
              </div>

              {/* ── Headline PCE ─────────────────────────────────────────── */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Headline PCE</div>
                    <div className={styles.sectionSubtitle}>Line 1 &middot; Personal Consumption Expenditures</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button" className={`${styles.legendItem} ${visHeadlinePce.has('yoy') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlinePce('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />YoY
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visHeadlinePce.has('ann6m') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlinePce('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.7 }} />6mo&Delta;
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visHeadlinePce.has('ann3m') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlinePce('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.5 }} />3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrapSmall}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={headlinePceRates}
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
                        width={48} tickFormatter={fmtPct}
                      />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(v: unknown, name: unknown) => {
                          const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-'
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann3m' ? '3mo\u0394' : '6mo\u0394'
                          return [val, lbl] as [string, string]
                        }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      <ReferenceLine y={2} stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="6 4" />
                      <Line
                        type="monotone" dataKey="ann3m" name="ann3m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="2 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlinePce.has('ann3m')}
                      />
                      <Line
                        type="monotone" dataKey="ann6m" name="ann6m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="6 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlinePce.has('ann6m')}
                      />
                      <Line
                        type="monotone" dataKey="yoy" name="yoy"
                        stroke="#ec4899" strokeWidth={2.5}
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlinePce.has('yoy')}
                      />
                      <Brush
                        dataKey="date"
                        startIndex={brushes.headlinePce.start}
                        endIndex={brushes.headlinePce.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleBrush('headlinePce', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.headlinePce.period}
                  onSelect={(l, c) => handleRateQuickSelect('headlinePce', l, c)}
                />
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PCE Series Explorer (existing)
        ══════════════════════════════════════════════════════════════════ */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>PCE Series Explorer</div>
          <div className={styles.sectorSelectWrap}>
            <span className={styles.lookbackLabel}>Series</span>
            <select
              className={styles.sectorSelect}
              value={selectedLine}
              onChange={e => setSelectedLine(parseInt(e.target.value))}
            >
              {PCE_ITEMS.map(item => (
                <option key={item.lineNumber} value={item.lineNumber}>{item.label}</option>
              ))}
            </select>
            <span className={styles.fredId}>Line {selectedLine}</span>
          </div>
        </div>

        {loading && (
          <div className={styles.statusBlock}>Loading Line {selectedLine}...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}
        {!loading && !error && seriesData.length === 0 && (
          <div className={styles.statusBlock}>No data available for Line {selectedLine}</div>
        )}

        {!loading && !error && seriesData.length > 0 && (
          <>
            {/* ════════════════════════════════════════════════════════════════
                Explorer Chart 1: Outright Index Level
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>{selectedLabel} Index</div>
                  <div className={styles.sectionSubtitle}>Long Term &middot; Index 2017=100</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#c4b5fd' }} />
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
                      stroke="#c4b5fd" strokeWidth={1.5}
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
                Explorer Chart 2: YoY % with Regime Shading
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
                Explorer Chart 3: YoY Delta
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
                        const lbl = name === 'delta' ? `YoY ${deltaPeriod}pd\u0394` : `${deltaMaPeriod}pd MA`
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
                Explorer Chart 4: MoM % Change with Moving Averages
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
                        const lbl = name === 'mom' ? 'MoM \u0394'
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
                Explorer Chart 5: Annualized MoM % Change
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
                Explorer Chart 6: MoM Sequential Comparison
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
    </>
  )
}

export function PCEDashboardPage() {
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
        <Link to="/models/inflation" className={styles.breadcrumbLink}>Inflation</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>PCE Dashboard</span>
      </nav>

      <div className={styles.body}>
        <PCEDashboardContent />
      </div>
    </div>
  )
}
