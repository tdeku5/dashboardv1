import { useMemo, useState, type ReactNode } from 'react'
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
import {
  AcmChartFrame,
  AcmCollapsible,
  AcmDataTable,
  AcmPageHeader,
  AcmPanel,
  AcmStatStrip,
  AcmStatTile,
  type AcmColumn,
  type AlertLevel,
  type SignTone,
} from '../components/acm'
import {
  CHART_MARGIN,
  chartTheme,
  referenceLines,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipSurfaceStyle,
} from '../components/acm/chartTheme'
import { TENOR_COLORS, US_RATES_VOL_COLORS } from '../constants/identityColors'
import styles from './UsRatesVolPage.module.css'

// Implied MOVE shares the Cross Asset Vol MOVE colour (VOL_INDEX_COLORS.move)
// so the same series reads the same colour wherever it appears.
const COLOR_IMPLIED = US_RATES_VOL_COLORS.implied
const COLOR_REALIZED = US_RATES_VOL_COLORS.realized
const COLOR_PREMIUM = US_RATES_VOL_COLORS.premium

const TENOR_SERIES = [
  { key: 'rv2y' as const, label: '2Y', color: TENOR_COLORS['2Y'], weight: 0.20 },
  { key: 'rv5y' as const, label: '5Y', color: TENOR_COLORS['5Y'], weight: 0.20 },
  { key: 'rv10y' as const, label: '10Y', color: TENOR_COLORS['10Y'], weight: 0.40 },
  { key: 'rv30y' as const, label: '30Y', color: TENOR_COLORS['30Y'], weight: 0.20 },
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

// Nulls render as an em dash everywhere — a missing value is never shown as 0.
function fmt(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return v.toFixed(dp)
}

// ASCII '-' for negatives (Decision 3): values paste into Excel as numbers.
function fmtSigned(v: number | null | undefined, dp = 2, suffix = ''): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const sign = v >= 0 ? '+' : '-'
  return `${sign}${Math.abs(v).toFixed(dp)}${suffix}`
}

function fmtDate(v: string | null | undefined): string {
  return v == null || v === '' ? DASH : v
}

/** The premium is a direction (neither good nor bad): dir-up / dir-down on its text. */
function directionTone(v: number | null | undefined): SignTone | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined
  return v > 0 ? 'dir-up' : 'dir-down'
}

