import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AcmChartFrame, fmtSignedFixed, type AcmLegendItem } from '../components/acm'
import { cx } from '../components/acm/acmFormat'
import { chartTheme, referenceBand, referenceLines } from '../components/acm/chartTheme'
import { POLICY_RATE_COLORS, TENOR_COLORS } from '../constants/identityColors'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './PolicyRatePage.module.css'

// ── Series colours: identity registry (R4) ─────────────────────────────────
// Every line is a LEVEL (rates, yields, Y/Y inflation, spreads), so colour is
// identity, never sign (rule 6). Recession shading = the theme's reference band.

const COLOR_EFFR = POLICY_RATE_COLORS.effr // = TENOR_COLORS.cash, shared across both charts
const COLOR_CPI  = POLICY_RATE_COLORS.cpi
const COLOR_PCE  = POLICY_RATE_COLORS.pce
const COLOR_2Y   = TENOR_COLORS['2Y']
const COLOR_5Y   = TENOR_COLORS['5Y']
const COLOR_10Y  = TENOR_COLORS['10Y']
const COLOR_30Y  = TENOR_COLORS['30Y']

/** Spreads (EFFR − inflation, tenor − EFFR) are signed: '+1.23pp', and '0.00pp' when they round to zero (near-zero rule). */
const fmtSpreadPp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmtSignedFixed(v, 2, 'pp') : '—')
const fmtLevelPct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : '—')

// ── Range selector ──────────────────────────────────────────────────────────

const RANGES = [
  { key: '1y',  label: '1Y',  years: 1 },
  { key: '2y',  label: '2Y',  years: 2 },
  { key: '5y',  label: '5Y',  years: 5 },
  { key: '10y', label: '10Y', years: 10 },
  { key: '20y', label: '20Y', years: 20 },
  { key: 'max', label: 'MAX', years: 100 },
] as const
type RangeKey = typeof RANGES[number]['key']

function cutoffForRange(range: RangeKey): string {
  if (range === 'max') return '1900-01-01'
  const years = RANGES.find(r => r.key === range)!.years
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

function parseObs(obs: FredObservation[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of obs) {
    if (!o.value || o.value === '.') continue
    const v = parseFloat(o.value)
    if (Number.isFinite(v)) m.set(o.date, v)
  }
  return m
}

/** Y/Y on a monthly index level: yoy_t = (idx_t / idx_{t-12} − 1) × 100.
 *  Looks up the (t−12) value by DATE STRING — not by array position — so that
 *  missing months in the source series (e.g. CPILFESL has no 2025-10 print
 *  because BLS skipped the release during the shutdown) don't shift the
 *  denominator. This mirrors `computeYoY` in CPIDashboardPage.tsx, which is
 *  the source of truth for the Fundamental Model. */
function computeYoyFromIndex(idx: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [date, v] of idx) {
    const [yStr, mStr] = date.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    if (!Number.isFinite(y) || !Number.isFinite(m)) continue
    const priorKey = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const p = idx.get(priorKey)
    if (p == null || p === 0) continue
    out.set(date, (v / p - 1) * 100)
  }
  return out
}

/** Linear-interpolate a missing 2025-10-01 print between Sep and Nov of the
 *  same series. CPILFESL has this gap (BLS shutdown); without filling it the
 *  Y/Y for Oct 2026 would be undefined and the denominator chain would be
 *  arguably less smooth. Mirrors `fillOct2025Gap` in CPIDashboardPage.tsx. */
function fillOct2025Gap(idx: Map<string, number>): Map<string, number> {
  if (idx.has('2025-10-01')) return idx
  const sep = idx.get('2025-09-01')
  const nov = idx.get('2025-11-01')
  if (sep == null || nov == null) return idx
  const filled = new Map(idx)
  filled.set('2025-10-01', (sep + nov) / 2)
  return filled
}

/** Simple average of daily EFFR values within each calendar month. The output
 *  is keyed by the FIRST day of each month (YYYY-MM-01) so it aligns with the
 *  cadence of FRED's monthly CPI / PCEPI releases.
 *
 *  Convention for partial months: a month is emitted only if the daily series
 *  contains at least one observation in the FOLLOWING month — that proves the
 *  month is fully elapsed. The latest in-progress month (e.g. "May 2026" when
 *  daily data ends ~May 19) is dropped so the chart never shows a partial-
 *  month average that could be misread as a complete value. */
