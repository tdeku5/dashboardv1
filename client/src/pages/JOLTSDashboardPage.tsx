import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  ScatterChart,
  Scatter,
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
import { fetchFredSeries } from '../lib/fred'
import styles from './JOLTSDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }
type RateKey    = 'openings' | 'hires' | 'quits' | 'layoffs'
type NullableRow = { date: string; value: number | null }

interface RateRow {
  date:   string
  rate:   number | null
  ma:     number | null
  change: number | null
}

interface ImpliedRow {
  date:       string
  hires:      number | null
  totalSep:   number | null
  hiresMA:    number | null
  totalSepMA: number | null
  implied:    number | null
  impliedMA:  number | null
  nfpMoM:     number | null
  nfpMoMMA:   number | null
}

interface BevRow {
  date:         string
  unrate:       number | null
  openingsRate: number | null
  year:         number
}

interface RecentDeltaRow {
  flow:  string
  color: string
  t0:    number | null
  t1:    number | null
  t2:    number | null
  t3:    number | null
}

// ── Rate group config ─────────────────────────────────────────────────────────

const RATE_GROUPS = [
  { key: 'openings' as const, label: 'Job Openings Rate', seriesId: 'JTSJOL', color: '#60a5fa' },
  { key: 'hires'    as const, label: 'Hires Rate',        seriesId: 'JTSHIL', color: '#f87171' },
  { key: 'quits'    as const, label: 'Quits Rate',        seriesId: 'JTSQUL', color: '#fb923c' },
  { key: 'layoffs'  as const, label: 'Layoffs Rate',      seriesId: 'JTSLDL', color: '#4ade80' },
] as const

const RECENT_MONTHS = [
  { key: 't0' as const, label: 'Last',  color: '#3b82f6' },
  { key: 't1' as const, label: 't−1',  color: '#4ade80' },
  { key: 't2' as const, label: 't−2',  color: '#f87171' },
  { key: 't3' as const, label: 't−3',  color: '#a78bfa' },
]

const JOLTS_FLOWS = [
  { key: 'JTSJOL', label: 'Openings',      color: '#60a5fa' },
  { key: 'JTSHIL', label: 'Hires',         color: '#f87171' },
  { key: 'JTSQUL', label: 'Quits',         color: '#fb923c' },
  { key: 'JTSLDL', label: 'Layoffs',       color: '#4ade80' },
  { key: 'JTSOSL', label: 'Other Sep',     color: '#e879f9' },
  { key: 'JTSTSL', label: 'Total Sep',     color: '#94a3b8' },
] as const

const ALL_JOLTS_FETCH = ['JTSJOL', 'JTSHIL', 'JTSQUL', 'JTSLDL', 'JTSOSL', 'JTSTSL', 'PAYEMS', 'UNRATE']

const QUICK_PERIODS = [
  { label: '1Y',  count: 12       },
  { label: '2Y',  count: 24       },
  { label: '5Y',  count: 60       },
  { label: '10Y', count: 120      },
  { label: 'Max', count: Infinity },
] as const

// ── Chart constants ───────────────────────────────────────────────────────────

const CM   = { top: 8, right: 16, bottom: 28, left: 62 } as const
const CMR  = { top: 8, right: 72, bottom: 28, left: 62 } as const  // dual-axis
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

const MINI_BRUSH = {
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

// ── Beveridge year palette ────────────────────────────────────────────────────

function yearColor(year: number): string {
  // Golden-angle hue stepping: 222° ≈ 360 × (1 − 1/φ²) → adjacent years
  // land on opposite sides of the hue wheel, maximising perceptual contrast.
  // Alternating lightness adds a second dimension of separation.
  const i = year - 2001
  const h = (i * 222) % 360
  const s = 72
  const l = i % 2 === 0 ? 62 : 54
  return `hsl(${h},${s}%,${l}%)`
}

const BEV_YEARS = Array.from({ length: 26 }, (_, i) => 2001 + i)   // 2001 – 2026

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

function fmtMonthYear(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} ${y}`
}

function fmtPct1(v: number): string  { return `${v.toFixed(2)}%` }
function fmtPp(v: number): string    { return `${v > 0 ? '+' : ''}${v.toFixed(2)} pp` }
function fmtK(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}M`
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}K`
}
function fmtKLevel(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}M`
  return `${v.toFixed(0)}K`
}

