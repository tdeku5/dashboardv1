import { Fragment, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTvYieldCurve } from '../hooks/useTvYieldCurve'
import { buildSpreadChartData, REGIME_COLORS, type SpreadChartPoint } from '../lib/curveRegime'
import { getCellColor } from '../lib/cellColor'
import { HIST_LOOKBACKS, histLookbackChange } from '../lib/historicalChanges'
import styles from './STIRDashboardPage.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type Selection =
  | { type: 'yield'; key: string; label: string }
  | { type: 'spread'; label: string; longKey: string; shortKey: string }
  | { type: 'butterfly'; label: string; lowKey: string; middleKey: string; highKey: string }

interface SpreadDef { label: string; long: string; short: string }
interface ButterflyDef { label: string; low: string; middle: string; high: string }

// ── Spread/butterfly candidate definitions ──────────────────────────────────

function buildSpreads(prefix: string, available: Set<string>): SpreadDef[] {
  const k = (tenor: string) => `${prefix}${tenor}`
  const candidates: Array<{ label: string; longSuffix: string; shortSuffix: string }> = [
    { label: '3m2s', longSuffix: '02Y', shortSuffix: '03MY' },
    { label: '1s2s', longSuffix: '02Y', shortSuffix: '01Y' },
    { label: '2s5s', longSuffix: '05Y', shortSuffix: '02Y' },
    { label: '2s10s', longSuffix: '10Y', shortSuffix: '02Y' },
    { label: '2s30s', longSuffix: '30Y', shortSuffix: '02Y' },
    { label: '5s10s', longSuffix: '10Y', shortSuffix: '05Y' },
    { label: '7s10s', longSuffix: '10Y', shortSuffix: '07Y' },
    { label: '5s30s', longSuffix: '30Y', shortSuffix: '05Y' },
    { label: '10s30s', longSuffix: '30Y', shortSuffix: '10Y' },
    { label: '10s40s', longSuffix: '40Y', shortSuffix: '10Y' },
  ]
  return candidates
    .filter(c => available.has(k(c.longSuffix)) && available.has(k(c.shortSuffix)))
    .map(c => ({ label: c.label, long: k(c.longSuffix), short: k(c.shortSuffix) }))
}

function buildButterflies(prefix: string, available: Set<string>): ButterflyDef[] {
  const k = (tenor: string) => `${prefix}${tenor}`
  const candidates: Array<{ label: string; lowSuffix: string; midSuffix: string; highSuffix: string }> = [
    { label: '2s5s10s', lowSuffix: '02Y', midSuffix: '05Y', highSuffix: '10Y' },
    { label: '2s10s30s', lowSuffix: '02Y', midSuffix: '10Y', highSuffix: '30Y' },
    { label: '5s10s30s', lowSuffix: '05Y', midSuffix: '10Y', highSuffix: '30Y' },
    { label: '10s20s30s', lowSuffix: '10Y', midSuffix: '20Y', highSuffix: '30Y' },
  ]
  return candidates
    .filter(c => available.has(k(c.lowSuffix)) && available.has(k(c.midSuffix)) && available.has(k(c.highSuffix)))
    .map(c => ({ label: c.label, low: k(c.lowSuffix), middle: k(c.midSuffix), high: k(c.highSuffix) }))
}

// ── Chart helpers ────────────────────────────────────────────────────────────

function filterByRange<T extends { date: string }>(series: T[], range: string): T[] {
  if (range === 'all' || series.length === 0) return series
  const now = new Date(series[series.length - 1].date)
  const cutoffs: Record<string, number> = {
    '1m': 30, '3m': 90, '6m': 180, '1y': 365, '5y': 1825, '10y': 3650,
  }
  const days = cutoffs[range] ?? 365
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10)
  return series.filter(p => p.date >= cutoff)
}

function fmtMonth(date: string): string {
  const d = new Date(date)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  pageKey: string
}

