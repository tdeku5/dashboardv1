import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTvSeries, type TvSeriesPoint } from '../hooks/useTvSeries'
import { useVixFuturesCurve } from '../hooks/useVixFuturesCurve'
import { CrudeCurvePanel } from '../components/CrudeCurvePanel'
import { AcmChartFrame, AcmPageHeader, fmtSignedFixed, niceAxis, useBrushWindow, type AcmLegendItem, type NiceAxis } from '../components/acm'
import { chartTheme } from '../components/acm/chartTheme'
import { EQUITY_VOL_SERIES_COLORS as SERIES, VOL_INDEX_COLORS } from '../constants/identityColors'
import { ButtonRow, EqState, EqTooltip, eqStyles } from './equitiesShared'

// E1 colour rules (design notes rule 7): VIX, realized vol, implied
// correlation and DSPX are LEVELS; VIX − realized, VIX3M − VIX and VX2 − VX1
// are vol spreads / vol point changes (ruling 1). All plain primary text in
// tooltips; every line takes its registry identity colour (VIX: the unified
// VOL_INDEX_COLORS.vix #ef4444, was amber here). No sign colour on the page.
// The spread z-score keeps its ±2σ reference lines (a chart, not a cell).

const VIX_COLOR = VOL_INDEX_COLORS.vix

// ── Range buttons ────────────────────────────────────────────────────────────

const RANGES = [
  { key: '1m',  label: '1M',  days: 30 },
  { key: '3m',  label: '3M',  days: 90 },
  { key: '6m',  label: '6M',  days: 180 },
  { key: '1y',  label: '1Y',  days: 365 },
  { key: '2y',  label: '2Y',  days: 730 },
  { key: '5y',  label: '5Y',  days: 1825 },
  { key: 'max', label: 'MAX', days: -1 },
] as const
type RangeKey = typeof RANGES[number]['key']

// ── Helpers ──────────────────────────────────────────────────────────────────

