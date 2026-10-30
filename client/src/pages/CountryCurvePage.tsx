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
import { AcmChartFrame, AcmPanel, fmtSignedFixed, niceAxis, roundForDisplay, signColor } from '../components/acm'
import { chartTheme, referenceLines } from '../components/acm/chartTheme'
import { CURVE_COMPARE_COLORS, REGIME_OVERLAY_LINE, UST_FAMILY_COLORS } from '../constants/identityColors'
import { useTvYieldCurve } from '../hooks/useTvYieldCurve'
import { buildSpreadChartData, type SpreadChartPoint } from '../lib/curveRegime'
import { getCellColor } from '../lib/cellColor'
import { HIST_LOOKBACKS, histLookbackChange } from '../lib/historicalChanges'
import { fmtMonthYearTick, rangeToggle, regimeColor, regimeLegend, renderDeltaLabel, ustChangeClass, ustLevelClass, UstTile } from './ratesShared'
import styles from './STIRDashboardPage.module.css'

// R5a: the per-market twin of US UST CURVE, on the same primitives and rules —
// yields are LEVELS (identity colour), spreads / butterflies are LEVELS (plain),
// every CHANGE follows rule 6 (increase = red), the historical-changes grid is
// the cellColor named heatmap (red / blue, text primary). Signed values go
// through fmtSignedFixed (near-zero rule).

