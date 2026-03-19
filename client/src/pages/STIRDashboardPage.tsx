import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { useFedWatch } from '../hooks/useFedWatch'
import { useFuturesCurve, type FuturesCurvePoint } from '../hooks/useFuturesCurve'
import styles from './STIRDashboardPage.module.css'

type ProductKey = 'fedfunds' | 'sofr'

const PRODUCT_CONFIG: Record<ProductKey, { label: string; root: string; title: string }> = {
  fedfunds: { label: 'FED FUNDS', root: 'ZQ', title: 'FED FUNDS' },
  sofr: { label: '3M SOFR', root: 'SR3', title: '3M SOFR' },
}

interface CurveRow {
  ticker: string
  latestRate: number | null
  benchmarkRate: number | null
  latestPrice: number | null
  benchmarkPrice: number | null
  deltaBps: number | null
  order: number
}

interface SummaryRow {
  key: string
  label: string
  impliedRate: number
  stepBps: number
  totalBps: number
  impliedMoves: number
  stepSummary: string
  totalSummary: string
  tone: 'cut' | 'hike' | 'flat'
}

function fmtDaysWeeks(currentDate: string, benchmarkDate: string): { days: number; weeks: string } {
  if (!currentDate || !benchmarkDate) return { days: 0, weeks: '0.0' }
  const current = new Date(`${currentDate}T12:00:00Z`)
  const benchmark = new Date(`${benchmarkDate}T12:00:00Z`)
  const diffMs = Math.abs(current.getTime() - benchmark.getTime())
  const days = Math.round(diffMs / 86_400_000)
  return { days, weeks: (days / 7).toFixed(1) }
}

function fmtRate(v: number): string {
  return v.toFixed(3)
}