function initBrush(data: { date: string }[], from: string): Pick<BrushState, 'start' | 'end'> {
  const end = data.length - 1
  const idx = data.findIndex(d => d.date >= from)
  return { start: idx >= 0 ? idx : 0, end }
}

// ── Compute helpers ───────────────────────────────────────────────────────────

function computeMA(data: NullableRow[], window: number): NullableRow[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null }
    const slice = data.slice(i - window + 1, i + 1)
    const valid = slice.filter(s => s.value != null).map(s => s.value as number)
    if (valid.length < window) return { date: d.date, value: null }
    return { date: d.date, value: valid.reduce((a, b) => a + b, 0) / window }
  })
}

function computeXmoChange(data: NullableRow[], period: number): NullableRow[] {
  return data.map((d, i) => {
    if (i < period) return { date: d.date, value: null }
    const prev = data[i - period]
    if (d.value == null || prev.value == null) return { date: d.date, value: null }
    return { date: d.date, value: d.value - prev.value }
  })
}

// ── Rate chart data builder ───────────────────────────────────────────────────

function buildRateData(key: RateKey, allData: AllData, period: number): RateRow[] {
  const group    = RATE_GROUPS.find(g => g.key === key)!
  const rawData  = allData[group.seriesId] ?? []
  const payems   = allData['PAYEMS'] ?? []
  const payMap   = new Map(payems.map(d => [d.date, d.value]))

  const rateRows: NullableRow[] = key === 'openings'
    ? rawData.map(d => {
        const pay = payMap.get(d.date)
        if (pay == null) return { date: d.date, value: null }
        return { date: d.date, value: (d.value / (d.value + pay)) * 100 }
      })
    : rawData.map(d => {
        const pay = payMap.get(d.date)
        if (pay == null || pay === 0) return { date: d.date, value: null }
        return { date: d.date, value: (d.value / pay) * 100 }
      })

  const maRows     = computeMA(rateRows, period)
  const changeRows = computeXmoChange(rateRows, period)

  return rateRows.map((d, i) => ({
    date:   d.date,
    rate:   d.value,
    ma:     maRows[i].value,
    change: changeRows[i].value,
  }))
}

// ── Recent 1moΔ builder ───────────────────────────────────────────────────────

function buildRecentDelta(allData: AllData): { rows: RecentDeltaRow[]; dates: string[] } {
  // Use JTSJOL as the date spine (all JOLTS series share dates)
  const spine = allData['JTSJOL'] ?? []
  const n     = spine.length
  if (n < 5) return { rows: [], dates: [] }

  const dates = [
    spine[n - 1].date,
    spine[n - 2].date,
    spine[n - 3].date,
    spine[n - 4].date,
  ]

  const rows: RecentDeltaRow[] = JOLTS_FLOWS.map(flow => {
    const data = allData[flow.key] ?? []
    const map  = new Map(data.map(d => [d.date, d.value]))
    const v = [0, 1, 2, 3, 4].map(i => map.get(spine[n - 1 - i]?.date ?? '') ?? null)
    return {
      flow:  flow.label,
      color: flow.color,
      t0: v[0] != null && v[1] != null ? v[0] - v[1] : null,
      t1: v[1] != null && v[2] != null ? v[1] - v[2] : null,
      t2: v[2] != null && v[3] != null ? v[2] - v[3] : null,
      t3: v[3] != null && v[4] != null ? v[3] - v[4] : null,
    }
  })

  return { rows, dates }
}

// ── Implied NFP builder ───────────────────────────────────────────────────────

