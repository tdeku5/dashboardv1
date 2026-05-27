// 2x3 grid of STIR FORWARD-CURVE small-multiples for the Rates → GLOBAL tab.
// Sits between the GLOBAL POLICY RATE & TERM STRUCTURE grid and the GLOBAL
// CALENDAR SPREADS section.
//
// Each cell mirrors the per-country Forward Pricing tab (STIRDashboardPage,
// activeView === 'pricing'): a two-panel chart where the top panel is the
// implied-rate forward curve (latest solid vs benchmark dashed) and the bottom
// panel is the per-contract day-over-day change in bps (green = up, red =
// down) — i.e. the gap between the solid and dashed lines at each contract.
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
import styles from './STIRDashboardPage.module.css'

// ── Visual constants (kept in sync with the per-country pricing tab) ─────────

const COLOR_LATEST = '#2196F3'   // solid blue — today's curve
const COLOR_BENCHMARK = '#888888' // dashed grey — prior-date curve
const COLOR_UP = '#4EC9B0'        // teal — contract rate up vs benchmark
const COLOR_DOWN = '#EF5350'      // red — contract rate down vs benchmark

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
function fmtBps(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
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

// ── Range buttons ────────────────────────────────────────────────────────────

function LookbackButtons({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {LOOKBACKS.map(r => {
        const active = value === r.key
        return (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            style={{
              padding: '4px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              color: active ? '#0f172a' : '#94a3b8',
              background: active ? '#60a5fa' : 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 2,
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Shared legend (static: Latest solid / Benchmark dashed) ──────────────────

function SharedLegend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 18px',
        padding: '8px 12px',
        marginBottom: 8,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 2,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        color: '#cbd5e1',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 3, borderRadius: 1, background: COLOR_LATEST, display: 'inline-block' }} />
        Latest
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 0, borderTop: `2px dashed ${COLOR_BENCHMARK}`, display: 'inline-block' }} />
        Benchmark
      </span>
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

  const curveDomain = useMemo<[number, number]>(() => {
    const rates = curveData
      .flatMap(row => [row.latestRate, showBenchmark ? row.benchmarkRate : null])
      .filter((v): v is number => v != null)
    if (rates.length === 0) return [0, 5]
    return [Math.min(...rates) - 0.15, Math.max(...rates) + 0.15]
  }, [curveData, showBenchmark])

  return (
    <div
      style={{
        background: 'var(--surface, #0b1220)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)',
          gap: 8,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#e2e8f0' }}>
            {cfg.label}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.04em', color: '#64748b', whiteSpace: 'nowrap' }}>
            {cfg.product}
          </span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em', color: '#94a3b8', whiteSpace: 'nowrap' }}>
          Current {cfg.cashLabel}: {cashRate != null ? `${cashRate.toFixed(2)}%` : '—'}
        </span>
      </div>

      {curve.error ? (
        <div className={styles.error} style={{ padding: 12 }}>{curve.error}</div>
      ) : curve.loading ? (
        <div className={styles.loading} style={{ padding: 12 }}>Loading…</div>
      ) : (
        <div style={{ padding: '2px 2px 0' }}>
          {/* Top panel — forward curve (latest solid + benchmark dashed) */}
          <ResponsiveContainer width="100%" height={310}>
            <LineChart data={curveData} margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
              <XAxis dataKey="ticker" stroke="#728197" tick={false} tickLine={false} height={4} />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 9, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={curveDomain}
                width={40}
                allowDataOverflow
              />
              <Tooltip content={<CurveTooltip />} />
              <Line
                type="monotone"
                dataKey="latestRate"
                name="Latest"
                stroke={COLOR_LATEST}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
                isAnimationActive={false}
              />
              {showBenchmark && (
                <Line
                  type="monotone"
                  dataKey="benchmarkRate"
                  name="Benchmark"
                  stroke={COLOR_BENCHMARK}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={{ r: 1.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>

          {/* Bottom panel — per-contract day-over-day bps step bars */}
          {showBenchmark && (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={curveData} margin={{ top: 4, right: 10, left: 2, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="ticker"
                  stroke="#728197"
                  tick={{ fontSize: 8, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  tickMargin={10}
                  height={56}
                />
                <YAxis
                  stroke="#728197"
                  tick={{ fontSize: 9, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  width={40}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Tooltip content={<CurveTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="deltaBps" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {curveData.map((row) => (
                    <Cell key={row.ticker} fill={(row.deltaBps ?? 0) >= 0 ? COLOR_UP : COLOR_DOWN} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}

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
    <div className={styles.yieldChangesSection}>
      <div className={styles.yieldChangesHeader}>
        <div className={styles.yieldChangesTitle}>GLOBAL FORWARD CURVES W/ DELTAS</div>
        <LookbackButtons value={lookback} onChange={setLookback} />
      </div>

      <SharedLegend />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {COUNTRIES.map(cfg => (
          <ForwardCurveCell
            key={cfg.key}
            cfg={cfg}
            lookback={lookback}
            cashRate={cashRates[cfg.key]}
          />
        ))}
      </div>
    </div>
  )
}
