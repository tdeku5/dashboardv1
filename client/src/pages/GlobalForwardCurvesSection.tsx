// 2x3 grid of STIR FORWARD-CURVE small-multiples for the Rates → GLOBAL tab.
// Sits between the GLOBAL POLICY RATE & TERM STRUCTURE grid and the GLOBAL
// CALENDAR SPREADS section.
//
// Each cell mirrors the per-country Forward Pricing tab (STIRDashboardPage,
// activeView === 'pricing'): a two-panel chart where the top panel is the
// implied-rate forward curve (latest solid vs benchmark dashed) and the bottom
// panel is the per-contract change in implied rate vs the benchmark, in bps —
// rule 6 (R5d): rate up = red, rate down = green, as on FORWARD PRICING (it was
// teal-up / red-down before) — i.e. the gap between the solid and dashed lines.
// Data is read straight from the same `/api/futures/curve/:root` endpoint the
// per-country tabs use, one hook instance per cell, so there is no duplicate
// ingestion or computation.
//
// A single set of benchmark-lookback buttons (t-0 / t-1 / t-5 / t-20) drives
// all six charts; t-0 shows today's curve only (benchmark + delta panel
// hidden). The endpoint clamps lookbackDays to >= 1, so t-0 and t-1 share the
// same fetch and t-0 just hides the benchmark client-side. Current cash rates
// are sourced once in the parent: SOFR via FRED for the US, the realized
// overnight rate via /api/overnight-rates/latest for the other five.

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useFuturesCurve, type FuturesCurvePoint } from '../hooks/useFuturesCurve'
import { useOvernightRates } from '../hooks/useOvernightRates'
import { fetchFredSeries } from '../lib/fred'
import { AcmChartFrame, AcmPanel, fmtSignedFixed, niceAxis, roundForDisplay, signColor } from '../components/acm'
import { chartTheme, referenceLines, tooltipSurfaceStyle } from '../components/acm/chartTheme'
import { CURVE_COMPARE_COLORS } from '../constants/identityColors'
import styles from './STIRDashboardPage.module.css'

// ── Colours: the registry (as on the per-country FORWARD PRICING tab) ────────

const COLOR_LATEST = CURVE_COMPARE_COLORS.forwardLatest   // today's curve (a LEVEL: identity)
const COLOR_BENCHMARK = CURVE_COMPARE_COLORS.benchmark    // prior-date curve, dashed

// ── Lookback (benchmark distance) buttons ────────────────────────────────────

const LOOKBACKS = [
  { key: 0,  label: 't-0' },
  { key: 1,  label: 't-1' },
  { key: 5,  label: 't-5' },
  { key: 20, label: 't-20' },
] as const

// ── Country configs (same order as the Policy Rate grid above) ───────────────

interface FwdCountry {
  key: string
  label: string
  root: string        // root symbol the /api/futures/curve endpoint expects
  product: string     // small subtitle, e.g. "SR3 SOFR"
  cashLabel: string   // e.g. "SOFR", "ECB DFR"
  cashCode: string | null // overnight-rates series code; null = US (FRED SOFR)
}

const COUNTRIES: FwdCountry[] = [
  { key: 'US',  label: 'US',  root: 'SR3',  product: 'SR3 SOFR',        cashLabel: 'SOFR',    cashCode: null },
  { key: 'UK',  label: 'UK',  root: 'SO3',  product: 'SO3 SONIA',       cashLabel: 'SONIA',   cashCode: 'SONIA' },
  { key: 'EU',  label: 'EU',  root: 'EUR',  product: 'EUR Euribor',     cashLabel: 'ECB DFR', cashCode: 'ECBDFR' },
  { key: 'CAD', label: 'CAD', root: 'CRA',  product: 'CRA CORRA',       cashLabel: 'CORRA',   cashCode: 'CORRA' },
  { key: 'JPY', label: 'JPY', root: 'TOA3', product: 'TOA3 TONA',       cashLabel: 'TONA',    cashCode: 'TONA' },
  { key: 'AUS', label: 'AUS', root: 'AUS',  product: 'AU 3M Bank Bill', cashLabel: 'AONIA',   cashCode: 'AONIA' },
]

const NON_US_CASH_CODES = COUNTRIES
  .map(c => c.cashCode)
  .filter((c): c is string => c != null)

// ── Helpers (local copies of the per-country formatters) ─────────────────────

