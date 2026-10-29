import { Fragment, useMemo, useState } from 'react'
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
import { useGlobalYieldCurves } from '../hooks/useGlobalYieldCurves'
import { useGlobalForwardCurves } from '../hooks/useGlobalForwardCurves'
import { useGlobalCalendarSpreads } from '../hooks/useGlobalCalendarSpreads'
import { useGlobalYieldChanges, type YieldChangeMetric, type YieldChangeRowKey } from '../hooks/useGlobalYieldChanges'
import { useGlobalRatesSummary, type CurveRegimeName, type NextMove } from '../hooks/useGlobalRatesSummary'
import { getCellColor } from '../lib/cellColor'
import { AcmChartFrame, AcmPanel, fmtSignedFixed, niceAxis, roundForDisplay, type AcmLegendItem } from '../components/acm'
import { chartTheme, referenceLines } from '../components/acm/chartTheme'
import { luminance } from '../lib/paletteCheck'
import { toneClass } from '../components/acm/tones'
import { countryColor, CURVE_REGIME_COLORS, type RegimeKey } from '../constants/identityColors'
import { DailyChangeModal } from '../components/DailyChangeModal'
import { policyMoveTone, rateChangeClass } from './ratesShared'
import { GlobalPolicyTermStructureSection } from './GlobalPolicyTermStructureSection'
import { GlobalPolicyPathRealRateSection } from './GlobalPolicyPathRealRateSection'
import { GlobalForwardCurvesSection } from './GlobalForwardCurvesSection'
import { Global2s10sRegimeSection } from './Global2s10sRegimeSection'
import styles from './STIRDashboardPage.module.css'

// R5c: GLOBAL on ACM primitives. Curves are LEVELS in country identity colours
// (registry countryColor). Summary: yield / curve Δ columns join the cellColor
// named heatmap (red / blue, text primary — addendum Decision 1); Terminal − OCR
// and ±6M / ±12M − Terminal follow rule 6 (increase red); HIKE red, CUT green;
// regime cells keep their CURVE_REGIME_COLORS identity fill. Calendar spread
// values are LEVELS (plain), as on STIR STRIPS.

/** Registry identity colour for a country / market key; a muted fallback if unmapped. */
const cc = (key: string): string => countryColor(key) ?? 'var(--acm-text-secondary)'

const YIELD_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
const FORWARD_COUNTRIES = ['US', 'UK', 'EU', 'CA', 'JP', 'AU'] as const



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

const REGIME_SHORT_LABELS: Record<CurveRegimeName, string> = {
  'Bull Steepener': 'Bull Stp',
  'Bear Steepener': 'Bear Stp',
  'Steepener Twist': 'Stp Twist',
  'Bull Flattener': 'Bull Flt',
  'Bear Flattener': 'Bear Flt',
  'Flattener Twist': 'Flt Twist',
  'Neutral': 'Neutral',
}

const YIELD_LOOKBACK_OPTIONS = [
  { value: '1d', label: '1D' }, { value: '5d', label: '5D' },
  { value: '1m', label: '1M' }, { value: '3m', label: '3M' },
  { value: '6m', label: '6M' }, { value: 'ytd', label: 'YTD' },
] as const

const REGIME_LOOKBACK_OPTIONS = [
  { value: '20d', label: '20D' }, { value: '60d', label: '60D' }, { value: '200d', label: '200D' },
] as const

/** HIKE = red, CUT = green (a priced policy move); HOLD / missing muted. */
function nextMoveClass(v: NextMove): string | undefined {
  if (v === 'HIKE') return toneClass(policyMoveTone('hike'))
  if (v === 'CUT') return toneClass(policyMoveTone('cut'))
  return styles.muted
}

/** Signed 1dp bp; a value that rounds to zero prints as 0.0 (near-zero rule). */
function fmtSignedBps(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, 1)
}

/**
 * Summary Δ cell: the cellColor named heatmap on the rate scale (red = up, blue
 * = down), per column max; a change that prints as 0.0 gets no fill.
 */
function deltaHeat(value: number | null, columnAbsMax: number): string | undefined {
  if (value == null || !Number.isFinite(value) || roundForDisplay(value, 1) === 0) return undefined
  return getCellColor(value, columnAbsMax, 'red-blue')
}

// Relative luminance of the two text tokens a regime cell can use
// (--acm-surface-bg, --acm-text-primary), for picking the higher-contrast one.
export const DARK_TEXT_LUMINANCE = 0.0078 // #0E1621 — pinned to the token by assetClassModels.global.test.ts
export const LIGHT_TEXT_LUMINANCE = 0.7697 // #DDE4ED

