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
import styles from './PolicyRatePage.module.css'

// ── Shared visual constants (kept in sync with PolicyRatePage) ──────────────

const COLOR_CASH = '#e2e8f0' // white — same as EFFR on the US chart
const COLOR_2Y   = '#60a5fa'
const COLOR_5Y   = '#a78bfa'
const COLOR_10Y  = '#34d399'
const COLOR_30Y  = '#f87171'

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

// ── UI bits ────────────────────────────────────────────────────────────────

type Tone = 'on' | 'off'

interface RangeButtonsProps {
  value: RangeKey
  onChange: (r: RangeKey) => void
}
function RangeButtons({ value, onChange }: RangeButtonsProps) {
  return (
    <div className={styles.rangeButtons}>
      {RANGES.map(r => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={value === r.key ? `${styles.rangeBtn} ${styles.rangeBtnActive}` : styles.rangeBtn}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

interface LegendEntry { key: string; label: string; color: string }
interface LegendBarProps {
  entries: LegendEntry[]
  state: Record<string, Tone>
  onToggle: (key: string) => void
}
function LegendBar({ entries, state, onToggle }: LegendBarProps) {
  return (
    <div className={styles.legendBar}>
      {entries.map(e => {
        const off = state[e.key] === 'off'
        return (
          <button
            key={e.key}
            onClick={() => onToggle(e.key)}
            className={styles.legendItem}
            style={{ color: off ? '#475569' : '#cbd5e1', opacity: off ? 0.55 : 1 }}
            title={off ? 'Show series' : 'Hide series'}
          >
            <span className={styles.legendSwatch} style={{ background: off ? '#475569' : e.color }} />
            {e.label}
          </button>
        )
      })}
    </div>
  )
}

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

  // Legend entries — overnight cash rate first, then tenors.
  const legend = useMemo<LegendEntry[]>(() => {
    return [
      { key: 'cash', label: props.cashLabel, color: COLOR_CASH },
      ...props.tenors.map(t => ({ key: t.symbol, label: t.label, color: t.color })),
    ]
  }, [props.cashLabel, props.tenors])

  if (loading) return <div style={{ padding: 16, color: '#94a3b8' }}>Loading {props.countryLabel} term structure…</div>
  if (error)   return <div style={{ padding: 16, color: '#f87171' }}>Failed to load: {error}</div>
  if (!data)   return null

  const hide = (key: string) => toggle[key] === 'off'
  const toggleKey = (key: string) =>
    setToggle(prev => ({ ...prev, [key]: prev[key] === 'off' ? 'on' : 'off' }))

  const subtitle = cashEmpty
    ? `${props.cashLabel} data not yet ingested — line omitted. (See server logs for collector status.)`
    : props.subtitle

  const toggleSpread = (key: string) => {
    setSelectedSpreads(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span>POLICY RATE VS TERM STRUCTURE</span>
        <RangeButtons value={range} onChange={setRange} />
      </div>
      <LegendBar entries={legend} state={toggle} onToggle={toggleKey} />
      {subtitle && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.04em',
          color: cashEmpty ? '#fcd34d' : '#6b7889',
          padding: '4px 16px 0',
        }}>
          {subtitle}
        </div>
      )}
      <div className={styles.chartArea}>
        {/* Main term-structure chart */}
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} />
            <YAxis stroke="#728197" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12 }}
              labelStyle={{ color: '#cbd5e1' }}
              formatter={(v: unknown) => `${Number(v).toFixed(2)}%`}
            />
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

        {/* Spread sub-chart: tenor − cash */}
        <SpreadSubChart
          data={data}
          tenors={props.tenors}
          cashEmpty={cashEmpty}
          selected={selectedSpreads}
          onToggle={toggleSpread}
        />
      </div>
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

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 6px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8' }}>
          SPREAD VS CASH RATE
        </span>
        {/* Tenor multi-select */}
        <div style={{ display: 'flex', gap: 4 }}>
          {tenors.map(t => {
            const on = selected.has(t.symbol)
            return (
              <button
                key={t.symbol}
                onClick={() => onToggle(t.symbol)}
                disabled={cashEmpty}
                style={{
                  padding: '3px 9px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: on ? '#0f172a' : t.color,
                  background: on ? t.color : 'transparent',
                  border: `1px solid ${t.color}`,
                  borderRadius: 999,
                  cursor: cashEmpty ? 'not-allowed' : 'pointer',
                  opacity: cashEmpty ? 0.4 : 1,
                }}
                title={cashEmpty ? 'Cash rate unavailable — spreads cannot be computed' : `${t.label} − cash`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#728197" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} />
          <YAxis stroke="#728197" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v.toFixed(1)}pp`} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12 }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(2)}pp`, String(name)]}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
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
            * cross-panel sync (see CountryTermStructure header). Fully syncing
            * the brush across the main chart would require slicing data outside
            * the Recharts component — deferred. */}
          <Brush dataKey="date" height={18} stroke="#728197" fill="#0d1520" travellerWidth={6} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Per-country configs ────────────────────────────────────────────────────
//
// Standard 2Y / 5Y / 10Y / 30Y per spec. If any tenor's symbol is missing in
// tv_series at render time it just won't draw a line (the line silently
// drops); the LegendBar still shows it so the user knows which series was
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