function fmtBps(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

function toneFromBps(v: number): 'cut' | 'hike' | 'flat' {
  if (v > 0.01) return 'hike'
  if (v < -0.01) return 'cut'
  return 'flat'
}

function summaryFromBps(v: number): string {
  const moves = Math.abs(v) / 25
  if (Math.abs(v) < 0.01) return 'UNCH'
  if (v > 0) return `+${moves.toFixed(1)} HIKES`
  return `${moves.toFixed(1)} CUTS`
}

function impliedMovesFromBps(v: number): number {
  return v / 25
}

function contractTicker(symbol: string): string {
  return symbol.replace(/^\//, '')
}

function sortCurve(points: FuturesCurvePoint[]): FuturesCurvePoint[] {
  return [...points].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
}

function renderDeltaLabel(props: any) {
  const { x, y, width, height, value } = props
  if (value == null) return null
  const numeric = Number(value)
  return (
    <text
      x={x + width / 2}
      y={numeric >= 0 ? y - 8 : y + height + 14}
      textAnchor="middle"
      fill="#94A3B8"
      fontSize={10}
      fontFamily="var(--font-mono)"
      fontWeight={700}
    >
      {fmtBps(numeric)}
    </text>
  )
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as CurveRow | undefined
  if (!row) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{label}</div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Latest</span>
        <span className={styles.tooltipValue}>
          {row.latestPrice != null ? row.latestPrice.toFixed(3) : '—'} | {row.latestRate != null ? `${fmtRate(row.latestRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Benchmark</span>
        <span className={styles.tooltipValue}>
          {row.benchmarkPrice != null ? row.benchmarkPrice.toFixed(3) : '—'} | {row.benchmarkRate != null ? `${fmtRate(row.benchmarkRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipKey}>Delta</span>
        <span className={styles.tooltipValue}>{row.deltaBps != null ? `${fmtBps(row.deltaBps)} bps` : '—'}</span>
      </div>
    </div>
  )
}

export function STIRDashboardPage() {
  const [product, setProduct] = useState<ProductKey>('fedfunds')
  const [lookbackDaysInput, setLookbackDaysInput] = useState('1')
  const [showMatrix, setShowMatrix] = useState(true)

  const productConfig = PRODUCT_CONFIG[product]
  const lookbackDays = Math.max(0, Number.parseInt(lookbackDaysInput, 10) || 0)

  const curve = useFuturesCurve(productConfig.root, lookbackDays)
  const fedwatch = useFedWatch()

  const loading = curve.loading || fedwatch.loading
  const error = curve.error || fedwatch.error

  const headerTiming = useMemo(
    () => fmtDaysWeeks(curve.currentDate, curve.lookbackDate),
    [curve.currentDate, curve.lookbackDate],
  )

  const curveData = useMemo(() => {
    const latest = sortCurve(curve.currentCurve)
    const benchmark = new Map(sortCurve(curve.lookbackCurve).map((row) => [row.symbol, row]))

    return latest.map((row, idx) => {
      const compare = benchmark.get(row.symbol)
      return {
        ticker: contractTicker(row.symbol),
        latestRate: row.impliedRate,
        benchmarkRate: compare?.impliedRate ?? null,
        latestPrice: row.lastPrice,
        benchmarkPrice: compare?.lastPrice ?? null,
        deltaBps: compare ? (row.impliedRate - compare.impliedRate) * 100 : null,
        order: idx,
      }
    })
  }, [curve.currentCurve, curve.lookbackCurve])

  const summaryRows = useMemo<SummaryRow[]>(() => {
    if (product === 'fedfunds') {
      return fedwatch.meetings
        .filter((meeting) => meeting.meetingDate <= '2027-03-31')
        .map((meeting) => {
          const stepBps = meeting.expectedChange * 100
          const totalBps = (meeting.effrEnd - fedwatch.currentEFFR) * 100
          const tone = toneFromBps(stepBps)
          return {
            key: meeting.meetingDate,
            label: meeting.meetingMonth,
            impliedRate: meeting.effrEnd,
            stepBps,
            totalBps,
            impliedMoves: impliedMovesFromBps(totalBps),
            stepSummary: summaryFromBps(stepBps),
            totalSummary: summaryFromBps(totalBps),
            tone,
          }
        })
    }

    const latest = sortCurve(curve.currentCurve)
      .filter((row) => row.year <= 2029)

    return latest.map((row, idx) => {
      const prior = idx > 0 ? latest[idx - 1] : null
      const stepBps = prior ? (row.impliedRate - prior.impliedRate) * 100 : (row.impliedRate - fedwatch.currentEFFR) * 100
      const totalBps = (row.impliedRate - fedwatch.currentEFFR) * 100
      const tone = toneFromBps(stepBps)
      return {
        key: row.symbol,
        label: row.expiryLabel,
        impliedRate: row.impliedRate,
        stepBps,
        totalBps,
        impliedMoves: impliedMovesFromBps(totalBps),
        stepSummary: summaryFromBps(stepBps),
        totalSummary: summaryFromBps(totalBps),
        tone,
      }
    })
  }, [product, fedwatch.meetings, fedwatch.currentEFFR, curve.currentCurve])

  const overnightRow = useMemo<SummaryRow>(() => ({
    key: 'cash',
    label: 'Overnight Cash',
    impliedRate: fedwatch.currentEFFR,
    stepBps: 0,
    totalBps: 0,
    impliedMoves: 0,
    stepSummary: 'UNCH',
    totalSummary: 'UNCH',
    tone: 'flat',
  }), [fedwatch.currentEFFR])

  const matrixRows = useMemo(() => {
    return fedwatch.cumulativeProbabilities.map((row) => {
      let maxRange = ''
      let maxValue = -1
      for (const range of fedwatch.rangeColumns) {
        const value = row.targetRanges[range] ?? 0
        if (value > maxValue) {
          maxValue = value
          maxRange = range
        }
      }
      return { ...row, maxRange }
    })
  }, [fedwatch.cumulativeProbabilities, fedwatch.rangeColumns])

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
        <span className={styles.breadcrumbCurrent}>STIR Futures</span>
      </nav>

      <main className={styles.body}>
        <section className={styles.controlsSection}>
          <div className={styles.toggleGroup}>
            {(Object.entries(PRODUCT_CONFIG) as [ProductKey, typeof PRODUCT_CONFIG[ProductKey]][]).map(([key, config]) => (
              <button
                key={key}
                className={`${styles.toggleButton} ${product === key ? styles.toggleButtonActive : ''}`}
                onClick={() => setProduct(key)}
              >
                {config.label}
              </button>
            ))}
          </div>

          <div className={styles.headerBlock}>
            <div className={styles.pageTitle}>// UNITED STATES: {productConfig.title} (FED IMPLIED)</div>
            <div className={styles.subtitleRow}>
              <span>● LATEST: {curve.currentDate || '—'} (0 DAYS, 0.0 WEEKS)</span>
              <span>● BENCHMARK: {curve.lookbackDate || '—'} ({headerTiming.days} DAYS, {headerTiming.weeks} WEEKS)</span>
            </div>
            <label className={styles.lookbackWrap}>
              <span className={styles.lookbackLabel}>t -</span>
              <input
                className={styles.lookbackInput}
                type="number"
                min="0"
                step="1"
                value={lookbackDaysInput}
                onChange={(e) => setLookbackDaysInput(e.target.value)}
              />
            </label>
          </div>
        </section>

        {error && (
          <section className={styles.section}>
            <div className={styles.error}>{error}</div>
          </section>
        )}

        {!error && loading && (
          <section className={styles.section}>
            <div className={styles.loading}>Loading futures dashboard…</div>
          </section>
        )}

        {!error && !loading && (
          <>
            <section className={styles.section}>
              <div className={styles.chartPanel}>
                <div className={styles.panelTitle}>Curve</div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={curveData} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis dataKey="ticker" stroke="#728197" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                    <YAxis stroke="#728197" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(2)}%`} />
                    <Tooltip content={<CurveTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="latestRate"
                      name="Latest"
                      stroke="#2196F3"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="benchmarkRate"
                      name="Benchmark"
                      stroke="#888888"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 2.5 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className={styles.chartPanel}>
                <div className={styles.panelTitle}>Delta vs Benchmark</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={curveData} margin={{ top: 24, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="ticker" stroke="#728197" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                    <YAxis stroke="#728197" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                    <Tooltip
                      formatter={(value: number | undefined) => [`${fmtBps(Number(value ?? 0))} bps`, 'Delta']}
                      labelFormatter={(label) => String(label)}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Bar dataKey="deltaBps" radius={[2, 2, 0, 0]}>
                      {curveData.map((row) => (
                        <Cell key={row.ticker} fill={(row.deltaBps ?? 0) >= 0 ? '#4EC9B0' : '#EF5350'} />
                      ))}
                      <LabelList content={renderDeltaLabel} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>Summary Table</div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Meeting</th>
                      <th>Implied Rate</th>
                      <th>Bps (Step)</th>
                      <th>Bps (Total)</th>
                      <th>Implied # Cuts/Hikes</th>
                      <th>Summary</th>
                      <th>Summary (Total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[overnightRow, ...summaryRows].map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td className={styles.mono}>{fmtRate(row.impliedRate)}</td>
                        <td className={`${styles.mono} ${row.stepBps < 0 ? styles.cutText : row.stepBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.stepBps)}</td>
                        <td className={`${styles.mono} ${row.totalBps < 0 ? styles.cutText : row.totalBps > 0 ? styles.hikeText : styles.flatText}`}>{fmtBps(row.totalBps)}</td>
                        <td className={styles.mono}>{row.impliedMoves.toFixed(1)}</td>
                        <td><span className={`${styles.badge} ${styles[row.tone]}`}>{row.stepSummary}</span></td>
                        <td><span className={`${styles.badge} ${styles[row.totalBps < 0 ? 'cut' : row.totalBps > 0 ? 'hike' : 'flat']}`}>{row.totalSummary}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {product === 'fedfunds' && (
              <section className={styles.section}>
                <button className={styles.matrixToggle} onClick={() => setShowMatrix((v) => !v)}>
                  {showMatrix ? '▼' : '▶'} Detailed Probability Matrix
                </button>
                {showMatrix && (
                  <div className={styles.matrixWrap}>
                    <table className={styles.matrixTable}>
                      <thead>
                        <tr>
                          <th>Meeting</th>
                          {fedwatch.rangeColumns.map((range) => (
                            <th key={range}>{range}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixRows.map((row) => (
                          <tr key={row.meetingDate}>
                            <td>{row.meetingLabel}</td>
                            {fedwatch.rangeColumns.map((range) => {
                              const value = row.targetRanges[range] ?? 0
                              return (
                                <td
                                  key={range}
                                  className={range === row.maxRange ? styles.matrixHot : ''}
                                >
                                  {(value * 100).toFixed(1)}%
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
