// 2x3 grid of 2s10s YIELD-CURVE-REGIME small-multiples for the Rates → GLOBAL
// tab. Sits at the very bottom of the page, below GLOBAL CALENDAR SPREADS.
//
// Each cell is the same 2s10s regime chart the per-country US/Credit tabs use
// (STIRDashboardPage): daily 2s10s bars colored by the prevailing curve regime
// (Bull/Bear × Steepener/Flattener/Twist/Neutral) with the 2s10s line overlaid.
// The regime classification, palette and spread-series construction are reused
// verbatim from lib/curveRegime (buildSpreadChartData + REGIME_COLORS) — this
// file only wires those to six countries' 2Y/10Y inputs and lays them out.
//
// Each country's 2Y/10Y are the same TradingView tickers the rest of the page
// uses (US02Y/US10Y, GB.., DE.. as the EU benchmark Bund, CA.., JP.., AU..),
// read one at a time from /api/tv/series/:symbol — the same tv_series store the
// Global Sovereign Yield Curves and Term Structure grid read from.
//
// Controls: one shared set of range buttons (3M/6M/1Y/5Y/10Y/ALL, default 1Y)
// and one shared regime-lookback input (default 20d) drive all six charts at
// once. Each chart additionally keeps its own (uncontrolled) brush, so a user
// can fine-zoom one country without disturbing the others.

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AcmChartFrame, AcmPanel, fmtSignedFixed, niceAxis, useBrushWindow } from '../components/acm'
import { chartTheme } from '../components/acm/chartTheme'
import { REGIME_OVERLAY_LINE } from '../constants/identityColors'
import { buildSpreadChartData, type SpreadChartPoint } from '../lib/curveRegime'
import { rangeToggle, regimeColor, regimeLegend } from './ratesShared'
import styles from './STIRDashboardPage.module.css'

type WD = { date: string; value: number }

// ── Country configs (same order as the other Global 2x3 grids) ───────────────
// EU benchmark curve = German Bund (DE), consistent with how the Global yield
// curves / term structure treat the EU sovereign curve.

interface RegimeCountry {
  key: string
  label: string   // per-cell title, e.g. "US 2s10s"
  short: string   // 2Y tv_series symbol
  long: string    // 10Y tv_series symbol
}

const COUNTRIES: RegimeCountry[] = [
  { key: 'US',  label: 'US 2s10s',  short: 'US02Y', long: 'US10Y' },
  { key: 'UK',  label: 'UK 2s10s',  short: 'GB02Y', long: 'GB10Y' },
  { key: 'EU',  label: 'EU 2s10s',  short: 'DE02Y', long: 'DE10Y' },
  { key: 'CAD', label: 'CAD 2s10s', short: 'CA02Y', long: 'CA10Y' },
  { key: 'JPY', label: 'JPY 2s10s', short: 'JP02Y', long: 'JP10Y' },
  { key: 'AUS', label: 'AUS 2s10s', short: 'AU02Y', long: 'AU10Y' },
]

const RANGES = ['3m', '6m', '1y', '5y', '10y', 'all'] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

// Matches STIRDashboardPage's getDateCutoff so the range windows line up with
// the per-country regime charts.
function getDateCutoff(range: string): string | null {
  if (range === 'all') return null
  const now = new Date()
  const months: Record<string, number> = { '3m': 3, '6m': 6, '1y': 12, '5y': 60, '10y': 120 }
  const m = months[range] || 12
  now.setMonth(now.getMonth() - m)
  return now.toISOString().slice(0, 10)
}

