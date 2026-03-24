import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
  ReferenceLine,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries } from '../lib/fred'
import styles from './ClaimsDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD        = { date: string; value: number }
type AllData   = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

interface LineData  { date: string; raw: number | null; ma4: number | null }
interface YoYData   { date: string; yoy: number | null }
interface ByYearRow { week: number; [year: string]: number | null }

// ── Series constants ───────────────────────────────────────────────────────────

const LINE_SERIES = [
  { key: 'raw', label: 'Weekly',  color: '#3b82f6', dashed: true  },
  { key: 'ma4', label: '4wk MA', color: '#ef4444', dashed: false },
] as const

const YEAR_SERIES = [
  { year: 2026, color: '#ef4444' },
  { year: 2025, color: '#93c5fd' },
  { year: 2024, color: '#60a5fa' },
  { year: 2023, color: '#3b82f6' },
  { year: 2022, color: '#1d4ed8' },
  { year: 2019, color: '#94a3b8' },
  { year: 2018, color: '#64748b' },
  { year: 2017, color: '#475569' },
  { year: 2016, color: '#334155' },
] as const

const QUICK_PERIODS = [
  { label: '1Y',  count: 52       },
  { label: '2Y',  count: 104      },
  { label: '5Y',  count: 260      },
  { label: '10Y', count: 520      },
  { label: 'Max', count: Infinity },
] as const

const ALL_CLAIMS_IDS = ['ICNSA', 'ICSA', 'CCNSA', 'CCSA'] as const

// Heatmap grid dimensions: most-recent year on the left
const HEATMAP_YEARS = Array.from({ length: 27 }, (_, i) => 2026 - i)  // [2026 … 2000]
const HEATMAP_WEEKS = Array.from({ length: 53 }, (_, i) => i + 1)     // [1 … 53]
// Percentile anchors used for the color scale (like Excel conditional formatting)
const HEATMAP_PCTS  = [10, 25, 50, 75, 90] as const

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const parts = d.split('-')
  const mo = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  const [y, m] = parts
  const day = parts[2] ? ` ${parseInt(parts[2])},` : ''
  return `${mo[parseInt(m) - 1]}${day} ${y}`
}

// Week-of-year: floor((dayOfYear) / 7) + 1  →  weeks 1-53
function weekNum(dateStr: string): number {
  const d   = new Date(dateStr + 'T12:00:00Z')
  const jan = new Date(d.getUTCFullYear() + '-01-01T12:00:00Z')
  return Math.floor((d.getTime() - jan.getTime()) / (7 * 86_400_000)) + 1
}

function computeMa4(data: WD[]): (number | null)[] {
  return data.map((_, i) =>
    i < 3 ? null
    : (data[i].value + data[i-1].value + data[i-2].value + data[i-3].value) / 4
  )
}

function initBrush(
  data: { date: string }[],
  from = '2021-01-01',
): Pick<BrushState, 'start' | 'end'> {
  const end = data.length - 1
  const idx = data.findIndex(d => d.date >= from)
  return { start: idx >= 0 ? idx : 0, end }
}

function makeToggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (key: string) => setter(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
}

function makeBrushChange(setter: React.Dispatch<React.SetStateAction<BrushState>>) {
  return ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) =>
    setter(prev => ({
      period: '',
      start: startIndex ?? prev.start,
      end:   endIndex   ?? prev.end,
    }))
}