const tsToMs = (s: string): number => Number(s) * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtAxisDate = (ms: number): string => {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`
}
const fmtFullDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function tsMapByDay(points: TvSeriesPoint[]): Map<number, number> {
  // Bucket by day at UTC midnight so series from different timestamps still align.
  const m = new Map<number, number>()
  for (const p of points) {
    const d = new Date(tsToMs(p.time))
    const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    m.set(dayMs, p.close)
  }
  return m
}

// Rolling sample-stddev z-score: (x − mean_w) / stddev_w over a trailing window.
// Returns one z per input value; entries with insufficient (<window/2) non-null
// history yield null so the chart shows a clean gap rather than noise.
const Z_WINDOW = 252   // 1y of trading days — "how unusual is the VRP vs the past year"
function rollingZScore(values: Array<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1).filter((v): v is number => v != null && Number.isFinite(v))
    if (slice.length < Math.floor(window / 2)) continue
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1)
    const sd = Math.sqrt(variance)
    const cur = values[i]
    if (cur == null || !Number.isFinite(cur) || sd <= 0) continue
    out[i] = (cur - mean) / sd
  }
  return out
}

// 20-day annualized realized volatility from close-to-close log returns of SPX.
//   daily_log_return[t] = ln(P[t] / P[t-1])
//   realized_vol[t]     = stddev_sample(returns[t-19..t]) * sqrt(252) * 100
// Sample stddev (n-1 = 19). Output in annualized vol points, directly
// comparable to VIX. Returns Map<dayMs, vol>.
const WINDOW = 20
const TRADING_DAYS = 252
function computeRealizedVol(spx: TvSeriesPoint[]): Map<number, number> {
  const sorted = [...spx]
    .map(p => ({ ms: tsToMs(p.time), close: p.close }))
    .filter(p => Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.ms - b.ms)

  // Day-bucket each close (last seen wins, so daily endpoints are stable).
  const byDay = new Map<number, number>()
  for (const p of sorted) {
    const d = new Date(p.ms)
    const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    byDay.set(dayMs, p.close)
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)

  // Log returns aligned to day t (one entry per day starting at day index 1).
  const logRet: number[] = []
  for (let i = 1; i < days.length; i++) {
    const prev = byDay.get(days[i - 1])!
    const cur  = byDay.get(days[i])!
    logRet.push(Math.log(cur / prev))
  }

  const out = new Map<number, number>()
  for (let i = WINDOW - 1; i < logRet.length; i++) {
    const w = logRet.slice(i - WINDOW + 1, i + 1)
    const mean = w.reduce((a, b) => a + b, 0) / WINDOW
    const variance = w.reduce((s, r) => s + (r - mean) ** 2, 0) / (WINDOW - 1)   // sample
    const vol = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100
    // realized vol at day t corresponds to logRet[i], i.e. day index i+1.
    out.set(days[i + 1], vol)
  }
  return out
}

function applyRange<T extends { t: number }>(rows: T[], range: RangeKey): T[] {
  if (range === 'max') return rows
  const ms = RANGES.find(r => r.key === range)!.days * 24 * 3600 * 1000
  const cutoff = Date.now() - ms
  return rows.filter(r => r.t >= cutoff)
}

// ── Generic chart pieces ─────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, valueFmt }: {
  active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: number | string; valueFmt: (v: number) => string;
}) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  const rows = payload
    .filter(p => typeof p.value === 'number' && Number.isFinite(p.value))
    .map((p, i) => ({ key: String(i), name: p.name ?? '', color: p.color, value: valueFmt(p.value!) }))
  return <EqTooltip label={fmtFullDate(label)} rows={rows} />
}

/** Vol points, signed: '+1.23 pts', '-0.40 pts', '0.00 pts' (near-zero rule). */
const fmtPts = (v: number) => fmtSignedFixed(v, 2, ' pts')
const fmtSigma = (v: number) => fmtSignedFixed(v, 2, 'σ')
const fmtLevel = (v: number) => v.toFixed(2)

/** Even ticks over a series window (niceAxis). */
function axisFor<T>(rows: ReadonlyArray<T>, keys: ReadonlyArray<keyof T>, dp: number, includeZero = false): NiceAxis {
  const vals: number[] = []
  for (const r of rows) for (const k of keys) { const v = r[k]; if (typeof v === 'number' && Number.isFinite(v)) vals.push(v) }
  return niceAxis(vals, { dp, includeZero })
}

interface PanelProps {
  title: string
  subtitle: string
  range: RangeKey
  setRange: (r: RangeKey) => void
  legend: AcmLegendItem[]
  height: number
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
}
function Panel({ title, subtitle, range, setRange, legend, height, loading, empty, emptyMessage, children }: PanelProps) {
  return (
    <AcmChartFrame
      title={title}
      subtitle={subtitle}
      legend={legend}
      actions={<ButtonRow items={RANGES} value={range} onChange={setRange} />}
      height={height}
    >
      {loading
        ? <EqState>Loading…</EqState>
        : empty
          ? <EqState>{emptyMessage ?? 'Data unavailable.'}</EqState>
          : children}
    </AcmChartFrame>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function VolPage() {
  const spx    = useTvSeries('SPX')
  const vix    = useTvSeries('VIX')
  const vix3m  = useTvSeries('VIX3M')
  // VX1 = continuous front-month VIX futures, VX2 = continuous second-month.
  // The prompt's literal `VX1!` / `VX2!` is TradingView's continuous-contract
  // notation; in tv_series they're stored without the `!` suffix. Plenty of
  // history (5500+ bars, current through today), so no dated-contract fallback
  // is needed — VX2 − VX1 below is computed directly from these two.
  const vx1    = useTvSeries('VX1')
  const vx2    = useTvSeries('VX2')
  const cor1m  = useTvSeries('COR1M')
  const cor3m  = useTvSeries('COR3M')
  const dspx   = useTvSeries('DSPX')

  // Per-chart range (independent so users can zoom each section separately).
  const [range1, setRange1] = useState<RangeKey>('1y')
  const [range2, setRange2] = useState<RangeKey>('1y')
  const [range3, setRange3] = useState<RangeKey>('1y')
  const [range4, setRange4] = useState<RangeKey>('1y')

  // Lifted brush for Chart 1 so its main + spread + z-score panels share the
  // visible window (Recharts' per-chart brush only zooms its own LineChart).
  // Reset when the range button changes, since the underlying data shifts.
  const [c1Brush, setC1Brush] = useState<{ start: number; end: number } | null>(null)
  useEffect(() => { setC1Brush(null) }, [range1])

  // ── VIX futures term-structure offset (Chart 5) ──────────────────────────
  // Debounced numeric input so the user can type without firing N fetches.
  const [vixOffsetInput, setVixOffsetInput] = useState('5')
  const [vixOffset, setVixOffset] = useState(5)
  useEffect(() => {
    const t = setTimeout(() => {
      const n = parseInt(vixOffsetInput, 10)
      if (Number.isFinite(n)) setVixOffset(Math.max(1, Math.min(1260, n)))
    }, 300)
    return () => clearTimeout(t)
  }, [vixOffsetInput])
  const vixFutures = useVixFuturesCurve(vixOffset)

  // ── Chart 1: 20d realized vs VIX + spread + z-score ──────────────────────
  const chart1Full = useMemo(() => {
    if (spx.data.length === 0 || vix.data.length === 0) return []
    const realized = computeRealizedVol(spx.data)
    const vixMap = tsMapByDay(vix.data)
    const days = [...new Set([...realized.keys(), ...vixMap.keys()])].sort((a, b) => a - b)
    // First pass: build rows with realized/vix/spread.
    const rows = days.map(t => {
      const r = realized.get(t) ?? null
      const v = vixMap.get(t) ?? null
      const sp = (r != null && v != null) ? v - r : null
      return { t, realized: r, vix: v, spread: sp, zscore: null as number | null }
    })
    // Second pass: rolling 252d z-score of the spread (computed on the FULL
    // history so the window is meaningful, then sliced by range below).
    const zs = rollingZScore(rows.map(r => r.spread), Z_WINDOW)
    for (let i = 0; i < rows.length; i++) rows[i].zscore = zs[i]
    return rows
  }, [spx.data, vix.data])
  const chart1 = useMemo(() => applyRange(chart1Full, range1), [chart1Full, range1])
  // Brush-visible slice: passed to all three Chart 1 panels so the brush
  // controls them in lockstep. Brush itself reads the full `chart1`.
  const chart1Visible = useMemo(
    () => (c1Brush ? chart1.slice(c1Brush.start, c1Brush.end + 1) : chart1),
    [chart1, c1Brush],
  )

  // ── Chart 2: VIX3M − VIX (index term structure) + VX2 − VX1 (futures) ────
  // Same sign convention on both: positive = contango (calm), negative =
  // backwardation (stress). Each cell carries whichever value is available —
  // gaps are rendered as line breaks rather than fabricated values.
  const chart2Full = useMemo(() => {
    const vixMap = tsMapByDay(vix.data)
    const v3Map  = tsMapByDay(vix3m.data)
    const v1Map  = tsMapByDay(vx1.data)
    const v2Map  = tsMapByDay(vx2.data)
    const days = [...new Set([...vixMap.keys(), ...v3Map.keys(), ...v1Map.keys(), ...v2Map.keys()])].sort((a, b) => a - b)
    return days.map(t => {
      const v = vixMap.get(t), v3 = v3Map.get(t)
      const a = v1Map.get(t),  b = v2Map.get(t)
      return {
        t,
        term:    (v != null && v3 != null) ? v3 - v : null,
        futTerm: (a != null && b != null)  ? b - a  : null,   // VX2 − VX1
      }
    })
  }, [vix.data, vix3m.data, vx1.data, vx2.data])
  const chart2 = useMemo(() => applyRange(chart2Full, range2), [chart2Full, range2])

  // ── Chart 3: implied correlation ─────────────────────────────────────────
  const chart3Full = useMemo(() => {
    const c1 = tsMapByDay(cor1m.data)
    const c3 = tsMapByDay(cor3m.data)
    const days = [...new Set([...c1.keys(), ...c3.keys()])].sort((a, b) => a - b)
    return days.map(t => ({ t, cor1m: c1.get(t) ?? null, cor3m: c3.get(t) ?? null }))
  }, [cor1m.data, cor3m.data])
  const chart3 = useMemo(() => applyRange(chart3Full, range3), [chart3Full, range3])

  // ── Chart 4: dispersion (DSPX) ───────────────────────────────────────────
  const chart4Full = useMemo(
    () => dspx.data.map(p => ({ t: tsToMs(p.time), dspx: p.close })).sort((a, b) => a.t - b.t),
    [dspx.data],
  )
  const chart4 = useMemo(() => applyRange(chart4Full, range4), [chart4Full, range4])

  // Brushed windows for the charts with their own Brush (2, 3, 4); Chart 1's
  // lifted brush already slices chart1Visible.
  const b2 = useBrushWindow(chart2.length)
  const b3 = useBrushWindow(chart3.length)
  const b4 = useBrushWindow(chart4.length)
  const ax1Main = useMemo(() => axisFor(chart1Visible, ['realized', 'vix'], 0), [chart1Visible])
  const ax1Spread = useMemo(() => axisFor(chart1Visible, ['spread'], 0, true), [chart1Visible])
  const ax2 = useMemo(() => axisFor(chart2.slice(b2.start, b2.end + 1), ['term', 'futTerm'], 1, true), [chart2, b2.start, b2.end])
  const ax3 = useMemo(() => axisFor(chart3.slice(b3.start, b3.end + 1), ['cor1m', 'cor3m'], 0), [chart3, b3.start, b3.end])
  const ax4 = useMemo(() => axisFor(chart4.slice(b4.start, b4.end + 1), ['dspx'], 1), [chart4, b4.start, b4.end])

  const xAxis = (
    <XAxis
      dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
      {...chartTheme.xAxis}
      tickFormatter={fmtAxisDate} minTickGap={40}
    />
  )
  const yAxis = (ax: NiceAxis, fmt: (v: number) => string) => (
    <YAxis {...chartTheme.yAxis} tickFormatter={fmt} domain={ax.domain} ticks={ax.ticks} allowDataOverflow width={44} />
  )
  const cursor = chartTheme.tooltip.cursor

  return (
    <div className={eqStyles.eqShell}>
      <AcmPageHeader title="S&P 500 VOLATILITY" subtitle="Realized vs implied · term structure · correlation · dispersion" />

      {/* 2×2 grid: vol charts on top, correlation/dispersion (inverse concepts) below. */}
      <div className={eqStyles.evGrid}>

      {/* ── Chart 1: 20d realized vs VIX + spread + z-score (3 stacked panels,
              one shared lifted brush at the bottom) ─────────────────────────── */}
      <Panel
        title="S&P 500 — REALIZED VOL vs IMPLIED (VIX)"
        subtitle={`20d realized (close-to-close, annualized) vs VIX · spread = VIX − realized · z-score over ${Z_WINDOW}d`}
        range={range1} setRange={setRange1}
        height={380 + 180 + 180 + 28}
        loading={spx.loading || vix.loading}
        empty={chart1.length === 0}
        emptyMessage={spx.error || vix.error || 'No data in selected range.'}
        legend={[
          { label: '20d Realized', color: SERIES.realized20d },
          { label: 'VIX', color: VIX_COLOR },
          { label: 'VIX − Realized (spread)', color: SERIES.vixMinusRealized },
          { label: `Spread z-score (${Z_WINDOW}d)`, color: SERIES.spreadZ },
        ]}
      >
        <div className={eqStyles.evPlotStack}>
        {/* Main: realized + VIX */}
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={chart1Visible} margin={{ top: 8, right: 24, left: 8, bottom: 0 }} syncId="vol1">
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            {yAxis(ax1Main, v => v.toFixed(0))}
            <Tooltip content={<CustomTooltip valueFmt={fmtLevel} />} cursor={cursor} isAnimationActive={false} />
            <Line type="monotone" dataKey="realized" name="20d Realized" stroke={SERIES.realized20d} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="vix"      name="VIX"          stroke={VIX_COLOR} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        {/* Sub 1: raw VIX − Realized spread (the variance risk premium) */}
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chart1Visible} margin={{ top: 4, right: 24, left: 8, bottom: 0 }} syncId="vol1">
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            {yAxis(ax1Spread, v => v.toFixed(0))}
            <Tooltip content={<CustomTooltip valueFmt={fmtPts} />} cursor={cursor} isAnimationActive={false} />
            <ReferenceLine y={0} {...chartTheme.referenceLines.zero} />
            <Line type="monotone" dataKey="spread" name="VIX − Realized" stroke={SERIES.vixMinusRealized} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        {/* Sub 2: rolling 252d z-score of the spread + ±2σ reference lines */}
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chart1Visible} margin={{ top: 4, right: 24, left: 8, bottom: 0 }} syncId="vol1">
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => fmtSignedFixed(v, 0, 'σ')} domain={[-3, 3]} ticks={[-3, -2, -1, 0, 1, 2, 3]} interval={0} width={44} />
            <Tooltip content={<CustomTooltip valueFmt={fmtSigma} />} cursor={cursor} isAnimationActive={false} />
            <ReferenceLine y={0}  {...chartTheme.referenceLines.zero} />
            <ReferenceLine y={2}  {...chartTheme.referenceLines.levelFaint} />
            <ReferenceLine y={-2} {...chartTheme.referenceLines.levelFaint} />
            <Line type="monotone" dataKey="zscore" name={`Spread z (${Z_WINDOW}d)`} stroke={SERIES.spreadZ} strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        {/* Shared brush — operates on the FULL chart1 and lifts state so all
            three panels above re-render with the brushed slice. */}
        {chart1.length > 1 && (
          <ResponsiveContainer width="100%" height={28}>
            <LineChart data={chart1} margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
              <XAxis dataKey="t" hide type="number" domain={['dataMin', 'dataMax']} />
              <YAxis hide />
              <Brush
                key={range1}
                dataKey="t"
                {...chartTheme.brush}
                tickFormatter={(ms: number) => fmtAxisDate(ms)}
                onChange={(e: { startIndex?: number; endIndex?: number } | null) => {
                  if (e && typeof e.startIndex === 'number' && typeof e.endIndex === 'number') {
                    if (e.startIndex === 0 && e.endIndex === chart1.length - 1) setC1Brush(null)
                    else setC1Brush({ start: e.startIndex, end: e.endIndex })
                  }
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        </div>
      </Panel>

      {/* Top-right grid cell: VIX3M−VIX line chart above the VIX futures
          curve + Δ bars, roughly matching the tall 3-panel chart on the left. */}
      <div className={eqStyles.evStack}>

      {/* ── Chart 2: VIX term structure ────────────────────────────────────── */}
      <Panel
        title="VIX TERM STRUCTURE"
        subtitle="Index (VIX3M − VIX) & futures (VX2 − VX1) · negative = backwardation"
        range={range2} setRange={setRange2}
        height={220}
        loading={vix.loading || vix3m.loading || vx1.loading || vx2.loading}
        empty={chart2.length === 0}
        emptyMessage={vix3m.error || vix.error || vx1.error || vx2.error || 'No data in selected range.'}
        legend={[
          { label: 'VIX3M − VIX', color: SERIES.vix3mMinusVix },
          { label: 'VX2 − VX1', color: SERIES.vx2MinusVx1 },
        ]}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart2} margin={{ top: 8, right: 24, left: 8, bottom: 6 }}>
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            {yAxis(ax2, v => v.toFixed(1))}
            <Tooltip content={<CustomTooltip valueFmt={fmtPts} />} cursor={cursor} isAnimationActive={false} />
            <ReferenceLine y={0} {...chartTheme.referenceLines.zero} />
            <Line type="monotone" dataKey="term"    name="VIX3M − VIX" stroke={SERIES.vix3mMinusVix} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="futTerm" name="VX2 − VX1"   stroke={SERIES.vx2MinusVx1} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Brush key={range2} dataKey="t" {...chartTheme.brush} tickFormatter={(ms: number) => fmtAxisDate(ms)} onChange={b2.onChange} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {/* ── Chart 5: VIX futures term structure (stacked under Chart 2) ─────── */}
      <div className={eqStyles.eqControls}>
        <span className={eqStyles.eqControlLabel}>Benchmark t −</span>
        <input
          type="number"
          aria-label="Benchmark offset in days"
          className={eqStyles.eqInput}
          min={1}
          max={1260}
          step={1}
          value={vixOffsetInput}
          onChange={e => setVixOffsetInput(e.target.value)}
        />
        <span className={eqStyles.eqControlLabel}>days</span>
      </div>
      <CrudeCurvePanel
        title="VIX FUTURES TERM STRUCTURE"
        data={vixFutures.data}
        loading={vixFutures.loading}
        error={vixFutures.error}
        showOffset1={true}
        showOffset2={false}
        deltaUnit="$"                                /* absolute subtraction; the vol-points formatters below replace the $ rendering */
        valueAxisLabel="vol pts"
        deltaAxisLabel="vol pts"
        valueFormat={fmtLevel}
        deltaFormat={v => fmtSignedFixed(v, 2)}
        curveHeight={380}                            /* shorter than the default 480 so the right-stack roughly matches the tall left panel */
        deltaHeight={180}
      />

      </div>  {/* end evStack */}

      {/* ── Chart 3: implied correlation ───────────────────────────────────── */}
      <Panel
        title="IMPLIED CORRELATION"
        subtitle="Cboe 1-month (COR1M) & 3-month (COR3M) implied correlation"
        range={range3} setRange={setRange3}
        height={420}
        loading={cor1m.loading || cor3m.loading}
        empty={chart3.length === 0}
        emptyMessage={cor1m.error || cor3m.error || 'No data in selected range.'}
        legend={[
          { label: 'COR1M (1-month)', color: SERIES.cor1m },
          { label: 'COR3M (3-month)', color: SERIES.cor3m },
        ]}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart3} margin={{ top: 12, right: 24, left: 8, bottom: 6 }}>
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            {yAxis(ax3, v => v.toFixed(0))}
            <Tooltip content={<CustomTooltip valueFmt={fmtLevel} />} cursor={cursor} isAnimationActive={false} />
            <Line type="monotone" dataKey="cor1m" name="COR1M" stroke={SERIES.cor1m} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="cor3m" name="COR3M" stroke={SERIES.cor3m} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Brush key={range3} dataKey="t" {...chartTheme.brush} tickFormatter={(ms: number) => fmtAxisDate(ms)} onChange={b3.onChange} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {/* ── Chart 4: DSPX ──────────────────────────────────────────────────── */}
      <Panel
        title="DISPERSION INDEX (DSPX)"
        subtitle="Cboe S&P 500 Dispersion Index · high = stocks moving independently"
        range={range4} setRange={setRange4}
        height={420}
        loading={dspx.loading}
        empty={chart4.length === 0}
        emptyMessage={dspx.error || 'No data in selected range.'}
        legend={[{ label: 'DSPX', color: SERIES.dspx }]}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart4} margin={{ top: 12, right: 24, left: 8, bottom: 6 }}>
            <CartesianGrid {...chartTheme.grid} />
            {xAxis}
            {yAxis(ax4, v => v.toFixed(1))}
            <Tooltip content={<CustomTooltip valueFmt={fmtLevel} />} cursor={cursor} isAnimationActive={false} />
            <Line type="monotone" dataKey="dspx" name="DSPX" stroke={SERIES.dspx} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
            <Brush key={range4} dataKey="t" {...chartTheme.brush} tickFormatter={(ms: number) => fmtAxisDate(ms)} onChange={b4.onChange} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      </div>
    </div>
  )
}