function fmtRate(v: number): string {
  return v.toFixed(3)
}
/** Signed 1dp bp; 0.0 when it rounds to zero (near-zero rule). */
function fmtBps(v: number): string {
  return fmtSignedFixed(v, 1)
}
function contractTicker(symbol: string): string {
  return symbol.replace(/^\//, '')
}
function sortCurve(points: FuturesCurvePoint[]): FuturesCurvePoint[] {
  return [...points].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
}

interface CurveRow {
  ticker: string
  latestRate: number | null
  benchmarkRate: number | null
  latestPrice: number | null
  benchmarkPrice: number | null
  deltaBps: number | null
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as CurveRow | undefined
  if (!row) return null
  return (
    <div className={styles.curveTip} style={tooltipSurfaceStyle}>
      <div className={styles.curveTipTitle}>{label}</div>
      <div className={styles.curveTipRow}>
        <span className={styles.curveTipKey}>Latest</span>
        <span>
          {row.latestPrice != null ? row.latestPrice.toFixed(3) : '—'} | {row.latestRate != null ? `${fmtRate(row.latestRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.curveTipRow}>
        <span className={styles.curveTipKey}>Benchmark</span>
        <span>
          {row.benchmarkPrice != null ? row.benchmarkPrice.toFixed(3) : '—'} | {row.benchmarkRate != null ? `${fmtRate(row.benchmarkRate)}%` : '—'}
        </span>
      </div>
      <div className={styles.curveTipRow}>
        <span className={styles.curveTipKey}>Delta</span>
        <span>{row.deltaBps != null ? `${fmtBps(row.deltaBps)} bps` : '—'}</span>
      </div>
    </div>
  )
}

// ── Forward-curve cell (one country) ─────────────────────────────────────────

interface CellProps {
  cfg: FwdCountry
  lookback: number       // selected button value (0/1/5/20)
  cashRate: number | null
}

function ForwardCurveCell({ cfg, lookback, cashRate }: CellProps) {
  // Endpoint clamps lookbackDays to >= 1; t-0 reuses the t-1 fetch and just
  // hides the benchmark, so toggling 0<->1 doesn't trigger a refetch.
  const showBenchmark = lookback > 0
  const curve = useFuturesCurve(cfg.root, Math.max(1, lookback))

  const curveData = useMemo<CurveRow[]>(() => {
    const latest = sortCurve(curve.currentCurve)
    const benchmark = new Map(sortCurve(curve.lookbackCurve).map(row => [row.symbol, row]))
    return latest.map(row => {
      const compare = benchmark.get(row.symbol)
      return {
        ticker: contractTicker(row.symbol),
        latestRate: row.impliedRate,
        benchmarkRate: compare?.impliedRate ?? null,
        latestPrice: row.lastPrice,
        benchmarkPrice: compare?.lastPrice ?? null,
        deltaBps: showBenchmark && compare ? (row.impliedRate - compare.impliedRate) * 100 : null,
      }
    })
  }, [curve.currentCurve, curve.lookbackCurve, showBenchmark])

  // The ±0.15 padded range snapped to even 2dp ticks; Δ bars on whole-bp ticks with 0 in range (niceAxis).
  const curveAxis = useMemo(() => {
    const rates = curveData
      .flatMap(row => [row.latestRate, showBenchmark ? row.benchmarkRate : null])
      .filter((v): v is number => v != null)
    if (rates.length === 0) return niceAxis([0, 5], { dp: 2, maxIntervals: 4 })
    return niceAxis([Math.min(...rates) - 0.15, Math.max(...rates) + 0.15], { dp: 2, maxIntervals: 4 })
  }, [curveData, showBenchmark])
  const deltaAxis = useMemo(() => niceAxis(curveData.map(r => r.deltaBps).filter((v): v is number => v != null), { dp: 0, includeZero: true, maxIntervals: 4 }), [curveData])

  return (
    <AcmChartFrame
      title={cfg.label}
      subtitle={`${cfg.product} · Current ${cfg.cashLabel}: ${cashRate != null ? `${cashRate.toFixed(2)}%` : '—'}`}
      height={TOP_HEIGHT + (showBenchmark ? BOTTOM_HEIGHT : 0)}
      className={styles.gMini}
    >
      {curve.error ? (
        <div className={styles.stateError}>{curve.error}</div>
      ) : curve.loading ? (
        <div className={styles.stateMsg}>Loading…</div>
      ) : (
        <>
          {/* Top panel — forward curve (latest solid + benchmark dashed): LEVELS, identity colours */}
          <ResponsiveContainer width="100%" height={TOP_HEIGHT}>
            <LineChart data={curveData} margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="ticker" {...chartTheme.xAxis} tick={false} tickLine={false} height={4} />
              <YAxis
                {...chartTheme.yAxis}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={curveAxis.domain}
                ticks={curveAxis.ticks}
                width={Y_WIDTH}
              />
              <Tooltip content={<CurveTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
              <Line type="monotone" dataKey="latestRate" name="Latest" stroke={COLOR_LATEST} strokeWidth={2} dot={{ r: 2, fill: COLOR_LATEST }} connectNulls isAnimationActive={false} />
              {showBenchmark && (
                <Line type="monotone" dataKey="benchmarkRate" name="Benchmark" stroke={COLOR_BENCHMARK} strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 1.5, fill: COLOR_BENCHMARK }} connectNulls isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>

          {/* Bottom panel — per-contract implied-rate change vs benchmark (bps): rule 6 */}
          {showBenchmark && (
            <ResponsiveContainer width="100%" height={BOTTOM_HEIGHT}>
              <BarChart data={curveData} margin={{ top: 4, right: 10, left: 2, bottom: 4 }}>
                <CartesianGrid {...chartTheme.grid} vertical={false} />
                <XAxis dataKey="ticker" {...chartTheme.xAxis} angle={-45} textAnchor="end" interval={0} tickMargin={10} height={56} />
                <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(0)}`} width={Y_WIDTH} domain={deltaAxis.domain} ticks={deltaAxis.ticks} />
                <ReferenceLine y={0} {...referenceLines.zero} />
                <Tooltip content={<CurveTooltip />} cursor={chartTheme.barTooltipCursor} isAnimationActive={false} />
                <Bar dataKey="deltaBps" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {curveData.map((row) => {
                    const shown = roundForDisplay(row.deltaBps ?? 0, 1) // the tooltip's 1dp: 0.0 → neutral
                    return <Cell key={row.ticker} fill={shown > 0 ? signColor('acm-negative') : shown < 0 ? signColor('acm-positive') : 'var(--acm-text-tertiary)'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </AcmChartFrame>
  )
}

const TOP_HEIGHT = 310
const BOTTOM_HEIGHT = 150
const Y_WIDTH = 40

// ── Section ──────────────────────────────────────────────────────────────────

export function GlobalForwardCurvesSection() {
  const [lookback, setLookback] = useState<number>(1)

  // Cash rates: five realized overnight rates in one call, plus US SOFR from FRED.
  const overnight = useOvernightRates(NON_US_CASH_CODES)
  const [usSofr, setUsSofr] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - 30)
    fetchFredSeries('SOFR', { observationStart: start.toISOString().slice(0, 10) })
      .then(obs => {
        if (cancelled) return
        for (let i = obs.length - 1; i >= 0; i--) {
          const v = parseFloat(obs[i].value)
          if (obs[i].value !== '.' && Number.isFinite(v)) { setUsSofr(v); return }
        }
      })
      .catch(() => { /* leave usSofr null — cell shows "—" */ })
    return () => { cancelled = true }
  }, [])

  const cashRates = useMemo<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {}
    for (const c of COUNTRIES) {
      out[c.key] = c.cashCode == null ? usSofr : (overnight.data[c.cashCode]?.value ?? null)
    }
    return out
  }, [overnight.data, usSofr])

  return (
    <AcmPanel
      title="GLOBAL FORWARD CURVES W/ DELTAS"
      actions={(
        <div className={styles.toggleGroup}>
          {LOOKBACKS.map(r => (
            <button
              key={r.key}
              type="button"
              aria-pressed={lookback === r.key}
              className={`${styles.toggleButton} ${lookback === r.key ? styles.toggleButtonActive : ''}`}
              onClick={() => setLookback(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    >
      <ul className={styles.gLegend}>
        <li className={styles.gLegendButton}>
          <span aria-hidden="true" className={styles.gLegendSwatch} style={{ ['--acm-swatch' as string]: COLOR_LATEST }} />
          Latest
        </li>
        <li className={styles.gLegendButton}>
          <span aria-hidden="true" className={`${styles.gLegendSwatch} ${styles.gLegendSwatchDashed}`} style={{ ['--acm-swatch' as string]: COLOR_BENCHMARK }} />
          Benchmark
        </li>
        <li className={styles.gLegendButton}>
          <span aria-hidden="true" className={styles.gLegendSwatch} style={{ ['--acm-swatch' as string]: signColor('acm-negative') }} />
          Rate up
        </li>
        <li className={styles.gLegendButton}>
          <span aria-hidden="true" className={styles.gLegendSwatch} style={{ ['--acm-swatch' as string]: signColor('acm-positive') }} />
          Rate down
        </li>
      </ul>

      <div className={styles.gGrid3}>
        {COUNTRIES.map(cfg => (
          <ForwardCurveCell
            key={cfg.key}
            cfg={cfg}
            lookback={lookback}
            cashRate={cashRates[cfg.key]}
          />
        ))}
      </div>
    </AcmPanel>
  )
}