function makeSelectPeriod(
  getData: () => { date: string }[],
  setter: React.Dispatch<React.SetStateAction<BrushState>>,
) {
  return (label: string, count: number) => {
    const data = getData()
    const end  = data.length - 1
    setter({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
  }
}

// Build weekly line data (values / 1000 = thousands)
function buildLineData(raw: WD[], active: Set<string>): LineData[] {
  const ma4 = computeMa4(raw)
  return raw.map((d, i) => ({
    date: d.date,
    raw:  active.has('raw') ? d.value / 1000 : null,
    ma4:  active.has('ma4') && ma4[i] !== null ? ma4[i]! / 1000 : null,
  }))
}

// Build YoY% of 4wk MA (using i-52 as prior-year proxy)
function buildYoYData(raw: WD[]): YoYData[] {
  const ma4 = computeMa4(raw)
  return raw.map((d, i) => {
    if (i < 52) return { date: d.date, yoy: null }
    const curr  = ma4[i]
    const prior = ma4[i - 52]
    if (curr === null || prior === null || prior === 0)
      return { date: d.date, yoy: null }
    return { date: d.date, yoy: ((curr - prior) / prior) * 100 }
  })
}

// Build by-year grid for seasonal comparison (week 1-53, one column per year)
function buildByYearData(raw: WD[], active: Set<string>): ByYearRow[] {
  const years = YEAR_SERIES.map(y => y.year)
  const ma4   = computeMa4(raw)

  // year → week → value (thousands)
  const grid = new Map<number, Map<number, number>>()
  years.forEach(y => grid.set(y, new Map()))

  raw.forEach((d, i) => {
    const yr = parseInt(d.date.slice(0, 4))
    if (!grid.has(yr)) return
    const wk = weekNum(d.date)
    const ma = ma4[i]
    if (ma !== null) grid.get(yr)!.set(wk, ma / 1000)
  })

  const rows: ByYearRow[] = []
  for (let w = 1; w <= 53; w++) {
    const row: ByYearRow = { week: w }
    years.forEach(y => {
      const key = String(y)
      row[key] = active.has(key) ? (grid.get(y)!.get(w) ?? null) : null
    })
    rows.push(row)
  }
  return rows
}

interface HeatmapBreakpoint { pct: number; value: number }

// Linear interpolation of a sorted array at percentile p (0-100)
function computePercentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo  = Math.floor(idx)
  const hi  = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Build heatmap: year → week → raw value (thousands), plus percentile breakpoints
function buildHeatmapData(raw: WD[]): {
  grid:        Map<number, Map<number, number>>
  breakpoints: HeatmapBreakpoint[]
} {
  const grid = new Map<number, Map<number, number>>()
  HEATMAP_YEARS.forEach(y => grid.set(y, new Map()))

  raw.forEach(d => {
    const yr = parseInt(d.date.slice(0, 4))
    if (yr < 2000 || yr > 2026) return
    grid.get(yr)?.set(weekNum(d.date), d.value / 1000)
  })

  // Collect all cell values for percentile computation
  const allValues: number[] = []
  grid.forEach(wkMap => wkMap.forEach(v => allValues.push(v)))
  allValues.sort((a, b) => a - b)

  const breakpoints: HeatmapBreakpoint[] = HEATMAP_PCTS.map(p => ({
    pct:   p,
    value: computePercentile(allValues, p),
  }))

  return { grid, breakpoints }
}

// Map a raw value → t ∈ [0,1] via piecewise linear interpolation over percentile anchors.
// Values below P10 clamp to 0; values above P90 clamp to 1.
function valueToT(value: number, bps: HeatmapBreakpoint[]): number {
  if (!bps.length || value <= bps[0].value) return 0
  if (value >= bps[bps.length - 1].value)   return 1
  const n = bps.length
  for (let i = 0; i < n - 1; i++) {
    if (value <= bps[i + 1].value) {
      const frac = (value - bps[i].value) / (bps[i + 1].value - bps[i].value)
      return (i + frac) / (n - 1)
    }
  }
  return 1
}

// Map t ∈ [0,1] → blue → white → dark-red
function tToColor(t: number): string {
  const tc = Math.max(0, Math.min(1, t))
  let r: number, g: number, b: number
  if (tc <= 0.5) {
    // blue(37,99,235) → white(255,255,255)
    const s = tc * 2
    r = Math.round(37  + s * (255 - 37))
    g = Math.round(99  + s * (255 - 99))
    b = Math.round(235 + s * (255 - 235))
  } else {
    // white(255,255,255) → dark-red(180,0,0)
    const s = (tc - 0.5) * 2
    r = Math.round(255 - s * (255 - 180))
    g = Math.round(255 - s * 255)
    b = Math.round(255 - s * 255)
  }
  return `rgb(${r},${g},${b})`
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface LegendItem { key: string; label: string; color: string; dashed?: boolean }

function LegendRow({ series, active, onToggle }: {
  series:   readonly LegendItem[]
  active:   Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className={styles.legend}>
      {series.map(s => (
        <button
          key={s.key}
          type="button"
          className={`${styles.legendItem} ${active.has(s.key) ? '' : styles.legendItemOff}`}
          onClick={() => onToggle(s.key)}
        >
          {s.dashed
            ? <div className={`${styles.legendLine} ${styles.legendLineDashed}`} style={{ borderColor: s.color }} />
            : <div className={styles.legendLine} style={{ background: s.color }} />
          }
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  )
}

function QuickSelect({ active, onSelect }: {
  active:   string
  onSelect: (label: string, count: number) => void
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${active === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.count)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload, label, formatValue }: {
  active?:      boolean
  payload?:     Array<{ name: string; value: number | null | undefined; color: string }>
  label?:       string | number
  formatValue?: (v: number) => string
}) {
  if (!active || !payload?.length || label == null) return null
  const rows = payload.filter(p => p.value != null)
  if (!rows.length) return null
  const fmt    = formatValue ?? ((v: number) => v.toFixed(2))
  const header = typeof label === 'number' ? `Week ${label}` : fmtFullDate(label)
  return (
    <div style={{
      background: '#090e15', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2, padding: '8px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {header}
      </div>
      {rows.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: p.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#64748B', minWidth: 72 }}>{p.name}</span>
          <span style={{ color: '#CBD5E1' }}>{fmt(p.value as number)}</span>
        </div>
      ))}
    </div>
  )
}

// Shared axis / brush props
const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }
// Auto-scale Y-axis to visible data with 5 % padding on each side
const Y_DOMAIN: [(n: number) => number, (n: number) => number] = [
  (n: number) => n * 0.95,
  (n: number) => n * 1.05,
]
const BRUSH_PROPS = {
  height: 40, stroke: 'rgba(255,255,255,0.10)', fill: '#070b10',
  travellerWidth: 7, tickFormatter: fmtAxisDate, gap: 4,
} as const
const fmtK  = (v: number) => `${v.toFixed(0)}K`
const fmtKd = (v: number) => `${v.toFixed(1)}K`
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtPctd = (v: number) => `${v.toFixed(2)}%`

// ── Reusable chart sections ────────────────────────────────────────────────────

function ClaimsLineSection({ title, data, active, onToggle, brush, onBrushChange, onSelect }: {
  title:         string
  data:          LineData[]
  active:        Set<string>
  onToggle:      (k: string) => void
  brush:         BrushState
  onBrushChange: (e: { startIndex?: number; endIndex?: number }) => void
  onSelect:      (label: string, count: number) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>{title}</span>
        <LegendRow series={LINE_SERIES} active={active} onToggle={onToggle} />
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={52}
              tickFormatter={fmtK} domain={Y_DOMAIN} />
            <Tooltip content={<ChartTooltip formatValue={fmtKd} />} />
            <Line type="monotone" dataKey="raw" name="Weekly"  stroke="#3b82f6"
              dot={false} strokeWidth={1.2} strokeDasharray="4 3"
              isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="ma4" name="4wk MA" stroke="#ef4444"
              dot={false} strokeWidth={1.8}
              isAnimationActive={false} connectNulls />
            <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
              onChange={onBrushChange} {...BRUSH_PROPS} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <QuickSelect active={brush.period} onSelect={onSelect} />
    </div>
  )
}

function YoYSection({ title, subtitle, data, brush, onBrushChange, onSelect }: {
  title:         string
  subtitle:      string
  data:          YoYData[]
  brush:         BrushState
  onBrushChange: (e: { startIndex?: number; endIndex?: number }) => void
  onSelect:      (label: string, count: number) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}</div>
          <div className={styles.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={52}
              tickFormatter={fmtPct} />
            <Tooltip content={<ChartTooltip formatValue={fmtPctd} />} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
            <Line type="monotone" dataKey="yoy" name="YoY %Δ" stroke="#22c55e"
              dot={false} strokeWidth={1.5}
              isAnimationActive={false} connectNulls />
            <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
              onChange={onBrushChange} {...BRUSH_PROPS} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <QuickSelect active={brush.period} onSelect={onSelect} />
    </div>
  )
}

// ── Heatmap section ───────────────────────────────────────────────────────────

function HeatmapSection({ title, subtitle, data }: {
  title:    string
  subtitle: string
  data:     WD[]
}) {
  const [tooltip, setTooltip] = useState<{
    year: number; week: number; value: number | null; x: number; y: number
  } | null>(null)

  const { grid, breakpoints } = useMemo(
    () => buildHeatmapData(data),
    [data],
  )

  return (
    <div className={styles.section}>

      {/* Header: title + percentile color-scale legend */}
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}</div>
          <div className={styles.sectionSubtitle}>{subtitle}</div>
        </div>
        <div className={styles.hmLegendWrap}>
          <div className={styles.hmLegendBar} />
          <div className={styles.hmLegendTicks}>
            {breakpoints.map(bp => (
              <div key={bp.pct} className={styles.hmLegendTick}>
                <span className={styles.hmLegendTickPct}>P{bp.pct}</span>
                <span className={styles.hmLegendTickVal}>{bp.value.toFixed(0)}K</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div
        className={styles.heatmapWrap}
        onMouseLeave={() => setTooltip(null)}
      >
        <div className={styles.heatmapGrid}>

          {/* Top-left corner */}
          <div className={styles.hmCorner} />

          {/* Year column headers */}
          {HEATMAP_YEARS.map(year => (
            <div key={`yr-${year}`} className={styles.hmColHeader}>
              <span className={styles.hmColHeaderText}>{year}</span>
            </div>
          ))}

          {/* Data rows: one row header + 27 cells per week */}
          {HEATMAP_WEEKS.flatMap(week => [
            <div key={`wk-${week}`} className={styles.hmRowHeader}>{week}</div>,
            ...HEATMAP_YEARS.map(year => {
              const value = grid.get(year)?.get(week) ?? null
              const color = value !== null
                ? tToColor(valueToT(value, breakpoints))
                : undefined
              return (
                <div
                  key={`${year}-${week}`}
                  className={color ? styles.hmCell : styles.hmCellEmpty}
                  style={color ? { background: color } : undefined}
                  onMouseEnter={e => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setTooltip({ year, week, value, x: r.right + 6, y: r.top })
                  }}
                />
              )
            }),
          ])}

        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className={styles.hmTooltip}
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <span style={{ color: '#94A3B8' }}>{tooltip.year}</span>
          <span style={{ color: '#4e6070' }}> · Wk {tooltip.week}</span>
          {tooltip.value !== null
            ? <span style={{ color: '#CBD5E1' }}> · {tooltip.value.toFixed(1)}K</span>
            : <span style={{ color: '#475569' }}> · no data</span>
          }
        </div>
      )}

    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ClaimsDashboardContent() {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [allData, setAllData] = useState<AllData>({})

  // Active series — Charts 1-4 (raw + ma4 toggleable)
  const [activeIC_NSA, setActiveIC_NSA] = useState<Set<string>>(() => new Set(['raw', 'ma4']))
  const [activeCC_NSA, setActiveCC_NSA] = useState<Set<string>>(() => new Set(['raw', 'ma4']))
  const [activeIC_SA,  setActiveIC_SA]  = useState<Set<string>>(() => new Set(['raw', 'ma4']))
  const [activeCC_SA,  setActiveCC_SA]  = useState<Set<string>>(() => new Set(['raw', 'ma4']))

  // Active years — Charts 5-6
  const [activeICYear, setActiveICYear] = useState<Set<string>>(
    () => new Set(YEAR_SERIES.map(y => String(y.year)))
  )
  const [activeCCYear, setActiveCCYear] = useState<Set<string>>(
    () => new Set(YEAR_SERIES.map(y => String(y.year)))
  )

  // Brush state — Charts 1-4 and 7-8
  const [bIC_NSA, setBIC_NSA] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bCC_NSA, setBCC_NSA] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bIC_SA,  setBIC_SA]  = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bCC_SA,  setBCC_SA]  = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bYoY_IC, setBYoY_IC] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bYoY_CC, setBYoY_CC] = useState<BrushState>({ start: 0, end: 0, period: '' })

  // Toggle handlers
  const toggleIC_NSA = makeToggle(setActiveIC_NSA)
  const toggleCC_NSA = makeToggle(setActiveCC_NSA)
  const toggleIC_SA  = makeToggle(setActiveIC_SA)
  const toggleCC_SA  = makeToggle(setActiveCC_SA)
  const toggleICYear = makeToggle(setActiveICYear)
  const toggleCCYear = makeToggle(setActiveCCYear)

  // Brush change handlers
  const changeIC_NSA = makeBrushChange(setBIC_NSA)
  const changeCC_NSA = makeBrushChange(setBCC_NSA)
  const changeIC_SA  = makeBrushChange(setBIC_SA)
  const changeCC_SA  = makeBrushChange(setBCC_SA)
  const changeYoY_IC = makeBrushChange(setBYoY_IC)
  const changeYoY_CC = makeBrushChange(setBYoY_CC)

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    Promise.all(
      ALL_CLAIMS_IDS.map(id =>
        fetchFredSeries(id, { observationStart: '1967-01-01' })
          .then(obs => {
            const valid = obs
              .filter(o => o.value !== '.' && o.value.trim() !== '')
              .map(o => ({ date: o.date, value: parseFloat(o.value) }))
              .filter(o => !isNaN(o.value))
            return [id, valid] as [string, WD[]]
          })
      )
    ).then(entries => {
      if (cancelled) return
      const data: AllData = Object.fromEntries(entries)
      setAllData(data)

      const icnsa = data['ICNSA'] ?? []
      const ccnsa = data['CCNSA'] ?? []
      const icsa  = data['ICSA']  ?? []
      const ccsa  = data['CCSA']  ?? []

      setBIC_NSA(b => ({ ...b, ...initBrush(icnsa, '2021-01-01') }))
      setBCC_NSA(b => ({ ...b, ...initBrush(ccnsa, '2021-01-01') }))
      setBIC_SA( b => ({ ...b, ...initBrush(icsa,  '2021-01-01') }))
      setBCC_SA( b => ({ ...b, ...initBrush(ccsa,  '2021-01-01') }))

      // YoY default: Jan 2022
      const icYoY = buildYoYData(icnsa)
      const ccYoY = buildYoYData(ccnsa)
      setBYoY_IC(b => ({ ...b, ...initBrush(icYoY, '2022-01-01') }))
      setBYoY_CC(b => ({ ...b, ...initBrush(ccYoY, '2022-01-01') }))

      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // ── Chart data (useMemo) ────────────────────────────────────────────────────

  // Charts 1-4: weekly line + 4wk MA
  const icNsaData = useMemo(
    () => buildLineData(allData['ICNSA'] ?? [], activeIC_NSA),
    [allData, activeIC_NSA]
  )
  const ccNsaData = useMemo(
    () => buildLineData(allData['CCNSA'] ?? [], activeCC_NSA),
    [allData, activeCC_NSA]
  )
  const icSaData = useMemo(
    () => buildLineData(allData['ICSA']  ?? [], activeIC_SA),
    [allData, activeIC_SA]
  )
  const ccSaData = useMemo(
    () => buildLineData(allData['CCSA']  ?? [], activeCC_SA),
    [allData, activeCC_SA]
  )

  // Charts 5-6: by-year seasonal
  const icByYearData = useMemo(
    () => buildByYearData(allData['ICNSA'] ?? [], activeICYear),
    [allData, activeICYear]
  )
  const ccByYearData = useMemo(
    () => buildByYearData(allData['CCNSA'] ?? [], activeCCYear),
    [allData, activeCCYear]
  )

  // Charts 7-8: YoY %
  const icYoYData = useMemo(
    () => buildYoYData(allData['ICNSA'] ?? []),
    [allData]
  )
  const ccYoYData = useMemo(
    () => buildYoYData(allData['CCNSA'] ?? []),
    [allData]
  )

  // Period select handlers (defined after memos that they reference)
  const selectIC_NSA = makeSelectPeriod(() => icNsaData,  setBIC_NSA)
  const selectCC_NSA = makeSelectPeriod(() => ccNsaData,  setBCC_NSA)
  const selectIC_SA  = makeSelectPeriod(() => icSaData,   setBIC_SA)
  const selectCC_SA  = makeSelectPeriod(() => ccSaData,   setBCC_SA)
  const selectYoY_IC = makeSelectPeriod(() => icYoYData,  setBYoY_IC)
  const selectYoY_CC = makeSelectPeriod(() => ccYoYData,  setBYoY_CC)

  // Year legend series derived from constants
  const yearLegendSeries = YEAR_SERIES.map(ys => ({
    key:    String(ys.year),
    label:  String(ys.year),
    color:  ys.color,
    dashed: false,
  }))

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
        <div>
          <div className={styles.pageTitle}>Claims Dashboard</div>
          <div className={styles.pageSub}>
            Initial &amp; continuing unemployment insurance claims — ICNSA · ICSA · CCNSA · CCSA
          </div>
        </div>

        {loading && (
          <div className={styles.statusBlock}>LOADING DATA…</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── Row 1: Initial + Continuing Claims NSA ─────────────────── */}
            <div className={styles.chartRow}>
              <ClaimsLineSection
                title="Initial Claims — Not Seasonally Adjusted"
                data={icNsaData}
                active={activeIC_NSA}
                onToggle={toggleIC_NSA}
                brush={bIC_NSA}
                onBrushChange={changeIC_NSA}
                onSelect={selectIC_NSA}
              />
              <ClaimsLineSection
                title="Continuing Claims — Not Seasonally Adjusted"
                data={ccNsaData}
                active={activeCC_NSA}
                onToggle={toggleCC_NSA}
                brush={bCC_NSA}
                onBrushChange={changeCC_NSA}
                onSelect={selectCC_NSA}
              />
            </div>

            {/* ── Row 2: Initial + Continuing Claims SA ──────────────────── */}
            <div className={styles.chartRow}>
              <ClaimsLineSection
                title="Initial Claims — Seasonally Adjusted"
                data={icSaData}
                active={activeIC_SA}
                onToggle={toggleIC_SA}
                brush={bIC_SA}
                onBrushChange={changeIC_SA}
                onSelect={selectIC_SA}
              />
              <ClaimsLineSection
                title="Continuing Claims — Seasonally Adjusted"
                data={ccSaData}
                active={activeCC_SA}
                onToggle={toggleCC_SA}
                brush={bCC_SA}
                onBrushChange={changeCC_SA}
                onSelect={selectCC_SA}
              />
            </div>

            {/* ── Row 3: By-year seasonal comparison ─────────────────────── */}
            <div className={styles.chartRow}>

              {/* Chart 5: Initial Claims by Year */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Initial Claims by Year</div>
                    <div className={styles.sectionSubtitle}>4wk Avg — Not Seasonally Adjusted</div>
                  </div>
                  <LegendRow
                    series={yearLegendSeries}
                    active={activeICYear}
                    onToggle={toggleICYear}
                  />
                </div>
                <div className={styles.chartWrapYear}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={icByYearData} margin={{ top: 4, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="week"
                        type="number"
                        domain={[1, 53]}
                        tick={TICK}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => String(v)}
                        label={{ value: 'Week of Year', position: 'insideBottom', offset: -2, fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                      />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={52}
                        tickFormatter={fmtK} domain={Y_DOMAIN} />
                      <Tooltip content={<ChartTooltip formatValue={fmtKd} />} />
                      {YEAR_SERIES.map(ys => (
                        <Line
                          key={ys.year}
                          type="monotone"
                          dataKey={String(ys.year)}
                          name={String(ys.year)}
                          stroke={ys.color}
                          dot={false}
                          strokeWidth={ys.year >= 2025 ? 2 : 1.5}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 6: Continuing Claims by Year */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Continuing Claims by Year</div>
                    <div className={styles.sectionSubtitle}>4wk Avg — Not Seasonally Adjusted</div>
                  </div>
                  <LegendRow
                    series={yearLegendSeries}
                    active={activeCCYear}
                    onToggle={toggleCCYear}
                  />
                </div>
                <div className={styles.chartWrapYear}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ccByYearData} margin={{ top: 4, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="week"
                        type="number"
                        domain={[1, 53]}
                        tick={TICK}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => String(v)}
                        label={{ value: 'Week of Year', position: 'insideBottom', offset: -2, fill: '#475569', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                      />
                      <YAxis tick={TICK} tickLine={false} axisLine={false} width={52}
                        tickFormatter={fmtK} domain={Y_DOMAIN} />
                      <Tooltip content={<ChartTooltip formatValue={fmtKd} />} />
                      {YEAR_SERIES.map(ys => (
                        <Line
                          key={ys.year}
                          type="monotone"
                          dataKey={String(ys.year)}
                          name={String(ys.year)}
                          stroke={ys.color}
                          dot={false}
                          strokeWidth={ys.year >= 2025 ? 2 : 1.5}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

            {/* ── Row 4: YoY % change ─────────────────────────────────────── */}
            <div className={styles.chartRow}>
              <YoYSection
                title="Initial Claims YoY %Δ"
                subtitle="4wk Avg, Not Seasonally Adjusted"
                data={icYoYData}
                brush={bYoY_IC}
                onBrushChange={changeYoY_IC}
                onSelect={selectYoY_IC}
              />
              <YoYSection
                title="Continuing Claims YoY %Δ"
                subtitle="4wk Avg, Not Seasonally Adjusted"
                data={ccYoYData}
                brush={bYoY_CC}
                onBrushChange={changeYoY_CC}
                onSelect={selectYoY_CC}
              />
            </div>

            {/* ── Row 5: Claims Heatmaps ─────────────────────────────────── */}
            <div className={styles.chartRow}>
              <HeatmapSection
                title="Initial Claims Heatmap"
                subtitle="ICNSA · Weekly · Thousands · 2000 – 2026 · rows = week of year · columns = year"
                data={allData['ICNSA'] ?? []}
              />
              <HeatmapSection
                title="Continuing Claims Heatmap"
                subtitle="CCNSA · Weekly · Thousands · 2000 – 2026 · rows = week of year · columns = year"
                data={allData['CCNSA'] ?? []}
              />
            </div>

          </>
        )}
    </>
  )
}

export function ClaimsDashboardPage() {
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
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor" className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>Claims Dashboard</span>
      </nav>

      <main className={styles.body}>
        <ClaimsDashboardContent />
      </main>
    </div>
  )
}