/** |z| > 2 → alert-mild tint, |z| > 3 → alert-strong tint. Never the text. */
function zAlert(z: number | null | undefined): AlertLevel | undefined {
  if (z == null || !Number.isFinite(z)) return undefined
  const a = Math.abs(z)
  return a > 3 ? 'strong' : a > 2 ? 'mild' : undefined
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
      {result && (
        <span className={result.startsWith('Error') ? styles.refreshError : styles.refreshOk}>
          {result}
        </span>
      )}
      <button type="button" className={styles.actionBtn} onClick={handle} disabled={busy}>
        {busy ? 'REFRESHING…' : '↻ REFRESH'}
      </button>
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
      <div className={styles.tooltip} style={tooltipSurfaceStyle}>
        <div style={tooltipLabelStyle}>{label}</div>
        {rows.map(p => (
          <div key={p.dataKey} className={styles.tooltipRow} style={tooltipItemStyle}>
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
  { premiumBp: 'Premium', band1hi: '+1σ', band1lo: '-1σ', band2hi: '+2σ', band2lo: '-2σ' }, 2, ' bp',
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

// ── Contribution table ───────────────────────────────────────────────────────

interface ContribTableRow {
  tenor: string
  weight: number | string | null
  rv: number | null
  contribution: number | null
  share: number | string | null
  bar: number | null
  total: boolean
}

const pct1 = (v: number) => `${v.toFixed(1)}%`

const CONTRIB_COLUMNS: AcmColumn<ContribTableRow>[] = [
  { key: 'tenor', header: 'Tenor', kind: 'label', value: r => r.tenor },
  { key: 'weight', header: 'Weight', kind: 'num', value: r => r.weight, format: v => pct1(v * 100) },
  { key: 'rv', header: 'Realized vol (bp)', kind: 'num', value: r => r.rv, format: v => v.toFixed(2) },
  { key: 'contribution', header: 'Contribution (bp)', kind: 'num', value: r => r.contribution, format: v => v.toFixed(2) },
  { key: 'share', header: 'Share of blend', kind: 'num', value: r => r.share, format: pct1, bar: r => r.bar },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function UsRatesVolPage() {
  const [range, setRange] = useState<VolRangeKey>('2y')
  const [hiddenTenors, setHiddenTenors] = useState<Set<TenorSeriesKey>>(new Set())
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

  const contribRows: ContribTableRow[] = useMemo(() => {
    const rows: ContribTableRow[] = (data?.contributions ?? []).map((c: ContributionRow) => ({
      tenor: c.tenor.toUpperCase(),
      weight: c.weight === 0 && c.rv == null ? null : c.weight,
      rv: c.rv,
      contribution: c.contribution,
      share: c.sharePct,
      bar: c.sharePct,
      total: false,
    }))
    if (hasSeries) {
      rows.push({ tenor: 'RMOVE', weight: '100.0%', rv: null, contribution: latest?.rvMove ?? null, share: '100.0%', bar: null, total: true })
    }
    return rows
  }, [data, hasSeries, latest])

  const renderChartState = (node: ReactNode) => {
    if (loading) return <div className={styles.placeholder}>Loading…</div>
    if (error) return <div className={styles.placeholder}>Failed to load: {error}</div>
    if (series.length === 0) return <div className={styles.placeholder}>No data in selected range.</div>
    return node
  }

  return (
    <div className={`acm-root ${styles.shell}`}>
      <AcmPageHeader
        title="US Rates — Volatility"
        subtitle="Implied MOVE vs a realized analogue built the same way · 21-day trailing, annualized bp"
        actions={<VolRefreshButton onDone={reload} />}
      />

      {/* 1 — Stat strip */}
      <AcmStatStrip>
        <AcmStatTile label="Implied MOVE" value={latest?.move} format={v => v.toFixed(2)} asOf={`as of ${fmtDate(data?.asOfImplied)}`} />
        <AcmStatTile label="Realized (21d)" value={latest?.rvMove} format={v => v.toFixed(2)} asOf={`as of ${fmtDate(latest?.date)}`} />
        <AcmStatTile
          label="Implied vol premium"
          value={fmtSigned(latest?.premiumBp, 2)}
          tone={directionTone(latest?.premiumBp)}
          asOf={`bp · as of ${fmtDate(latest?.date)}`}
        />
        <AcmStatTile label="Ratio" value={`${fmt(latest?.ratio, 3)}×`} asOf={`implied ÷ realized · ${fmtDate(latest?.date)}`} />
        <AcmStatTile
          label="Premium 1y z-score"
          value={fmtSigned(latest?.premiumZ252, 2, 'σ')}
          alert={zAlert(latest?.premiumZ252)}
          asOf={`252d · as of ${fmtDate(latest?.date)}`}
        />
        <AcmStatTile
          label="Ratio 1y percentile"
          value={latest?.ratioPct252 == null ? DASH : `${latest.ratioPct252.toFixed(1)}%`}
          asOf={`252d · as of ${fmtDate(latest?.date)}`}
        />
      </AcmStatStrip>

      {/* 7 — Data-quality notes */}
      {data?.impliedTrailsRealized && (
        <div className={styles.note} role="note">
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
        <div className={styles.note} role="note">
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
            aria-pressed={range === r.key}
            className={`${styles.rangeBtn} ${range === r.key ? styles.rangeBtnActive : ''}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* 2 — Implied vs realized */}
      <AcmChartFrame
        title="Implied vs realized"
        subtitle="Both in annualized bp · realized is 21-day trailing against same-date implied"
        height={CHART_HEIGHT}
        legend={[
          { label: 'Implied MOVE', color: COLOR_IMPLIED },
          { label: 'Realized MOVE (21d)', color: COLOR_REALIZED },
        ]}
      >
        {renderChartState(
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={CHART_MARGIN}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
              <YAxis {...chartTheme.yAxis} width={52} label={undefined} />
              <Tooltip content={<ImpliedRealizedTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
              {/* connectNulls={false}: a gap is drawn as a break, never bridged. */}
              <Line type="monotone" dataKey="move" stroke={COLOR_IMPLIED} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="rvMove" stroke={COLOR_REALIZED} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>,
        )}
      </AcmChartFrame>

      {/* 3 — Premium with ±1σ / ±2σ bands */}
      <AcmChartFrame
        title="Implied vol premium / discount"
        subtitle={`MOVE − realized, in bp · bands are the trailing ${data?.lookbackDays ?? 252}-day mean ±1σ and ±2σ`}
        height={CHART_HEIGHT}
        legend={[
          { label: 'Premium (bp)', color: COLOR_PREMIUM },
          { label: '±1σ', color: String(referenceLines.level.stroke), dashed: true },
          { label: '±2σ', color: String(referenceLines.levelFaint.stroke), dashed: true },
        ]}
      >
        {renderChartState(
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={premiumData} margin={CHART_MARGIN}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
              <YAxis {...chartTheme.yAxis} width={52} />
              <Tooltip content={<PremiumTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
              <ReferenceLine y={0} {...referenceLines.zero} />
              <Line type="monotone" dataKey="band2hi" {...referenceLines.levelFaint} dot={false} strokeWidth={1} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="band2lo" {...referenceLines.levelFaint} dot={false} strokeWidth={1} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="band1hi" {...referenceLines.level} dot={false} strokeWidth={1} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="band1lo" {...referenceLines.level} dot={false} strokeWidth={1} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="premiumBp" stroke={COLOR_PREMIUM} dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>,
        )}
      </AcmChartFrame>

      {/* 4 — Per-tenor realized vol */}
      <AcmChartFrame
        title="Realized vol by tenor"
        subtitle="21-day zero-mean realized vol per tenor, annualized bp · click a chip to toggle"
        height={CHART_HEIGHT}
        legend={TENOR_SERIES.map(t => ({
          label: t.label,
          color: t.color,
          hidden: hiddenTenors.has(t.key),
          onClick: () => toggleTenor(t.key),
        }))}
      >
        {renderChartState(
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={CHART_MARGIN}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
              <YAxis {...chartTheme.yAxis} width={52} />
              <Tooltip content={<TenorTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
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
      </AcmChartFrame>

      {/* 5 — Contribution table */}
      <AcmPanel
        title="Contribution to the blend"
        footer={
          <>
            As of {fmtDate(latest?.date)} · weights are those actually applied
            {latest?.weightsRenormalized ? ' (renormalized — a tenor was missing)' : ''}
          </>
        }
      >
        <AcmDataTable columns={CONTRIB_COLUMNS} rows={contribRows} rowKey={r => r.tenor} rowEmphasis={r => r.total} />
      </AcmPanel>

      {/* 6 — Methodology */}
      <AcmCollapsible title="Methodology">
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
      </AcmCollapsible>
    </div>
  )
}