async function fetchTvSeries(symbol: string): Promise<WD[]> {
  const res = await fetch(`/api/tv/series/${symbol}?limit=50000`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return ((json.data ?? []) as Array<{ time: string; close: number }>).map(r => ({
    date: new Date(parseInt(r.time, 10) * 1000).toISOString().slice(0, 10),
    value: r.close,
  }))
}

function fmtAxisDate(date: string): string {
  const d = new Date(date)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
}

// ── Shared regime legend (7 regime identity colours + the 2s10s line) ────────
// The 2s10s spread is a LEVEL: bars take the regime identity colour (registry),
// the line REGIME_OVERLAY_LINE — no sign colour (rule 6).

function RegimeLegend() {
  return (
    <ul className={styles.gLegend}>
      {regimeLegend('2s10s').map(item => (
        <li key={item.label} className={styles.gLegendButton}>
          <span aria-hidden="true" className={styles.gLegendSwatch} style={{ ['--acm-swatch' as string]: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

// ── Regime cell (one country) ────────────────────────────────────────────────

function RegimeCell({ cfg, range, regimeLookback }: { cfg: RegimeCountry; range: string; regimeLookback: number }) {
  const [series, setSeries] = useState<{ short: WD[]; long: WD[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Raw series are fetched once per ticker pair; changing the shared lookback or
  // range never refetches — only the memo below recomputes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchTvSeries(cfg.short), fetchTvSeries(cfg.long)])
      .then(([short, long]) => {
        if (cancelled) return
        setSeries({ short, long })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [cfg.short, cfg.long])

  const data = useMemo<SpreadChartPoint[]>(() => {
    if (!series) return []
    const full = buildSpreadChartData(series.short, series.long, regimeLookback)
    const cutoff = getDateCutoff(range)
    return cutoff ? full.filter(p => p.date >= cutoff) : full
  }, [series, regimeLookback, range])

  // Even whole-bp ticks over the brushed window (niceAxis + useBrushWindow).
  const brushWin = useBrushWindow(data.length)
  const yAxis = niceAxis(data.slice(brushWin.start, brushWin.end + 1).map(p => p.spread), { dp: 0 })

  return (
    <AcmChartFrame title={cfg.label} subtitle={`${cfg.long} − ${cfg.short}`} height={CELL_HEIGHT} className={styles.gMini}>
      {error ? (
        <div className={styles.stateError}>{error}</div>
      ) : loading ? (
        <div className={styles.stateMsg}>Loading…</div>
      ) : data.length === 0 ? (
        <div className={styles.stateMsg}>No data</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 18, left: 4, bottom: 12 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} tickFormatter={fmtAxisDate} interval="preserveStartEnd" minTickGap={50} />
            <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} width={44} domain={yAxis.domain} ticks={yAxis.ticks} />
            <Tooltip
              {...chartTheme.tooltip}
              cursor={chartTheme.barTooltipCursor}
              formatter={(value: unknown) => (typeof value === 'number' ? fmtSignedFixed(value, 1, 'bp') : '—')}
            />
            <Bar dataKey="spread" barSize={3} isAnimationActive={false}>
              {data.map((point, idx) => (
                <Cell key={idx} fill={regimeColor(point.regime)} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="spread" stroke={REGIME_OVERLAY_LINE} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Brush dataKey="date" {...chartTheme.brush} height={26} tickFormatter={fmtAxisDate} onChange={brushWin.onChange} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </AcmChartFrame>
  )
}

const CELL_HEIGHT = 300

// ── Section ──────────────────────────────────────────────────────────────────

export function Global2s10sRegimeSection() {
  const [range, setRange] = useState<string>('1y')
  const [regimeLookback, setRegimeLookback] = useState(20)

  return (
    <AcmPanel
      title="GLOBAL 2s10s YIELD CURVE REGIMES"
      actions={(
        <>
          {rangeToggle(range, setRange, RANGES)}
          <label className={styles.ustLookback}>
            <span>Lookback (days):</span>
            <input
              className={styles.laborInput}
              type="number"
              min="1"
              value={regimeLookback}
              onChange={(e) => setRegimeLookback(Math.max(1, Number.parseInt(e.target.value, 10) || 20))}
            />
          </label>
        </>
      )}
    >
      <RegimeLegend />
      <div className={styles.gGrid3}>
        {COUNTRIES.map(cfg => (
          <RegimeCell key={cfg.key} cfg={cfg} range={range} regimeLookback={regimeLookback} />
        ))}
      </div>
    </AcmPanel>
  )
}
