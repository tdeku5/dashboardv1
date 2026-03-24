import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchBEASeries } from '../lib/bea'
import type { FredObservation } from '../lib/fred'
import styles from './PCEProjectionsPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }

interface SeriesModel {
  raw:           WD[]
  currentLevel:  number
  currentDate:   string
  currentYoY:    number | null
  current1moAnn: number | null
  current3moAnn: number | null
  current6moAnn: number | null
  past1moMoM:    number
  past3moAvgMoM: number
  past6moAvgMoM: number
  yoyIn6mo1mo:   number | null
  yoyIn6mo3mo:   number | null
  yoyIn6mo6mo:   number | null
}

// ── Constants ───────────────────────────────────────────────────────────────

const QUICK_PERIODS = [
  { label: '1Y',  count: 12       },
  { label: '2Y',  count: 24       },
  { label: '3Y',  count: 36       },
  { label: 'All', count: Infinity },
] as const

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
  labelStyle: { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle:  { color: '#CBD5E1', padding: '1px 0' },
  cursor:     { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
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

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const COLOR_HIST  = '#ffffff'
const COLOR_1MO   = '#4ade80'
const COLOR_3MO   = '#60a5fa'
const COLOR_6MO   = '#f59e0b'

const HIST_CUTOFF = '2024-01-01'

// ── Pure helpers ────────────────────────────────────────────────────────────

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  return `${MONTHS_SHORT[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

function fmtShortDate(d: string): string {
  const [y, m] = d.split('-')
  return `${MONTHS_SHORT[parseInt(m) - 1]} ${y}`
}

function fmtPct(v: number): string {
  return `${v.toFixed(2)}%`
}

function addMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number)
  let ty = y, tm = m + n
  while (tm < 1)  { ty--; tm += 12 }
  while (tm > 12) { ty++; tm -= 12 }
  return `${ty}-${String(tm).padStart(2, '0')}-01`
}

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.' && o.value.trim() !== '')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !isNaN(o.value))
}

// ── Model computation ───────────────────────────────────────────────────────

function projectYoYAt(
  currentLevel: number,
  mom: number,
  monthsForward: number,
  map: Map<string, number>,
  currentDate: string,
): number | null {
  const projLevel = currentLevel * Math.pow(1 + mom / 100, monthsForward)
  const projDate  = addMonths(currentDate, monthsForward)
  const denomDate = addMonths(projDate, -12)
  const denomLevel = map.get(denomDate)
  if (denomLevel == null || denomLevel === 0) return null
  return (projLevel / denomLevel - 1) * 100
}

function buildModel(data: WD[]): SeriesModel {
  const empty: SeriesModel = {
    raw: data, currentLevel: 0, currentDate: '',
    currentYoY: null, current1moAnn: null, current3moAnn: null, current6moAnn: null,
    past1moMoM: 0, past3moAvgMoM: 0, past6moAvgMoM: 0,
    yoyIn6mo1mo: null, yoyIn6mo3mo: null, yoyIn6mo6mo: null,
  }
  if (data.length < 13) return empty

  const map  = new Map(data.map(d => [d.date, d.value]))
  const last = data[data.length - 1]
  const currentLevel = last.value
  const currentDate  = last.date

  // YoY
  const p12 = map.get(addMonths(currentDate, -12))
  const currentYoY = (p12 != null && p12 !== 0) ? (currentLevel / p12 - 1) * 100 : null

  // 1mo annualized
  const p1 = map.get(addMonths(currentDate, -1))
  const current1moAnn = (p1 != null && p1 !== 0) ? (Math.pow(currentLevel / p1, 12) - 1) * 100 : null

  // 3mo annualized
  const p3 = map.get(addMonths(currentDate, -3))
  const current3moAnn = (p3 != null && p3 !== 0) ? (Math.pow(currentLevel / p3, 4) - 1) * 100 : null

  // 6mo annualized
  const p6 = map.get(addMonths(currentDate, -6))
  const current6moAnn = (p6 != null && p6 !== 0) ? (Math.pow(currentLevel / p6, 2) - 1) * 100 : null

  // MoM% for last 6 months
  const momValues: number[] = []
  for (let i = 0; i < 6; i++) {
    const dCurr = addMonths(currentDate, -i)
    const dPrev = addMonths(currentDate, -i - 1)
    const vCurr = map.get(dCurr)
    const vPrev = map.get(dPrev)
    if (vCurr != null && vPrev != null && vPrev !== 0) {
      momValues.push(((vCurr - vPrev) / vPrev) * 100)
    }
  }

  const past1moMoM    = momValues.length >= 1 ? momValues[0] : 0
  const past3moAvgMoM = momValues.length >= 3
    ? momValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3 : 0
  const past6moAvgMoM = momValues.length >= 6
    ? momValues.reduce((a, b) => a + b, 0) / 6 : 0

  // Project YoY at t+6 for each pace
  const yoyIn6mo1mo = projectYoYAt(currentLevel, past1moMoM,    6, map, currentDate)
  const yoyIn6mo3mo = projectYoYAt(currentLevel, past3moAvgMoM, 6, map, currentDate)
  const yoyIn6mo6mo = projectYoYAt(currentLevel, past6moAvgMoM, 6, map, currentDate)

  return {
    raw: data, currentLevel, currentDate,
    currentYoY, current1moAnn, current3moAnn, current6moAnn,
    past1moMoM, past3moAvgMoM, past6moAvgMoM,
    yoyIn6mo1mo, yoyIn6mo3mo, yoyIn6mo6mo,
  }
}

// ── Chart data builder ──────────────────────────────────────────────────────

type ChartRow = {
  date: string
  historical?: number
  pace1mo?:    number
  pace3mo?:    number
  pace6mo?:    number
}

function buildChartData(model: SeriesModel, visible: Set<string>): ChartRow[] {
  if (!model.currentDate || model.raw.length === 0) return []

  const map = new Map(model.raw.map(d => [d.date, d.value]))

  // Historical YoY from Jan 2024 onward
  const rows: ChartRow[] = []
  for (const d of model.raw) {
    if (d.date < HIST_CUTOFF) continue
    const [y, m] = d.date.split('-').map(Number)
    const prior  = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const pv     = map.get(prior)
    const yoy    = (pv != null && pv !== 0) ? (d.value / pv - 1) * 100 : undefined
    rows.push({ date: d.date, historical: yoy })
  }

  // Anchor: set projection values at current date = currentYoY so lines connect
  const lastRow = rows[rows.length - 1]
  if (lastRow && model.currentYoY != null) {
    if (visible.has('pace1mo')) lastRow.pace1mo = model.currentYoY
    if (visible.has('pace3mo')) lastRow.pace3mo = model.currentYoY
    if (visible.has('pace6mo')) lastRow.pace6mo = model.currentYoY
  }

  // Projection months t+1 through t+6
  for (let n = 1; n <= 6; n++) {
    const projDate = addMonths(model.currentDate, n)
    const row: ChartRow = { date: projDate }

    if (visible.has('pace1mo')) {
      const v = projectYoYAt(model.currentLevel, model.past1moMoM, n, map, model.currentDate)
      if (v != null) row.pace1mo = v
    }
    if (visible.has('pace3mo')) {
      const v = projectYoYAt(model.currentLevel, model.past3moAvgMoM, n, map, model.currentDate)
      if (v != null) row.pace3mo = v
    }
    if (visible.has('pace6mo')) {
      const v = projectYoYAt(model.currentLevel, model.past6moAvgMoM, n, map, model.currentDate)
      if (v != null) row.pace6mo = v
    }

    rows.push(row)
  }

  return rows
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

// ── Summary Boxes ───────────────────────────────────────────────────────────

function SummaryBoxes({ model }: { model: SeriesModel }) {
  return (
    <div className={styles.boxesCol}>
      {/* Box 1: Current Snapshot */}
      <div className={styles.summaryBox} style={{ borderLeftColor: 'rgba(255,255,255,0.25)' }}>
        <div className={styles.boxTitle}>Current Snapshot</div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Current YoY</span>
          <span className={styles.boxValue}>
            {model.currentYoY != null ? fmtPct(model.currentYoY) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Latest Month</span>
          <span className={styles.boxValue}>{model.currentDate ? fmtShortDate(model.currentDate) : '-'}</span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Index Level</span>
          <span className={styles.boxValue}>{model.currentLevel ? model.currentLevel.toFixed(3) : '-'}</span>
        </div>
      </div>

      {/* Box 2: 1-Month Pace */}
      <div className={styles.summaryBox} style={{ borderLeftColor: COLOR_1MO }}>
        <div className={styles.boxTitle}>1-Month Pace</div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>1mo Annualized</span>
          <span className={styles.boxValue}>
            {model.current1moAnn != null ? fmtPct(model.current1moAnn) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Raw 1mo MoM</span>
          <span className={styles.boxValue}>{fmtPct(model.past1moMoM)}</span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>YoY in 6mo</span>
          <span className={styles.boxValue}>
            {model.yoyIn6mo1mo != null ? fmtPct(model.yoyIn6mo1mo) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          {model.yoyIn6mo1mo != null && model.yoyIn6mo1mo <= 2.0
            ? <span className={styles.hits2Yes}>Hits 2%: {fmtPct(model.yoyIn6mo1mo)} in 6mo (will reach)</span>
            : <span className={styles.hits2No}>Hits 2%: {model.yoyIn6mo1mo != null ? fmtPct(model.yoyIn6mo1mo) : '-'} in 6mo (won't reach)</span>}
        </div>
      </div>

      {/* Box 3: 3-Month Pace */}
      <div className={styles.summaryBox} style={{ borderLeftColor: COLOR_3MO }}>
        <div className={styles.boxTitle}>3-Month Pace</div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>3mo Annualized</span>
          <span className={styles.boxValue}>
            {model.current3moAnn != null ? fmtPct(model.current3moAnn) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Avg 3mo MoM</span>
          <span className={styles.boxValue}>{fmtPct(model.past3moAvgMoM)}</span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>YoY in 6mo</span>
          <span className={styles.boxValue}>
            {model.yoyIn6mo3mo != null ? fmtPct(model.yoyIn6mo3mo) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          {model.yoyIn6mo3mo != null && model.yoyIn6mo3mo <= 2.0
            ? <span className={styles.hits2Yes}>Hits 2%: {fmtPct(model.yoyIn6mo3mo)} in 6mo (will reach)</span>
            : <span className={styles.hits2No}>Hits 2%: {model.yoyIn6mo3mo != null ? fmtPct(model.yoyIn6mo3mo) : '-'} in 6mo (won't reach)</span>}
        </div>
      </div>

      {/* Box 4: 6-Month Pace */}
      <div className={styles.summaryBox} style={{ borderLeftColor: COLOR_6MO }}>
        <div className={styles.boxTitle}>6-Month Pace</div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>6mo Annualized</span>
          <span className={styles.boxValue}>
            {model.current6moAnn != null ? fmtPct(model.current6moAnn) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>Avg 6mo MoM</span>
          <span className={styles.boxValue}>{fmtPct(model.past6moAvgMoM)}</span>
        </div>
        <div className={styles.boxRow}>
          <span className={styles.boxLabel}>YoY in 6mo</span>
          <span className={styles.boxValue}>
            {model.yoyIn6mo6mo != null ? fmtPct(model.yoyIn6mo6mo) : '-'}
          </span>
        </div>
        <div className={styles.boxRow}>
          {model.yoyIn6mo6mo != null && model.yoyIn6mo6mo <= 2.0
            ? <span className={styles.hits2Yes}>Hits 2%: {fmtPct(model.yoyIn6mo6mo)} in 6mo (will reach)</span>
            : <span className={styles.hits2No}>Hits 2%: {model.yoyIn6mo6mo != null ? fmtPct(model.yoyIn6mo6mo) : '-'} in 6mo (won't reach)</span>}
        </div>
      </div>
    </div>
  )
}

// ── Section Component ───────────────────────────────────────────────────────

function ProjectionSection({
  title,
  model,
}: {
  title: string
  model: SeriesModel
}) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(['historical', 'pace1mo', 'pace3mo', 'pace6mo'])
  )
  const [brush, setBrush] = useState<BrushState>({ start: 0, end: 0, period: 'All' })

  const chartData = useMemo(() => buildChartData(model, visible), [model, visible])

  // Initialize brush to show all
  useEffect(() => {
    if (chartData.length > 0) {
      setBrush({ start: 0, end: chartData.length - 1, period: 'All' })
    }
  }, [chartData.length])

  const handleBrush = useCallback((startIndex?: number, endIndex?: number) => {
    if (startIndex != null && endIndex != null) {
      setBrush(prev => ({ ...prev, start: startIndex, end: endIndex, period: '' }))
    }
  }, [])

  const handleQuickSelect = useCallback((label: string, count: number) => {
    const end = chartData.length - 1
    const start = count === Infinity ? 0 : Math.max(0, end - count + 1)
    setBrush({ start, end, period: label })
  }, [chartData.length])

  const toggle = useCallback((key: string) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (!model.currentDate) return null

  const LEGEND_ITEMS = [
    { key: 'historical', label: 'YoY',       color: COLOR_HIST, dashed: false },
    { key: 'pace1mo',    label: '1mo Pace',   color: COLOR_1MO,  dashed: true  },
    { key: 'pace3mo',    label: '3mo Pace',   color: COLOR_3MO,  dashed: true  },
    { key: 'pace6mo',    label: '6mo Pace',   color: COLOR_6MO,  dashed: true  },
  ]

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}</div>
          <div className={styles.sectionSubtitle}>
            Latest: {fmtFullDate(model.currentDate)}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {LEGEND_ITEMS.map(item => (
            <button
              key={item.key}
              type="button"
              className={`${styles.legendItem} ${visible.has(item.key) ? '' : styles.legendItemOff}`}
              onClick={() => toggle(item.key)}
            >
              <span
                className={item.dashed ? styles.legendLineDashed : styles.legendLine}
                style={{ [item.dashed ? 'borderTopColor' : 'background']: item.color }}
              />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart + Boxes */}
      <div className={styles.contentRow}>
        <div className={styles.chartCol}>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
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
                  width={52} tickFormatter={fmtPct}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(v: unknown, name: unknown) => {
                    const val = typeof v === 'number' ? fmtPct(v) : '-'
                    const n = String(name)
                    const labels: Record<string, string> = {
                      historical: 'YoY',
                      pace1mo:    `1mo Pace (${fmtPct(model.past1moMoM)} MoM)`,
                      pace3mo:    `3mo Pace (${fmtPct(model.past3moAvgMoM)} MoM)`,
                      pace6mo:    `6mo Pace (${fmtPct(model.past6moAvgMoM)} MoM)`,
                    }
                    return [val, labels[n] ?? n] as [string, string]
                  }}
                />
                <ReferenceLine y={2} stroke="rgba(255,255,255,0.20)" strokeDasharray="6 3" strokeWidth={1} />

                {/* Historical YoY */}
                <Line
                  type="monotone" dataKey="historical" name="historical"
                  stroke={COLOR_HIST} strokeWidth={2.5}
                  dot={false} isAnimationActive={false} connectNulls
                  hide={!visible.has('historical')}
                />

                {/* 1mo Pace */}
                <Line
                  type="monotone" dataKey="pace1mo" name="pace1mo"
                  stroke={COLOR_1MO} strokeWidth={1.5} strokeDasharray="6 3"
                  dot={false} isAnimationActive={false} connectNulls
                  hide={!visible.has('pace1mo')}
                />

                {/* 3mo Pace */}
                <Line
                  type="monotone" dataKey="pace3mo" name="pace3mo"
                  stroke={COLOR_3MO} strokeWidth={1.5} strokeDasharray="6 3"
                  dot={false} isAnimationActive={false} connectNulls
                  hide={!visible.has('pace3mo')}
                />

                {/* 6mo Pace */}
                <Line
                  type="monotone" dataKey="pace6mo" name="pace6mo"
                  stroke={COLOR_6MO} strokeWidth={1.5} strokeDasharray="6 3"
                  dot={false} isAnimationActive={false} connectNulls
                  hide={!visible.has('pace6mo')}
                />

                <Brush
                  dataKey="date"
                  startIndex={brush.start}
                  endIndex={brush.end}
                  onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                  {...BRUSH_STYLE}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <QuickSelectRow
            period={brush.period}
            onSelect={handleQuickSelect}
          />
        </div>

        <SummaryBoxes model={model} />
      </div>
    </div>
  )
}

// ── Content Component ──────────────────────────────────────────────────────────

export function PCEProjectionsContent() {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<{ headline: WD[]; core: WD[] }>({ headline: [], core: [] })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      fetchBEASeries(1),   // Headline PCEPI (Line 1)
      fetchBEASeries(25),  // Core PCE (Line 25)
    ])
      .then(([headlineObs, coreObs]) => {
        if (cancelled) return
        const headline = parseObs(headlineObs)
        const core     = parseObs(coreObs)
        setData({ headline, core })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const headlineModel = useMemo(() => buildModel(data.headline), [data.headline])
  const coreModel     = useMemo(() => buildModel(data.core),     [data.core])

  return (
    <>
      {loading && (
        <div className={styles.statusBlock}>Loading PCE data...</div>
      )}
      {error && (
        <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
      )}

      {!loading && !error && (
        <>
          <ProjectionSection title="Headline PCEPI Projection" model={headlineModel} />
          <ProjectionSection title="Core PCE Projection" model={coreModel} />
        </>
      )}
    </>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PCEProjectionsPage() {
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
        <Link to="/models/inflation" className={styles.breadcrumbLink}>Inflation</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>PCE Projections</span>
      </nav>

      <main className={styles.body}>
        <PCEProjectionsContent />
      </main>
    </div>
  )
}
