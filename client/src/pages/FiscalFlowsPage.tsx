import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import styles from './FiscalFlowsPage.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowPoint {
  record_date: string
  day_index: number
  cumulative_flow: number
}

interface FiscalFlowsResponse {
  fiscalYears: Record<string, FlowPoint[]>
  lastUpdated: string | null
}

interface TaxPeriod {
  period_end: string
  days: number
  total: number
  daily_avg: number
  growth_vs_ly?: number | null
}

interface TaxCycle {
  label: string
  periods: TaxPeriod[]
  totals: {
    total: number
    days: number
    daily_avg: number
    growth_vs_ly?: number | null
  } | null
}

interface TaxReceiptsResponse {
  currentCycle: TaxCycle
  priorCycle: TaxCycle
}

// ── FY line configs ──────────────────────────────────────────────────────────

interface FYLine {
  fy: string
  color: string
  width: number
  opacity: number
}

const CURRENT_FY = '2026'
const DISPLAY_FYS = new Set([
  '2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','2026',
])

const FY_STYLES: Record<string, { color: string; width: number; opacity: number }> = {
  '2026': { color: '#ef4444', width: 2.5, opacity: 1 },
  '2020': { color: '#f97316', width: 1.5, opacity: 0.75 },
  '2021': { color: '#fbbf24', width: 1.5, opacity: 0.75 },
  '2016': { color: '#3b82f6', width: 1, opacity: 0.45 },
  '2017': { color: '#2da0a1', width: 1, opacity: 0.45 },
  '2018': { color: '#22c55e', width: 1, opacity: 0.45 },
  '2019': { color: '#10b981', width: 1, opacity: 0.45 },
  '2022': { color: '#06b6d4', width: 1, opacity: 0.45 },
  '2023': { color: '#6366f1', width: 1, opacity: 0.45 },
  '2024': { color: '#8b5cf6', width: 1, opacity: 0.45 },
  '2025': { color: '#38bdf8', width: 1, opacity: 0.45 },
}

function buildFYLines(availableFYs: string[]): FYLine[] {
  return [...availableFYs]
    .filter((fy) => DISPLAY_FYS.has(fy))
    .sort()
    .map((fy) => {
      const s = FY_STYLES[fy] ?? { color: '#64748B', width: 1, opacity: 0.4 }
      return { fy, ...s }
    })
}

// ── Styling constants ────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

// Calendar day positions for each month start within a fiscal year
// Oct 1 = day 1, Nov 1 = day 32, ..., Sep 1 = day 336
const MONTH_TICKS: { day: number; label: string }[] = [
  { day: 1,   label: 'Oct' },
  { day: 32,  label: 'Nov' },
  { day: 62,  label: 'Dec' },
  { day: 93,  label: 'Jan' },
  { day: 124, label: 'Feb' },
  { day: 152, label: 'Mar' },
  { day: 183, label: 'Apr' },
  { day: 213, label: 'May' },
  { day: 244, label: 'Jun' },
  { day: 274, label: 'Jul' },
  { day: 305, label: 'Aug' },
  { day: 336, label: 'Sep' },
]

function dayIndexToMonth(day: number): string {
  for (let i = MONTH_TICKS.length - 1; i >= 0; i--) {
    if (day >= MONTH_TICKS[i].day) return MONTH_TICKS[i].label
  }
  return 'Oct'
}

function fmtBillions(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}T`
  if (Math.abs(v) >= 1) return `$${v.toFixed(0)}B`
  return `$${(v * 1000).toFixed(0)}M`
}

function fmtBillionsExact(v: number): string {
  if (Math.abs(v) >= 1000) {
    return `$${(v / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}T`
  }
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`
}

// ── Tax receipts formatters ──────────────────────────────────────────────────

function fmtDollars(v: number): string {
  return `$ ${v.toLocaleString('en-US')}`
}