function buildImpliedNFP(allData: AllData, maWindow: number): ImpliedRow[] {
  const hires    = allData['JTSHIL'] ?? []
  const sepData  = allData['JTSTSL'] ?? []
  const payems   = allData['PAYEMS'] ?? []
  const hiresMap = new Map(hires.map(d => [d.date, d.value]))
  const sepMap   = new Map(sepData.map(d => [d.date, d.value]))
  const payMap   = new Map(payems.map(d => [d.date, d.value]))

  // Build per-series NullableRows for MA computation
  const hiresRows:   NullableRow[] = hires.map(d => ({ date: d.date, value: hiresMap.get(d.date) ?? null }))
  const sepRows:     NullableRow[] = hires.map(d => ({ date: d.date, value: sepMap.get(d.date) ?? null }))
  const impliedRows: NullableRow[] = hires.map(d => {
    const h = hiresMap.get(d.date)
    const s = sepMap.get(d.date)
    return { date: d.date, value: h != null && s != null ? h - s : null }
  })
  const nfpMoMRows: NullableRow[] = hires.map((d, i) => {
    if (i === 0) return { date: d.date, value: null }
    const pay  = payMap.get(d.date)
    const prev = payMap.get(hires[i - 1].date)
    return { date: d.date, value: pay != null && prev != null ? pay - prev : null }
  })

  const hiresMA   = computeMA(hiresRows,   maWindow)
  const sepMA     = computeMA(sepRows,     maWindow)
  const impliedMA = computeMA(impliedRows, maWindow)
  const nfpMoMMA  = computeMA(nfpMoMRows,  maWindow)

  return hires.map((d, i) => ({
    date:       d.date,
    hires:      hiresRows[i].value,
    totalSep:   sepRows[i].value,
    hiresMA:    hiresMA[i].value,
    totalSepMA: sepMA[i].value,
    implied:    impliedRows[i].value,
    impliedMA:  impliedMA[i].value,
    nfpMoM:     nfpMoMRows[i].value,
    nfpMoMMA:   nfpMoMMA[i].value,
  }))
}

// ── Beveridge curve builder ───────────────────────────────────────────────────

function buildBeveridge(allData: AllData): BevRow[] {
  const jolData  = allData['JTSJOL'] ?? []
  const payems   = allData['PAYEMS'] ?? []
  const unrate   = allData['UNRATE'] ?? []
  const payMap   = new Map(payems.map(d => [d.date, d.value]))
  const unMap    = new Map(unrate.map(d => [d.date, d.value]))

  return jolData.map(d => {
    const pay = payMap.get(d.date)
    const un  = unMap.get(d.date)
    const openRate = pay != null ? (d.value / (d.value + pay)) * 100 : null
    const year = parseInt(d.date.split('-')[0])
    return {
      date:         d.date,
      unrate:       un ?? null,
      openingsRate: openRate,
      year,
    }
  })
}

// ── Beveridge custom tooltip ──────────────────────────────────────────────────

interface BevTooltipPayload {
  payload?: { x: number; y: number; date: string }
}

