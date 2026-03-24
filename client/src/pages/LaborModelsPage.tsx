import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries } from '../lib/fred'
import type { FredObservation } from '../lib/fred'
import styles from './LaborModelsPage.module.css'

// ── Constants ───────────────────────────────────────────────────────────────

const MONTHS_AHEAD = 12
const SCENARIO_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'] as const
const SCENARIO_LABELS = ['50k/mo', '100k/mo', '150k/mo', '200k/mo'] as const

// ── Date helpers ─────────────────────────────────────────────────────────────

function twoYearsAgo(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 2)
  return d.toISOString().slice(0, 10)
}

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

function fmtMonthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[m - 1]} '${String(y).slice(2)}`
}

function latestYYYYMM(obs: FredObservation[]): string {
  const valid = obs.filter(o => o.value !== '.')
  return valid[valid.length - 1]?.date.slice(0, 7) ?? ''
}

function latestValue(obs: FredObservation[]): number {
  const valid = obs.filter(o => o.value !== '.')
  return valid.length ? parseFloat(valid[valid.length - 1].value) : 0
}

// ── Heat-map colour ──────────────────────────────────────────────────────────

function heatColor(val: number, min: number, max: number): string {
  if (max === min) return 'transparent'
  const t = (val - min) / (max - min)  // 0 = best (low U3), 1 = worst (high U3)
  // green → amber → red
  const r = Math.round(34  + (239 - 34)  * t)
  const g = Math.round(197 + (68  - 197) * t)
  const b = Math.round(94  + (68  - 94)  * t)
  return `rgba(${r},${g},${b},0.18)`
}

// ── Model computation ────────────────────────────────────────────────────────

interface ProjectionRow {
  scenario: number            // payroll in k/mo
  color:    string
  label:    string
  values:   number[]          // length = MONTHS_AHEAD + 1 (index 0 = current)
}

function computeProjections(
  emp:      number,   // thousands
  clf:      number,   // thousands
  scenarios: readonly number[],
  clfGrowthPct: number  // monthly %
): ProjectionRow[] {
  return scenarios.map((scenario, i) => {
    const values: number[] = []
    for (let n = 0; n <= MONTHS_AHEAD; n++) {
      const empN = emp + scenario * n
      const clfN = clf * Math.pow(1 + clfGrowthPct / 100, n)
      values.push((clfN - empN) / clfN * 100)
    }
    return { scenario, color: SCENARIO_COLORS[i], label: SCENARIO_LABELS[i], values }
  })
}

// ── Chart data ───────────────────────────────────────────────────────────────

interface ChartPoint {
  date:  string
  hist?: number
  s0?:   number
  s1?:   number
  s2?:   number
  s3?:   number
}

