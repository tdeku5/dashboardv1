import { Fragment, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useGlobalYieldCurves } from '../hooks/useGlobalYieldCurves'
import { useGlobalForwardCurves } from '../hooks/useGlobalForwardCurves'
import { useGlobalCalendarSpreads } from '../hooks/useGlobalCalendarSpreads'
import { useGlobalYieldChanges, type YieldChangeMetric, type YieldChangeRowKey } from '../hooks/useGlobalYieldChanges'
import { ReferenceLine } from 'recharts'
import styles from './STIRDashboardPage.module.css'

const COUNTRY_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  DE: '#facc15',
  FR: '#fb923c',
  IT: '#34d399',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

const YIELD_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
const FORWARD_COUNTRIES = ['US', 'UK', 'EU', 'CA', 'JP', 'AU'] as const

const FORWARD_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  EU: '#facc15',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

const SPREAD_MARKET_COLORS: Record<string, string> = {
  SR3: '#60a5fa',
  SO3: '#a78bfa',
  EUR: '#facc15',
  CRA: '#f87171',
  TOA3: '#f472b6',
  AUS: '#22d3ee',
}

const STRIDE_LABELS: Record<number, string> = { 1: '3m', 2: '6m', 3: '9m', 4: '12m' }

const YIELD_CHANGE_COUNTRIES: { key: string; label: string }[] = [
  { key: 'US',      label: 'US' },
  { key: 'Canada',  label: 'Canada' },
  { key: 'AU',      label: 'AU' },
  { key: 'Japan',   label: 'Japan' },
  { key: 'GB',      label: 'GB' },
  { key: 'Germany', label: 'Germany' },
  { key: 'France',  label: 'France' },
  { key: 'Italy',   label: 'Italy' },
]

const YIELD_CHANGE_ROWS: YieldChangeRowKey[] = ['2Y', '5Y', '10Y', '30Y', '2s10s', '10s30s']

// Per-row color normalization: the strongest |σ| in each row anchors that
// row's gradient. Brown/bronze for selloffs (σ > 0), teal for rallies (σ < 0).
// Power curve (0.7) keeps mid-magnitude moves visible instead of crushing them
// to near-neutral; 0.65 max opacity preserves text readability.
function getCellColor(sigma: number | null | undefined, rowMaxAbs: number): string | undefined {
  if (sigma == null || !Number.isFinite(sigma) || rowMaxAbs === 0) return undefined
  const intensity = sigma / rowMaxAbs
  const curved = Math.sign(intensity) * Math.pow(Math.abs(intensity), 0.7)
  const opacity = Math.abs(curved) * 0.65
  if (curved > 0) return `rgba(180, 120, 60, ${opacity})`
  return `rgba(78, 201, 176, ${opacity})`
}

function fmtSigma(z: number | null | undefined): string {
  if (z == null || !Number.isFinite(z)) return '—'
  const sign = z >= 0 ? '+' : '-'
  return `${sign}${Math.abs(z).toFixed(3)}σ`
}

function fmtBps(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '—'
  const sign = b >= 0 ? '+' : '-'
  return `${sign}${Math.abs(b).toFixed(2)} bps`
}