export function CountryCurvePage({ pageKey }: Props) {
  const { loading, error, data, tenors, displayName } = useTvYieldCurve(pageKey)

  const [ycLookback, setYcLookback] = useState(1)
  const [ycCompressed, setYcCompressed] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [chartRange, setChartRange] = useState('1y')
  const [regimeLookback, setRegimeLookback] = useState(20)

  // Derive prefix from the first tenor key
  const prefix = useMemo(() => {
    if (tenors.length === 0) return ''
    const key = tenors[0].key
    // Strip the trailing tenor part (e.g. 'GB01MY' → 'GB', 'JP40Y' → 'JP')
    const match = key.match(/^([A-Z]{2})/)
    return match ? match[1] : ''
  }, [tenors])

  const availableKeys = useMemo(() => new Set(tenors.map(t => t.key)), [tenors])

  // ── Yield curve chart data ──────────────────────────────────────────
  const ycCurveData = useMemo(() => {
    return tenors.map(tenor => {
      const series = data[tenor.key] || []
      if (series.length < 2) return { ...tenor, latest: null as number | null, offset: null as number | null, delta: null as number | null }
      const latest = series[series.length - 1]
      const offsetIdx = Math.max(0, series.length - 1 - ycLookback)
      const offset = series[offsetIdx]
      return {
        ...tenor,
        latest: latest?.value ?? null,
        offset: offset?.value ?? null,
        delta: latest && offset ? (latest.value - offset.value) * 100 : null,
      }
    }).filter(d => d.latest != null)
  }, [data, tenors, ycLookback])

  const ycLatestDate = useMemo(() => {
    // Use the longest-available tenor (usually 10Y)
    const key10y = tenors.find(t => t.label === '10Y')?.key ?? tenors[tenors.length - 1]?.key
    const series = key10y ? data[key10y] || [] : []
    return series.length > 0 ? series[series.length - 1].date : '—'
  }, [data, tenors])

  const ycOffsetDate = useMemo(() => {
    const key10y = tenors.find(t => t.label === '10Y')?.key ?? tenors[tenors.length - 1]?.key
    const series = key10y ? data[key10y] || [] : []
    const idx = Math.max(0, series.length - 1 - ycLookback)
    return series.length > 0 ? series[idx].date : '—'
  }, [data, tenors, ycLookback])

  const ycYDomain = useMemo((): [number, number] => {
    const vals = ycCurveData.flatMap(d => [d.latest, d.offset]).filter((v): v is number => v != null)
    if (vals.length === 0) return [0, 5]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.15 || 0.2
    return [min - pad, max + pad]
  }, [ycCurveData])

  // Compressed mode max X
  const maxYears = useMemo(() => {
    if (tenors.length === 0) return 30
    return tenors[tenors.length - 1].years
  }, [tenors])

  // ── Historical Yield Changes (per-tenor × lookback heatmap) ─────────
  const historicalChanges = useMemo(() => {
    const rows = tenors.map(t => {
      const series = data[t.key] || []
      const cells = HIST_LOOKBACKS.map(lb => ({
        lookback: lb.label,
        bps: histLookbackChange(series, lb.tradingDays),
      }))
      return { rowLabel: t.label, cells }
    })

    const colMaxAbs: Record<string, number> = {}
    for (const lb of HIST_LOOKBACKS) {
      let max = 0
      for (const r of rows) {
        const cell = r.cells.find(c => c.lookback === lb.label)
        if (cell?.bps != null && Number.isFinite(cell.bps)) {
          const a = Math.abs(cell.bps)
          if (a > max) max = a
        }
      }
      colMaxAbs[lb.label] = max
    }

    let latestDate = ''
    for (const t of tenors) {
      const s = data[t.key] || []
      if (s.length > 0 && s[s.length - 1].date > latestDate) latestDate = s[s.length - 1].date
    }
    return { rows, colMaxAbs, latestDate }
  }, [data, tenors])

  // ── Yield boxes ─────────────────────────────────────────────────────
  const currentYields = useMemo(() => {
    return tenors.map(tenor => {
      const series = data[tenor.key] || []
      if (series.length < 2) return { ...tenor, current: null as number | null, change: null as number | null }
      const current = series[series.length - 1].value
      const prior = series[series.length - 2].value
      return { ...tenor, current, change: current - prior }
    })
  }, [data, tenors])

  // ── Spreads ─────────────────────────────────────────────────────────
  const spreadDefs = useMemo(() => buildSpreads(prefix, availableKeys), [prefix, availableKeys])

  const currentSpreads = useMemo(() => {
    return spreadDefs.map(spread => {
      const longSeries = data[spread.long] || []
      const shortSeries = data[spread.short] || []
      if (longSeries.length < 2 || shortSeries.length < 2) return { ...spread, current: null as number | null, change: null as number | null }
      const lc = longSeries[longSeries.length - 1].value
      const sc = shortSeries[shortSeries.length - 1].value
      const lp = longSeries[longSeries.length - 2].value
      const sp = shortSeries[shortSeries.length - 2].value
      const current = (lc - sc) * 100
      const prior = (lp - sp) * 100
      return { ...spread, current, change: current - prior }
    })
  }, [data, spreadDefs])

  // ── Butterflies ─────────────────────────────────────────────────────
  const butterflyDefs = useMemo(() => buildButterflies(prefix, availableKeys), [prefix, availableKeys])

  const currentButterflies = useMemo(() => {
    return butterflyDefs.map(fly => {
      const lowS = data[fly.low] || []
      const midS = data[fly.middle] || []
      const highS = data[fly.high] || []
      if (lowS.length < 2 || midS.length < 2 || highS.length < 2) return { ...fly, current: null as number | null, change: null as number | null }
      const cur = (2 * midS[midS.length - 1].value - lowS[lowS.length - 1].value - highS[highS.length - 1].value) * 100
      const prev = (2 * midS[midS.length - 2].value - lowS[lowS.length - 2].value - highS[highS.length - 2].value) * 100
      return { ...fly, current: cur, change: cur - prev }
    })
  }, [data, butterflyDefs])

  // ── Interactive chart data ──────────────────────────────────────────
  const spreadChartData = useMemo((): SpreadChartPoint[] => {
    if (!selection || selection.type !== 'spread') return []
    const shortS = data[selection.shortKey] || []
    const longS = data[selection.longKey] || []
    if (shortS.length === 0 || longS.length === 0) return []
    const full = buildSpreadChartData(shortS, longS, regimeLookback)
    return filterByRange(full, chartRange)
  }, [selection, data, chartRange, regimeLookback])

  const lineChartData = useMemo((): { date: string; value: number }[] => {
    if (!selection) return []

    if (selection.type === 'yield') {
      return filterByRange(data[selection.key] || [], chartRange)
    }

    if (selection.type === 'butterfly') {
      const lowS = data[selection.lowKey] || []
      const midS = data[selection.middleKey] || []
      const highS = data[selection.highKey] || []
      const midMap = new Map(midS.map(p => [p.date, p.value]))
      const highMap = new Map(highS.map(p => [p.date, p.value]))
      const points: { date: string; value: number }[] = []
      for (const p of lowS) {
        const mv = midMap.get(p.date)
        const hv = highMap.get(p.date)
        if (mv != null && hv != null) points.push({ date: p.date, value: (2 * mv - p.value - hv) * 100 })
      }
      return filterByRange(points, chartRange)
    }

    return []
  }, [selection, data, chartRange])

  // ── Default selection ───────────────────────────────────────────────
  const activeSelection = selection ?? (tenors.length > 0 ? { type: 'yield' as const, key: tenors[0].key, label: tenors[0].label } : null)

  // ── Render ─────────────────────────────────────────────────────────

  if (error) return <div className={styles.error}>{error}</div>

  return (
    <section className={styles.section}>
      {/* ═══ Yield Curve Chart ═══ */}
      <div className={styles.ustDashboard}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>{displayName.toUpperCase()}</div>
          <div className={styles.ustYcControls}>
            <label className={styles.ustLookbackWrap}>
              <span className={styles.ustLookbackLabel}>t −</span>
              <input
                className={styles.laborInput}
                type="number"
                min="0"
                value={ycLookback}
                onChange={(e) => setYcLookback(Math.max(0, parseInt(e.target.value) || 1))}
                style={{ width: '40px' }}
              />
            </label>
            <button
              onClick={() => setYcCompressed(v => !v)}
              style={{
                background: ycCompressed ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                border: `1px solid ${ycCompressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: ycCompressed ? '#60a5fa' : '#728197',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600,
                padding: '3px 10px', cursor: 'pointer', borderRadius: '2px',
              }}
            >
              COMPRESSED
            </button>
          </div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} LATEST: {ycLatestDate} &nbsp;&nbsp; {'\u25CF'} OFFSET: {ycOffsetDate} ({ycLookback} {ycLookback === 1 ? 'day' : 'days'})
        </div>
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={450}>
              <LineChart data={ycCurveData.map((d, idx) => ({ ...d, xVal: ycCompressed ? d.years : idx }))} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis
                  dataKey={ycCompressed ? 'years' : 'label'}
                  type={ycCompressed ? 'number' : 'category'}
                  stroke="#728197"
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  {...(ycCompressed ? {
                    domain: [0, maxYears] as [number, number],
                    ticks: tenors.map(t => t.years),
                    tickFormatter: (v: number) => (v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`),
                  } : {})}
                />
                <YAxis
                  stroke="#728197"
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                  domain={ycYDomain}
                  allowDataOverflow
                />
                <Tooltip
                  contentStyle={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}
                  formatter={(value: unknown, name: string | undefined) => [typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                  labelFormatter={(label: unknown) => {
                    const point = ycCurveData.find(d => ycCompressed ? d.years === label : d.label === label)
                    return point?.label || String(label)
                  }}
                />
                <Line type="monotone" dataKey="latest" name="Latest" stroke="#60a5fa" strokeWidth={2.5} dot={{ r: 3, fill: '#60a5fa' }} connectNulls />
                <Line type="monotone" dataKey="offset" name="Offset" stroke="#888888" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2.5, fill: '#888888' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ycCurveData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="#728197" tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }} />
                <YAxis
                  stroke="#728197"
                  tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                  label={{ value: 'bps', position: 'top', offset: 10, style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' } }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Bar dataKey="delta" radius={[2, 2, 0, 0]}>
                  {ycCurveData.map((d, idx) => (
                    <Cell key={idx} fill={(d.delta ?? 0) >= 0 ? '#4EC9B0' : '#EF5350'} />
                  ))}
                  <LabelList
                    dataKey="delta"
                    content={((props: { x?: number; y?: number; width?: number; height?: number; value?: number | null }) => {
                      const { x = 0, y = 0, width = 0, height = 0, value } = props
                      if (value == null) return null
                      const n = Number(value)
                      return (
                        <text
                          x={x + width / 2} y={n >= 0 ? y - 8 : y + height + 14}
                          textAnchor="middle" fill="#94A3B8" fontSize={11} fontFamily="var(--font-mono)" fontWeight={700}
                        >
                          {n > 0 ? '+' : ''}{n.toFixed(1)}
                        </text>
                      )
                    }) as never}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ═══ Nominal Yields — Historical Changes Heatmap ═══ */}
      {!loading && historicalChanges.rows.length > 0 && (
        <div className={styles.ustDashboard}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>NOMINAL YIELDS</div>
          <div className={styles.ustYcDates}>
            {'●'} AS OF: {historicalChanges.latestDate || '—'}
          </div>
          <div className={styles.histChangesGrid}>
            <div className={styles.histChangesHeaderCell}></div>
            {HIST_LOOKBACKS.map(lb => (
              <div key={lb.label} className={styles.histChangesHeaderCell}>{lb.label}</div>
            ))}
            {historicalChanges.rows.map(row => (
              <Fragment key={row.rowLabel}>
                <div className={styles.histChangesRowLabel}>{row.rowLabel}</div>
                {row.cells.map(cell => {
                  const bg = getCellColor(cell.bps, historicalChanges.colMaxAbs[cell.lookback] ?? 0, 'red-blue')
                  return (
                    <div
                      key={`${row.rowLabel}-${cell.lookback}`}
                      className={styles.histChangesCell}
                      style={bg ? { background: bg } : undefined}
                    >
                      {cell.bps != null && Number.isFinite(cell.bps)
                        ? `${cell.bps >= 0 ? '+' : ''}${cell.bps.toFixed(1)} bps`
                        : '—'}
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Nominal Yields Dashboard ═══ */}
      {!loading && (
        <div className={styles.ustDashboard}>
          <div className={styles.ustSectionLabel}>Nominal Yields</div>
          <div className={styles.ustYieldRow}>
            {currentYields.map(tenor => (
              <div
                key={tenor.key}
                className={`${styles.ustYieldBox} ${activeSelection?.type === 'yield' && activeSelection.key === tenor.key ? styles.ustBoxSelected : ''}`}
                onClick={() => setSelection({ type: 'yield', key: tenor.key, label: tenor.label })}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.ustYieldLabel}>{tenor.label}</div>
                <div className={styles.ustYieldValue}>
                  {tenor.current != null ? tenor.current.toFixed(2) : '—'}%
                </div>
                <div
                  className={styles.ustYieldChange}
                  style={{
                    color: tenor.change != null
                      ? tenor.change > 0 ? '#4EC9B0' : tenor.change < 0 ? '#EF5350' : '#728197'
                      : '#728197',
                  }}
                >
                  {tenor.change != null ? `${tenor.change > 0 ? '+' : ''}${(tenor.change * 100).toFixed(1)}bp` : '—'}
                </div>
              </div>
            ))}
          </div>

          {currentSpreads.length > 0 && (
            <>
              <div className={styles.ustSectionLabel}>Nominal Spreads</div>
              <div className={styles.ustSpreadRow}>
                {currentSpreads.map(spread => (
                  <div
                    key={spread.label}
                    className={`${styles.ustSpreadBox} ${activeSelection?.type === 'spread' && activeSelection.label === spread.label ? styles.ustBoxSelected : ''}`}
                    onClick={() => setSelection({ type: 'spread', label: spread.label, longKey: spread.long, shortKey: spread.short })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustSpreadLabel}>{spread.label}</div>
                    <div className={styles.ustSpreadValue} style={{
                      color: spread.current != null ? spread.current > 0 ? '#4EC9B0' : spread.current < 0 ? '#EF5350' : '#e2e8f0' : '#728197',
                    }}>
                      {spread.current != null ? `${spread.current > 0 ? '+' : ''}${spread.current.toFixed(1)}bp` : '—'}
                    </div>
                    <div className={styles.ustSpreadChange} style={{
                      color: spread.change != null ? spread.change > 0 ? '#4EC9B0' : spread.change < 0 ? '#EF5350' : '#728197' : '#728197',
                    }}>
                      {spread.change != null ? `${spread.change > 0 ? '+' : ''}${spread.change.toFixed(1)}bp` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {currentButterflies.length > 0 && (
            <>
              <div className={styles.ustSectionLabel}>Butterflies</div>
              <div className={styles.butterflyRow}>
                {currentButterflies.map(fly => (
                  <div
                    key={fly.label}
                    className={`${styles.ustSpreadBox} ${activeSelection?.type === 'butterfly' && activeSelection.label === fly.label ? styles.ustBoxSelected : ''}`}
                    onClick={() => setSelection({ type: 'butterfly', label: fly.label, lowKey: fly.low, middleKey: fly.middle, highKey: fly.high })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className={styles.ustSpreadLabel} style={{ color: '#60a5fa' }}>{fly.label}</div>
                    <div className={styles.ustSpreadValue} style={{
                      color: fly.current != null ? fly.current > 0 ? '#4EC9B0' : fly.current < 0 ? '#EF5350' : '#e2e8f0' : '#728197',
                    }}>
                      {fly.current != null ? `${fly.current > 0 ? '+' : ''}${fly.current.toFixed(1)}bp` : '—'}
                    </div>
                    <div className={styles.ustSpreadChange} style={{
                      color: fly.change != null ? fly.change > 0 ? '#4EC9B0' : fly.change < 0 ? '#EF5350' : '#728197' : '#728197',
                    }}>
                      {fly.change != null ? `${fly.change > 0 ? '+' : ''}${fly.change.toFixed(1)}bp` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ═══ Interactive Chart ═══ */}
          {activeSelection && (
            <>
              <div className={styles.ustChartTitle}>
                {activeSelection.type === 'yield'
                  ? `${activeSelection.label} Yield`
                  : activeSelection.type === 'butterfly'
                    ? `${activeSelection.label} butterfly`
                    : `${activeSelection.label} spread`}
              </div>
              <div className={styles.ustChartControls}>
                <div className={styles.ustRangeBar}>
                  {['3m', '6m', '1y', '5y', '10y', 'all'].map((range, idx) => (
                    <button
                      key={range}
                      className={`${styles.fvmRangeBtn} ${chartRange === range ? styles.fvmRangeBtnActive : ''}`}
                      onClick={() => setChartRange(range)}
                      style={{
                        border: `1px solid ${chartRange === range ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                        ...(idx > 0 ? { borderLeft: 'none' } : {}),
                        fontSize: '0.75rem', padding: '4px 10px',
                      }}
                    >
                      {range.toUpperCase()}
                    </button>
                  ))}
                </div>
                {activeSelection.type === 'spread' && (
                  <label className={styles.ustLookbackWrap}>
                    <span className={styles.ustLookbackLabel}>Lookback (days):</span>
                    <input
                      className={styles.laborInput}
                      type="number"
                      min="1"
                      value={regimeLookback}
                      onChange={(e) => setRegimeLookback(Math.max(1, parseInt(e.target.value, 10) || 20))}
                      style={{ width: '50px' }}
                    />
                  </label>
                )}
              </div>

              {activeSelection.type === 'spread' && (
                <>
                  <div className={styles.ustRegimeLegend}>
                    {Object.entries(REGIME_COLORS).filter(([n]) => n !== 'Neutral').map(([name, color]) => (
                      <span key={name} className={styles.ustRegimeLegendItem}>
                        <span className={styles.ustRegimeSwatch} style={{ background: color }} />
                        {name}
                      </span>
                    ))}
                    <span className={styles.ustRegimeLegendItem}>
                      <span className={styles.ustRegimeSwatch} style={{ background: '#ffffff', height: '2px', borderRadius: '1px' }} />
                      {activeSelection.label}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart data={spreadChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date" stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={fmtMonth}
                        interval="preserveStartEnd" minTickGap={60}
                      />
                      <YAxis
                        stroke="#728197"
                        tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                        tickFormatter={(v: number) => `${v.toFixed(0)}bp`}
                      />
                      <Tooltip
                        contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                        labelStyle={{ color: '#94A3B8' }}
                        formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)}bp` : '—')}
                        labelFormatter={(label, payload) => {
                          const regime = (payload?.[0]?.payload as SpreadChartPoint | undefined)?.regime
                          return `${label}${regime ? ` — ${regime}` : ''}`
                        }}
                      />
                      <Bar dataKey="spread" barSize={3}>
                        {spreadChartData.map((point, idx) => (
                          <Cell key={idx} fill={point.regime ? (REGIME_COLORS[point.regime] || '#728197') : '#728197'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="spread" stroke="#ffffff" strokeWidth={1.5} dot={false} />
                      <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </>
              )}

              {activeSelection.type !== 'spread' && (
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart data={lineChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date" stroke="#728197"
                      tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={fmtMonth}
                      interval="preserveStartEnd" minTickGap={60}
                    />
                    <YAxis
                      stroke="#728197"
                      tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                      tickFormatter={(v: number) => activeSelection.type === 'yield' ? `${v.toFixed(2)}%` : `${v.toFixed(0)}bp`}
                      domain={['auto', 'auto']}
                    />
                    {activeSelection.type === 'butterfly' && <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />}
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      formatter={(value: unknown) => (typeof value === 'number' ? (activeSelection.type === 'yield' ? `${value.toFixed(2)}%` : `${value.toFixed(1)}bp`) : '—')}
                    />
                    <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    <Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
