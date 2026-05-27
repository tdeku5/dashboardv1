import { Fragment, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import { REGIME_COLORS } from '../lib/curveRegime'
import { ReferenceLine } from 'recharts'
import { DailyChangeModal } from '../components/DailyChangeModal'
import { GlobalPolicyTermStructureSection } from './GlobalPolicyTermStructureSection'
import { GlobalForwardCurvesSection } from './GlobalForwardCurvesSection'
import styles from './STIRDashboardPage.module.css'

const COUNTRY_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  DE: '#facc15',
  FR: '#fb923c',
  IT: '#34d399',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

const YIELD_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
const FORWARD_COUNTRIES = ['US', 'UK', 'EU', 'CA', 'JP', 'AU'] as const

const FORWARD_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  EU: '#facc15',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

const SPREAD_MARKET_COLORS: Record<string, string> = {
  SR3: '#60a5fa',
  SO3: '#a78bfa',
  EUR: '#facc15',
  CRA: '#f87171',
  TOA3: '#f472b6',
  AUS: '#22d3ee',
}

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

// Rates-trader convention: positive bps in yield = red (bearish, rates up).
function deltaColorClass(v: number | null): string {
  if (v == null) return styles.cellNeutral
  if (v > 0) return styles.cellNegative
  if (v < 0) return styles.cellPositive
  return ''
}

// Front − 12m: positive = curve rising forward = hikes priced (red, bearish);
// negative = curve falling forward = cuts priced (green). Same sign convention
// as the yield-Δ and Terminal−OCR columns.
function frontMinus12mColorClass(v: number | null): string {
  if (v == null) return styles.cellNeutral
  if (v > 0) return styles.cellNegative
  if (v < 0) return styles.cellPositive
  return ''
}

// Terminal − OCR: positive = hikes still required to reach terminal (red);
// negative = cuts to reach terminal (green).
function terminalSpreadColorClass(v: number | null): string {
  if (v == null) return styles.cellNeutral
  if (v > 0) return styles.cellNegative
  if (v < 0) return styles.cellPositive
  return ''
}

function nextMoveColorClass(v: NextMove): string {
  if (v === 'HIKE') return styles.cellNegative
  if (v === 'CUT') return styles.cellPositive
  return styles.cellNeutral
}

function fmtSignedBps(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

// Per-column gradient: blue for negative, red for positive, intensity scales
// with |value| / column's |max|. Cap alpha at 0.35 so the green/red text on
// top stays legible.
function deltaCellStyle(value: number | null, columnAbsMax: number): React.CSSProperties | undefined {
  if (value == null || !Number.isFinite(value) || columnAbsMax === 0) return undefined
  const intensity = Math.min(1, Math.abs(value) / columnAbsMax)
  const alpha = (intensity * 0.35).toFixed(3)
  if (value < 0) return { background: `rgba(59, 130, 246, ${alpha})` }
  if (value > 0) return { background: `rgba(239, 68, 68, ${alpha})` }
  return undefined
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return { r: 128, g: 128, b: 128 }
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

// Pick black or white text for a given background based on luminance. Above
// ~0.55 → dark text reads better; below → white text.
function regimeCellStyle(regime: CurveRegimeName | null): React.CSSProperties {
  if (!regime) return { color: '#94a3b8' }
  const bg = REGIME_COLORS[regime]
  if (!bg) return { color: '#94a3b8' }
  const { r, g, b } = hexToRgb(bg)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return {
    background: bg,
    color: luminance > 0.55 ? '#000000' : '#ffffff',
    fontWeight: 700,
  }
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

function fmtSigma(z: number | null | undefined): string {
  if (z == null || !Number.isFinite(z)) return '—'
  const sign = z >= 0 ? '+' : '-'
  return `${sign}${Math.abs(z).toFixed(3)}σ`
}

function fmtBps(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '—'
  const sign = b >= 0 ? '+' : '-'
  return `${sign}${Math.abs(b).toFixed(2)} bps`
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

  const fmtSpread = (v: number | undefined): string => {
    if (typeof v !== 'number') return '—'
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
  }
  const spreadCellClass = (v: string | number | undefined): string => {
    if (typeof v !== 'number') return styles.cellEmpty
    if (v > 0) return styles.ocrPositive
    if (v < 0) return styles.ocrNegative
    return ''
  }

  const ycYDomain = useMemo((): [number, number] => {
    const vals: number[] = []
    for (const r of yieldData.tenors) {
      for (const c of YIELD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
  }, [yieldData.tenors])

  const fwdYDomain = useMemo((): [number, number] => {
    const vals: number[] = []
    for (const r of forwardData.contracts) {
      for (const c of FORWARD_COUNTRIES) {
        const v = r[c] as number | undefined | null
        if (v != null) vals.push(v)
      }
    }
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
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

  return (
    <div className={styles.fullPanel}>
      {/* ═══ Global Rates Summary ═══ */}
      <div className={styles.globalSummarySection}>
        <div className={styles.summaryHeader}>
          <h3 className={styles.summaryTitle}>GLOBAL RATES SUMMARY</h3>
          <div className={styles.summaryControls}>
            <div className={styles.summaryControl}>
              <label htmlFor="summaryYieldLookback">YIELD Δ LOOKBACK:</label>
              <select
                id="summaryYieldLookback"
                value={summaryYieldLookback}
                onChange={e => setSummaryYieldLookback(e.target.value)}
              >
                {YIELD_LOOKBACK_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.summaryControl}>
              <label htmlFor="summaryRegimeLookback">REGIME LOOKBACK:</label>
              <select
                id="summaryRegimeLookback"
                value={summaryRegimeLookback}
                onChange={e => setSummaryRegimeLookback(e.target.value)}
              >
                {REGIME_LOOKBACK_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {summary.loading ? (
          <div className={styles.loading}>Loading summary…</div>
        ) : summary.error ? (
          <div className={styles.error}>{summary.error}</div>
        ) : summary.data ? (() => {
          const rows = summary.data.rows
          const max2Y  = columnAbsMax(rows.map(r => r.delta2Y))
          const max5Y  = columnAbsMax(rows.map(r => r.delta5Y))
          const max10Y = columnAbsMax(rows.map(r => r.delta10Y))
          const max30Y = columnAbsMax(rows.map(r => r.delta30Y))
          return (
          <table className={styles.summaryTable}>
            <thead>
              <tr>
                <th className={styles.colCountry}>Country</th>
                <th className={styles.colDelta}>2Y Δ</th>
                <th className={styles.colDelta}>5Y Δ</th>
                <th className={styles.colDelta}>10Y Δ</th>
                <th className={styles.colDelta}>30Y Δ</th>
                <th className={styles.colRegime}>2s10s</th>
                <th className={styles.colRegime}>10s30s</th>
                <th className={styles.colNextMove}>Next CB Move</th>
                <th className={styles.colSpread}>Terminal − OCR <span className={styles.unitSuffix}>(bps)</span></th>
                <th className={styles.colSpread}>Front − 12m <span className={styles.unitSuffix}>(bps)</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.country}>
                  <td className={styles.colCountry}>{row.country}</td>
                  <td className={`${styles.colDelta} ${deltaColorClass(row.delta2Y)}`}  style={deltaCellStyle(row.delta2Y, max2Y)}>{fmtSignedBps(row.delta2Y)}</td>
                  <td className={`${styles.colDelta} ${deltaColorClass(row.delta5Y)}`}  style={deltaCellStyle(row.delta5Y, max5Y)}>{fmtSignedBps(row.delta5Y)}</td>
                  <td className={`${styles.colDelta} ${deltaColorClass(row.delta10Y)}`} style={deltaCellStyle(row.delta10Y, max10Y)}>{fmtSignedBps(row.delta10Y)}</td>
                  <td className={`${styles.colDelta} ${deltaColorClass(row.delta30Y)}`} style={deltaCellStyle(row.delta30Y, max30Y)}>{fmtSignedBps(row.delta30Y)}</td>
                  <td className={styles.colRegime} style={regimeCellStyle(row.regime2s10s)}>
                    {row.regime2s10s ? REGIME_SHORT_LABELS[row.regime2s10s] : '—'}
                  </td>
                  <td className={styles.colRegime} style={regimeCellStyle(row.regime10s30s)}>
                    {row.regime10s30s ? REGIME_SHORT_LABELS[row.regime10s30s] : '—'}
                  </td>
                  <td className={`${styles.colNextMove} ${nextMoveColorClass(row.nextMove)}`}>{row.nextMove ?? '—'}</td>
                  <td className={`${styles.colSpread} ${terminalSpreadColorClass(row.terminalMinusOcr)}`}>
                    {fmtSignedBps(row.terminalMinusOcr)}
                  </td>
                  <td className={`${styles.colSpread} ${frontMinus12mColorClass(row.frontMinus12m)}`}>
                    {fmtSignedBps(row.frontMinus12m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )
        })() : null}
      </div>

      <div className={styles.globalTopRow}>
      {/* ═══ Global Yield Curves ═══ */}
      <div className={styles.ustDashboard} style={{ minWidth: 0 }}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL SOVEREIGN YIELD CURVES</div>
          <div className={styles.ustYcControls}>
            <div className={styles.spreadLookbackControl}>
              <label htmlFor="ycLookback">t −</label>
              <input
                id="ycLookback"
                type="number"
                min="0"
                max="252"
                value={yieldLookback}
                onChange={(e) => setYieldLookback(Math.max(0, parseInt(e.target.value) || 0))}
                className={styles.spreadLookbackInput}
              />
            </div>
            <button
              onClick={() => setCompressed(v => !v)}
              style={{
                background: compressed ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                border: `1px solid ${compressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: compressed ? '#60a5fa' : '#728197',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600,
                padding: '3px 10px', cursor: 'pointer', borderRadius: '2px',
              }}
            >
              COMPRESSED
            </button>
          </div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {yieldData.asOfDate || '—'}{yieldLookback > 0 && ` (t − ${yieldLookback})`}
        </div>

        {yieldData.loading ? (
          <div className={styles.loading}>Loading global yield curves…</div>
        ) : yieldData.error ? (
          <div className={styles.error}>{yieldData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={600}>
            <LineChart data={yieldData.tenors} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={compressed ? 'years' : 'tenor'}
                type={compressed ? 'number' : 'category'}
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                {...(compressed ? {
                  domain: [0, maxYears] as [number, number],
                  ticks: yieldData.tenors.map(t => t.years),
                  tickFormatter: (v: number) => v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`,
                } : {})}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={ycYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                labelFormatter={(label: unknown) => {
                  if (compressed) {
                    const v = Number(label)
                    return v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`
                  }
                  return String(label)
                }}
              />
              <Legend
                verticalAlign="top"
                height={28}
                wrapperStyle={{ paddingBottom: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              />
              {YIELD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  name={c}
                  type="monotone"
                  dataKey={c}
                  stroke={COUNTRY_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ═══ Global Forward Curves ═══ */}
      <div className={styles.ustDashboard} style={{ minWidth: 0 }}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL FORWARD CURVES (STIR STRIPS)</div>
          <div className={styles.ustYcControls}>
            <div className={styles.spreadLookbackControl}>
              <label htmlFor="fwdLookback">t −</label>
              <input
                id="fwdLookback"
                type="number"
                min="0"
                max="252"
                value={forwardLookback}
                onChange={(e) => setForwardLookback(Math.max(0, parseInt(e.target.value) || 0))}
                className={styles.spreadLookbackInput}
              />
            </div>
          </div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {forwardData.asOfDate || '—'}{forwardLookback > 0 && ` (t − ${forwardLookback})`}
        </div>

        {forwardData.loading ? (
          <div className={styles.loading}>Loading global forward curves…</div>
        ) : forwardData.error ? (
          <div className={styles.error}>{forwardData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={600}>
            <LineChart data={forwardData.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="code"
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                tickMargin={8}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={fwdYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
              />
              <Legend
                verticalAlign="top"
                height={28}
                wrapperStyle={{ paddingBottom: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}
              />
              {FORWARD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  name={c}
                  type="monotone"
                  dataKey={c}
                  stroke={FORWARD_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      </div>

      {/* ═══ Global Bond Yields — 1 Day Change ═══ */}
      <div className={styles.yieldChangesSection}>
        <div className={styles.yieldChangesHeader}>
          <div className={styles.yieldChangesTitle}>GLOBAL BOND YIELDS — 1 DAY CHANGE</div>
          <div className={styles.yieldChangesDate}>
            {'●'} AS OF: {yieldChanges.asOfDate || '—'}
          </div>
        </div>
        {yieldChanges.loading ? (
          <div className={styles.loading}>Loading yield changes…</div>
        ) : yieldChanges.error ? (
          <div className={styles.error}>{yieldChanges.error}</div>
        ) : (
          <>
            <div
              className={styles.yieldChangesGrid}
              style={{ gridTemplateColumns: `repeat(${YIELD_CHANGE_COUNTRIES.length}, 1fr)` }}
            >
              {YIELD_CHANGE_ROWS.map((row) => (
                <Fragment key={row}>
                  {YIELD_CHANGE_COUNTRIES.map(({ key, label }) => {
                    const country = yieldChanges.countries[key]
                    const metric: YieldChangeMetric | null | undefined = country?.[row]
                    const z = metric?.zScore
                    const bg = getCellColor(z, yieldChangeRowMaxAbs[row], 'red-blue')
                    const cellStyle: React.CSSProperties = { cursor: 'pointer', ...(bg ? { background: bg } : {}) }
                    return (
                      <div
                        key={`${key}-${row}`}
                        className={styles.yieldChangeCell}
                        style={cellStyle}
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
                        <div className={styles.yieldChangeCellHeader}>{label} {row}</div>
                        {metric ? (
                          <>
                            <div className={styles.yieldChangeSigma}>{fmtSigma(z)}</div>
                            <div className={styles.yieldChangeBps}>{fmtBps(metric.changeBps)}</div>
                          </>
                        ) : (
                          <div className={styles.yieldChangeSigma}>—</div>
                        )}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
            <div className={styles.yieldChangeFooter}>
              σ — 200 Day Standard Deviation<br />
              Bottom two rows show curve differentials
            </div>
          </>
        )}
      </div>

      {/* ═══ Global Policy Rate & Term Structure (2x3) ═══ */}
      <GlobalPolicyTermStructureSection />

      {/* ═══ Global Forward Curves (2x3 — STIR forward curve + delta bars) ═══ */}
      <GlobalForwardCurvesSection />

      {/* ═══ Global Calendar Spreads ═══ */}
      <div className={styles.spreadsDashboardFullWidth}>
        <div className={styles.spreadsDashboardHeader}>
          <div className={styles.spreadsHeader}>GLOBAL CALENDAR SPREADS</div>
          <div className={styles.spreadLookbackControl}>
            <label htmlFor="spreadsLookback">t −</label>
            <input
              id="spreadsLookback"
              type="number"
              min="0"
              max="252"
              value={spreadsLookback}
              onChange={(e) => setSpreadsLookback(Math.max(0, parseInt(e.target.value) || 0))}
              className={styles.spreadLookbackInput}
            />
          </div>
        </div>
        <div className={styles.spreadsDateLabels}>
          {'●'} AS OF: {spreadsData.asOfDate || '—'}{spreadsLookback > 0 && ` (t − ${spreadsLookback})`}
        </div>

        {spreadsData.loading ? (
          <div className={styles.loading}>Loading global spreads…</div>
        ) : spreadsData.error ? (
          <div className={styles.error}>{spreadsData.error}</div>
        ) : (
          <div
            className={styles.spreadsGrid}
            style={{ gridTemplateColumns: `repeat(${[1, 2, 3, 4].filter(s => (spreadsData.strides[s]?.length ?? 0) > 0).length || 1}, 1fr)` }}
          >
            {([1, 2, 3, 4] as const).filter(s => (spreadsData.strides[s]?.length ?? 0) > 0).map((stride) => {
              const rows = spreadsData.strides[stride] ?? []
              return (
                <div key={stride} className={styles.spreadColumn}>
                  <div className={styles.spreadColumnTitle}>{STRIDE_LABELS[stride]} Spreads</div>
                  <div className={styles.spreadChartContainer}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rows} margin={{ top: 12, right: 12, left: 8, bottom: 50 }}>
                        <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={8}
                          angle={-30}
                          textAnchor="end"
                          height={50}
                          interval={0}
                          stroke="#728197"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#cbd5e1', fontFamily: 'var(--font-mono)' }}
                          tickMargin={6}
                          tickFormatter={(v: number) => v.toFixed(1)}
                          label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: '#cbd5e1', fontSize: 10 }}
                          domain={['auto', 'auto']}
                          stroke="#728197"
                        />
                        <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1} />
                        <Tooltip
                          contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                          formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}bp` : '—', name ?? '']}
                        />
                        <Legend
                          verticalAlign="top"
                          height={24}
                          wrapperStyle={{ paddingBottom: 4, fontSize: 11, fontFamily: 'var(--font-mono)' }}
                        />
                        {spreadsData.countries.map((c) => (
                          <Line
                            key={c.marketKey}
                            name={c.marketKey}
                            type="linear"
                            dataKey={c.marketKey}
                            stroke={SPREAD_MARKET_COLORS[c.marketKey] ?? '#cbd5e1'}
                            strokeWidth={1.5}
                            dot={{ r: 3, fill: SPREAD_MARKET_COLORS[c.marketKey] ?? '#cbd5e1' }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <table className={styles.spreadTable}>
                    <thead>
                      <tr>
                        <th>Spread</th>
                        {spreadsData.countries.map((c) => (
                          <th key={c.marketKey}>
                            <div className={styles.marketKeyHeader}>{c.marketKey}</div>
                            <div className={styles.marketNameHeader}>{c.shortName}</div>
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
                            return (
                              <td key={c.marketKey} className={spreadCellClass(v)}>
                                {typeof v === 'number' ? fmtSpread(v) : '—'}
                              </td>
                            )
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
      </div>

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
