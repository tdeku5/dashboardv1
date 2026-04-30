import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import styles from './MtsPage.module.css'

const CURRENT_FY = '2026'
const DISPLAY_FYS = new Set([
  '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026',
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

const MONTH_LABELS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
const TO_BILLIONS = 1_000_000_000

interface CumulativeRow { month_index: number; cumulative: number }
interface ApiResponse {
  fiscalYears: Record<string, CumulativeRow[]>
  lastUpdated: string
}

interface FredObservation {
  date: string
  value: string
}

interface FredResponse {
  observations: FredObservation[]
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

function fmtPercent(v: number): string {
  return `${v.toFixed(1)}%`
}

function fmtPercentWhole(v: number): string {
  return `${v.toFixed(0)}%`
}

function renderBarValueLabel(format: (value: number) => string) {
  return (props: any) => {
    const { x, y, width, height, value } = props
    if (value == null) return null
    const numericValue = Number(value)
    return (
      <text
        x={x + width / 2}
        y={numericValue < 0 ? y + height - 8 : y + 16}
        textAnchor="middle"
        fill="#94A3B8"
        fontSize={12}
        fontWeight={700}
        fontFamily="var(--font-mono)"
      >
        {format(numericValue)}
      </text>
    )
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{MONTH_LABELS[(label as number) - 1] ?? label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          FY{String(p.name)}: {fmtBillionsExact(Number(p.value ?? 0))}
        </p>
      ))}
    </div>
  )
}

/* ── Content component (all hooks/state/effects live here) ──── */
export function MtsContent() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [gdp, setGdp] = useState<FredObservation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hiddenFYs, setHiddenFYs] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    fetch('/api/mts/cumulative-balance')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })
      .then((json) => { if (!cancelled) setData(json) })
      .catch(e => { if (!cancelled) setError(e.message) })

    fetch('/api/fred?series_id=GDP')
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<FredResponse> })
      .then((json) => { if (!cancelled) setGdp(json.observations ?? []) })
      .catch(() => {
        if (!cancelled) setGdp([])
      })

    return () => { cancelled = true }
  }, [])

  const fiscalYears = useMemo(() => {
    if (!data) return []
    return Object.keys(data.fiscalYears)
      .filter((fy) => DISPLAY_FYS.has(fy))
      .sort()
  }, [data])

  /* Build chart data: array of { month_index, FY2026, FY2025, ... } */
  const chartData = useMemo(() => {
    if (!data) return []
    const byMonth: Record<number, Record<string, number>> = {}
    for (const [fy, rows] of Object.entries(data.fiscalYears)) {
      for (const r of rows) {
        if (!byMonth[r.month_index]) byMonth[r.month_index] = { month_index: r.month_index }
        byMonth[r.month_index][fy] = r.cumulative / TO_BILLIONS
      }
    }
    return Object.values(byMonth).sort((a, b) => a.month_index - b.month_index)
  }, [data])

  const stats = useMemo(() => {
    if (!data) return null
    const currentFY = CURRENT_FY
    const currentRows = data.fiscalYears[currentFY]
    if (!currentRows?.length) return null
    const latest = currentRows[currentRows.length - 1]
    const ytdB = latest.cumulative / TO_BILLIONS

    const fy25Rows = data.fiscalYears['2025']
    let delta: number | null = null
    let deltaPct: number | null = null
    if (fy25Rows) {
      const match = fy25Rows.find(r => r.month_index === latest.month_index)
      if (match) {
        const matchB = match.cumulative / TO_BILLIONS
        delta = ytdB - matchB
        deltaPct = matchB !== 0 ? ((ytdB - matchB) / Math.abs(matchB)) * 100 : null
      }
    }
    return { currentFY, monthIndex: latest.month_index, ytdB, delta, deltaPct }
  }, [data, fiscalYears])

  const fytdBars = useMemo(() => {
    if (!data) return []
    return fiscalYears
      .map((fy) => {
        const rows = data.fiscalYears[fy]
        const last = rows?.[rows.length - 1]
        if (!last) return null
        return {
          fy,
          valueB: last.cumulative / TO_BILLIONS,
        }
      })
      .filter((row): row is { fy: string; valueB: number } => row != null)
  }, [data, fiscalYears])

  const fytdPctBars = useMemo(() => {
    if (!fytdBars.length || !gdp.length) return []

    const parsedGdp = gdp
      .map((row) => ({ date: row.date, value: Number(row.value) }))
      .filter((row) => Number.isFinite(row.value))

    if (!parsedGdp.length) return []

    const latestGdp = parsedGdp[parsedGdp.length - 1]?.value ?? null

    return fytdBars
      .map((row) => {
        const targetDate = `${row.fy}-07-01`
        const exact = parsedGdp.find((obs) => obs.date === targetDate)?.value
        const gdpValue = exact ?? (row.fy === CURRENT_FY ? latestGdp : null)
        if (!gdpValue) return null
        return {
          fy: row.fy,
          pct: (row.valueB / gdpValue) * 100,
        }
      })
      .filter((row): row is { fy: string; pct: number } => row != null)
  }, [fytdBars, gdp])

  const toggleFY = (fy: string) => {
    setHiddenFYs(prev => {
      const next = new Set(prev)
      next.has(fy) ? next.delete(fy) : next.add(fy)
      return next
    })
  }

  return (
    <>
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>CUMULATIVE FISCAL BALANCE</div>
            <div className={styles.sectionSub}>$ billions · Monthly Surplus/Deficit</div>
          </div>
        </div>

        {stats && (
          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>FY{stats.currentFY} YTD (Month {stats.monthIndex})</span>
              <span className={styles.statValue} style={{ color: stats.ytdB >= 0 ? '#22c55e' : '#ef4444' }}>
                {fmtBillionsExact(stats.ytdB)}
              </span>
            </div>
            {stats.delta !== null && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>vs FY2025</span>
                <span className={styles.statValue} style={{ color: stats.delta >= 0 ? '#22c55e' : '#ef4444' }}>
                  {stats.delta > 0 ? '+' : ''}{fmtBillionsExact(stats.delta)}
                  {stats.deltaPct !== null && (
                    <span className={styles.statPct}> ({stats.deltaPct >= 0 ? '+' : ''}{stats.deltaPct.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        <div className={styles.legendRow}>
          <div className={styles.legend}>
            {fiscalYears.map(fy => {
              const s = FY_STYLES[fy] ?? { color: '#64748b', width: 1, opacity: 0.3 }
              const hidden = hiddenFYs.has(fy)
              return (
                <div
                  key={fy}
                  className={styles.legendItem}
                  style={{ opacity: hidden ? 0.35 : 1 }}
                  onClick={() => toggleFY(fy)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleFY(fy)
                  }}
                >
                  <span
                    className={styles.legendLine}
                    style={{
                      background: s.color,
                      opacity: s.opacity,
                      height: fy === CURRENT_FY ? 3 : 2,
                    }}
                  />
                  FY{fy}
                </div>
              )
            })}
          </div>
        </div>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={520}>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="month_index"
                tickFormatter={(v: number) => MONTH_LABELS[v - 1] ?? ''}
                stroke="var(--text-primary)"
                fontSize={12}
              />
              <YAxis
                stroke="var(--text-primary)"
                fontSize={12}
                tickFormatter={fmtBillions}
              />
              <Tooltip content={<CustomTooltip />} />
              {fiscalYears.map(fy => {
                if (hiddenFYs.has(fy)) return null
                const s = FY_STYLES[fy] ?? { color: '#64748b', width: 1, opacity: 0.3 }
                return (
                  <Line
                    key={fy}
                    type="monotone"
                    dataKey={fy}
                    name={fy}
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeOpacity={s.opacity}
                    dot={false}
                    connectNulls
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : !error && (
          <div className={styles.loading} style={{ height: 520 }}>Loading…</div>
        )}

        {data?.lastUpdated && (
          <p className={styles.lastUpdated}>Last updated: {data.lastUpdated}</p>
        )}
      </section>

      <section className={styles.gridSection}>
        <div className={styles.gridCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>FYTD SURPLUS/DEFICIT</div>
              <div className={styles.sectionSub}>$ billions</div>
            </div>
          </div>

          {fytdBars.length > 0 ? (
            <div className={styles.miniChartWrap}>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={fytdBars} margin={{ top: 28, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="fy" stroke="var(--text-primary)" fontSize={11} />
                  <YAxis stroke="var(--text-primary)" fontSize={11} tickFormatter={fmtBillions} domain={['dataMin', 0]} />
                  <Tooltip
                    formatter={(value: number | undefined) => fmtBillionsExact(Number(value ?? 0))}
                    labelFormatter={(label) => `FY${label}`}
                  />
                  <Bar dataKey="valueB" radius={[3, 3, 0, 0]}>
                    {fytdBars.map((row) => (
                      <Cell
                        key={row.fy}
                        fill={row.fy === CURRENT_FY ? '#60a5fa' : '#3b82f6'}
                        fillOpacity={row.fy === CURRENT_FY ? 1 : 0.82}
                      />
                    ))}
                    <LabelList content={renderBarValueLabel((value) => {
                      if (Math.abs(value) >= 1000) return `${value.toFixed(1)}T`
                      return `${value.toFixed(0)}B`
                    })} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={styles.loading} style={{ height: 340 }}>Loading…</div>
          )}
        </div>

        <div className={styles.gridCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>FYTD SURPLUS/DEFICIT</div>
              <div className={styles.sectionSub}>% of GDP</div>
            </div>
          </div>

          {fytdPctBars.length > 0 ? (
            <div className={styles.miniChartWrap}>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={fytdPctBars} margin={{ top: 28, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="fy" stroke="var(--text-primary)" fontSize={11} />
                  <YAxis stroke="var(--text-primary)" fontSize={11} tickFormatter={fmtPercentWhole} domain={['dataMin', 0]} />
                  <Tooltip
                    formatter={(value: number | undefined) => fmtPercent(Number(value ?? 0))}
                    labelFormatter={(label) => `FY${label}`}
                  />
                  <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                    {fytdPctBars.map((row) => (
                      <Cell
                        key={row.fy}
                        fill={row.fy === CURRENT_FY ? '#4ade80' : '#22c55e'}
                        fillOpacity={row.fy === CURRENT_FY ? 1 : 0.82}
                      />
                    ))}
                    <LabelList content={renderBarValueLabel((value) => fmtPercent(value))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={styles.loading} style={{ height: 340 }}>Loading…</div>
          )}
        </div>
      </section>
    </>
  )
}

/* ── Page shell wrapper ──────────────────────────────────────── */
export function MtsPage() {
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
        <Link to="/models/fiscal" className={styles.breadcrumbLink}>Fiscal</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Monthly Treasury Statement</span>
      </nav>

      <main className={styles.body}>
        <MtsContent />
      </main>
    </div>
  )
}
