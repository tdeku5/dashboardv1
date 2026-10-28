// Reusable POLICY RATE VS TERM STRUCTURE chart for non-USD countries.
// Wires the country's overnight cash rate (from /api/overnight-rates/history)
// to its 2Y / 5Y / 10Y / 30Y sovereign yields (from /api/tv/yield-curve/:key)
// on a shared time axis. Colours, layout, range buttons, brush, and the top
// legend bar mirror the US Policy Rate term-structure chart so the same tenor
// renders in the same colour across every country tab.

import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AcmChartFrame, fmtSignedFixed, niceAxis, type AcmLegendItem } from '../components/acm'
import { cx } from '../components/acm/acmFormat'
import { chartTheme, referenceLines } from '../components/acm/chartTheme'
import { TENOR_COLORS } from '../constants/identityColors'
import { cutoffForRange, RangeButtons, type RangeKey } from './PolicyRatePage'
import styles from './PolicyRatePage.module.css'

// ── Colours: identity registry (R5a) — the same TENOR_COLORS as the US chart ──
// Every line is a LEVEL (cash rate, yields, tenor − cash spreads): identity
// colour, never sign (rule 6). Layout + range buttons = PolicyRatePage's pr*.

const COLOR_CASH = TENOR_COLORS.cash
const COLOR_2Y   = TENOR_COLORS['2Y']
const COLOR_5Y   = TENOR_COLORS['5Y']
const COLOR_10Y  = TENOR_COLORS['10Y']
const COLOR_30Y  = TENOR_COLORS['30Y']
const TERM_HEIGHT = 380
const SPREAD_HEIGHT = 180

/** Tenor − cash spreads are signed; '0.00pp' when they round to zero (near-zero rule). */
const fmtSpreadPp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmtSignedFixed(v, 2, 'pp') : '—')
const fmtLevelPct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : '—')

// ── Props ──────────────────────────────────────────────────────────────────

interface TenorSpec {
  /** Display label, e.g. '2Y'. */
  label: '2Y' | '5Y' | '10Y' | '30Y'
  /** Symbol to look up in the /api/tv/yield-curve response, e.g. 'GB02Y'. */
  symbol: string
  color: string
}

export interface CountryTermStructureProps {
  /** Country page label, e.g. 'UK'. */
  countryLabel: string
  /** overnight_rates.series_code (e.g. 'SONIA'). */
  cashSeriesCode: string
  /** Label for the cash-rate line in the legend (e.g. 'SONIA'). */
  cashLabel: string
  /** Yield-curve page key (e.g. 'gilt', 'egb', 'cad', 'jgb', 'agb'). */
  yieldCurvePageKey: string
  /** Tenors to render, in display order. Symbol points at the
   *  /api/tv/yield-curve tenor.key. */
  tenors: TenorSpec[]
  /** Optional subtitle to surface — e.g. a substitution note when a tenor is missing. */
  subtitle?: string
}

// ── Data fetching ───────────────────────────────────────────────────────────

interface YieldCurveApiResp {
  tenors: Array<{ key: string; label: string; years: number; data: Array<{ date: string; value: number }> }>
}

interface OvernightHistoryResp {
  [seriesCode: string]: Array<{ date: string; value: number }>
}

interface SeriesBundle {
  cash: Map<string, number>
  tenors: Map<string, Map<string, number>> // tenor symbol → date map
}

async function fetchAll(props: CountryTermStructureProps): Promise<SeriesBundle> {
  const [curveRes, cashRes] = await Promise.all([
    fetch(`/api/tv/yield-curve/${props.yieldCurvePageKey}`).then(r => r.json() as Promise<YieldCurveApiResp>),
    fetch(`/api/overnight-rates/history?series=${encodeURIComponent(props.cashSeriesCode)}`)
      .then(r => r.json() as Promise<OvernightHistoryResp>),
  ])
  const cash = new Map<string, number>()
  const cashRows = cashRes[props.cashSeriesCode] ?? []
  for (const r of cashRows) if (r.value != null) cash.set(r.date, r.value)
  const tenors = new Map<string, Map<string, number>>()
  for (const spec of props.tenors) {
    const t = curveRes.tenors.find(x => x.key === spec.symbol)
    const map = new Map<string, number>()
    if (t) for (const r of t.data) if (r.value != null) map.set(r.date, r.value)
    tenors.set(spec.symbol, map)
  }
  return { cash, tenors }
}

