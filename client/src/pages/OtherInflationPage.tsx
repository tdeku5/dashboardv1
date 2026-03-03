import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Brush, ResponsiveContainer,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries } from '../lib/fred'
import styles from './OtherInflationPage.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

interface WD { date: string; value: number }
interface BrushState { start: number; end: number; period: string }

// ── Chart styling constants (dark theme) ─────────────────────────────────────

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
  { label: '6M',  count: 6 },
  { label: '1Y',  count: 12 },
  { label: '3Y',  count: 36 },
  { label: '5Y',  count: 60 },
  { label: 'All', count: Infinity },
]

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

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`
}

// ── Series configs ───────────────────────────────────────────────────────────

const METRIC_SERIES = [
  { id: 'PCETRIM12M159SFRBDAL', label: 'Trimmed Mean PCE',     color: '#f07070', raw: true  },
  { id: 'CORESTICKM159SFRBATL', label: 'Sticky Price Core CPI', color: '#e0a050', raw: true  },
  { id: 'CP0000USM086NEST',     label: 'Harmonized CPI',        color: '#9070d0', raw: false },
  { id: 'CPIAUCSL',             label: 'CPI',                   color: '#70c070', raw: false },
  { id: 'CPILFESL',             label: 'Core CPI',              color: '#a0a050', raw: false },
  { id: 'PCEPI',                label: 'PCEPI',                 color: '#70b0e0', raw: false },
  { id: 'PCEPILFE',             label: 'Core PCEPI',            color: '#a080d0', raw: false },
]

// ── QuickSelectRow ───────────────────────────────────────────────────────────

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

// ── Expectations line configs ────────────────────────────────────────────────

const EXP_LINES = [
  { key: 'umich1y',  label: 'UMich 1y',  color: '#f0a0a0' },
  { key: 'umich5y',  label: 'UMich 5y',  color: '#e0d080' },
  { key: 'nyfed1y',  label: 'NY Fed 1y', color: '#70b0e0' },
  { key: 'nyfed3y',  label: 'NY Fed 3y', color: '#70c070' },
  { key: 'nyfed5y',  label: 'NY Fed 5y', color: '#a080d0' },
]

// ── Chart 1: Inflation Expectations ──────────────────────────────────────────

function ExpectationsChart() {
  const [chartData, setChartData] = useState<Record<string, unknown>[]>([])
  const [brush, setBrush] = useState<BrushState>({ start: 0, end: 0, period: '5Y' })
  const [vis, setVis] = useState<Set<string>>(() => new Set(EXP_LINES.map(l => l.key)))

  const toggle = useCallback(
    (key: string) => setVis(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    }), []
  )

  useEffect(() => {
    Promise.all([
      fetchFredSeries('MICH').then(obs =>
        obs.filter(o => o.value !== '.').map(o => ({ date: o.date, value: parseFloat(o.value) }))
      ),
      fetch('/api/sce/inflation-expectations')
        .then(r => r.json())
        .then((rows: { date: string; horizon: string; value: number }[]) => rows)
        .catch(() => [] as { date: string; horizon: string; value: number }[]),
      fetch('/api/umich/inflation-expectations')
        .then(r => r.json())
        .then((rows: { date: string; px5: number }[]) => rows)
        .catch(() => [] as { date: string; px5: number }[]),
    ]).then(([michData, sceData, umich5yData]) => {
      // Build lookup maps
      const michMap = new Map(michData.map(d => [d.date, d.value]))
      const umich5yMap = new Map(umich5yData.map(d => [d.date, d.px5]))
      const sce1y = new Map<string, number>()
      const sce3y = new Map<string, number>()
      const sce5y = new Map<string, number>()
      for (const r of sceData) {
        if (r.horizon === '1y') sce1y.set(r.date, r.value)
        else if (r.horizon === '3y') sce3y.set(r.date, r.value)
        else if (r.horizon === '5y') sce5y.set(r.date, r.value)
      }

      // Union all dates
      const dateSet = new Set<string>()
      michMap.forEach((_, d) => dateSet.add(d))
      umich5yMap.forEach((_, d) => dateSet.add(d))
      sce1y.forEach((_, d) => dateSet.add(d))
      sce3y.forEach((_, d) => dateSet.add(d))
      sce5y.forEach((_, d) => dateSet.add(d))
      const dates = Array.from(dateSet).sort()

      setChartData(dates.map(date => ({
        date,
        umich1y: michMap.get(date) ?? null,
        umich5y: umich5yMap.get(date) ?? null,
        nyfed1y: sce1y.get(date) ?? null,
        nyfed3y: sce3y.get(date) ?? null,
        nyfed5y: sce5y.get(date) ?? null,
      })))
    }).catch(console.error)
  }, [])

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
        <div className={styles.sectionTitle}>Inflation Expectations</div>

      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {EXP_LINES.map(l => (
            <button
              key={l.key}
              type="button"
              className={`${styles.legendItem} ${vis.has(l.key) ? '' : styles.legendItemOff}`}
              onClick={() => toggle(l.key)}
            >
              <span className={styles.legendLine} style={{ background: l.color }} />
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60}
            />
            <YAxis
              tick={TICK} tickLine={false} axisLine={false}
              width={48} tickFormatter={fmtPct}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const val = typeof v === 'number' ? `${v.toFixed(1)}%` : '-'
                const l = EXP_LINES.find(x => x.key === name)
                return [val, l?.label ?? String(name)] as [string, string]
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {EXP_LINES.map(l => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                stroke={l.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
                hide={!vis.has(l.key)}
              />
            ))}
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

// ── Chart 2: Inflation Metrics ───────────────────────────────────────────────

function InflationMetricsChart() {
  const [raw, setRaw] = useState<Record<string, WD[]>>({})
  const [brush, setBrush] = useState<BrushState>({ start: 0, end: 0, period: '5Y' })
  const [vis, setVis] = useState<Set<string>>(() => new Set(METRIC_SERIES.map(s => s.id)))

  const toggle = useCallback(
    (key: string) => setVis(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    }), []
  )

  useEffect(() => {
    Promise.all(
      METRIC_SERIES.map(s =>
        fetchFredSeries(s.id).then(obs => ({
          id: s.id,
          data: obs
            .filter(o => o.value !== '.')
            .map(o => ({ date: o.date, value: parseFloat(o.value) })),
        }))
      )
    )
      .then(results => {
        const map: Record<string, WD[]> = {}
        results.forEach(r => { map[r.id] = r.data })
        setRaw(map)
      })
      .catch(console.error)
  }, [])

  const chartData = useMemo(() => {
    if (!Object.keys(raw).length) return []

    // Collect union of all dates
    const dateSet = new Set<string>()
    Object.values(raw).forEach(arr => arr.forEach(d => dateSet.add(d.date)))
    const dates = Array.from(dateSet).sort()

    // Build O(1) lookup maps per series
    const maps: Record<string, Map<string, number>> = {}
    for (const s of METRIC_SERIES) {
      const arr = raw[s.id]
      if (arr) maps[s.id] = new Map(arr.map(d => [d.date, d.value]))
    }

    return dates.map(date => {
      const row: Record<string, unknown> = { date }
      for (const s of METRIC_SERIES) {
        const map = maps[s.id]
        if (!map) { row[s.id] = null; continue }

        const v = map.get(date)
        if (v == null) { row[s.id] = null; continue }

        if (s.raw) {
          row[s.id] = v
        } else {
          // Compute YoY % change from index levels
          const [y, m] = date.split('-').map(Number)
          const d12 = `${y - 1}-${String(m).padStart(2, '0')}-01`
          const v12 = map.get(d12)
          row[s.id] = (v12 != null && v12 !== 0) ? (v / v12 - 1) * 100 : null
        }
      }
      return row
    })
  }, [raw])

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
        <div className={styles.sectionTitle}>Inflation Metrics</div>

      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {METRIC_SERIES.map(s => (
            <button
              key={s.id}
              type="button"
              className={`${styles.legendItem} ${vis.has(s.id) ? '' : styles.legendItemOff}`}
              onClick={() => toggle(s.id)}
            >
              <span className={styles.legendLine} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date" tick={TICK} tickLine={false} axisLine={false}
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
                const s = METRIC_SERIES.find(x => x.id === name)
                return [val, s?.label ?? String(name)] as [string, string]
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {METRIC_SERIES.map(s => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                stroke={s.color}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
                connectNulls
                legendType="none"
                hide={!vis.has(s.id)}
              />
            ))}
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

// ── Main page ────────────────────────────────────────────────────────────────

export function OtherInflationPage() {
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
        <span className={styles.breadcrumbCurrent}>Other</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>Other Inflation Measures</div>
          <div className={styles.pageSub}>
            Alternative inflation gauges — Michigan expectations, Dallas trimmed-mean PCE, OECD harmonized CPI, Atlanta sticky-price CPI
          </div>
        </div>

        <ExpectationsChart />
        <InflationMetricsChart />
      </main>
    </div>
  )
}