/** Tiles per row before wrapping. */
const TILE_COLS_MAX = 8

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

  // Curve y axis: the 15% padded range, snapped to even 2dp ticks (niceAxis).
  const ycYAxis = useMemo(() => {
    const vals = ycCurveData.flatMap(d => [d.latest, d.offset]).filter((v): v is number => v != null)
    if (vals.length === 0) return niceAxis([0, 5], { dp: 2 })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.15 || 0.2
    return niceAxis([min - pad, max + pad], { dp: 2 })
  }, [ycCurveData])
  // Change-vs-offset bars: whole-bp ticks, 0 in range (no '-1,-1,-0' labels).
  const deltaYAxis = useMemo(() => niceAxis(ycCurveData.map(d => d.delta).filter((v): v is number => v != null), { dp: 0, includeZero: true }), [ycCurveData])

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

  if (error) return <div className={styles.stateError}>{error}</div>

  const tileCols = (n: number) => ({ ['--ust-cols' as string]: String(Math.min(Math.max(n, 1), TILE_COLS_MAX)) })
  const dateLabel = (label: unknown, payload: ReadonlyArray<{ payload?: unknown }> | undefined) => {
    const regime = (payload?.[0]?.payload as SpreadChartPoint | undefined)?.regime
    return `${String(label)}${regime ? ` — ${regime}` : ''}`
  }

  return (
    <div className={styles.ustStack}>
      {/* ═══ Yield curve + change vs offset ═══ */}
      {/* The curve frame (and its controls) renders while loading, as before. */}
          <AcmChartFrame
            title={displayName.toUpperCase()}
            subtitle={`● LATEST: ${ycLatestDate}   ● OFFSET: ${ycOffsetDate} (${ycLookback} ${ycLookback === 1 ? 'day' : 'days'})`}
            legend={[
              { label: 'Latest', color: CURVE_COMPARE_COLORS.yieldLatest },
              { label: 'Offset', color: CURVE_COMPARE_COLORS.benchmark, dashed: true },
            ]}
            actions={(
              <>
                <label className={styles.ustLookback}>
                  <span>t −</span>
                  <input
                    className={`${styles.laborInput} ${styles.inputNarrow}`}
                    type="number"
                    min="0"
                    value={ycLookback}
                    onChange={(e) => setYcLookback(Math.max(0, parseInt(e.target.value) || 1))}
                  />
                </label>
                <button
                  type="button"
                  className={`${styles.toggleButton} ${ycCompressed ? styles.toggleButtonActive : ''}`}
                  aria-pressed={ycCompressed}
                  onClick={() => setYcCompressed(v => !v)}
                >
                  COMPRESSED
                </button>
              </>
            )}
            height={450}
          >
            {loading ? <div className={styles.stateMsg}>Loading…</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ycCurveData.map((d, idx) => ({ ...d, xVal: ycCompressed ? d.years : idx }))} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
                <CartesianGrid {...chartTheme.grid} />
                <XAxis
                  dataKey={ycCompressed ? 'years' : 'label'}
                  type={ycCompressed ? 'number' : 'category'}
                  {...chartTheme.xAxis}
                  {...(ycCompressed ? {
                    domain: [0, maxYears] as [number, number],
                    ticks: tenors.map(t => t.years),
                    tickFormatter: (v: number) => (v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`),
                  } : {})}
                />
                <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={ycYAxis.domain} ticks={ycYAxis.ticks} />
                <Tooltip
                  {...chartTheme.tooltip}
                  formatter={(value: unknown, name: string | undefined) => [typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                  labelFormatter={(label: unknown) => {
                    const point = ycCurveData.find(d => ycCompressed ? d.years === label : d.label === label)
                    return point?.label || String(label)
                  }}
                />
                <Line type="monotone" dataKey="latest" name="Latest" stroke={CURVE_COMPARE_COLORS.yieldLatest} strokeWidth={2.5} dot={{ r: 3, fill: CURVE_COMPARE_COLORS.yieldLatest }} connectNulls />
                <Line type="monotone" dataKey="offset" name="Offset" stroke={CURVE_COMPARE_COLORS.benchmark} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2.5, fill: CURVE_COMPARE_COLORS.benchmark }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            )}
          </AcmChartFrame>

          {!loading && (
          <AcmChartFrame
            title="Change vs offset (bps)"
            legend={[
              { label: 'Yield up', color: signColor('acm-negative') },
              { label: 'Yield down', color: signColor('acm-positive') },
            ]}
            height={200}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ycCurveData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid {...chartTheme.grid} vertical={false} />
                <XAxis dataKey="label" {...chartTheme.xAxis} />
                <YAxis {...chartTheme.yAxis} domain={deltaYAxis.domain} ticks={deltaYAxis.ticks} tickFormatter={(v: number) => `${v.toFixed(0)}`} label={{ ...chartTheme.axisLabel, value: 'bps', position: 'top', offset: 10 }} />
                <ReferenceLine y={0} {...referenceLines.zero} />
                <Bar dataKey="delta" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {ycCurveData.map((d, idx) => {
                    const shown = roundForDisplay(d.delta ?? 0, 1) // the label's 1dp: a 0.0 change gets the neutral fill
                    return <Cell key={idx} fill={shown > 0 ? signColor('acm-negative') : shown < 0 ? signColor('acm-positive') : 'var(--acm-text-tertiary)'} />
                  })}
                  <LabelList dataKey="delta" content={renderDeltaLabel} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </AcmChartFrame>
          )}

      {/* ═══ Nominal yields — historical changes (the cellColor grid, red / blue) ═══ */}
      {!loading && historicalChanges.rows.length > 0 && (
        <AcmPanel title="NOMINAL YIELDS">
          <div className={styles.ustAsOf}>● AS OF: {historicalChanges.latestDate || '—'}</div>
          <div className={`${styles.chgGrid} ${styles.chgGridNominal}`}>
            <div className={styles.chgHead}></div>
            {HIST_LOOKBACKS.map(lb => (
              <div key={lb.label} className={styles.chgHead}>{lb.label}</div>
            ))}
            {historicalChanges.rows.map(row => (
              <Fragment key={row.rowLabel}>
                <div className={styles.chgRowLabel}>{row.rowLabel}</div>
                {row.cells.map(cell => {
                  // a change that prints as 0.0 gets no fill (near-zero rule)
                  const bg = getCellColor(cell.bps != null && roundForDisplay(cell.bps, 1) === 0 ? 0 : cell.bps, historicalChanges.colMaxAbs[cell.lookback] ?? 0, 'red-blue')
                  return (
                    <div
                      key={`${row.rowLabel}-${cell.lookback}`}
                      className={styles.chgCell}
                      data-cell-color
                      style={bg ? { background: bg } : undefined}
                    >
                      {cell.bps != null && Number.isFinite(cell.bps) ? `${fmtSignedFixed(cell.bps, 1)} bps` : '—'}
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </AcmPanel>
      )}

      {/* ═══ Nominal yields, spreads, butterflies + selected-series chart ═══ */}
      {!loading && (
        <AcmPanel title="Nominal yields">
          <div className={`${styles.ustTiles} ${styles.ustTilesN}`} style={tileCols(currentYields.length)}>
            {currentYields.map(tenor => (
              <UstTile
                key={tenor.key}
                family={UST_FAMILY_COLORS.nominal}
                label={tenor.label}
                value={`${tenor.current != null ? tenor.current.toFixed(2) : '—'}%`}
                valueIsFamily
                change={tenor.change != null ? fmtSignedFixed(tenor.change * 100, 1, 'bp') : '—'}
                changeClass={ustChangeClass(tenor.change == null ? null : tenor.change * 100)}
                selected={activeSelection?.type === 'yield' && activeSelection.key === tenor.key}
                onSelect={() => setSelection({ type: 'yield', key: tenor.key, label: tenor.label })}
              />
            ))}
          </div>

          {currentSpreads.length > 0 && (
            <>
              <div className={styles.ustSubLabel}>Nominal Spreads</div>
              <div className={`${styles.ustTiles} ${styles.ustTilesN}`} style={tileCols(currentSpreads.length)}>
                {currentSpreads.map(spread => (
                  <UstTile
                    key={spread.label}
                    family={UST_FAMILY_COLORS.nominal}
                    label={spread.label}
                    value={spread.current != null ? fmtSignedFixed(spread.current, 1, 'bp') : '—'}
                    valueClass={ustLevelClass(spread.current)}
                    change={spread.change != null ? fmtSignedFixed(spread.change, 1, 'bp') : '—'}
                    changeClass={ustChangeClass(spread.change)}
                    selected={activeSelection?.type === 'spread' && activeSelection.label === spread.label}
                    onSelect={() => setSelection({ type: 'spread', label: spread.label, longKey: spread.long, shortKey: spread.short })}
                  />
                ))}
              </div>
            </>
          )}

          {currentButterflies.length > 0 && (
            <>
              <div className={styles.ustSubLabel}>Butterflies</div>
              <div className={`${styles.ustTiles} ${styles.ustTilesN}`} style={tileCols(currentButterflies.length)}>
                {currentButterflies.map(fly => (
                  <UstTile
                    key={fly.label}
                    family={UST_FAMILY_COLORS.nominal}
                    label={fly.label}
                    value={fly.current != null ? fmtSignedFixed(fly.current, 1, 'bp') : '—'}
                    valueClass={ustLevelClass(fly.current)}
                    change={fly.change != null ? fmtSignedFixed(fly.change, 1, 'bp') : '—'}
                    changeClass={ustChangeClass(fly.change)}
                    selected={activeSelection?.type === 'butterfly' && activeSelection.label === fly.label}
                    onSelect={() => setSelection({ type: 'butterfly', label: fly.label, lowKey: fly.low, middleKey: fly.middle, highKey: fly.high })}
                  />
                ))}
              </div>
            </>
          )}

          {activeSelection && (
            <AcmChartFrame
              title={activeSelection.type === 'yield'
                ? `${activeSelection.label} Yield`
                : activeSelection.type === 'butterfly'
                  ? `${activeSelection.label} butterfly`
                  : `${activeSelection.label} yield curve regimes`}
              legend={activeSelection.type === 'spread'
                ? regimeLegend(activeSelection.label)
                : [{ label: activeSelection.label, color: UST_FAMILY_COLORS.nominal }]}
              actions={(
                <>
                  {rangeToggle(chartRange, setChartRange)}
                  {activeSelection.type === 'spread' && (
                    <label className={styles.ustLookback}>
                      <span>Lookback (days):</span>
                      <input
                        className={styles.laborInput}
                        type="number"
                        min="1"
                        value={regimeLookback}
                        onChange={(e) => setRegimeLookback(Math.max(1, parseInt(e.target.value, 10) || 20))}
                      />
                    </label>
                  )}
                </>
              )}
              height={420}
            >
              <ResponsiveContainer width="100%" height="100%">
                {activeSelection.type === 'spread' ? (
                  <ComposedChart data={spreadChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="date" {...chartTheme.xAxis} tickFormatter={fmtMonthYearTick} interval="preserveStartEnd" minTickGap={60} />
                    <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => `${v.toFixed(0)}bp`} />
                    <Tooltip
                      {...chartTheme.tooltip}
                      cursor={chartTheme.barTooltipCursor}
                      formatter={(value: unknown) => (typeof value === 'number' ? fmtSignedFixed(value, 1, 'bp') : '—')}
                      labelFormatter={dateLabel}
                    />
                    <Bar dataKey="spread" barSize={3}>
                      {spreadChartData.map((point, idx) => (
                        <Cell key={idx} fill={regimeColor(point.regime)} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="spread" stroke={REGIME_OVERLAY_LINE} strokeWidth={1.5} dot={false} />
                    <Brush dataKey="date" {...chartTheme.brush} />
                  </ComposedChart>
                ) : (
                  <LineChart data={lineChartData} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="date" {...chartTheme.xAxis} tickFormatter={fmtMonthYearTick} interval="preserveStartEnd" minTickGap={60} />
                    <YAxis {...chartTheme.yAxis} tickFormatter={(v: number) => activeSelection.type === 'yield' ? `${v.toFixed(2)}%` : `${v.toFixed(0)}bp`} domain={['auto', 'auto']} />
                    {activeSelection.type === 'butterfly' && <ReferenceLine y={0} {...referenceLines.zero} />}
                    <Tooltip
                      {...chartTheme.tooltip}
                      formatter={(value: unknown) => (typeof value === 'number' ? (activeSelection.type === 'yield' ? `${value.toFixed(2)}%` : fmtSignedFixed(value, 1, 'bp')) : '—')}
                    />
                    <Line type="monotone" dataKey="value" stroke={UST_FAMILY_COLORS.nominal} strokeWidth={2} dot={false} />
                    <Brush dataKey="date" {...chartTheme.brush} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </AcmChartFrame>
          )}
        </AcmPanel>
      )}
    </div>
  )
}