function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const day = String(d.getDate()).padStart(2, '0')
  const mon = months[d.getMonth()]
  const yr = String(d.getFullYear()).slice(2)
  return `${day}-${mon}-${yr}`
}

function fmtGrowth(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v > 0 ? '' : ''}${v.toFixed(1)}%`
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const monthLabel = dayIndexToMonth(label as number)

  const entries = payload
    .filter((p: any) => p.value != null && !String(p.dataKey).endsWith('_ma'))
    .sort((a: any, b: any) => a.value - b.value)

  return (
    <div style={{
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      padding: '6px 10px',
      maxWidth: 200,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em', fontSize: 11 }}>
        Day {label} ({monthLabel})
      </div>
      {entries.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color, padding: '1px 0', opacity: Math.max(p.strokeOpacity ?? 1, 0.7) }}>
          FY{p.dataKey.replace('FY', '')}: {fmtBillionsExact(p.value)}
        </div>
      ))}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function FiscalFlowsPage() {
  const [rawData, setRawData] = useState<FiscalFlowsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taxData, setTaxData] = useState<TaxReceiptsResponse | null>(null)
  const [taxLoading, setTaxLoading] = useState(true)
  const [hiddenFYs, setHiddenFYs] = useState<Set<string>>(new Set())

  const toggleFY = (fy: string) => {
    setHiddenFYs(prev => {
      const next = new Set(prev)
      if (next.has(fy)) next.delete(fy)
      else next.add(fy)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/fiscal-flows')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) { setRawData(json); setLoading(false) }
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) }
      }
    }
    async function loadTax() {
      try {
        const res = await fetch('/api/fiscal-flows/tax-receipts')
        if (!res.ok) { setTaxLoading(false); return }
        const json = await res.json()
        if (!cancelled) { setTaxData(json); setTaxLoading(false) }
      } catch {
        if (!cancelled) setTaxLoading(false)
      }
    }
    load()
    loadTax()
    return () => { cancelled = true }
  }, [])

  const fyLines = useMemo(() => {
    if (!rawData) return []
    const fys = Object.keys(rawData.fiscalYears).filter(
      (fy) => (rawData.fiscalYears[fy]?.length ?? 0) > 0,
    )
    return buildFYLines(fys)
  }, [rawData])

  // Build unified dataset: each row = one dayIndex, each FY = a column
  // Complete FYs have 365/366 entries. Current FY stops at latest date (null beyond).
  const chartData = useMemo(() => {
    if (!rawData) return []
    const byDay = new Map<number, Record<string, number>>()

    for (const line of fyLines) {
      const points = rawData.fiscalYears[line.fy]
      if (!points) continue
      for (const pt of points) {
        const entry = byDay.get(pt.day_index) ?? {}
        entry[`FY${line.fy}`] = pt.cumulative_flow
        byDay.set(pt.day_index, entry)
      }
    }

    const sorted = Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, vals]) => ({ dayIndex: day, ...vals } as Record<string, number>))

    // Compute 7-day simple moving average for each FY series
    for (const line of fyLines) {
      const key = `FY${line.fy}`
      const maKey = `FY${line.fy}_ma`
      const window: number[] = []
      for (const row of sorted) {
        const v = row[key]
        if (v == null) continue
        window.push(v)
        if (window.length > 7) window.shift()
        row[maKey] = window.reduce((s, x) => s + x, 0) / window.length
      }
    }

    return sorted
  }, [rawData, fyLines])

  const stats = useMemo(() => {
    if (!rawData) return null
    const currentPts = rawData.fiscalYears[CURRENT_FY]
    const prevPts = rawData.fiscalYears['2025']
    if (!currentPts?.length) return null

    const currentYtd = currentPts[currentPts.length - 1].cumulative_flow
    const currentDayIdx = currentPts[currentPts.length - 1].day_index

    // Find FY2025 value at the same day_index for YoY comparison
    let prevAtSameDay: number | null = null
    if (prevPts?.length) {
      const match = prevPts.find((p) => p.day_index === currentDayIdx)
      if (match) prevAtSameDay = match.cumulative_flow
    }

    const delta = prevAtSameDay != null ? currentYtd - prevAtSameDay : null
    const pctDelta = prevAtSameDay != null && prevAtSameDay !== 0
      ? ((currentYtd - prevAtSameDay) / Math.abs(prevAtSameDay)) * 100
      : null

    return { currentYtd, delta, pctDelta }
  }, [rawData])

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
        <Link to="/models/fiscal" className={styles.breadcrumbLink}>Fiscal</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Daily Treasury Statement</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>Cumulative Daily Net Fiscal Flows</div>
              <div className={styles.sectionSub}>$ billions · (ΔTGA − ΔDebt)</div>
            </div>
          </div>

          {/* Legend */}
          <div className={styles.legendRow}>
            <div className={styles.legend}>
              {fyLines.map(l => (
                <span
                  key={l.fy}
                  className={styles.legendItem}
                  onClick={() => toggleFY(l.fy)}
                  style={{
                    cursor: 'pointer',
                    opacity: hiddenFYs.has(l.fy) ? 0.3 : 1,
                  }}
                >
                  <span
                    className={styles.legendLine}
                    style={{
                      background: l.color,
                      height: l.fy === CURRENT_FY ? 3 : 2,
                      opacity: hiddenFYs.has(l.fy) ? 0.3 : l.opacity,
                    }}
                  />
                  FY{l.fy}
                </span>
              ))}
            </div>
          </div>

          {/* Chart or loading */}
          {loading ? (
            <div className={styles.loading}>
              <div className={styles.spinner} />
              Syncing DTS fiscal data...
            </div>
          ) : error ? (
            <div className={styles.error}>Error: {error}</div>
          ) : fyLines.length === 0 ? (
            <div className={styles.loading}>
              Treasury API unavailable — data will populate when service is restored
            </div>
          ) : (
            <>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 16, right: 24, bottom: 8, left: 16 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="dayIndex"
                      type="number"
                      domain={[1, 366]}
                      ticks={MONTH_TICKS.map(t => t.day)}
                      tickFormatter={dayIndexToMonth}
                      tick={TICK}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    />
                    <YAxis
                      tickFormatter={fmtBillions}
                      tick={TICK}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      width={60}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                    <Tooltip content={<CustomTooltip />} />
                    {fyLines.flatMap(l => {
                      const hidden = hiddenFYs.has(l.fy)
                      return [
                        <Line
                          key={`${l.fy}_raw`}
                          dataKey={`FY${l.fy}`}
                          stroke={l.color}
                          strokeOpacity={hidden ? 0 : l.opacity * 0.6}
                          strokeWidth={0.8}
                          strokeDasharray="2 3"
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />,
                        <Line
                          key={`${l.fy}_ma`}
                          dataKey={`FY${l.fy}_ma`}
                          stroke={l.color}
                          strokeOpacity={hidden ? 0 : l.opacity}
                          strokeWidth={l.width}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />,
                      ]
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Summary stats */}
              {stats && (
                <div className={styles.statsRow}>
                  <div className={styles.stat}>
                    <div className={styles.statLabel}>FY{CURRENT_FY} YTD</div>
                    <div className={styles.statValue}>
                      {fmtBillionsExact(stats.currentYtd)}
                    </div>
                  </div>
                  <div className={styles.stat}>
                    <div className={styles.statLabel}>vs FY2025 YTD</div>
                    <div
                      className={styles.statValue}
                      style={{
                        color: stats.delta != null
                          ? stats.delta > 0 ? '#22c55e' : '#ef4444'
                          : undefined,
                      }}
                    >
                      {stats.delta != null
                        ? `${stats.delta > 0 ? '+' : ''}${fmtBillionsExact(stats.delta)}${stats.pctDelta != null ? ` (${stats.pctDelta > 0 ? '+' : ''}${stats.pctDelta.toFixed(1)}%)` : ''}`
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
              {rawData?.lastUpdated && (
                <div className={styles.lastUpdated}>Last updated: {rawData.lastUpdated}</div>
              )}
            </>
          )}
        </div>

        {/* Tax Receipts Table */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>
                US Treasury — Federal Employment Tax Receipts (in millions)
              </div>
              <div className={styles.sectionSub}>
                Withheld Income &amp; Employment Taxes · 12-period rolling cycle
              </div>
            </div>
          </div>

          {taxLoading ? (
            <div className={styles.taxLoadingSmall}>
              <div className={styles.spinner} />
              Loading tax receipts...
            </div>
          ) : !taxData ? (
            <div className={styles.taxLoadingSmall}>
              Treasury API unavailable — tax receipt data will populate when service is restored
            </div>
          ) : (
            <div className={styles.taxGrid}>
              {/* Current Cycle */}
              <div className={styles.taxHalf}>
                <div className={styles.taxCycleLabel}>{taxData.currentCycle.label}</div>
                <table className={styles.taxTable}>
                  <thead>
                    <tr>
                      <th>Period End</th>
                      <th>Employment Taxes</th>
                      <th>Days</th>
                      <th>Daily Avg</th>
                      <th>vs LY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxData.currentCycle.periods.map((p, i) => {
                      const isLast = i === taxData.currentCycle.periods.length - 1
                      const growthClass =
                        p.growth_vs_ly != null
                          ? p.growth_vs_ly >= 0
                            ? styles.taxGreen
                            : styles.taxRed
                          : ''
                      return (
                        <tr key={p.period_end} className={isLast ? styles.taxHighlight : ''}>
                          <td>{fmtDateShort(p.period_end)}</td>
                          <td>{fmtDollars(p.total)}</td>
                          <td>{p.days}</td>
                          <td>{fmtDollars(p.daily_avg)}</td>
                          <td className={growthClass}>{fmtGrowth(p.growth_vs_ly)}</td>
                        </tr>
                      )
                    })}
                    {taxData.currentCycle.totals && (
                      <tr className={styles.taxSummaryRow}>
                        <td>DAILY AVG</td>
                        <td>{fmtDollars(taxData.currentCycle.totals.total)}</td>
                        <td>{taxData.currentCycle.totals.days}</td>
                        <td>{fmtDollars(taxData.currentCycle.totals.daily_avg)}</td>
                        <td className={
                          taxData.currentCycle.totals.growth_vs_ly != null
                            ? taxData.currentCycle.totals.growth_vs_ly >= 0
                              ? styles.taxGreen
                              : styles.taxRed
                            : ''
                        }>
                          {fmtGrowth(taxData.currentCycle.totals.growth_vs_ly)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Prior Cycle */}
              <div className={styles.taxHalf}>
                <div className={styles.taxCycleLabel}>{taxData.priorCycle.label}</div>
                <table className={styles.taxTable}>
                  <thead>
                    <tr>
                      <th>Period End</th>
                      <th>Employment Taxes</th>
                      <th>Days</th>
                      <th>Daily Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxData.priorCycle.periods.map((p) => (
                      <tr key={p.period_end}>
                        <td>{fmtDateShort(p.period_end)}</td>
                        <td>{fmtDollars(p.total)}</td>
                        <td>{p.days}</td>
                        <td>{fmtDollars(p.daily_avg)}</td>
                      </tr>
                    ))}
                    {taxData.priorCycle.totals && (
                      <tr className={styles.taxSummaryRow}>
                        <td>DAILY AVG</td>
                        <td>{fmtDollars(taxData.priorCycle.totals.total)}</td>
                        <td>{taxData.priorCycle.totals.days}</td>
                        <td>{fmtDollars(taxData.priorCycle.totals.daily_avg)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
