import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useUsRatesVol,
  type ContributionRow,
  type VolRangeKey,
  type VolSeriesPoint,
} from '../hooks/useUsRatesVol'
import styles from './UsRatesVolPage.module.css'

// Implied MOVE keeps the blue it carries on the Cross-Asset Vol page so the
// same series reads the same colour wherever it appears in the terminal.
const COLOR_IMPLIED = '#3b82f6'
const COLOR_REALIZED = '#f59e0b'
const COLOR_PREMIUM = '#e2e8f0'
const COLOR_BAND_1 = '#4e6070'
const COLOR_BAND_2 = '#3a4654'

const TENOR_SERIES = [
  { key: 'rv2y' as const, label: '2Y', color: '#ef4444', weight: 0.20 },
  { key: 'rv5y' as const, label: '5Y', color: '#f59e0b', weight: 0.20 },
  { key: 'rv10y' as const, label: '10Y', color: '#3b82f6', weight: 0.40 },
  { key: 'rv30y' as const, label: '30Y', color: '#a855f7', weight: 0.20 },
]
type TenorSeriesKey = (typeof TENOR_SERIES)[number]['key']

const RANGES: ReadonlyArray<{ key: VolRangeKey; label: string }> = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: 'all', label: 'ALL' },
]

const CHART_HEIGHT = 360
const DASH = '—'

const AXIS_TICK = { fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }

// Nulls render as an em dash everywhere — a missing value is never shown as 0.
function fmt(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return v.toFixed(dp)
}

function fmtSigned(v: number | null | undefined, dp = 2, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const sign = v >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v).toFixed(dp)}${suffix}`
}

function fmtDate(v: string | null | undefined): string {
  return v == null || v === '' ? DASH : v
}

function signClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  if (v > 0) return styles.statPos
  if (v < 0) return styles.statNeg
  return ''
}

// ── Refresh control ──────────────────────────────────────────────────────────
// The scheduled job (startup + every 4h) is the primary path. This exists
// because cron on this machine misses runs when the laptop sleeps.

function VolRefreshButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handle = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/rates/us/vol/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setResult(
          data.datesUpserted > 0
            ? `Upserted ${data.datesUpserted} · latest ${data.latestDate}`
            : `Already current · latest ${data.latestDate}`,
        )
        onDone()
      } else {
        setResult(`Error: ${data.error}`)
      }
    } catch (err) {
      setResult(`Error: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.refreshRow}>
      <button type="button" className={styles.methodToggle} onClick={handle} disabled={busy}>
        {busy ? 'REFRESHING…' : '↻ REFRESH'}
      </button>
      {result && (
        <span
          className={styles.statMeta}
          style={{ color: result.startsWith('Error') ? '#ef4444' : '#22c55e' }}
        >
          {result}
        </span>
      )}
    </div>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipRow { dataKey: string; value: number | null; color: string; name?: string }

function makeTooltip(
  labels: Record<string, string>,
  dp: number,
  suffix = '',
) {
  return function ChartTooltip({ active, payload, label }: {
    active?: boolean
    payload?: TooltipRow[]
    label?: string
  }) {
    if (!active || !payload || payload.length === 0) return null
    const rows = payload.filter(p => labels[p.dataKey] !== undefined)
    if (rows.length === 0) return null
    return (
      <div className={styles.tooltip}>
        <div className={styles.tooltipDate}>{label}</div>
        {rows.map(p => (
          <div key={p.dataKey} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: p.color }} />
            <span className={styles.tooltipName}>{labels[p.dataKey]}</span>
            <span className={styles.tooltipVal}>
              {p.value == null || !Number.isFinite(p.value) ? DASH : `${p.value.toFixed(dp)}${suffix}`}
            </span>
          </div>
        ))}
      </div>
    )
  }
}