type Tone = 'on' | 'off'

// ── Page component ─────────────────────────────────────────────────────────

export function CountryTermStructure(props: CountryTermStructureProps) {
  const [bundle, setBundle] = useState<SeriesBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('2y')

  // Toggle keys: 'cash' for the overnight line, then each tenor's symbol.
  const initialToggle = useMemo<Record<string, Tone>>(() => {
    const t: Record<string, Tone> = { cash: 'on' }
    for (const s of props.tenors) t[s.symbol] = 'on'
    return t
  }, [props.tenors])
  const [toggle, setToggle] = useState<Record<string, Tone>>(initialToggle)
  useEffect(() => { setToggle(initialToggle) }, [initialToggle])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAll(props)
      .then(b => { if (!cancelled) { setBundle(b); setLoading(false) } })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [props.cashSeriesCode, props.yieldCurvePageKey, props])

  const data = useMemo(() => {
    if (!bundle) return null
    const cutoff = cutoffForRange(range)
    const grid = new Set<string>()
    for (const d of bundle.cash.keys()) if (d >= cutoff) grid.add(d)
    for (const m of bundle.tenors.values()) for (const d of m.keys()) if (d >= cutoff) grid.add(d)
    const dates = Array.from(grid).sort()
    const rows = dates.map(d => {
      const row: Record<string, number | null | string> = { date: d }
      const cash = bundle.cash.get(d) ?? null
      row.cash = cash
      for (const spec of props.tenors) {
        const y = bundle.tenors.get(spec.symbol)?.get(d) ?? null
        row[spec.symbol] = y
        // Spread vs cash rate — populated only when both inputs exist for the day.
        row[`spread_${spec.symbol}`] = y != null && cash != null ? +(y - cash).toFixed(4) : null
      }
      return row
    })
    return rows
  }, [bundle, range, props.tenors])

  // Spread sub-chart state: which tenor spreads are selected. Default is 2Y.
  const initialSpreadSelection = useMemo<Set<string>>(() => {
    const out = new Set<string>()
    const twoYr = props.tenors.find(t => t.label === '2Y')
    if (twoYr) out.add(twoYr.symbol)
    return out
  }, [props.tenors])
  const [selectedSpreads, setSelectedSpreads] = useState<Set<string>>(initialSpreadSelection)
  useEffect(() => { setSelectedSpreads(initialSpreadSelection) }, [initialSpreadSelection])

  // Flag for the UX-only TONA-missing case: cash data empty even though we
  // tried to fetch it. We let the legend mark TONA as 'off' so the missing
  // line is visibly explained.
  const cashEmpty = bundle != null && bundle.cash.size === 0

  if (loading) return <div className={styles.prStateMsg}>Loading {props.countryLabel} term structure…</div>
  if (error)   return <div className={styles.prStateError}>Failed to load: {error}</div>
  if (!data)   return null

  const hide = (key: string) => toggle[key] === 'off'
  const toggleKey = (key: string) =>
    setToggle(prev => ({ ...prev, [key]: prev[key] === 'off' ? 'on' : 'off' }))

  const toggleSpread = (key: string) => {
    setSelectedSpreads(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Legend — overnight cash rate first, then tenors; click to toggle. A cash
  // series that was never ingested shows dimmed and can't be toggled on.
  const legend: AcmLegendItem[] = [
    { label: props.cashLabel, color: COLOR_CASH, hidden: cashEmpty || hide('cash'), onClick: cashEmpty ? undefined : () => toggleKey('cash') },
    ...props.tenors.map(t => ({ label: t.label, color: t.color, hidden: hide(t.symbol), onClick: () => toggleKey(t.symbol) })),
  ]

  return (
    <div className={styles.prColumn}>
      {cashEmpty && (
        <div className={cx(styles.prNote, styles.prNoteWarning)}>
          {props.cashLabel} data not yet ingested — line omitted. (See server logs for collector status.)
        </div>
      )}
      <AcmChartFrame
        title="POLICY RATE VS TERM STRUCTURE"
        subtitle={cashEmpty ? undefined : props.subtitle}
        legend={legend}
        actions={<RangeButtons value={range} onChange={setRange} />}
        height={TERM_HEIGHT}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid {...chartTheme.grid} />
            <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
            <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
            <Tooltip {...chartTheme.tooltip} formatter={fmtLevelPct} />
            {!cashEmpty && (
              <Line type="monotone" dataKey="cash" name={props.cashLabel}
                stroke={COLOR_CASH} strokeWidth={2} dot={false} connectNulls hide={hide('cash')} />
            )}
            {props.tenors.map(t => (
              <Line key={t.symbol} type="monotone" dataKey={t.symbol} name={t.label}
                stroke={t.color} strokeWidth={1.5} dot={false} connectNulls hide={hide(t.symbol)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </AcmChartFrame>

      {/* Spread sub-chart: tenor − cash */}
      <SpreadSubChart
        data={data}
        tenors={props.tenors}
        cashEmpty={cashEmpty}
        selected={selectedSpreads}
        onToggle={toggleSpread}
      />
    </div>
  )
}

// ── Spread sub-chart ────────────────────────────────────────────────────────

interface SpreadSubChartProps {
  data: Array<Record<string, number | null | string>>
  tenors: TenorSpec[]
  cashEmpty: boolean
  selected: Set<string>
  onToggle: (symbol: string) => void
}

function SpreadSubChart({ data, tenors, cashEmpty, selected, onToggle }: SpreadSubChartProps) {
  const visible = tenors.filter(t => selected.has(t.symbol))
  const singleMode = visible.length === 1
  // even 1dp ticks over the visible spreads, 0 kept for the zero line
  const yAxis = niceAxis(visible.flatMap(t => data.map(r => r[`spread_${t.symbol}`])).filter((v): v is number => typeof v === 'number'), { dp: 1, includeZero: true, maxIntervals: 4 })

  // Tenor multi-select = the frame legend; disabled (no onClick) without a cash rate.
  const legend: AcmLegendItem[] = tenors.map(t => ({
    label: t.label, color: t.color, hidden: !selected.has(t.symbol), onClick: cashEmpty ? undefined : () => onToggle(t.symbol),
  }))

  return (
    <AcmChartFrame
      title="SPREAD VS CASH RATE"
      subtitle={cashEmpty ? 'Cash rate unavailable — spreads cannot be computed' : 'Tenor − cash (pp) · click a tenor to toggle'}
      legend={legend}
      height={SPREAD_HEIGHT}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="date" {...chartTheme.xAxis} minTickGap={40} />
          <YAxis {...chartTheme.yAxis} domain={yAxis.domain} ticks={yAxis.ticks} tickFormatter={(v: number) => `${v.toFixed(1)}pp`} />
          <Tooltip {...chartTheme.tooltip} formatter={(v: unknown, name: unknown) => [fmtSpreadPp(v), String(name)]} />
          <ReferenceLine y={0} {...referenceLines.zero} />
          {/* One selected: line + translucent area fill. Two or more: plain lines, no fill. */}
          {singleMode && visible.map(t => (
            <Area
              key={t.symbol}
              type="monotone"
              dataKey={`spread_${t.symbol}`}
              name={`${t.label} − cash`}
              stroke={t.color}
              strokeWidth={1.75}
              fill={t.color}
              fillOpacity={0.18}
              dot={false}
              connectNulls
              baseValue={0}
              isAnimationActive={false}
            />
          ))}
          {!singleMode && visible.map(t => (
            <Line
              key={t.symbol}
              type="monotone"
              dataKey={`spread_${t.symbol}`}
              name={`${t.label} − cash`}
              stroke={t.color}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          {/* Brush controls only this sub-chart; range buttons remain the primary
            * cross-panel sync. Fully syncing the brush across the main chart
            * would require slicing data outside the Recharts component — deferred. */}
          <Brush dataKey="date" {...chartTheme.brush} />
        </ComposedChart>
      </ResponsiveContainer>
    </AcmChartFrame>
  )
}

// ── Per-country configs ────────────────────────────────────────────────────
//
// Standard 2Y / 5Y / 10Y / 30Y per spec. If any tenor's symbol is missing in
// tv_series at render time it just won't draw a line (the line silently
// drops); the frame legend still shows it so the user knows which series was
// intended. EGB / GB / CA / JP / AU all carry the four tenors per the
// tv_series audit at the time of this commit.

export const COUNTRY_TERM_STRUCTURE_CONFIGS: Record<
  'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS',
  Omit<CountryTermStructureProps, 'countryLabel'>
> = {
  UK: {
    cashSeriesCode: 'SONIA',
    cashLabel: 'SONIA',
    yieldCurvePageKey: 'gilt',
    tenors: [
      { label: '2Y',  symbol: 'GB02Y', color: COLOR_2Y },
      { label: '5Y',  symbol: 'GB05Y', color: COLOR_5Y },
      { label: '10Y', symbol: 'GB10Y', color: COLOR_10Y },
      { label: '30Y', symbol: 'GB30Y', color: COLOR_30Y },
    ],
  },
  EU: {
    cashSeriesCode: 'ECBDFR',
    cashLabel: 'ECB DFR',
    yieldCurvePageKey: 'egb',
    tenors: [
      { label: '2Y',  symbol: 'EU02Y', color: COLOR_2Y },
      { label: '5Y',  symbol: 'EU05Y', color: COLOR_5Y },
      { label: '10Y', symbol: 'EU10Y', color: COLOR_10Y },
      { label: '30Y', symbol: 'EU30Y', color: COLOR_30Y },
    ],
  },
  CAD: {
    cashSeriesCode: 'CORRA',
    cashLabel: 'CORRA',
    yieldCurvePageKey: 'cad',
    tenors: [
      { label: '2Y',  symbol: 'CA02Y', color: COLOR_2Y },
      { label: '5Y',  symbol: 'CA05Y', color: COLOR_5Y },
      { label: '10Y', symbol: 'CA10Y', color: COLOR_10Y },
      { label: '30Y', symbol: 'CA30Y', color: COLOR_30Y },
    ],
  },
  JPY: {
    cashSeriesCode: 'TONA',
    cashLabel: 'TONA',
    yieldCurvePageKey: 'jgb',
    tenors: [
      { label: '2Y',  symbol: 'JP02Y', color: COLOR_2Y },
      { label: '5Y',  symbol: 'JP05Y', color: COLOR_5Y },
      { label: '10Y', symbol: 'JP10Y', color: COLOR_10Y },
      { label: '30Y', symbol: 'JP30Y', color: COLOR_30Y },
    ],
  },
  AUS: {
    cashSeriesCode: 'AONIA',
    cashLabel: 'AONIA',
    yieldCurvePageKey: 'agb',
    tenors: [
      { label: '2Y',  symbol: 'AU02Y', color: COLOR_2Y },
      { label: '5Y',  symbol: 'AU05Y', color: COLOR_5Y },
      { label: '10Y', symbol: 'AU10Y', color: COLOR_10Y },
      { label: '30Y', symbol: 'AU30Y', color: COLOR_30Y },
    ],
  },
}