/** Regime cell: its registry identity colour as the fill; dark or light text, whichever contrasts more. */
function regimeCellStyle(regime: CurveRegimeName | null): React.CSSProperties | undefined {
  const bg = regime ? CURVE_REGIME_COLORS[regime as RegimeKey] : undefined
  if (!bg) return undefined
  const l = luminance(bg)
  const dark = (l + 0.05) / (DARK_TEXT_LUMINANCE + 0.05)
  const light = (LIGHT_TEXT_LUMINANCE + 0.05) / (l + 0.05)
  return { background: bg, color: dark >= light ? 'var(--acm-surface-bg)' : 'var(--acm-text-primary)' }
}

function columnAbsMax(values: Array<number | null>): number {
  let max = 0
  for (const v of values) {
    if (v != null && Number.isFinite(v)) {
      const a = Math.abs(v)
      if (a > max) max = a
    }
  }
  return max
}

/** z-score / bp in the 1-day grid; a value that rounds to zero prints unsigned. */
function fmtSigma(z: number | null | undefined): string {
  if (z == null || !Number.isFinite(z)) return '—'
  return fmtSignedFixed(z, 3, 'σ')
}

function fmtBps(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '—'
  return fmtSignedFixed(b, 2, ' bps')
}

export function GlobalRatesPage() {
  const [yieldLookback, setYieldLookback] = useState(0)
  const [forwardLookback, setForwardLookback] = useState(0)
  const [spreadsLookback, setSpreadsLookback] = useState(0)

  const yieldData = useGlobalYieldCurves(yieldLookback)
  const forwardData = useGlobalForwardCurves(forwardLookback)
  const spreadsData = useGlobalCalendarSpreads(spreadsLookback)
  const yieldChanges = useGlobalYieldChanges()
  const [compressed, setCompressed] = useState(false)

  const [summaryYieldLookback, setSummaryYieldLookback] = useState<string>('1d')
  const [summaryRegimeLookback, setSummaryRegimeLookback] = useState<string>('20d')
  const summary = useGlobalRatesSummary(summaryYieldLookback, summaryRegimeLookback)

  const [detailCell, setDetailCell] = useState<{ country: string; countryLabel: string; tenor: YieldChangeRowKey } | null>(null)

  // Calendar spread values are LEVELS: plain text, signed; 0.0 when they round to zero.
  const fmtSpread = (v: number | undefined): string => (typeof v === 'number' ? fmtSignedFixed(v, 1) : '—')

  const ycYDomain = useMemo(() => {
    const vals: number[] = []
    for (const r of yieldData.tenors) {
      for (const c of YIELD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return niceAxis([0, 6], { dp: 2 })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    // the 10% padded range snapped to even 2dp ticks (niceAxis)
    return niceAxis([min - pad, max + pad], { dp: 2 })
  }, [yieldData.tenors])

  const fwdYDomain = useMemo(() => {
    const vals: number[] = []
    for (const r of forwardData.contracts) {
      for (const c of FORWARD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return niceAxis([0, 6], { dp: 2 })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    // the 10% padded range snapped to even 2dp ticks (niceAxis)
    return niceAxis([min - pad, max + pad], { dp: 2 })
  }, [forwardData.contracts])

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

  const lookbackInput = (id: string, value: number, onChange: (v: number) => void) => (
    <label className={styles.ustLookback} htmlFor={id}>
      <span>t −</span>
      <input
        id={id}
        className={`${styles.laborInput} ${styles.inputNarrow}`}
        type="number"
        min="0"
        max="252"
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      />
    </label>
  )
  const countryLegend = (keys: readonly string[]): AcmLegendItem[] => keys.map(k => ({ label: k, color: cc(k) }))
  const spreadStrides = ([1, 2, 3, 4] as const).filter(s => (spreadsData.strides[s]?.length ?? 0) > 0)

  return (
    <div className={styles.ustStack}>
      {/* ═══ Global Rates Summary ═══ */}
      <AcmPanel
        title="GLOBAL RATES SUMMARY"
        actions={(
          <>
            <label className={styles.ustLookback} htmlFor="summaryYieldLookback">
              <span>YIELD Δ LOOKBACK:</span>
              <select id="summaryYieldLookback" className={styles.gsSelect} value={summaryYieldLookback} onChange={e => setSummaryYieldLookback(e.target.value)}>
                {YIELD_LOOKBACK_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.ustLookback} htmlFor="summaryRegimeLookback">
              <span>REGIME LOOKBACK:</span>
              <select id="summaryRegimeLookback" className={styles.gsSelect} value={summaryRegimeLookback} onChange={e => setSummaryRegimeLookback(e.target.value)}>
                {REGIME_LOOKBACK_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
      >
        {summary.loading ? (
          <div className={styles.stateMsg}>Loading summary…</div>
        ) : summary.error ? (
          <div className={styles.stateError}>{summary.error}</div>
        ) : summary.data ? (() => {
          const rows = summary.data.rows
          const max2Y  = columnAbsMax(rows.map(r => r.delta2Y))
          const max5Y  = columnAbsMax(rows.map(r => r.delta5Y))
          const max10Y = columnAbsMax(rows.map(r => r.delta10Y))
          const max30Y = columnAbsMax(rows.map(r => r.delta30Y))
          const max2s10s  = columnAbsMax(rows.map(r => r.delta2s10s))
          const max10s30s = columnAbsMax(rows.map(r => r.delta10s30s))
          // Window label comes from the RESPONSE, not the dropdown's local
          // state, so the header can never describe a window the data is not
          // actually from (e.g. mid-fetch after a dropdown change).
          const regimeWindowLabel = `${summary.data.regimeLookbackDays}D`
          const heatCell = (v: number | null, max: number) => {
            const bg = deltaHeat(v, max)
            return <td className={styles.gsHeat} data-col="delta" data-cell-color data-heat={bg} style={bg ? { background: bg } : undefined}>{fmtSignedBps(v)}</td>
          }
          const regimeCell = (r: CurveRegimeName | null) => (
            <td className={styles.gsRegime} data-col="regime" style={regimeCellStyle(r)}>{r ? REGIME_SHORT_LABELS[r] : '—'}</td>
          )
          const spreadCell = (v: number | null) => <td data-col="spread" className={rateChangeClass(v) ?? (v == null ? styles.muted : undefined)}>{fmtSignedBps(v)}</td>
          return (
          <table className={styles.summaryTableAcm}>
            <thead>
              <tr>
                <th data-col="country">Country</th>
                <th data-col="delta">2Y Δ</th>
                <th data-col="delta">5Y Δ</th>
                <th data-col="delta">10Y Δ</th>
                <th data-col="delta">30Y Δ</th>
                <th data-col="regime">2s10s</th>
                <th data-col="delta">2s10s Δ <span className={styles.gsUnit}>({regimeWindowLabel})</span></th>
                <th data-col="regime">10s30s</th>
                <th data-col="delta">10s30s Δ <span className={styles.gsUnit}>({regimeWindowLabel})</span></th>
                <th data-col="nextmove">Next CB Move</th>
                <th data-col="spread">Terminal − OCR <span className={styles.gsUnit}>(bps)</span></th>
                <th data-col="spread">+6M − Terminal <span className={styles.gsUnit}>(bps)</span></th>
                <th data-col="spread">+12M − Terminal <span className={styles.gsUnit}>(bps)</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.country}>
                  <td data-col="country">{row.country}</td>
                  {heatCell(row.delta2Y, max2Y)}
                  {heatCell(row.delta5Y, max5Y)}
                  {heatCell(row.delta10Y, max10Y)}
                  {heatCell(row.delta30Y, max30Y)}
                  {regimeCell(row.regime2s10s)}
                  {heatCell(row.delta2s10s, max2s10s)}
                  {regimeCell(row.regime10s30s)}
                  {heatCell(row.delta10s30s, max10s30s)}
                  <td data-col="nextmove" className={nextMoveClass(row.nextMove)}>{row.nextMove ?? '—'}</td>
                  {spreadCell(row.terminalMinusOcr)}
                  {spreadCell(row.fwd6mMinusTerminal)}
                  {spreadCell(row.fwd12mMinusTerminal)}
                </tr>
              ))}
            </tbody>
          </table>
          )
        })() : null}
      </AcmPanel>

      <div className={styles.ustPair}>
        {/* ═══ Global Yield Curves ═══ */}
        <AcmChartFrame
          title="GLOBAL SOVEREIGN YIELD CURVES"
          subtitle={`● AS OF: ${yieldData.asOfDate || '—'}${yieldLookback > 0 ? ` (t − ${yieldLookback})` : ''}`}
          legend={countryLegend(YIELD_COUNTRIES)}
          actions={(
            <>
              {lookbackInput('ycLookback', yieldLookback, setYieldLookback)}
              <button
                type="button"
                className={`${styles.toggleButton} ${compressed ? styles.toggleButtonActive : ''}`}
                aria-pressed={compressed}
                onClick={() => setCompressed(v => !v)}
              >
                COMPRESSED
              </button>
            </>
          )}
          height={600}
        >
          {yieldData.loading ? (
            <div className={styles.stateMsg}>Loading global yield curves…</div>
          ) : yieldData.error ? (
            <div className={styles.stateError}>{yieldData.error}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yieldData.tenors} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid {...chartTheme.grid} vertical={false} />
                <XAxis
                  dataKey={compressed ? 'years' : 'tenor'}
                  type={compressed ? 'number' : 'category'}
                  {...chartTheme.xAxis}
                  {...(compressed ? {
                    domain: [0, maxYears] as [number, number],
                    ticks: yieldData.tenors.map(t => t.years),
                    tickFormatter: (v: number) => v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`,
                  } : {})}
                />
                <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={ycYDomain.domain} ticks={ycYDomain.ticks} />
                <Tooltip
                  {...chartTheme.tooltip}
                  formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                  labelFormatter={(label: unknown) => {
                    if (compressed) {
                      const v = Number(label)
                      return v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`
                    }
                    return String(label)
                  }}
                />
                {YIELD_COUNTRIES.map(c => (
                  <Line key={c} name={c} type="monotone" dataKey={c} stroke={cc(c)} strokeWidth={2} dot={{ r: 3, fill: cc(c) }} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </AcmChartFrame>

        {/* ═══ Global Forward Curves ═══ */}
        <AcmChartFrame
          title="GLOBAL FORWARD CURVES (STIR STRIPS)"
          subtitle={`● AS OF: ${forwardData.asOfDate || '—'}${forwardLookback > 0 ? ` (t − ${forwardLookback})` : ''}`}
          legend={countryLegend(FORWARD_COUNTRIES)}
          actions={lookbackInput('fwdLookback', forwardLookback, setForwardLookback)}
          height={600}
        >
          {forwardData.loading ? (
            <div className={styles.stateMsg}>Loading global forward curves…</div>
          ) : forwardData.error ? (
            <div className={styles.stateError}>{forwardData.error}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forwardData.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid {...chartTheme.grid} vertical={false} />
                <XAxis dataKey="code" {...chartTheme.xAxis} tickMargin={8} interval="preserveStartEnd" minTickGap={30} />
                <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={fwdYDomain.domain} ticks={fwdYDomain.ticks} />
                <Tooltip
                  {...chartTheme.tooltip}
                  formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                />
                {FORWARD_COUNTRIES.map(c => (
                  <Line key={c} name={c} type="monotone" dataKey={c} stroke={cc(c)} strokeWidth={2} dot={{ r: 3, fill: cc(c) }} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </AcmChartFrame>
      </div>

      {/* ═══ Global Bond Yields — 1 Day Change: the z-score grid (cellColor named heatmap, red / blue) ═══ */}
      <AcmPanel title="GLOBAL BOND YIELDS — 1 DAY CHANGE" footer={<>σ — 200 Day Standard Deviation · bottom two rows show curve differentials</>}>
        <div className={styles.ustAsOf}>● AS OF: {yieldChanges.asOfDate || '—'}</div>
        {yieldChanges.loading ? (
          <div className={styles.stateMsg}>Loading yield changes…</div>
        ) : yieldChanges.error ? (
          <div className={styles.stateError}>{yieldChanges.error}</div>
        ) : (
          <div className={styles.gzGrid} style={{ gridTemplateColumns: `repeat(${YIELD_CHANGE_COUNTRIES.length}, minmax(0, 1fr))` }}>
            {YIELD_CHANGE_ROWS.map((row) => (
              <Fragment key={row}>
                {YIELD_CHANGE_COUNTRIES.map(({ key, label }) => {
                  const country = yieldChanges.countries[key]
                  const metric: YieldChangeMetric | null | undefined = country?.[row]
                  const z = metric?.zScore
                  // a z that prints as 0.000 gets no fill (near-zero rule)
                  const bg = getCellColor(z != null && roundForDisplay(z, 3) === 0 ? 0 : z, yieldChangeRowMaxAbs[row], 'red-blue')
                  return (
                    <div
                      key={`${key}-${row}`}
                      className={styles.gzCell}
                      data-cell-color
                      style={bg ? { background: bg } : undefined}
                      onClick={() => setDetailCell({ country: key, countryLabel: label, tenor: row })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDetailCell({ country: key, countryLabel: label, tenor: row })
                        }
                      }}
                    >
                      <div className={styles.gzHead}>{label} {row}</div>
                      {metric ? (
                        <>
                          <div className={styles.gzSigma}>{fmtSigma(z)}</div>
                          <div className={styles.gzBps}>{fmtBps(metric.changeBps)}</div>
                        </>
                      ) : (
                        <div className={styles.gzSigma}>—</div>
                      )}
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
        )}
      </AcmPanel>

      {/* ═══ Global Policy Paths & Real Rates (cross-country overlays) ═══ */}
      <GlobalPolicyPathRealRateSection />

      {/* ═══ Global Policy Rate & Term Structure (2x3) ═══ */}
      <GlobalPolicyTermStructureSection />

      {/* ═══ Global Forward Curves (2x3 — STIR forward curve + delta bars) ═══ */}
      <GlobalForwardCurvesSection />

      {/* ═══ Global Calendar Spreads — values are LEVELS (plain), as on STIR STRIPS ═══ */}
      <AcmPanel title="GLOBAL CALENDAR SPREADS" actions={lookbackInput('spreadsLookback', spreadsLookback, setSpreadsLookback)}>
        <div className={styles.ustAsOf}>● AS OF: {spreadsData.asOfDate || '—'}{spreadsLookback > 0 && ` (t − ${spreadsLookback})`}</div>
        {spreadsData.loading ? (
          <div className={styles.stateMsg}>Loading global spreads…</div>
        ) : spreadsData.error ? (
          <div className={styles.stateError}>{spreadsData.error}</div>
        ) : (
          <div className={styles.calGrid} style={{ gridTemplateColumns: `repeat(${spreadStrides.length || 1}, minmax(0, 1fr))` }}>
            {spreadStrides.map((stride) => {
              const rows = spreadsData.strides[stride] ?? []
              const axis = niceAxis(rows.flatMap(r => spreadsData.countries.map(c => r[c.marketKey])).filter((v): v is number => typeof v === 'number'), { dp: 1 })
              return (
                <div key={stride} className={styles.calColumn}>
                  <AcmChartFrame title={`${STRIDE_LABELS[stride]} Spreads`} legend={countryLegend(spreadsData.countries.map(c => c.marketKey))} height={420} className={styles.calFrame}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rows} margin={{ top: 12, right: 12, left: 8, bottom: 50 }}>
                        <CartesianGrid {...chartTheme.grid} />
                        <XAxis dataKey="label" {...chartTheme.xAxis} tickMargin={8} angle={-30} textAnchor="end" height={50} interval={0} />
                        <YAxis
                          {...chartTheme.yAxis}
                          tickMargin={6}
                          tickFormatter={(v: number) => v.toFixed(1)}
                          label={{ ...chartTheme.axisLabel, value: 'bps', angle: -90, position: 'insideLeft' }}
                          domain={axis.domain}
                          ticks={axis.ticks}
                        />
                        <ReferenceLine y={0} {...referenceLines.zero} />
                        <Tooltip
                          {...chartTheme.tooltip}
                          formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `${fmtSignedFixed(v, 2)}bp` : '—', name ?? '']}
                        />
                        {spreadsData.countries.map((c) => (
                          <Line
                            key={c.marketKey}
                            name={c.marketKey}
                            type="linear"
                            dataKey={c.marketKey}
                            stroke={cc(c.marketKey)}
                            strokeWidth={1.5}
                            dot={{ r: 3, fill: cc(c.marketKey) }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </AcmChartFrame>
                  <table className={styles.calTable}>
                    <thead>
                      <tr>
                        <th>Spread</th>
                        {spreadsData.countries.map((c) => (
                          <th key={c.marketKey}>
                            <div>{c.marketKey}</div>
                            <div className={styles.calHeadName}>{c.shortName}</div>
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
                            return <td key={c.marketKey} className={typeof v === 'number' ? undefined : styles.muted}>{fmtSpread(typeof v === 'number' ? v : undefined)}</td>
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
      </AcmPanel>

      {/* ═══ Global 2s10s Yield Curve Regimes (2x3) ═══ */}
      <Global2s10sRegimeSection />

      {detailCell && (
        <DailyChangeModal
          country={detailCell.country}
          countryLabel={detailCell.countryLabel}
          tenor={detailCell.tenor}
          onClose={() => setDetailCell(null)}
        />
      )}
    </div>
  )
}