export function GlobalRatesPage() {
  const [yieldLookback, setYieldLookback] = useState(1)
  const [forwardLookback, setForwardLookback] = useState(1)
  const [spreadsLookback, setSpreadsLookback] = useState(1)

  const yieldData = useGlobalYieldCurves(yieldLookback)
  const forwardData = useGlobalForwardCurves(forwardLookback)
  const spreadsData = useGlobalCalendarSpreads(spreadsLookback)
  const yieldChanges = useGlobalYieldChanges()
  const [compressed, setCompressed] = useState(false)

  // Merge current + lookback rows by row key into _current/_lookback per country.
  const mergeForChart = <T extends Record<string, unknown>>(
    current: T[], lookback: T[], keyField: keyof T, countryKeys: readonly string[]
  ): Array<Record<string, unknown>> => {
    const lookbackByKey = new Map<unknown, T>(lookback.map((r) => [r[keyField], r]))
    return current.map((cur) => {
      const lb = lookbackByKey.get(cur[keyField])
      const out: Record<string, unknown> = { ...cur }
      for (const c of countryKeys) {
        out[`${c}_current`] = cur[c as keyof T] ?? null
        out[`${c}_lookback`] = lb ? (lb[c as keyof T] ?? null) : null
      }
      return out
    })
  }

  const fmtSpread = (v: number | undefined): string => {
    if (typeof v !== 'number') return '—'
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
  }
  const spreadCellClass = (v: string | number | undefined): string => {
    if (typeof v !== 'number') return styles.cellEmpty
    if (v > 0) return styles.ocrPositive
    if (v < 0) return styles.ocrNegative
    return ''
  }

  const ycMergedRows = useMemo(
    () => mergeForChart(yieldData.currentTenors, yieldData.lookbackTenors, 'tenor', YIELD_COUNTRIES as readonly string[]),
    [yieldData.currentTenors, yieldData.lookbackTenors]
  )

  const ycYDomain = useMemo((): [number, number] => {
    const vals: number[] = []
    for (const r of yieldData.currentTenors) {
      for (const c of YIELD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    for (const r of yieldData.lookbackTenors) {
      for (const c of YIELD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
  }, [yieldData.currentTenors, yieldData.lookbackTenors])

  const fwdMergedRows = useMemo(
    () => mergeForChart(forwardData.currentContracts, forwardData.lookbackContracts, 'code', FORWARD_COUNTRIES as readonly string[]),
    [forwardData.currentContracts, forwardData.lookbackContracts]
  )

  const fwdYDomain = useMemo((): [number, number] => {
    const vals: number[] = []
    for (const r of forwardData.currentContracts) {
      for (const c of FORWARD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    for (const r of forwardData.lookbackContracts) {
      for (const c of FORWARD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
  }, [forwardData.currentContracts, forwardData.lookbackContracts])

  const maxYears = useMemo(() => {
    if (yieldData.tenors.length === 0) return 30
    return yieldData.tenors[yieldData.tenors.length - 1].years
  }, [yieldData.tenors])

  const yieldChangeRowMaxAbs = useMemo(() => {
    const result: Record<YieldChangeRowKey, number> = { '2Y': 0, '5Y': 0, '10Y': 0, '30Y': 0, '2s10s': 0, '10s30s': 0 }
    for (const row of YIELD_CHANGE_ROWS) {
      let max = 0
      for (const { key } of YIELD_CHANGE_COUNTRIES) {
        const z = yieldChanges.countries[key]?.[row]?.zScore
        if (z != null && Number.isFinite(z)) {
          const a = Math.abs(z)
          if (a > max) max = a
        }
      }
      result[row] = max
    }
    return result
  }, [yieldChanges.countries])

  return (
    <div className={styles.fullPanel}>
      <div className={styles.globalTopRow}>
      {/* ═══ Global Yield Curves ═══ */}
      <div className={styles.ustDashboard} style={{ minWidth: 0 }}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL SOVEREIGN YIELD CURVES</div>
          <div className={styles.ustYcControls}>
            <div className={styles.spreadLookbackControl}>
              <label htmlFor="ycLookback">t −</label>
              <input
                id="ycLookback"
                type="number"
                min="0"
                max="252"
                value={yieldLookback}
                onChange={(e) => setYieldLookback(Math.max(0, parseInt(e.target.value) || 0))}
                className={styles.spreadLookbackInput}
              />
            </div>
            <button
              onClick={() => setCompressed(v => !v)}
              style={{
                background: compressed ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                border: `1px solid ${compressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: compressed ? '#60a5fa' : '#728197',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600,
                padding: '3px 10px', cursor: 'pointer', borderRadius: '2px',
              }}
            >
              COMPRESSED
            </button>
          </div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {yieldData.asOfDate || '—'}
        </div>

        {yieldData.loading ? (
          <div className={styles.loading}>Loading global yield curves…</div>
        ) : yieldData.error ? (
          <div className={styles.error}>{yieldData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={600}>
            <LineChart data={yieldData.tenors} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={compressed ? 'years' : 'tenor'}
                type={compressed ? 'number' : 'category'}
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                {...(compressed ? {
                  domain: [0, maxYears] as [number, number],
                  ticks: yieldData.tenors.map(t => t.years),
                  tickFormatter: (v: number) => v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`,
                } : {})}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={ycYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                labelFormatter={(label: unknown) => {
                  if (compressed) {
                    const v = Number(label)
                    return v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`
                  }
                  return String(label)
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              {YIELD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={COUNTRY_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ═══ Global Forward Curves ═══ */}
      <div className={styles.ustDashboard} style={{ minWidth: 0 }}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL FORWARD CURVES (STIR STRIPS)</div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {forwardData.asOfDate || '—'}
        </div>

        {forwardData.loading ? (
          <div className={styles.loading}>Loading global forward curves…</div>
        ) : forwardData.error ? (
          <div className={styles.error}>{forwardData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={600}>
            <LineChart data={forwardData.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="code"
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                tickMargin={8}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={fwdYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              {FORWARD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={FORWARD_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      </div>

      {/* ═══ Global Bond Yields — 1 Day Change ═══ */}
      <div className={styles.yieldChangesSection}>
        <div className={styles.yieldChangesHeader}>
          <div className={styles.yieldChangesTitle}>GLOBAL BOND YIELDS — 1 DAY CHANGE</div>
          <div className={styles.yieldChangesDate}>
            {'●'} AS OF: {yieldChanges.asOfDate || '—'}
          </div>
        </div>
        {yieldChanges.loading ? (
          <div className={styles.loading}>Loading yield changes…</div>
        ) : yieldChanges.error ? (
          <div className={styles.error}>{yieldChanges.error}</div>
        ) : (
          <>
            <div
              className={styles.yieldChangesGrid}
              style={{ gridTemplateColumns: `repeat(${YIELD_CHANGE_COUNTRIES.length}, 1fr)` }}
            >
              {YIELD_CHANGE_ROWS.map((row) => (
                <Fragment key={row}>
                  {YIELD_CHANGE_COUNTRIES.map(({ key, label }) => {
                    const country = yieldChanges.countries[key]
                    const metric: YieldChangeMetric | null | undefined = country?.[row]
                    const z = metric?.zScore
                    const bg = getCellColor(z, yieldChangeRowMaxAbs[row])
                    return (
                      <div
                        key={`${key}-${row}`}
                        className={styles.yieldChangeCell}
                        style={bg ? { background: bg } : undefined}
                      >
                        <div className={styles.yieldChangeCellHeader}>{label} {row}</div>
                        {metric ? (
                          <>
                            <div className={styles.yieldChangeSigma}>{fmtSigma(z)}</div>
                            <div className={styles.yieldChangeBps}>{fmtBps(metric.changeBps)}</div>
                          </>
                        ) : (
                          <div className={styles.yieldChangeSigma}>—</div>
                        )}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
            <div className={styles.yieldChangeFooter}>
              σ — 200 Day Standard Deviation<br />
              Bottom two rows show curve differentials
            </div>
          </>
        )}
      </div>

      {/* ═══ Global Calendar Spreads ═══ */}
      <div className={styles.spreadsDashboardFullWidth}>
        <div className={styles.spreadsDashboardHeader}>
          <div className={styles.spreadsHeader}>GLOBAL CALENDAR SPREADS</div>
        </div>
        <div className={styles.spreadsDateLabels}>
          {'●'} AS OF: {spreadsData.asOfDate || '—'}
        </div>

        {spreadsData.loading ? (
          <div className={styles.loading}>Loading global spreads…</div>
        ) : spreadsData.error ? (
          <div className={styles.error}>{spreadsData.error}</div>
        ) : (
          <div
            className={styles.spreadsGrid}
            style={{ gridTemplateColumns: `repeat(${[1, 2, 3, 4].filter(s => (spreadsData.strides[s]?.length ?? 0) > 0).length || 1}, 1fr)` }}
          >
            {([1, 2, 3, 4] as const).filter(s => (spreadsData.strides[s]?.length ?? 0) > 0).map((stride) => {
              const rows = spreadsData.strides[stride] ?? []
              return (
                <div key={stride} className={styles.spreadColumn}>
                  <div className={styles.spreadColumnTitle}>{STRIDE_LABELS[stride]} Spreads</div>
                  <div className={styles.spreadChartContainer}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rows} margin={{ top: 12, right: 12, left: 8, bottom: 50 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={8}
                          angle={-30}
                          textAnchor="end"
                          height={50}
                          interval={0}
                          stroke="#728197"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={6}
                          tickFormatter={(v: number) => v.toFixed(1)}
                          label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: '#cbd5e1', fontSize: 10 }}
                          domain={['auto', 'auto']}
                          stroke="#728197"
                        />
                        <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1} />
                        <Tooltip
                          contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                          formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}bp` : '—', name ?? '']}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                        {spreadsData.countries.map((c) => (
                          <Line
                            key={c.marketKey}
                            type="linear"
                            dataKey={c.marketKey}
                            stroke={SPREAD_MARKET_COLORS[c.marketKey] ?? '#cbd5e1'}
                            strokeWidth={1.5}
                            dot={{ r: 3, fill: SPREAD_MARKET_COLORS[c.marketKey] ?? '#cbd5e1' }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <table className={styles.spreadTable}>
                    <thead>
                      <tr>
                        <th>Spread</th>
                        {spreadsData.countries.map((c) => (
                          <th key={c.marketKey}>
                            <div className={styles.marketKeyHeader}>{c.marketKey}</div>
                            <div className={styles.marketNameHeader}>{c.shortName}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          {spreadsData.countries.map((c) => {
                            const v = row[c.marketKey]
                            return (
                              <td key={c.marketKey} className={spreadCellClass(v)}>
                                {typeof v === 'number' ? fmtSpread(v) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