function monthlyAverage(daily: Map<string, number>): Map<string, number> {
  const buckets = new Map<string, { sum: number; n: number }>()
  const seenYm = new Set<string>()
  for (const [date, v] of daily) {
    const ym = date.slice(0, 7) // YYYY-MM
    seenYm.add(ym)
    const b = buckets.get(ym) ?? { sum: 0, n: 0 }
    b.sum += v
    b.n += 1
    buckets.set(ym, b)
  }
  const out = new Map<string, number>()
  for (const [ym, { sum, n }] of buckets) {
    if (n === 0) continue
    const [yStr, mStr] = ym.split('-')
    const y = Number(yStr), m = Number(mStr)
    const nextY = m === 12 ? y + 1 : y
    const nextM = m === 12 ? 1 : m + 1
    const nextYm = `${nextY}-${String(nextM).padStart(2, '0')}`
    if (!seenYm.has(nextYm)) continue // partial — no follow-up month observed
    out.set(`${ym}-01`, sum / n)
  }
  return out
}

function buildRecessionBands(usrec: Map<string, number>): Array<{ x1: string; x2: string }> {
  const sorted = Array.from(usrec.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const bands: Array<{ x1: string; x2: string }> = []
  let activeStart: string | null = null
  let prevDate: string | null = null
  for (const [date, v] of sorted) {
    if (v >= 0.5 && activeStart == null) activeStart = date
    else if (v < 0.5 && activeStart != null && prevDate != null) {
      bands.push({ x1: activeStart, x2: prevDate })
      activeStart = null
    }
    prevDate = date
  }
  if (activeStart != null && prevDate != null) bands.push({ x1: activeStart, x2: prevDate })
  return bands
}

// ── Data fetching ───────────────────────────────────────────────────────────

interface SeriesBundle {
  effrDaily: Map<string, number>
  cpiIndex: Map<string, number>
  pceIndex: Map<string, number>
  dgs2: Map<string, number>
  dgs5: Map<string, number>
  dgs10: Map<string, number>
  dgs30: Map<string, number>
  usrec: Map<string, number>
}

async function fetchAll(): Promise<SeriesBundle> {
  const [effr, cpi, pce, dgs2, dgs5, dgs10, dgs30, usrec] = await Promise.all([
    fetchFredSeries('EFFR',     { observationStart: '1954-01-01' }),
    fetchFredSeries('CPILFESL', { observationStart: '1957-01-01' }),
    fetchFredSeries('PCEPILFE', { observationStart: '1959-01-01' }),
    fetchFredSeries('DGS2',     { observationStart: '1976-01-01' }),
    fetchFredSeries('DGS5',     { observationStart: '1962-01-01' }),
    fetchFredSeries('DGS10',    { observationStart: '1962-01-01' }),
    fetchFredSeries('DGS30',    { observationStart: '1977-01-01' }),
    fetchFredSeries('USREC',    { observationStart: '1900-01-01' }),
  ])
  return {
    effrDaily: parseObs(effr),
    cpiIndex: parseObs(cpi),
    pceIndex: parseObs(pce),
    dgs2: parseObs(dgs2),
    dgs5: parseObs(dgs5),
    dgs10: parseObs(dgs10),
    dgs30: parseObs(dgs30),
    usrec: parseObs(usrec),
  }
}

type Tone = 'on' | 'off'

// ── Page ────────────────────────────────────────────────────────────────────

export function PolicyRatePage() {
  const [bundle, setBundle] = useState<SeriesBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-chart range state (Change 2). Both default to 2Y per spec.
  const [rangeInflation, setRangeInflation] = useState<RangeKey>('2y')
  const [rangeTerm, setRangeTerm] = useState<RangeKey>('2y')

  const [toggle1, setToggle1] = useState<Record<string, Tone>>({ effr: 'on', cpi: 'on', pce: 'on' })
  const [toggle2, setToggle2] = useState<Record<string, Tone>>({ effr: 'on', dgs2: 'on', dgs5: 'on', dgs10: 'on', dgs30: 'on' })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAll()
      .then(b => { if (!cancelled) { setBundle(b); setLoading(false) } })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  // ── Inflation chart data (monthly EFFR) ────────────────────────────────
  const inflationData = useMemo(() => {
    if (!bundle) return null
    const cutoff = cutoffForRange(rangeInflation)

    // Apply the same Oct 2025 gap-fill the Fundamental Model uses so Y/Y for
    // Oct 2026 is defined. PCEPILFE doesn't have the gap, so the fill is a no-op.
    const yoyCpi = computeYoyFromIndex(fillOct2025Gap(bundle.cpiIndex))
    const yoyPce = computeYoyFromIndex(fillOct2025Gap(bundle.pceIndex))
    const effrMonthly = monthlyAverage(bundle.effrDaily)

    // Date grid = union of monthly EFFR + Y/Y inflation dates within the window.
    const grid = new Set<string>()
    for (const d of effrMonthly.keys()) if (d >= cutoff) grid.add(d)
    for (const d of yoyCpi.keys())       if (d >= cutoff) grid.add(d)
    for (const d of yoyPce.keys())       if (d >= cutoff) grid.add(d)
    const dates = Array.from(grid).sort()

    // Direct lookups — no forward-fill. Each series should render exactly to
    // its last actual data point and stop. EFFR (monthly avg, partial month
    // dropped above) ends at the latest fully-elapsed month; Core CPI / PCEPI
    // end at their FRED last-release dates (typically CPI ≈ M-1, PCE ≈ M-2).
    // Trailing nulls naturally truncate each Recharts <Line> at its last value.
    const rows = dates.map(d => {
      const eff = effrMonthly.get(d) ?? null
      const c   = yoyCpi.get(d) ?? null
      const p   = yoyPce.get(d) ?? null
      return {
        date: d,
        effr: eff,
        cpi: c,
        pce: p,
        realCpi: eff != null && c != null ? +(eff - c).toFixed(2) : null,
        realPce: eff != null && p != null ? +(eff - p).toFixed(2) : null,
      }
    })
    return { rows, bands: clipBands(buildRecessionBands(bundle.usrec), cutoff, dates) }
  }, [bundle, rangeInflation])

  // ── Term structure chart data (daily EFFR) ─────────────────────────────
  const termData = useMemo(() => {
    if (!bundle) return null
    const cutoff = cutoffForRange(rangeTerm)
    const grid = new Set<string>()
    for (const d of bundle.effrDaily.keys()) if (d >= cutoff) grid.add(d)
    for (const d of bundle.dgs2.keys())      if (d >= cutoff) grid.add(d)
    for (const d of bundle.dgs5.keys())      if (d >= cutoff) grid.add(d)
    for (const d of bundle.dgs10.keys())     if (d >= cutoff) grid.add(d)
    for (const d of bundle.dgs30.keys())     if (d >= cutoff) grid.add(d)
    const dates = Array.from(grid).sort()
    const rows = dates.map(d => {
      const effr  = bundle.effrDaily.get(d) ?? null
      const dgs2  = bundle.dgs2.get(d)  ?? null
      const dgs5  = bundle.dgs5.get(d)  ?? null
      const dgs10 = bundle.dgs10.get(d) ?? null
      const dgs30 = bundle.dgs30.get(d) ?? null
      const sp = (y: number | null) => effr != null && y != null ? +(y - effr).toFixed(4) : null
      return {
        date: d, effr, dgs2, dgs5, dgs10, dgs30,
        spread_dgs2:  sp(dgs2),
        spread_dgs5:  sp(dgs5),
        spread_dgs10: sp(dgs10),
        spread_dgs30: sp(dgs30),
      }
    })
    return { rows, bands: clipBands(buildRecessionBands(bundle.usrec), cutoff, dates) }
  }, [bundle, rangeTerm])

  // Spread sub-chart selection (default 2Y).
  const [selectedSpreads, setSelectedSpreads] = useState<Set<string>>(new Set(['dgs2']))
  const toggleSpread = (key: string) =>
    setSelectedSpreads(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  if (loading) return <div className={styles.prStateMsg}>Loading FRED series…</div>
  if (error)   return <div className={styles.prStateError}>Failed to load: {error}</div>
  if (!inflationData || !termData) return null

  const toggle = (key: string, set: typeof setToggle1) =>
    set(prev => ({ ...prev, [key]: prev[key] === 'off' ? 'on' : 'off' }))
  const hide = (t: Record<string, Tone>, key: string) => t[key] === 'off'
  const legendFor = (entries: Array<{ key: string; label: string; color: string }>, state: Record<string, Tone>, set: typeof setToggle1): AcmLegendItem[] =>
    entries.map(e => ({ label: e.label, color: e.color, hidden: state[e.key] === 'off', onClick: () => toggle(e.key, set) }))

  // Inflation legend — the 3 input series; the two spread lines share their
  // parent inflation series' colour and toggle with it.
  const inflationLegend = legendFor([
    { key: 'effr', label: 'EFFR (monthly avg)', color: COLOR_EFFR },
    { key: 'cpi',  label: 'Y/Y Core CPI',       color: COLOR_CPI },
    { key: 'pce',  label: 'Y/Y Core PCEPI',     color: COLOR_PCE },
  ], toggle1, setToggle1)
  const termLegend = legendFor([
    { key: 'effr',  label: 'EFFR', color: COLOR_EFFR },
    { key: 'dgs2',  label: '2Y',   color: COLOR_2Y },
    { key: 'dgs5',  label: '5Y',   color: COLOR_5Y },
    { key: 'dgs10', label: '10Y',  color: COLOR_10Y },
    { key: 'dgs30', label: '30Y',  color: COLOR_30Y },
  ], toggle2, setToggle2)

  return (
    <div className={styles.prRow}>
      {/* ═══ Chart 1: Policy Rate vs Inflation (levels on top, spreads below) ═══ */}
      <AcmChartFrame
        title="POLICY RATE VS INFLATION"
        subtitle="Top: levels · bottom: EFFR − Y/Y inflation (pp)"
        legend={inflationLegend}
        actions={<RangeButtons value={rangeInflation} onChange={setRangeInflation} />}
        height={INFLATION_TOP_HEIGHT + INFLATION_BOTTOM_HEIGHT}
      >
        <ResponsiveContainer width="100%" height={INFLATION_TOP_HEIGHT}>
          <LineChart data={inflationData.rows} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
            <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
            <Tooltip {...chartTheme.tooltip} formatter={fmtLevelPct} />
            {inflationData.bands.map((b, i) => (
              <ReferenceArea key={`r1a-${i}`} x1={b.x1} x2={b.x2} {...referenceBand} ifOverflow="visible" />
            ))}
            <Line type="monotone" dataKey="effr" name="EFFR"           stroke={COLOR_EFFR} strokeWidth={2}   dot={false} connectNulls hide={hide(toggle1, 'effr')} />
            <Line type="monotone" dataKey="cpi"  name="Y/Y Core CPI"   stroke={COLOR_CPI}  strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle1, 'cpi')} />
            <Line type="monotone" dataKey="pce"  name="Y/Y Core PCEPI" stroke={COLOR_PCE}  strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle1, 'pce')} />
          </LineChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={INFLATION_BOTTOM_HEIGHT}>
          <LineChart data={inflationData.rows} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
            <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(1)}pp`} />
            <Tooltip {...chartTheme.tooltip} formatter={fmtSpreadPp} />
            <ReferenceLine y={0} {...referenceLines.zero} />
            {inflationData.bands.map((b, i) => (
              <ReferenceArea key={`r1b-${i}`} x1={b.x1} x2={b.x2} {...referenceBand} ifOverflow="visible" />
            ))}
            <Line type="monotone" dataKey="realCpi" name="EFFR − Y/Y Core CPI"   stroke={COLOR_CPI} strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle1, 'cpi')} />
            <Line type="monotone" dataKey="realPce" name="EFFR − Y/Y Core PCEPI" stroke={COLOR_PCE} strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle1, 'pce')} />
            <Brush dataKey="date" {...chartTheme.brush} />
          </LineChart>
        </ResponsiveContainer>
      </AcmChartFrame>

      {/* ═══ Chart 2: Policy Rate vs Term Structure + spread sub-chart ═══ */}
      <div className={styles.prColumn}>
        <AcmChartFrame
          title="POLICY RATE VS TERM STRUCTURE"
          legend={termLegend}
          actions={<RangeButtons value={rangeTerm} onChange={setRangeTerm} />}
          height={TERM_HEIGHT}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={termData.rows} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
              <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
              <Tooltip {...chartTheme.tooltip} formatter={fmtLevelPct} />
              {termData.bands.map((b, i) => (
                <ReferenceArea key={`r2-${i}`} x1={b.x1} x2={b.x2} {...referenceBand} ifOverflow="visible" />
              ))}
              <Line type="monotone" dataKey="effr"  name="EFFR" stroke={COLOR_EFFR} strokeWidth={2}   dot={false} connectNulls hide={hide(toggle2, 'effr')} />
              <Line type="monotone" dataKey="dgs2"  name="2Y"   stroke={COLOR_2Y}   strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle2, 'dgs2')} />
              <Line type="monotone" dataKey="dgs5"  name="5Y"   stroke={COLOR_5Y}   strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle2, 'dgs5')} />
              <Line type="monotone" dataKey="dgs10" name="10Y"  stroke={COLOR_10Y}  strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle2, 'dgs10')} />
              <Line type="monotone" dataKey="dgs30" name="30Y"  stroke={COLOR_30Y}  strokeWidth={1.5} dot={false} connectNulls hide={hide(toggle2, 'dgs30')} />
            </LineChart>
          </ResponsiveContainer>
        </AcmChartFrame>

        <SpreadSubChartUS data={termData.rows} selected={selectedSpreads} onToggle={toggleSpread} />
      </div>
    </div>
  )
}

const INFLATION_TOP_HEIGHT = 300
const INFLATION_BOTTOM_HEIGHT = 210
const TERM_HEIGHT = 380
const SPREAD_HEIGHT = 180

// ── Range buttons ───────────────────────────────────────────────────────────

interface RangeButtonsProps {
  value: RangeKey
  onChange: (r: RangeKey) => void
}
function RangeButtons({ value, onChange }: RangeButtonsProps) {
  return (
    <div className={styles.prRangeButtons}>
      {RANGES.map(r => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          className={cx(styles.prRangeBtn, value === r.key && styles.prRangeBtnActive)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

// ── Spread sub-chart (US — tenor minus EFFR) ────────────────────────────────
// Tenor selection = the frame legend (click a tenor to toggle it); one tenor
// shown → shaded area to 0, several → lines.

const US_SPREAD_TENORS: Array<{ key: string; label: string; color: string }> = [
  { key: 'dgs2',  label: '2Y',  color: COLOR_2Y },
  { key: 'dgs5',  label: '5Y',  color: COLOR_5Y },
  { key: 'dgs10', label: '10Y', color: COLOR_10Y },
  { key: 'dgs30', label: '30Y', color: COLOR_30Y },
]

interface SpreadSubChartUSProps {
  data: Array<Record<string, number | null | string>>
  selected: Set<string>
  onToggle: (key: string) => void
}
function SpreadSubChartUS({ data, selected, onToggle }: SpreadSubChartUSProps) {
  const visible = US_SPREAD_TENORS.filter(t => selected.has(t.key))
  const singleMode = visible.length === 1
  return (
    <AcmChartFrame
      title="SPREAD VS CASH RATE"
      subtitle="Tenor − EFFR (pp) · click a tenor to toggle"
      legend={US_SPREAD_TENORS.map(t => ({ label: t.label, color: t.color, hidden: !selected.has(t.key), onClick: () => onToggle(t.key) }))}
      height={SPREAD_HEIGHT}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
          <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(1)}pp`} />
          <Tooltip {...chartTheme.tooltip} formatter={(v: unknown, name: unknown) => [fmtSpreadPp(v), String(name)]} />
          <ReferenceLine y={0} {...referenceLines.zero} />
          {singleMode && visible.map(t => (
            <Area
              key={t.key} type="monotone" dataKey={`spread_${t.key}`} name={`${t.label} − EFFR`}
              stroke={t.color} strokeWidth={1.75} fill={t.color} fillOpacity={0.18}
              dot={false} connectNulls baseValue={0} isAnimationActive={false}
            />
          ))}
          {!singleMode && visible.map(t => (
            <Line
              key={t.key} type="monotone" dataKey={`spread_${t.key}`} name={`${t.label} − EFFR`}
              stroke={t.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false}
            />
          ))}
          {/* Brush controls only the sub-chart (range buttons remain the
            * primary cross-panel sync). Same tradeoff documented in
            * CountryTermStructure.SpreadSubChart. */}
          <Brush dataKey="date" {...chartTheme.brush} />
        </ComposedChart>
      </ResponsiveContainer>
    </AcmChartFrame>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clipBands(
  bands: Array<{ x1: string; x2: string }>,
  cutoff: string,
  dates: string[],
): Array<{ x1: string; x2: string }> {
  const lastDate = dates[dates.length - 1] ?? cutoff
  return bands
    .filter(b => b.x2 >= cutoff)
    .map(b => ({ x1: b.x1 < cutoff ? cutoff : b.x1, x2: b.x2 > lastDate ? lastDate : b.x2 }))
}
