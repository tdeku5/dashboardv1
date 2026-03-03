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
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import { CPI_ITEMS } from '../data/cpiSeriesConfig'
import styles from './CPIDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }
type ChartKey   = 'contribYoy' | 'contribMom' | 'distV1' | 'distV2' | 'coreCpi' | 'headlineCpi' | 'index' | 'regime' | 'yoyDelta' | 'mom' | 'annMom'

type NullableRow = { date: string; value: number | null }
type ContribRow  = { date: string; food: number | null; energy: number | null; coreGoods: number | null; coreServices: number | null; allItems: number | null }
type RateRow     = { date: string; yoy: number | null; ann3m: number | null; ann6m: number | null }

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

const CONTRIB_SERIES = [
  { key: 'allItems',     id: 'CPIAUCSL' },
  { key: 'food',         id: 'CPIUFDSL' },
  { key: 'energy',       id: 'CPIENGSL' },
  { key: 'coreGoods',    id: 'CUSR0000SACL1E' },
  { key: 'coreServices', id: 'CUSR0000SASLE' },
  { key: 'coreCpi',      id: 'CPILFESL' },
] as const

// BLS relative importance weights (December 2024), sum = 100.000
const CONTRIB_WEIGHTS: Record<string, number> = {
  food:         13.531,
  energy:        6.921,
  coreGoods:    21.361,
  coreServices: 58.187,
}

const CONTRIB_LABELS: Record<string, string> = {
  food:         'Food',
  energy:       'Energy',
  coreGoods:    'Core Goods',
  coreServices: 'Core Services',
  allItems:     'All Items',
}

// ── Distribution chart constants ─────────────────────────────────────────────

const DIST_SERIES_IDS = [
  'CPIAUCSL','CPIFABSL','CPIUFDSL','CUSR0000SAF11','CUSR0000SAF111','CUSR0000SAF112',
  'CUSR0000SEFJ','CUSR0000SAF113','CUSR0000SAF114','CUSR0000SEFP01','CUSR0000SAF115',
  'CUSR0000SEFR','CUSR0000SEFS','CUSR0000SEFT','CUSR0000SEFV','CUSR0000SEFV05',
  'CUSR0000SAF116','CUSR0000SEFW','CUSR0000SEFX','CPIHOSSL','CUSR0000SAH1','CUSR0000SEHA',
  'CUSR0000SEHB','CUSR0000SEHC','CUSR0000SEHC01','CUSR0000SAH2','CUSR0000SAH21',
  'CUSR0000SEHE','CUSR0000SEHF','CUSR0000SEHF01','CUSR0000SEHF02','CUSR0000SEHG',
  'CUSR0000SAH3','CPIAPPSL','CUSR0000SAA1','CUSR0000SAA2','CUSR0000SEAE','CUSR0000SEAF',
  'CPITRNSL','CUSR0000SAT1','CUSR0000SETA','CUSR0000SETA01','CUSR0000SETA02','CUSR0000SETB',
  'CUSR0000SETB01','CUSR0000SETC','CUSR0000SETD','CUSR0000SETG','CUSR0000SETG01','CPIMEDSL',
  'CUSR0000SAM1','CUSR0000SAM2','CUSR0000SEMC','CUSR0000SEMC04','CUSR0000SEMD','CPIRECSL',
  'CUSR0000SERA','CUSR0000SERA02','CUSR0000SS61031','CUSR0000SERE01','CUSR0000SERE03',
  'CUSR0000SERF01','CUSR0000SS62031','CUSR0000SERF03','CPIEDUSL','CUSR0000SAE1',
  'CUSR0000SEEA','CUSR0000SEEB','CUSR0000SAE2','CUSR0000SAE21','CUSR0000SEEE',
  'CUSR0000SEEE01','CPIOGSSL','CUSR0000SEGA','CUSR0000SAG1','CUSR0000SEGD','CUSR0000SEGD03',
] as const

const DIST_V1_BUCKETS = [
  { key: 'ltNeg10', label: '< -10%',     color: '#1e3a5f', test: (v: number) => v < -10 },
  { key: 'neg10to5', label: '-10% to -5%', color: '#3b82f6', test: (v: number) => v >= -10 && v < -5 },
  { key: 'neg5to0',  label: '-5% to 0%',   color: '#93c5fd', test: (v: number) => v >= -5 && v < 0 },
  { key: 'pos0to5',  label: '0% to 5%',    color: '#9ca3af', test: (v: number) => v >= 0 && v < 5 },
  { key: 'pos5to10', label: '5% to 10%',   color: '#fca5a5', test: (v: number) => v >= 5 && v < 10 },
  { key: 'gt10',     label: '> 10%',       color: '#ef4444', test: (v: number) => v >= 10 },
] as const