function buildChartData(
  unrateObs:   FredObservation[],
  projections: ProjectionRow[],
  currentMM:   string   // "YYYY-MM"
): ChartPoint[] {
  const pts: ChartPoint[] = []

  // Historical
  const validHist = unrateObs.filter(o => o.value !== '.')
  for (const obs of validHist) {
    const mm = obs.date.slice(0, 7)
    pts.push({ date: mm, hist: parseFloat(obs.value) })
  }

  // Projections — start at current month (overlap with last historical point)
  for (let n = 0; n <= MONTHS_AHEAD; n++) {
    const mm = addMonths(currentMM, n)
    const existing = pts.find(p => p.date === mm)
    const point: ChartPoint = existing ?? { date: mm }
    point.s0 = projections[0].values[n]
    point.s1 = projections[1].values[n]
    point.s2 = projections[2].values[n]
    point.s3 = projections[3].values[n]
    if (!existing) pts.push(point)
  }

  pts.sort((a, b) => a.date.localeCompare(b.date))
  return pts
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background:   '#090e15',
      border:       '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      padding:      '8px 12px',
      fontFamily:   'var(--font-mono)',
      fontSize:     11,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {label ? fmtMonthLabel(label) : ''}
      </div>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#CBD5E1' }}>{p.value.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Content component ────────────────────────────────────────────────────────

export function LaborModelsContent() {
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState<string | null>(null)

  const [unrateObs, setUnrateObs]   = useState<FredObservation[]>([])
  const [ceObs,     setCeObs]       = useState<FredObservation[]>([])
  const [clfObs,    setClfObs]      = useState<FredObservation[]>([])

  const [scenarios,    setScenarios]    = useState<[number,number,number,number]>([50, 100, 150, 200])
  const [clfGrowthPct, setClfGrowthPct] = useState<number>(0.00)

  // ── Fetch data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const start = twoYearsAgo()

    Promise.all([
      fetchFredSeries('UNRATE',   { observationStart: start }),
      fetchFredSeries('CE16OV',   { observationStart: start }),
      fetchFredSeries('CLF16OV',  { observationStart: start }),
    ]).then(([unrate, ce, clf]) => {
      if (cancelled) return
      setUnrateObs(unrate)
      setCeObs(ce)
      setClfObs(clf)
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentMM  = useMemo(() => latestYYYYMM(unrateObs), [unrateObs])
  const currentU3  = useMemo(() => latestValue(unrateObs),  [unrateObs])
  const currentEmp = useMemo(() => latestValue(ceObs),      [ceObs])
  const currentClf = useMemo(() => latestValue(clfObs),     [clfObs])

  const projections = useMemo(
    () => computeProjections(currentEmp, currentClf, scenarios, clfGrowthPct),
    [currentEmp, currentClf, scenarios, clfGrowthPct]
  )

  const chartData = useMemo(
    () => buildChartData(unrateObs, projections, currentMM),
    [unrateObs, projections, currentMM]
  )

  // Heat-map bounds across all projected values (n=1 onwards)
  const { heatMin, heatMax } = useMemo(() => {
    const all = projections.flatMap(p => p.values.slice(1))
    return { heatMin: Math.min(...all), heatMax: Math.max(...all) }
  }, [projections])

  // Column headers for table: n=0 is "Current", n=1..12 are months
  const colHeaders = useMemo(() => {
    if (!currentMM) return []
    return Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => {
      if (i === 0) return 'Current'
      return fmtMonthLabel(addMonths(currentMM, i))
    })
  }, [currentMM])

  // ── Input handlers ─────────────────────────────────────────────────────────
  function updateScenario(i: number, raw: string) {
    const v = parseFloat(raw)
    if (isNaN(v)) return
    setScenarios(prev => {
      const next = [...prev] as [number,number,number,number]
      next[i] = v
      return next
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
        {/* Page title */}
        <div>
          <div className={styles.pageTitle}>U-3 Payroll Based Projection</div>
          <div className={styles.pageSub}>
            Forward projection based on payroll growth and labor force dynamics
          </div>
        </div>

        {loading ? (
          <div className={styles.statusBlock}>
            <span>Loading FRED data…</span>
          </div>
        ) : error ? (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>
            <span>Error: {error}</span>
          </div>
        ) : (<>

          {/* Controls */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Model Inputs</span>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.controlsGrid}>

                {/* Payroll scenarios */}
                <div>
                  <div className={styles.inputLabel} style={{ marginBottom: 8 }}>
                    Monthly Payroll Growth (thousands)
                  </div>
                  <div className={styles.scenariosRow}>
                    {scenarios.map((val, i) => (
                      <div key={i} className={styles.inputGroup}>
                        <div className={styles.inputLabel} style={{ color: SCENARIO_COLORS[i] }}>
                          Scenario {i + 1}
                        </div>
                        <input
                          type="number"
                          className={styles.inputField}
                          value={val}
                          min={-500}
                          max={2000}
                          step={25}
                          onChange={e => updateScenario(i, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.scenarioDivider}>
                  <span className={styles.scenarioDividerLine} />
                </div>

                {/* CLF growth */}
                <div className={styles.inputGroup}>
                  <div className={styles.inputLabel}>CLF Monthly Growth %</div>
                  <input
                    type="number"
                    className={styles.inputField}
                    value={clfGrowthPct}
                    min={-1}
                    max={2}
                    step={0.01}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) setClfGrowthPct(v)
                    }}
                  />
                </div>

                {/* Current readings */}
                <div className={styles.scenarioDivider}>
                  <span className={styles.scenarioDividerLine} />
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  {[
                    { label: 'Current U-3',  val: `${currentU3.toFixed(1)}%`,             sub: 'UNRATE'   },
                    { label: 'Employment',   val: `${(currentEmp/1000).toFixed(2)}M`,      sub: 'CE16OV'   },
                    { label: 'Labor Force',  val: `${(currentClf/1000).toFixed(2)}M`,      sub: 'CLF16OV'  },
                    { label: 'As of',        val: currentMM ? fmtMonthLabel(currentMM) : '—', sub: 'latest obs' },
                  ].map(item => (
                    <div key={item.label} className={styles.inputGroup}>
                      <div className={styles.inputLabel}>{item.label}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: '#CBD5E1', paddingTop: 6 }}>
                        {item.val}
                      </div>
                      <div style={{ fontSize: 10, color: '#4e6070', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {item.sub}
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </div>

          {/* Chart */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>U-3 Unemployment Rate</span>
            </div>
            <div className={styles.sectionBody} style={{ padding: '16px 4px 8px 4px' }}>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="rgba(255,255,255,0.05)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtMonthLabel}
                      tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={v => `${v.toFixed(1)}%`}
                      tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip />} />

                    {/* Vertical divider at current date */}
                    {currentMM && (
                      <ReferenceLine
                        x={currentMM}
                        stroke="rgba(255,255,255,0.18)"
                        strokeDasharray="3 3"
                      />
                    )}

                    {/* Historical UNRATE */}
                    <Line
                      dataKey="hist"
                      name="Historical"
                      stroke="#dde4f0"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />

                    {/* Projection lines */}
                    {(['s0','s1','s2','s3'] as const).map((key, i) => (
                      <Line
                        key={key}
                        dataKey={key}
                        name={SCENARIO_LABELS[i]}
                        stroke={SCENARIO_COLORS[i]}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Legend */}
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div className={styles.legendLine} style={{ background: '#dde4f0' }} />
                <span>Historical (UNRATE)</span>
              </div>
              {projections.map((p, i) => (
                <div key={i} className={styles.legendItem}>
                  <div className={styles.legendLine + ' ' + styles.legendLineDashed} style={{ borderColor: p.color, width: 20 }} />
                  <span>{p.label}</span>
                </div>
              ))}
              <div className={styles.legendItem} style={{ marginLeft: 'auto', color: '#4e6070' }}>
                <span>Dashed line = now</span>
              </div>
            </div>
          </div>

          {/* Projection table */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>12-Month Projection Table</span>
            </div>
            <div className={styles.sectionBody} style={{ padding: 0 }}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      {colHeaders.map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projections.map((row, ri) => (
                      <tr key={ri}>
                        <td>
                          <div className={styles.scenarioCell}>
                            <span
                              className={styles.scenarioSwatch}
                              style={{ background: row.color }}
                            />
                            {row.label}
                          </div>
                        </td>
                        {row.values.map((v, ni) => (
                          <td
                            key={ni}
                            className={`${styles.heatCell} ${ni === 0 ? styles.currentCell : ''}`}
                            style={ni === 0 ? undefined : { background: heatColor(v, heatMin, heatMax) }}
                          >
                            {v.toFixed(2)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Data footnote */}
          <div style={{ fontSize: 10, color: '#4e6070', fontFamily: 'var(--font-mono)', paddingBottom: 4 }}>
            Sources: UNRATE, CE16OV, CLF16OV — Federal Reserve Bank of St. Louis (FRED).
            Projections are mechanical extrapolations and do not constitute forecasts.
          </div>

        </>)}
    </>
  )
}

export function LaborModelsPage() {
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
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor" className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>U-3 Payroll Based Projection</span>
      </nav>

      {/* Body */}
      <main className={styles.body}>
        <LaborModelsContent />
      </main>
    </div>
  )
}