const ImpliedRealizedTooltip = makeTooltip(
  { move: 'Implied MOVE', rvMove: 'Realized (21d)' }, 2, ' bp',
)
const PremiumTooltip = makeTooltip(
  { premiumBp: 'Premium', band1hi: '+1σ', band1lo: '−1σ', band2hi: '+2σ', band2lo: '−2σ' }, 2, ' bp',
)
const TenorTooltip = makeTooltip(
  { rv2y: '2Y', rv5y: '5Y', rv10y: '10Y', rv30y: '30Y' }, 2, ' bp',
)

export interface PremiumChartPoint {
  date: string
  premiumBp: number | null
  band1hi: number | null
  band1lo: number | null
  band2hi: number | null
  band2lo: number | null
}

/**
 * ±1σ / ±2σ band lines are pure presentation: the route supplies the
 * trailing-252 mean and stdev, and the bands are mean ± kσ around them.
 *
 * A missing premium stays null and a date without a full 252-day window has no
 * bands — null is never coerced to 0. Paired with connectNulls={false} on the
 * chart, that is what makes the line break across a gap instead of drawing
 * straight through it. Exported so the null contract is testable without a
 * browser.
 */
export function buildPremiumChartData(
  series: ReadonlyArray<VolSeriesPoint>,
): PremiumChartPoint[] {
  return series.map(p => {
    const m = p.premiumMean252
    const s = p.premiumSd252
    const ok = m != null && s != null && Number.isFinite(m) && Number.isFinite(s)
    return {
      date: p.date,
      premiumBp: p.premiumBp,
      band1hi: ok ? m + s : null,
      band1lo: ok ? m - s : null,
      band2hi: ok ? m + 2 * s : null,
      band2lo: ok ? m - 2 * s : null,
    }
  })
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function UsRatesVolPage() {
  const [range, setRange] = useState<VolRangeKey>('2y')
  const [hiddenTenors, setHiddenTenors] = useState<Set<TenorSeriesKey>>(new Set())
  const [methodOpen, setMethodOpen] = useState(false)
  const { data, loading, error, reload } = useUsRatesVol(range)

  const series: VolSeriesPoint[] = useMemo(() => data?.series ?? [], [data])

  const premiumData = useMemo(() => buildPremiumChartData(series), [series])

  const toggleTenor = (k: TenorSeriesKey) => {
    setHiddenTenors(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const latest = data?.latest
  const hasSeries = !loading && !error && series.length > 0

  const renderChartState = (node: React.ReactNode) => {
    if (loading) return <div className={styles.placeholder}>Loading…</div>
    if (error) return <div className={styles.placeholder}>Failed to load: {error}</div>
    if (series.length === 0) return <div className={styles.placeholder}>No data in selected range.</div>
    return node
  }

  return (
    <div className={styles.shell}>
      <div className={styles.headerRow}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>US Rates — Volatility</div>
          <div className={styles.pageSubtitle}>
            Implied MOVE vs a realized analogue built the same way · 21-day trailing, annualized bp
          </div>
        </div>
        <VolRefreshButton onDone={reload} />
      </div>

      {/* 1 — Stat strip */}
      <div className={styles.statStrip}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Implied MOVE</span>
          <span className={styles.statValue} style={{ color: COLOR_IMPLIED }}>{fmt(latest?.move)}</span>
          <span className={styles.statMeta}>as of {fmtDate(data?.asOfImplied)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Realized (21d)</span>
          <span className={styles.statValue} style={{ color: COLOR_REALIZED }}>{fmt(latest?.rvMove)}</span>
          <span className={styles.statMeta}>as of {fmtDate(latest?.date)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Implied vol premium</span>
          <span className={`${styles.statValue} ${signClass(latest?.premiumBp)}`}>
            {fmtSigned(latest?.premiumBp, 2)}
          </span>
          <span className={styles.statMeta}>bp · as of {fmtDate(latest?.date)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ratio</span>
          <span className={styles.statValue}>{fmt(latest?.ratio, 3)}×</span>
          <span className={styles.statMeta}>implied ÷ realized · {fmtDate(latest?.date)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Premium 1y z-score</span>
          <span className={`${styles.statValue} ${signClass(latest?.premiumZ252)}`}>
            {fmtSigned(latest?.premiumZ252, 2, 'σ')}
          </span>
          <span className={styles.statMeta}>252d · as of {fmtDate(latest?.date)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ratio 1y percentile</span>
          <span className={styles.statValue}>
            {latest?.ratioPct252 == null ? DASH : `${latest.ratioPct252.toFixed(1)}%`}
          </span>
          <span className={styles.statMeta}>252d · as of {fmtDate(latest?.date)}</span>
        </div>
      </div>

      {/* 7 — Data-quality notes */}
      {data?.impliedTrailsRealized && (
        <div className={styles.warning}>
          <span>
            Realized has printed for {fmtDate(data.asOfRealized)} but implied MOVE has not — the
            comparison is shown as of {fmtDate(data.asOfImplied)}.
          </span>
          <span>
            The ingest stale-tip filter withholds a MOVE bar whose close exactly repeats the prior
            session, so an unfilled bar is dropped rather than recorded. It resolves on the next
            export carrying a real close. The join is not shifted and nothing is forward-filled.
          </span>
        </div>
      )}

      {data && data.renormalizedRanges.length > 0 && (
        <div className={styles.warning}>
          <span>
            Weights renormalized on {data.renormalizedRanges.reduce((s, r) => s + r.days, 0)} date(s)
            in this range — a tenor was missing and the remaining weights were rescaled to sum to 1,
            so the blend over these stretches is not the standard 20/20/40/20:
          </span>
          {data.renormalizedRanges.map(r => (
            <span key={r.from}>· {r.from} → {r.to} ({r.days}d)</span>
          ))}
        </div>
      )}

      <div className={styles.rangeRow}>
        <span className={styles.rangeLabel}>Range</span>
        {RANGES.map(r => (
          <button
            key={r.key}
            type="button"
            className={`${styles.btn} ${range === r.key ? styles.btnActive : ''}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* 2 — Implied vs realized */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Implied vs realized</div>
          <div className={styles.panelSubtitle}>
            Both in annualized bp · realized is 21-day trailing against same-date implied
          </div>
        </div>
        <div className={styles.chartWrap}>
          {renderChartState(
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={series} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={AXIS_TICK} width={52} label={undefined} />
                <Tooltip content={<ImpliedRealizedTooltip />} />
                {/* connectNulls={false}: a gap is drawn as a break, never bridged. */}
                <Line type="monotone" dataKey="move" stroke={COLOR_IMPLIED} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="rvMove" stroke={COLOR_REALIZED} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>,
          )}
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendChip}>
            <span className={styles.legendDot} style={{ background: COLOR_IMPLIED }} />
            Implied MOVE
          </span>
          <span className={styles.legendChip}>
            <span className={styles.legendDot} style={{ background: COLOR_REALIZED }} />
            Realized MOVE (21d)
          </span>
        </div>
      </div>

      {/* 3 — Premium with ±1σ / ±2σ bands */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Implied vol premium / discount</div>
          <div className={styles.panelSubtitle}>
            MOVE − realized, in bp · bands are the trailing {data?.lookbackDays ?? 252}-day mean ±1σ and ±2σ
          </div>
        </div>
        <div className={styles.chartWrap}>
          {renderChartState(
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={premiumData} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={AXIS_TICK} width={52} />
                <Tooltip content={<PremiumTooltip />} />
                <ReferenceLine y={0} stroke="#64748B" strokeWidth={1} />
                <Line type="monotone" dataKey="band2hi" stroke={COLOR_BAND_2} dot={false} strokeWidth={1} strokeDasharray="2 4" connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="band2lo" stroke={COLOR_BAND_2} dot={false} strokeWidth={1} strokeDasharray="2 4" connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="band1hi" stroke={COLOR_BAND_1} dot={false} strokeWidth={1} strokeDasharray="4 4" connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="band1lo" stroke={COLOR_BAND_1} dot={false} strokeWidth={1} strokeDasharray="4 4" connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="premiumBp" stroke={COLOR_PREMIUM} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>,
          )}
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendChip}>
            <span className={styles.legendDot} style={{ background: COLOR_PREMIUM }} />
            Premium (bp)
          </span>
          <span className={styles.legendChip}>
            <span className={styles.legendDot} style={{ background: COLOR_BAND_1 }} />
            ±1σ
          </span>
          <span className={styles.legendChip}>
            <span className={styles.legendDot} style={{ background: COLOR_BAND_2 }} />
            ±2σ
          </span>
        </div>
      </div>

      {/* 4 — Per-tenor realized vol */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Realized vol by tenor</div>
          <div className={styles.panelSubtitle}>
            21-day zero-mean realized vol per tenor, annualized bp · click a chip to toggle
          </div>
        </div>
        <div className={styles.chartWrap}>
          {renderChartState(
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={series} margin={{ top: 16, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={AXIS_TICK} width={52} />
                <Tooltip content={<TenorTooltip />} />
                {TENOR_SERIES.filter(t => !hiddenTenors.has(t.key)).map(t => (
                  <Line
                    key={t.key}
                    type="monotone"
                    dataKey={t.key}
                    stroke={t.color}
                    dot={false}
                    strokeWidth={1.4}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>,
          )}
        </div>
        <div className={styles.legendRow}>
          {TENOR_SERIES.map(t => {
            const hidden = hiddenTenors.has(t.key)
            return (
              <button
                key={t.key}
                type="button"
                className={`${styles.legendChip} ${hidden ? styles.legendChipHidden : ''}`}
                onClick={() => toggleTenor(t.key)}
              >
                <span
                  className={`${styles.legendDot} ${hidden ? styles.legendDotHidden : ''}`}
                  style={{ background: t.color }}
                />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 5 — Contribution table */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Contribution to the blend</div>
          <div className={styles.panelSubtitle}>
            As of {fmtDate(latest?.date)} · weights are those actually applied
            {latest?.weightsRenormalized ? ' (renormalized — a tenor was missing)' : ''}
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tenor</th>
              <th>Weight</th>
              <th>Realized vol (bp)</th>
              <th>Contribution (bp)</th>
              <th>Share of blend</th>
            </tr>
          </thead>
          <tbody>
            {(data?.contributions ?? []).map((c: ContributionRow) => (
              <tr key={c.tenor}>
                <td>{c.tenor.toUpperCase()}</td>
                <td>{c.weight === 0 && c.rv == null ? DASH : `${(c.weight * 100).toFixed(1)}%`}</td>
                <td>{fmt(c.rv)}</td>
                <td>{fmt(c.contribution)}</td>
                <td>
                  {c.sharePct == null ? DASH : (
                    <>
                      <span
                        className={styles.tableBar}
                        style={{ width: `${Math.max(2, c.sharePct)}px` }}
                      />
                      {c.sharePct.toFixed(1)}%
                    </>
                  )}
                </td>
              </tr>
            ))}
            {hasSeries && (
              <tr>
                <td><strong>RMOVE</strong></td>
                <td>100.0%</td>
                <td>{DASH}</td>
                <td><strong>{fmt(latest?.rvMove)}</strong></td>
                <td>100.0%</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 6 — Methodology */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Methodology</div>
        </div>
        <button type="button" className={styles.methodToggle} onClick={() => setMethodOpen(o => !o)}>
          {methodOpen ? '▾ Hide' : '▸ Show'}
        </button>
        {methodOpen && (
          <div className={styles.methodBody}>
            <div className={styles.methodHeading}>Construction</div>
            <div>
              The ICE BofA MOVE is a curve-weighted average of normalized (basis-point) implied
              volatility on 1-month Treasury options, quoted in annualized basis points. The realized
              analogue mirrors that arithmetic exactly, so the two sit on the same axis. Per tenor,
              over a rolling window of <strong>N = 21 trading days</strong> (matching the 1-month
              option tenor):
            </div>
            <div className={styles.formula}>
{`Δy_t    = (y_t − y_{t−1}) × 100          yields quoted in percent → bp
σ_tenor = sqrt( (252 / 21) × Σ Δy_t² )   annualized bp, zero-mean

RMOVE   = 0.20·σ_2y + 0.20·σ_5y + 0.40·σ_10y + 0.20·σ_30y`}
            </div>
            <div>
              The blend is a linear weighted average <strong>of the vols</strong>, not the vol of a
              weighted yield portfolio. That is how the index itself is built, and matching its
              arithmetic is the point. The <strong>√252</strong> factor annualizes a daily figure;
              the 252/21 form above folds in the window length.
            </div>

            <div className={styles.methodHeading}>Zero-mean, and why</div>
            <div>
              The daily changes are squared <strong>as they come</strong>: no mean subtraction, and
              an N (not N−1) denominator. This is deliberate and is not a textbook sample variance.
              The two estimators differ by exactly the squared mean, so centering always reports less
              vol — and what it removes is whatever directional drift occurred in the window. If 10s
              sell off a steady 2bp per day for a month, zero-mean reports ≈31.7bp annualized while
              centered reports ≈0, yet that month paid a straddle holder every day and the MOVE would
              not have printed zero.
            </div>
            <div>
              The reason is that an option prices the expected <strong>second moment</strong>, not
              variance around a drift. Uncentered realized vol is the quantity that belongs on the
              same axis as an implied number. Over a 21-observation window the estimated mean also
              carries a standard error of roughly σ/√21 ≈ 22% of σ, so centering subtracts mostly
              noise, always downward.
            </div>
            <div>
              The z-score and percentile below <em>are</em> centered — they standardise a level
              against its own recent distribution, which is a different question from estimating a
              second moment.
            </div>

            <div className={styles.methodHeading}>Window alignment</div>
            <div>
              MOVE at date <em>t</em> prices volatility over the forward window [t, t+21]; trailing
              realized at <em>t</em> measures [t−21, t]. This page uses{' '}
              <strong>21-day trailing realized against same-date implied</strong> —
              contemporaneous alignment, which is standard practice and the only version computable
              up to the current session. Implied and realized are not shifted to meet each other.
            </div>

            <div className={styles.methodHeading}>Weights and renormalization</div>
            <div>
              Weights are <strong>20% / 20% / 40% / 20%</strong> across 2y / 5y / 10y / 30y. If a
              tenor is missing on a date, the remaining weights are rescaled to sum to 1 and the date
              is flagged — a missing 30y gives 0.25 / 0.25 / 0.50 across 2s/5s/10s. If{' '}
              <strong>two or more</strong> tenors are missing the blend returns nothing at all, since
              at that point it is a different index. Any stretch where weights were renormalized is
              called out above the charts rather than left silently different.
            </div>

            <div className={styles.methodHeading}>Missing data</div>
            <div>
              A window must hold <strong>exactly 21</strong> valid daily changes. Fewer returns
              nothing rather than a partial window scaled up. Yields are never forward-filled, gaps
              are never interpolated, and no neighbouring tenor is ever substituted for a missing
              one. Missing values render as {DASH} and charts break the line across them.
            </div>

            <div className={styles.methodHeading}>Derived metrics</div>
            <div>
              <strong>Premium</strong> = MOVE − RMOVE, in bp.{' '}
              <strong>Ratio</strong> = MOVE ÷ RMOVE (nothing when RMOVE is zero).{' '}
              <strong>z-score</strong> and <strong>percentile</strong> use a trailing{' '}
              {data?.lookbackDays ?? 252} trading days and require a full window — a partial one
              returns nothing.
            </div>

            <div className={styles.methodHeading}>Sources</div>
            <div>
              Implied MOVE and the 2y/5y/10y/30y yields all come from TradingView, so the trading
              calendar, the daily close convention and the snapshot time are shared across both sides
              of a difference. Implied and realized are joined on date with an inner join: a date
              appears only when both exist.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
