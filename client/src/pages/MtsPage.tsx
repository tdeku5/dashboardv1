import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { FiscalYearOverlay, type FYStyle } from '../components/charts/FiscalYearOverlay'
import styles from './MtsPage.module.css'

// 2026-07 (UK models Phase 3): the multi-FY cumulative overlay section was
// extracted into the shared <FiscalYearOverlay /> (components/charts), which
// this page now consumes; the FYTD bar charts remain page-specific.

const CURRENT_FY = '2026'
const DISPLAY_FYS = new Set([
  '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026',
])

const FY_STYLES: Record<string, FYStyle> = {
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

/* ── Content component (all hooks/state/effects live here) ──── */
export function MtsContent() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [gdp, setGdp] = useState<FredObservation[]>([])
  const [error, setError] = useState<string | null>(null)

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

  /* Scaled per-FY series for the shared overlay: { FY: [{periodIndex, value($B)}] } */
  const overlayFYs = useMemo(() => {
    if (!data) return {}
    const out: Record<string, Array<{ periodIndex: number; value: number }>> = {}
    for (const fy of fiscalYears) {
      const rows = data.fiscalYears[fy]
      if (!rows) continue
      out[fy] = rows.map(r => ({ periodIndex: r.month_index, value: r.cumulative / TO_BILLIONS }))
    }
    return out
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

  return (
    <>
      {error && <p style={{ color: '#ef4444' }}>Error: {error}</p>}

      <FiscalYearOverlay
        title="CUMULATIVE FISCAL BALANCE"
        subtitle="$ billions · Monthly Surplus/Deficit"
        fiscalYears={overlayFYs}
        currentFY={CURRENT_FY}
        comparisonFY="2025"
        monthLabels={[...MONTH_LABELS]}
        valueFormatter={fmtBillions}
        exactFormatter={fmtBillionsExact}
        fyStyles={FY_STYLES}
        lastUpdated={data?.lastUpdated}
      />

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