function BevTooltip({ active, payload }: { active?: boolean; payload?: readonly BevTooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const pt = payload[0].payload
  if (!pt) return null
  return (
    <div style={{
      background:   '#090e15',
      border:       '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      fontFamily:   'var(--font-mono)',
      fontSize:     11,
      padding:      '6px 10px',
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>
        {fmtMonthYear(pt.date)}
      </div>
      <div style={{ color: '#CBD5E1', padding: '1px 0' }}>
        Unemployment: {pt.x.toFixed(1)}%
      </div>
      <div style={{ color: '#CBD5E1', padding: '1px 0' }}>
        Job Openings Rate: {pt.y.toFixed(2)}%
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function JOLTSDashboardPage() {
  // ── State ──────────────────────────────────────────────────────────────────

  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Rate group period controls (X-month MA + change window)
  const [periods, setPeriods] = useState<Record<RateKey, number>>({
    openings: 3, hires: 3, quits: 3, layoffs: 3,
  })

  // Rate group brushes
  const [brushes, setBrushes] = useState<Record<RateKey, BrushState>>({
    openings: { start: 0, end: 0, period: 'Max' },
    hires:    { start: 0, end: 0, period: 'Max' },
    quits:    { start: 0, end: 0, period: 'Max' },
    layoffs:  { start: 0, end: 0, period: 'Max' },
  })

  // Implied NFP
  const [impliedMaWindow, setImpliedMaWindow] = useState(3)
  const [impliedBrush,    setImpliedBrush]    = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all(ALL_JOLTS_FETCH.map(id =>
      fetchFredSeries(id).then(obs => ({
        id,
        data: obs
          .filter(o => o.value !== '.')
          .map(o => ({ date: o.date, value: parseFloat(o.value) }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      }))
    ))
      .then(results => {
        if (cancelled) return
        const data: AllData = {}
        for (const r of results) data[r.id] = r.data
        setAllData(data)

        const jol = data['JTSJOL'] ?? []
        const n   = jol.length
        if (n === 0) return

        const defaultFrom = '2019-01-01'

        const makeBrush = (arr: { date: string }[]) => ({
          ...initBrush(arr, defaultFrom),
          period: '5Y',
        })

        setBrushes({
          openings: makeBrush(jol),
          hires:    makeBrush(jol),
          quits:    makeBrush(jol),
          layoffs:  makeBrush(jol),
        })

        setImpliedBrush({ ...makeBrush(jol) })
        setLoading(false)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  // ── Rate chart data ────────────────────────────────────────────────────────

  const openingsData = useMemo(
    () => buildRateData('openings', allData, periods.openings),
    [allData, periods.openings]
  )
  const hiresData = useMemo(
    () => buildRateData('hires', allData, periods.hires),
    [allData, periods.hires]
  )
  const quitsData = useMemo(
    () => buildRateData('quits', allData, periods.quits),
    [allData, periods.quits]
  )
  const layoffsData = useMemo(
    () => buildRateData('layoffs', allData, periods.layoffs),
    [allData, periods.layoffs]
  )

  const rateDataMap: Record<RateKey, RateRow[]> = {
    openings: openingsData,
    hires:    hiresData,
    quits:    quitsData,
    layoffs:  layoffsData,
  }

  // ── Recent delta ───────────────────────────────────────────────────────────

  const { rows: recentRows, dates: recentDates } = useMemo(
    () => buildRecentDelta(allData),
    [allData]
  )

  // ── Implied NFP ────────────────────────────────────────────────────────────

  const impliedData = useMemo(
    () => buildImpliedNFP(allData, impliedMaWindow),
    [allData, impliedMaWindow]
  )

  // ── Beveridge ──────────────────────────────────────────────────────────────

  const bevData = useMemo(() => buildBeveridge(allData), [allData])

  const bevByYear = useMemo(() => {
    const map: Record<number, { x: number; y: number; date: string }[]> = {}
    for (const row of bevData) {
      if (row.unrate == null || row.openingsRate == null) continue
      if (!map[row.year]) map[row.year] = []
      map[row.year].push({ x: row.unrate, y: row.openingsRate, date: row.date })
    }
    return map
  }, [bevData])

  const latestBev = useMemo(() => {
    for (let i = bevData.length - 1; i >= 0; i--) {
      if (bevData[i].unrate != null && bevData[i].openingsRate != null)
        return { x: bevData[i].unrate as number, y: bevData[i].openingsRate as number, date: bevData[i].date }
    }
    return null
  }, [bevData])

  // ── Brush handlers ─────────────────────────────────────────────────────────

  function handleRateBrush(key: RateKey, data: RateRow[]) {
    return (e: { startIndex?: number; endIndex?: number }) => {
      const s = e.startIndex ?? 0
      const end = e.endIndex ?? data.length - 1
      setBrushes(prev => ({ ...prev, [key]: { ...prev[key], start: s, end, period: '' } }))
    }
  }

  function setRateQs(key: RateKey, count: number, data: RateRow[]) {
    const end   = data.length - 1
    const start = count === Infinity ? 0 : Math.max(0, end - count + 1)
    setBrushes(prev => ({
      ...prev,
      [key]: { start, end, period: count === Infinity ? 'Max' : String(count) },
    }))
  }

  function handleImpliedBrush(e: { startIndex?: number; endIndex?: number }) {
    const s   = e.startIndex ?? 0
    const end = e.endIndex ?? impliedData.length - 1
    setImpliedBrush(prev => ({ ...prev, start: s, end, period: '' }))
  }

  function setImpliedQs(count: number) {
    const end   = impliedData.length - 1
    const start = count === Infinity ? 0 : Math.max(0, end - count + 1)
    setImpliedBrush({ start, end, period: count === Infinity ? 'Max' : String(count) })
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderRateGroup(key: RateKey) {
    const group   = RATE_GROUPS.find(g => g.key === key)!
    const data    = rateDataMap[key]
    const brush   = brushes[key]
    const period  = periods[key]
    const color   = group.color
    const visible = data.slice(brush.start, brush.end + 1)

    return (
      <div key={key} className={styles.rateGroup}>
        {/* Header */}
        <div className={styles.rateGroupHeader}>
          <div>
            <div className={styles.sectionTitle}>{group.label}</div>
          </div>
          <div className={styles.controls}>
            <div className={styles.lookbackWrap}>
              <span className={styles.lookbackLabel}>Period</span>
              <input
                type="number"
                min={1}
                max={24}
                value={period}
                className={styles.lookbackInput}
                onChange={e => {
                  const v = parseInt(e.target.value)
                  if (v >= 1 && v <= 24) setPeriods(prev => ({ ...prev, [key]: v }))
                }}
              />
              <span className={styles.lookbackLabel}>mo</span>
            </div>
          </div>
        </div>

        {/* Top chart: rate level + MA */}
        <div className={styles.rateTopChart}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visible} margin={CM}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={TICK} minTickGap={60} />
              <YAxis tickFormatter={fmtPct1} tick={TICK} width={52} domain={['auto', 'auto']} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: string | undefined) => {
                  if (typeof v !== 'number') return ['-', name ?? '']
                  return [fmtPct1(v), name ?? '']
                }}
              />
              <Line dataKey="rate" name="Rate"          stroke={color}   dot={false} strokeWidth={1.5} connectNulls />
              <Line dataKey="ma"   name={`${period}mo MA`} stroke="#ffffff" dot={false} strokeWidth={1.2} strokeDasharray="4 2" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom chart: X-month change bars + brush */}
        <div className={styles.rateBottomChart}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ ...CM, bottom: 4, left: 66 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={TICK} minTickGap={60} hide />
              <YAxis
                tickFormatter={v => (v as number).toFixed(2)}
                tick={TICK}
                width={56}
                label={{
                  value: 'pp change',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#4e6070',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  offset: 10,
                }}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.20)" />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v: unknown) => typeof v === 'string' ? fmtFullDate(v) : ''}
                formatter={(v: unknown, name: string | undefined) => {
                  if (typeof v !== 'number') return ['-', name ?? '']
                  return [fmtPp(v), name ?? '']
                }}
              />
              <Bar dataKey="change" name={`${period}mo Chg`} fill={color} fillOpacity={0.8} maxBarSize={12} isAnimationActive={false} />
              <Brush
                dataKey="date"
                startIndex={brush.start}
                endIndex={brush.end}
                onChange={handleRateBrush(key, data)}
                {...MINI_BRUSH}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* QuickSelect */}
        <div className={styles.quickSelectRow}>
          <span className={styles.quickSelectLabel}>Range</span>
          {QUICK_PERIODS.map(qp => (
            <button
              key={qp.label}
              className={`${styles.qsBtn} ${brush.period === qp.label ? styles.qsBtnActive : ''}`}
              onClick={() => setRateQs(key, qp.count, data)}
            >
              {qp.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb}>
        <Link to="/models"        className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor"  className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>JOLTS Dashboard</span>
      </nav>

      {/* Body */}
      <main className={styles.body}>
        {loading && <div className={styles.statusBlock}>Loading JOLTS data…</div>}
        {error   && <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>}

        {!loading && !error && (
          <>
            {/* ── Section 1: Rate Charts ──────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>JOLTS Rates</div>
                  <div className={styles.sectionSubtitle}>
                    Openings / (Openings + Payrolls) · Others / Payrolls
                  </div>
                </div>
              </div>
              <div style={{ padding: '16px' }}>
                <div className={styles.rateGrid}>
                  {RATE_GROUPS.map(g => renderRateGroup(g.key))}
                </div>
              </div>
            </div>

            {/* ── Sections 2 + 3: side by side ───────────────────────────── */}
            <div className={styles.twoColGrid}>

            {/* ── Section 2: Recent 1moΔ ──────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Recent 1-Month Change</div>
                  <div className={styles.sectionSubtitle}>
                    Month-over-month change in level (thousands) — 4 most recent months
                  </div>
                </div>
                {recentDates.length > 0 && (
                  <div className={styles.controls}>
                    {RECENT_MONTHS.map((m, i) => (
                      <div key={m.key} className={styles.legendItem}>
                        <span className={styles.legendSwatch} style={{ background: m.color }} />
                        <span style={{ color: '#94A3B8', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                          {m.label}{recentDates[i] ? ` (${fmtAxisDate(recentDates[i])})` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.recentChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    layout="vertical"
                    data={recentRows}
                    margin={{ top: 8, right: 24, bottom: 8, left: 100 }}
                  >
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      type="number"
                      tickFormatter={v => fmtK(v as number)}
                      tick={TICK}
                      minTickGap={40}
                    />
                    <YAxis
                      type="category"
                      dataKey="flow"
                      tick={{ ...TICK, textAnchor: 'end' }}
                      width={96}
                    />
                    <ReferenceLine x={0} stroke="rgba(255,255,255,0.20)" />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      labelFormatter={(v: unknown) => String(v)}
                      formatter={(v: unknown, name: string | undefined) => {
                        if (typeof v !== 'number') return ['-', name ?? '']
                        return [`${v >= 0 ? '+' : ''}${v.toFixed(0)}K`, name ?? '']
                      }}
                    />
                    {RECENT_MONTHS.map(m => (
                      <Bar
                        key={m.key}
                        dataKey={m.key}
                        name={m.label}
                        fill={m.color}
                        maxBarSize={14}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Section 3: Implied NFP Growth ───────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>JOLTS Implied NFP Growth</div>
                  <div className={styles.sectionSubtitle}>
                    Implied NFP = Hires − Total Separations · Right axis vs Payroll MoM
                  </div>
                </div>
                <div className={styles.controls}>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA</span>
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={impliedMaWindow}
                      className={styles.lookbackInput}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (v >= 1 && v <= 24) setImpliedMaWindow(v)
                      }}
                    />
                    <span className={styles.lookbackLabel}>mo avg</span>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <div className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#f87171' }} />
                    <span>Hires</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#a78bfa' }} />
                    <span>Total Sep</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} />
                    <span>Implied NFP (right)</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                    <span>NFP MoM (right)</span>
                  </div>
                </div>
              </div>

              <div className={styles.impliedChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={impliedData.slice(impliedBrush.start, impliedBrush.end + 1)}
                    margin={CMR}
                  >
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={TICK} minTickGap={60} />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={v => fmtKLevel(v as number)}
                      tick={TICK}
                      width={60}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={v => fmtK(v as number)}
                      tick={TICK}
                      width={62}
                    />
                    <ReferenceLine yAxisId="right" y={0} stroke="rgba(255,255,255,0.20)" />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: string | undefined) => {
                        if (typeof v !== 'number') return ['-', name ?? '']
                        if (name === 'Hires' || name === 'Total Sep') return [fmtKLevel(v), name ?? '']
                        return [fmtK(v), name ?? '']
                      }}
                    />
                    {/* Left axis: level lines */}
                    <Line yAxisId="left"  dataKey="hiresMA"    name="Hires"     stroke="#f87171" dot={false} strokeWidth={1.5} connectNulls />
                    <Line yAxisId="left"  dataKey="totalSepMA" name="Total Sep" stroke="#a78bfa" dot={false} strokeWidth={1.5} connectNulls />
                    {/* Right axis: implied + NFP */}
                    <Bar  yAxisId="right" dataKey="impliedMA"  name="Implied NFP" maxBarSize={10} isAnimationActive={false}>
                      {impliedData.slice(impliedBrush.start, impliedBrush.end + 1).map(d => (
                        <Cell
                          key={d.date}
                          fill={(d.impliedMA ?? 0) >= 0 ? '#60a5fa' : '#f87171'}
                          fillOpacity={0.75}
                        />
                      ))}
                    </Bar>
                    <Line yAxisId="right" dataKey="nfpMoMMA" name="NFP MoM" stroke="#ffffff" dot={false} strokeWidth={1.5} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Brush */}
              <div className={styles.brushWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={impliedData} margin={{ ...CM, bottom: 4 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Line dataKey="impliedMA" stroke="#60a5fa" dot={false} strokeWidth={1} connectNulls />
                    <Brush
                      dataKey="date"
                      startIndex={impliedBrush.start}
                      endIndex={impliedBrush.end}
                      onChange={handleImpliedBrush}
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* QuickSelect */}
              <div className={styles.quickSelectRow}>
                <span className={styles.quickSelectLabel}>Range</span>
                {QUICK_PERIODS.map(qp => (
                  <button
                    key={qp.label}
                    className={`${styles.qsBtn} ${impliedBrush.period === qp.label ? styles.qsBtnActive : ''}`}
                    onClick={() => setImpliedQs(qp.count)}
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>

            </div>{/* end twoColGrid */}

            {/* ── Section 4: Beveridge Curve ──────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Beveridge Curve</div>
                  <div className={styles.sectionSubtitle}>
                    Unemployment Rate (x) vs Openings Rate (y) — colored by calendar year
                  </div>
                </div>
              </div>

              <div className={styles.bevWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 16, right: 24, bottom: 36, left: 62 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      name="Unemployment Rate"
                      domain={['auto', 'auto']}
                      tickFormatter={v => `${(v as number).toFixed(1)}%`}
                      tick={TICK}
                      label={{
                        value: 'Unemployment Rate (%)',
                        position: 'insideBottom',
                        offset: -12,
                        fill: '#64748B',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <YAxis
                      dataKey="y"
                      type="number"
                      name="Openings Rate"
                      domain={['auto', 'auto']}
                      tickFormatter={v => `${(v as number).toFixed(1)}%`}
                      tick={TICK}
                      width={52}
                      label={{
                        value: 'Openings Rate (%)',
                        angle: -90,
                        position: 'insideLeft',
                        offset: 12,
                        fill: '#64748B',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: '4 4', stroke: 'rgba(255,255,255,0.15)' }}
                      content={(props: { active?: boolean; payload?: readonly BevTooltipPayload[] }) =>
                        <BevTooltip active={props.active} payload={props.payload} />
                      }
                    />

                    {/* One Scatter per year for coloring */}
                    {BEV_YEARS.filter(y => bevByYear[y]?.length).map(year => (
                      <Scatter
                        key={year}
                        name={String(year)}
                        data={bevByYear[year]}
                        fill={yearColor(year)}
                        opacity={0.85}
                        r={3}
                        isAnimationActive={false}
                      />
                    ))}

                    {/* Latest point — larger, white, labeled */}
                    {latestBev && (
                      <>
                        <Scatter
                          name="Latest"
                          data={[latestBev]}
                          fill="#ffffff"
                          r={6}
                          isAnimationActive={false}
                          shape={(props: { cx?: number; cy?: number }) => {
                            const { cx = 0, cy = 0 } = props
                            return (
                              <g>
                                <circle cx={cx} cy={cy} r={6} fill="#ffffff" />
                                <text
                                  x={cx + 9}
                                  y={cy - 7}
                                  fill="#94A3B8"
                                  fontSize={10}
                                  fontFamily="var(--font-mono)"
                                >
                                  {fmtAxisDate(latestBev.date)}
                                </text>
                              </g>
                            )
                          }}
                        />
                      </>
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Year legend — 2 rows */}
              <div className={styles.bevLegend}>
                <div className={styles.bevLegendRow}>
                  {BEV_YEARS.slice(0, 13).map(y => (
                    <div key={y} className={styles.bevLegendItem}>
                      <span className={styles.bevSwatch} style={{ background: yearColor(y) }} />
                      <span>{y}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.bevLegendRow}>
                  {BEV_YEARS.slice(13).map(y => (
                    <div key={y} className={styles.bevLegendItem}>
                      <span className={styles.bevSwatch} style={{ background: yearColor(y) }} />
                      <span>{y}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