const DIST_V2_BUCKETS = [
  { key: 'ltNeg2',  label: '< -2%',      color: '#1e3a5f', test: (v: number) => v < -2 },
  { key: 'neg2to0', label: '-2% to 0%',  color: '#60a5fa', test: (v: number) => v >= -2 && v < 0 },
  { key: 'pos0to2', label: '0% to 2%',   color: '#d1d5db', test: (v: number) => v >= 0 && v < 2 },
  { key: 'pos2to4', label: '2% to 4%',   color: '#9ca3af', test: (v: number) => v >= 2 && v < 4 },
  { key: 'pos4to6', label: '4% to 6%',   color: '#fca5a5', test: (v: number) => v >= 4 && v < 6 },
  { key: 'gt6',     label: '> 6%',       color: '#ef4444', test: (v: number) => v >= 6 },
] as const

type DistRow = { date: string; [bucket: string]: number | string }

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

// ── October 2025 gap-fill utility ───────────────────────────────────────────

function fillOct2025Gap(obs: FredObservation[]): FredObservation[] {
  const hasOct = obs.some(o => o.date === '2025-10-01')
  if (hasOct) return obs

  const sepIdx = obs.findIndex(o => o.date === '2025-09-01')
  const novIdx = obs.findIndex(o => o.date === '2025-11-01')

  if (sepIdx < 0 || novIdx < 0) return obs

  const sepVal = parseFloat(obs[sepIdx].value)
  const novVal = parseFloat(obs[novIdx].value)
  if (isNaN(sepVal) || isNaN(novVal)) return obs

  const interpolated: FredObservation = {
    date:  '2025-10-01',
    value: ((sepVal + novVal) / 2).toString(),
  }

  // Insert after September
  const result = [...obs]
  result.splice(sepIdx + 1, 0, interpolated)
  return result
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

// ── Rate-of-change computation (YoY, 3mo ann, 6mo ann) ─────────────────────

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

// ── Distribution bucket computation ─────────────────────────────────────────

function computeDistribution(
  allSeriesData: WD[][],
  buckets: readonly { key: string; test: (v: number) => boolean }[],
): DistRow[] {
  // Build YoY% maps for each series
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

  // Collect all unique dates across all series
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

// ── YoY Contribution custom SVG chart ────────────────────────────────────────

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

const CONTRIB_ITEMS = [
  { id: 'food',         label: 'Food',          color: '#ef4444' },
  { id: 'energy',       label: 'Energy',        color: '#a855f7' },
  { id: 'coreGoods',    label: 'Core Goods',    color: '#84cc16' },
  { id: 'coreServices', label: 'Core Services', color: '#60a5fa' },
] as const

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

function ContribYoyTooltip({
  row,
  activeItems,
  showAllItems,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:         ContribRow
  activeItems: readonly { id: string; label: string; color: string }[]
  showAllItems: boolean
  mouseX:      number
  mouseY:      number
  isRightHalf: boolean
}) {
  const items = [...activeItems]
    .map(s => ({ ...s, value: row[s.id as keyof ContribRow] as number | null }))
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
      {showAllItems && row.allItems != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>All Items YoY</span>
          <span style={{ color: row.allItems >= 0 ? '#4ade80' : '#f87171' }}>
            {row.allItems >= 0 ? '+' : ''}{row.allItems.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

function ContribYoyChart({
  data,
  visibleStart,
  visibleEnd,
  activeSeries,
}: {
  data:         ContribRow[]
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
    () => CONTRIB_ITEMS.filter(s => activeSeries.has(s.id)),
    [activeSeries]
  )
  const showAllItems = activeSeries.has('allItems')

  // Compute Y domain from visible data
  const yDomain = useMemo((): [number, number] => {
    let min = 0, max = 0
    for (const row of visible) {
      let posStack = 0, negStack = 0
      for (const s of activeItems) {
        const v = row[s.id as keyof ContribRow] as number | null
        if (v == null || v === 0) continue
        if (v > 0) posStack += v; else negStack += v
      }
      if (showAllItems && row.allItems != null) {
        posStack = Math.max(posStack, row.allItems)
        negStack = Math.min(negStack, row.allItems)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showAllItems])

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
        const value = row[s.id as keyof ContribRow] as number | null
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

    const pts = showAllItems
      ? cols
          .filter(c => c.row.allItems != null)
          .map(c => ({ cx: c.cx, cy: toY(c.row.allItems!) }))
      : []

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, showAllItems, colW, yMin, yRange, innerH])

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
  const clipId = `cyoy${uid.replace(/[^a-zA-Z0-9]/g, '')}`

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

        {/* All Items line overlay */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
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
        <ContribYoyTooltip
          row={hovCol.row}
          activeItems={activeItems}
          showAllItems={showAllItems}
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

export function CPIDashboardPage() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [seriesData, setSeriesData] = useState<WD[]>([])
  const [selectedId, setSelectedId] = useState('CPIAUCSL')

  // ── Chart-specific controls ─────────────────────────────────────────────────
  const [regimeMa, setRegimeMa]         = useState(12)
  const [deltaPeriod, setDeltaPeriod]    = useState(1)
  const [deltaMaPeriod, setDeltaMaPeriod] = useState(12)
  const [momMa1, setMomMa1]             = useState(3)
  const [momMa2, setMomMa2]             = useState(6)

  // ── Legend visibility sets (charts 3–6) ────────────────────────────────────
  const [visYoyDelta, setVisYoyDelta] = useState<Set<string>>(() => new Set(['delta', 'ma']))
  const [visMom, setVisMom]           = useState<Set<string>>(() => new Set(['mom', 'ma1', 'ma2']))
  const [visAnnMom, setVisAnnMom]     = useState<Set<string>>(() => new Set(['value']))
  const [visSeqYears, setVisSeqYears] = useState<Set<string>>(() => new Set<string>())

  // ── Contribution decomposition state ──────────────────────────────────────
  const [contribRaw, setContribRaw]       = useState<Record<string, WD[]> | null>(null)
  const [contribLoading, setContribLoading] = useState(true)
  const [contribError, setContribError]     = useState<string | null>(null)
  const [visContribYoy, setVisContribYoy] = useState<Set<string>>(() => new Set(['food', 'energy', 'coreGoods', 'coreServices', 'allItems']))
  const [visContribMom, setVisContribMom] = useState<Set<string>>(() => new Set(['food', 'energy', 'coreGoods', 'coreServices', 'allItems']))

  // ── Distribution state ────────────────────────────────────────────────────
  const [distSeriesData, setDistSeriesData] = useState<WD[][] | null>(null)
  const [distLoading, setDistLoading]       = useState(true)
  const [distProgress, setDistProgress]     = useState(0)
  const [distError, setDistError]           = useState<string | null>(null)
  const [visDistV1, setVisDistV1] = useState<Set<string>>(() => new Set(DIST_V1_BUCKETS.map(b => b.key)))
  const [visDistV2, setVisDistV2] = useState<Set<string>>(() => new Set(DIST_V2_BUCKETS.map(b => b.key)))

  // ── Core vs Headline state ────────────────────────────────────────────────
  const [visCoreCpi, setVisCoreCpi]         = useState<Set<string>>(() => new Set(['yoy', 'ann3m', 'ann6m']))
  const [visHeadlineCpi, setVisHeadlineCpi] = useState<Set<string>>(() => new Set(['yoy', 'ann3m', 'ann6m']))

  // ── Brush states (one per chart, except sequential) ─────────────────────────
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    contribYoy:  { start: 0, end: 0, period: '' },
    contribMom:  { start: 0, end: 0, period: '' },
    distV1:      { start: 0, end: 0, period: 'All' },
    distV2:      { start: 0, end: 0, period: 'All' },
    coreCpi:     { start: 0, end: 0, period: '' },
    headlineCpi: { start: 0, end: 0, period: '' },
    index:       { start: 0, end: 0, period: 'All' },
    regime:     { start: 0, end: 0, period: 'All' },
    yoyDelta:   { start: 0, end: 0, period: 'All' },
    mom:        { start: 0, end: 0, period: 'All' },
    annMom:     { start: 0, end: 0, period: 'All' },
  })

  // ── Selected series label ───────────────────────────────────────────────────
  const selectedLabel = useMemo(
    () => CPI_ITEMS.find(s => s.id === selectedId)?.label ?? selectedId,
    [selectedId]
  )

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchFredSeries(selectedId)
      .then(raw => {
        if (cancelled) return
        const filled = fillOct2025Gap(raw)
        const parsed = parseObs(filled)
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
      CONTRIB_SERIES.map(async s => {
        const raw = await fetchFredSeries(s.id)
        const filled = fillOct2025Gap(raw)
        return { key: s.key, data: parseObs(filled) }
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

  // ── Distribution series fetch (batched, independent of explorer) ───────────
  useEffect(() => {
    let cancelled = false
    const BATCH_SIZE = 12
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    ;(async () => {
      const allData: WD[][] = []
      for (let i = 0; i < DIST_SERIES_IDS.length; i += BATCH_SIZE) {
        if (cancelled) return
        const batch = DIST_SERIES_IDS.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(async id => {
            const raw = await fetchFredSeries(id)
            return parseObs(fillOct2025Gap(raw))
          })
        )
        allData.push(...results)
        if (!cancelled) setDistProgress(allData.length)
        if (i + BATCH_SIZE < DIST_SERIES_IDS.length) await delay(300)
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
  const contribYoyData = useMemo((): ContribRow[] => {
    if (!contribRaw?.allItems) return []
    const allItems = contribRaw.allItems
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return allItems.map(d => {
      const [y, m] = d.date.split('-').map(Number)
      const prior = `${y - 1}-${String(m).padStart(2, '0')}-01`
      const ac = maps.allItems?.get(d.date), ap = maps.allItems?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? CONTRIB_WEIGHTS[k] * (c / p - 1) : null
      }
      return {
        date: d.date,
        food: contrib('food'), energy: contrib('energy'),
        coreGoods: contrib('coreGoods'), coreServices: contrib('coreServices'),
        allItems: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // ── Contribution MoM data ──────────────────────────────────────────────────
  const contribMomData = useMemo((): ContribRow[] => {
    if (!contribRaw?.allItems) return []
    const allItems = contribRaw.allItems
    const maps: Record<string, Map<string, number>> = {}
    for (const [key, data] of Object.entries(contribRaw)) {
      maps[key] = new Map(data.map(d => [d.date, d.value]))
    }
    return allItems.map((d, i) => {
      if (i === 0) return { date: d.date, food: null, energy: null, coreGoods: null, coreServices: null, allItems: null }
      const prior = allItems[i - 1].date
      const ac = maps.allItems?.get(d.date), ap = maps.allItems?.get(prior)
      const contrib = (k: string) => {
        const c = maps[k]?.get(d.date), p = maps[k]?.get(prior)
        return (c != null && p != null && p !== 0) ? CONTRIB_WEIGHTS[k] * (c / p - 1) : null
      }
      return {
        date: d.date,
        food: contrib('food'), energy: contrib('energy'),
        coreGoods: contrib('coreGoods'), coreServices: contrib('coreServices'),
        allItems: (ac != null && ap != null && ap !== 0) ? (ac / ap - 1) * 100 : null,
      }
    })
  }, [contribRaw])

  // ── Distribution chart data ────────────────────────────────────────────────
  const distV1Data = useMemo(
    () => distSeriesData ? computeDistribution(distSeriesData, DIST_V1_BUCKETS) : [],
    [distSeriesData]
  )
  const distV2Data = useMemo(
    () => distSeriesData ? computeDistribution(distSeriesData, DIST_V2_BUCKETS) : [],
    [distSeriesData]
  )

  // ── Core vs Headline rate data ──────────────────────────────────────────────
  const coreCpiRates = useMemo(
    () => contribRaw?.coreCpi ? computeRates(contribRaw.coreCpi) : [],
    [contribRaw]
  )
  const headlineCpiRates = useMemo(
    () => contribRaw?.allItems ? computeRates(contribRaw.allItems) : [],
    [contribRaw]
  )

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

  // Initialize distribution brush ranges
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

  // Initialize core/headline brush ranges (~5 years = 60 months)
  useEffect(() => {
    if (coreCpiRates.length > 0) {
      const end = coreCpiRates.length - 1
      const start = Math.max(0, end - 72 + 1)
      setBrushes(prev => ({
        ...prev,
        coreCpi:     { start, end, period: '' },
        headlineCpi: { start, end, period: '' },
      }))
    }
  }, [coreCpiRates.length])

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
      const len = key === 'coreCpi' ? coreCpiRates.length : headlineCpiRates.length
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
    [coreCpiRates.length, headlineCpiRates.length]
  )

  // ── Legend toggle helper ────────────────────────────────────────────────────
  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (key: string) => setter(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const toggleYoyDelta = mkToggle(setVisYoyDelta)
  const toggleMom      = mkToggle(setVisMom)
  const toggleAnnMom   = mkToggle(setVisAnnMom)
  const toggleSeqYear  = mkToggle(setVisSeqYears)
  const toggleContribYoy = mkToggle(setVisContribYoy)
  const toggleContribMom = mkToggle(setVisContribMom)
  const toggleDistV1     = mkToggle(setVisDistV1)
  const toggleDistV2     = mkToggle(setVisDistV2)
  const toggleCoreCpi    = mkToggle(setVisCoreCpi)
  const toggleHeadlineCpi = mkToggle(setVisHeadlineCpi)

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
        <span className={styles.breadcrumbCurrent}>CPI Dashboard</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ── Contribution Decomposition ──────────────────────────────────── */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>CPI Contribution Decomposition</div>
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
                Contribution Chart 1: Contribution to YoY CPI
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to YoY CPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('food') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('food')}>
                    <span className={styles.legendSwatch} style={{ background: '#ef4444' }} />Food
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('energy') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('energy')}>
                    <span className={styles.legendSwatch} style={{ background: '#a855f7' }} />Energy
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('coreGoods') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('coreGoods')}>
                    <span className={styles.legendSwatch} style={{ background: '#84cc16' }} />Core Goods
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('coreServices') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('coreServices')}>
                    <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} />Core Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribYoy.has('allItems') ? '' : styles.legendItemOff}`} onClick={() => toggleContribYoy('allItems')}>
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />All Items
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ContribYoyChart
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
                Contribution Chart 2: Contribution to MoM CPI
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Contribution to MoM CPI</div>
                  <div className={styles.sectionSubtitle}>Recent</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('coreServices') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('coreServices')}>
                    <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} />Core Services
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('coreGoods') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('coreGoods')}>
                    <span className={styles.legendSwatch} style={{ background: '#84cc16' }} />Core Goods
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('energy') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('energy')}>
                    <span className={styles.legendSwatch} style={{ background: '#a855f7' }} />Energy
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('food') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('food')}>
                    <span className={styles.legendSwatch} style={{ background: '#ef4444' }} />Food
                  </button>
                  <button type="button" className={`${styles.legendItem} ${visContribMom.has('allItems') ? '' : styles.legendItemOff}`} onClick={() => toggleContribMom('allItems')}>
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />All Items
                  </button>
                </div>
              </div>
              <div className={styles.chartWrap}>
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
                        return [val, CONTRIB_LABELS[String(name)] ?? String(name)] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="coreServices" stackId="contributions" fill="rgba(96,165,250,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('coreServices')} />
                    <Bar dataKey="coreGoods" stackId="contributions" fill="rgba(132,204,22,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('coreGoods')} />
                    <Bar dataKey="energy" stackId="contributions" fill="rgba(168,85,247,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('energy')} />
                    <Bar dataKey="food" stackId="contributions" fill="rgba(239,68,68,0.80)" isAnimationActive={false} legendType="none" hide={!visContribMom.has('food')} />
                    <Line
                      type="monotone" dataKey="allItems" name="allItems"
                      stroke="#ffffff" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                      legendType="none" hide={!visContribMom.has('allItems')}
                    />
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

        {/* ── Distribution Charts ────────────────────────────────────────── */}
        {distLoading && (
          <div className={styles.statusBlock}>
            Loading distribution data ({distProgress}/{DIST_SERIES_IDS.length} series)...
          </div>
        )}
        {distError && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{distError}</div>
        )}

        {!distLoading && !distError && distV1Data.length > 0 && (
          <>
            {/* ════════════════════════════════════════════════════════════════
                Distribution Chart 1: CPI Distribution v1 (Wide Buckets)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>CPI Distribution v1</div>
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
                Distribution Chart 2: CPI Distribution v2 (Narrow Buckets)
            ════════════════════════════════════════════════════════════════ */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>CPI Distribution v2</div>
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

        {/* ── Core vs Headline ────────────────────────────────────────────── */}
        {!contribLoading && !contribError && coreCpiRates.length > 0 && (
          <>
            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>Core vs Headline</div>
            </div>

            <div className={styles.splitGrid}>
              {/* ── Core CPI ─────────────────────────────────────────────── */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Core CPI</div>
                    <div className={styles.sectionSubtitle}>CPILFESL &middot; Less Food &amp; Energy</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button" className={`${styles.legendItem} ${visCoreCpi.has('yoy') ? '' : styles.legendItemOff}`} onClick={() => toggleCoreCpi('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />YoY
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visCoreCpi.has('ann6m') ? '' : styles.legendItemOff}`} onClick={() => toggleCoreCpi('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.7 }} />6mo&Delta;
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visCoreCpi.has('ann3m') ? '' : styles.legendItemOff}`} onClick={() => toggleCoreCpi('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.5 }} />3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrapSmall}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={coreCpiRates}
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
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann3m' ? '3moΔ' : '6moΔ'
                          return [val, lbl] as [string, string]
                        }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      <ReferenceLine y={2} stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="6 4" />
                      <Line
                        type="monotone" dataKey="ann3m" name="ann3m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="2 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCoreCpi.has('ann3m')}
                      />
                      <Line
                        type="monotone" dataKey="ann6m" name="ann6m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="6 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCoreCpi.has('ann6m')}
                      />
                      <Line
                        type="monotone" dataKey="yoy" name="yoy"
                        stroke="#ec4899" strokeWidth={2.5}
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visCoreCpi.has('yoy')}
                      />
                      <Brush
                        dataKey="date"
                        startIndex={brushes.coreCpi.start}
                        endIndex={brushes.coreCpi.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleBrush('coreCpi', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.coreCpi.period}
                  onSelect={(l, c) => handleRateQuickSelect('coreCpi', l, c)}
                />
              </div>

              {/* ── Headline CPI ─────────────────────────────────────────── */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Headline CPI</div>
                    <div className={styles.sectionSubtitle}>CPIAUCSL &middot; All Items</div>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <button type="button" className={`${styles.legendItem} ${visHeadlineCpi.has('yoy') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlineCpi('yoy')}>
                      <span className={styles.legendLine} style={{ background: '#ec4899' }} />YoY
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visHeadlineCpi.has('ann6m') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlineCpi('ann6m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.7 }} />6mo&Delta;
                    </button>
                    <button type="button" className={`${styles.legendItem} ${visHeadlineCpi.has('ann3m') ? '' : styles.legendItemOff}`} onClick={() => toggleHeadlineCpi('ann3m')}>
                      <span className={styles.legendLine} style={{ background: '#a3a38a', opacity: 0.5 }} />3mo&Delta;
                    </button>
                  </div>
                </div>
                <div className={styles.chartWrapSmall}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={headlineCpiRates}
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
                          const lbl = name === 'yoy' ? 'YoY' : name === 'ann3m' ? '3moΔ' : '6moΔ'
                          return [val, lbl] as [string, string]
                        }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                      <ReferenceLine y={2} stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="6 4" />
                      <Line
                        type="monotone" dataKey="ann3m" name="ann3m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="2 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlineCpi.has('ann3m')}
                      />
                      <Line
                        type="monotone" dataKey="ann6m" name="ann6m"
                        stroke="#a3a38a" strokeWidth={1.5} strokeDasharray="6 3"
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlineCpi.has('ann6m')}
                      />
                      <Line
                        type="monotone" dataKey="yoy" name="yoy"
                        stroke="#ec4899" strokeWidth={2.5}
                        dot={false} isAnimationActive={false} connectNulls
                        legendType="none" hide={!visHeadlineCpi.has('yoy')}
                      />
                      <Brush
                        dataKey="date"
                        startIndex={brushes.headlineCpi.start}
                        endIndex={brushes.headlineCpi.end}
                        onChange={({ startIndex, endIndex }) =>
                          handleBrush('headlineCpi', startIndex, endIndex)}
                        {...BRUSH_STYLE}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <QuickSelectRow
                  period={brushes.headlineCpi.period}
                  onSelect={(l, c) => handleRateQuickSelect('headlineCpi', l, c)}
                />
              </div>
            </div>
          </>
        )}

        {/* ── Explorer header ──────────────────────────────────────────────── */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectionTitle}>CPI Series Explorer</div>
          <div className={styles.sectorSelectWrap}>
            <span className={styles.lookbackLabel}>Series</span>
            <select
              className={styles.sectorSelect}
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              {CPI_ITEMS.map(item => (
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
                    {/* Regime shading bars */}
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
