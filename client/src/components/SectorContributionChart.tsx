import { useMemo, useState } from 'react'
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SECTORS } from '../constants/sectors'
import { SECTOR_COLORS, SECTOR_SHORT_NAME, INDEX_COLOR } from '../constants/sectorColors'
import {
  useSectorContribution,
  type ContribLookbackKey,
  type ContribRangeKey,
} from '../hooks/useSectorContribution'
import { SectorStatTiles, type SectorTileInput } from './SectorStatTiles'
import { sectorLegendItems } from './SectorLegendToggle'
import { AcmChartFrame, niceAxis } from './acm'
import { chartTheme } from './acm/chartTheme'
import { ButtonRow, EqState, EqTooltip, EqWarning, eqStyles, fmtSignedPct } from '../pages/equitiesShared'

// E1: stacked bars are sector CONTRIBUTIONS in each sector's registry identity
// colour; the line is SPY's rolling return in the index identity colour. No
// sign colour on the chart. Tooltip values plain (contribution classification
// pending the user's ruling; see SectorStatTiles). Y axis: niceAxis over the
// visible stack totals and SPY line, following the brush.

const LOOKBACKS: ReadonlyArray<{ key: ContribLookbackKey; label: string }> = [
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '2w', label: '2W' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
]

const RANGES: ReadonlyArray<{ key: ContribRangeKey; label: string }> = [
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: '6m',  label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: '15y', label: '15Y' },
  { key: '20y', label: '20Y' },
  { key: 'all', label: 'ALL' },
]

// Approximate trading-day length per range/lookback for the snap-up rule.
// Doesn't need to be exact — just monotonic so we pick the right "smallest
// allowed" range when bumping up.
const RANGE_LENGTH_DAYS: Record<ContribRangeKey, number> = {
  '1m': 21, '3m': 63, '6m': 126, ytd: 130, '1y': 252, '2y': 504,
  '5y': 1260, '10y': 2520, '15y': 3780, '20y': 5040, all: Number.POSITIVE_INFINITY,
}
const LOOKBACK_LENGTH_DAYS: Record<ContribLookbackKey, number> = {
  '1d': 1, '1w': 5, '2w': 10, '1m': 20, '3m': 63, '6m': 126, '1y': 252,
}

// Smallest range key that has length >= the given lookback.
function smallestRangeFitting(lookback: ContribLookbackKey): ContribRangeKey {
  const need = LOOKBACK_LENGTH_DAYS[lookback]
  for (const r of RANGES) {
    if (RANGE_LENGTH_DAYS[r.key] >= need) return r.key
  }
  return 'all'
}

interface FlatRow {
  date: string
  spy_return: number
  [ticker: string]: number | string
}

const CHART_HEIGHT = 540

function fmtPct(v: number | null | undefined, places = 2): string {
  return fmtSignedPct(v, places)
}

interface TooltipPayloadItem {
  dataKey: string
  value: number
  color: string
  name: string
}

interface RechartsTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function ChartTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const spy = payload.find((p) => p.dataKey === 'spy_return')
  const sectorRows = payload
    .filter((p) => p.dataKey !== 'spy_return' && Number.isFinite(p.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const rows = [
    ...(spy ? [{ key: 'spy', name: 'SPY', color: INDEX_COLOR, value: fmtPct(spy.value) }] : []),
    ...sectorRows.map((r) => ({ key: r.dataKey, name: SECTOR_SHORT_NAME[r.dataKey] ?? r.dataKey, color: r.color, value: fmtPct(r.value, 3) })),
  ]
  return <EqTooltip label={label} rows={rows} />
}

export function SectorContributionChart() {
  const [lookback, setLookback] = useState<ContribLookbackKey>('1m')
  const [range, setRange] = useState<ContribRangeKey>('2y')
  const { data, loading, error } = useSectorContribution(lookback, range)
  const [hiddenSectors, setHiddenSectors] = useState<Set<string>>(new Set())
  const [hideIndex, setHideIndex] = useState(false)
  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null)

  // Flatten the API series into the Recharts row shape.
  const flatSeries: FlatRow[] = useMemo(() => {
    if (!data) return []
    return data.series.map((r) => {
      const row: FlatRow = { date: r.date, spy_return: r.spy_return }
      for (const s of SECTORS) row[s.ticker] = r.contributions[s.ticker] ?? 0
      return row
    })
  }, [data])

  // Rightmost visible bar — defaults to the most recent bar; under brush, the
  // brush's right edge.
  const visibleEnd = brushIdx?.end ?? Math.max(0, flatSeries.length - 1)

  // Tiles anchor on the rightmost bar in the visible (or brushed) window — the
  // tile values match what the tooltip shows for that bar. Each bar is the
  // rolling N-day return ending on its date, so the tiles read out "latest
  // rolling-{lookback} reading."
  const visibleStats = useMemo(() => {
    if (!data || data.series.length === 0) {
      return {
        indexReturn: null as number | null,
        tiles: [] as SectorTileInput[],
        anchorDate: null as string | null,
      }
    }

    const anchorIdx = Math.min(visibleEnd, data.series.length - 1)
    const anchorRow = data.series[anchorIdx]
    if (!anchorRow) {
      return { indexReturn: null, tiles: [], anchorDate: null }
    }

    const tiles: SectorTileInput[] = SECTORS.map((s) => {
      const w = data.weights[s.ticker] ?? 0
      const contribution = anchorRow.contributions[s.ticker] ?? 0
      const ret = w > 0 ? contribution / w : 0
      return { ticker: s.ticker, return_: ret, contribution, weight: w }
    })

    return {
      indexReturn: anchorRow.spy_return,
      tiles,
      anchorDate: anchorRow.date,
    }
  }, [data, visibleEnd])

  // Filter tiles to visible (legend-on) sectors.
  const visibleSectorTiles = visibleStats.tiles.filter((t) => !hiddenSectors.has(t.ticker))

  const onLookbackClick = (k: ContribLookbackKey) => {
    setLookback(k)
    setBrushIdx(null)
    // Snap range up if it's now shorter than the lookback.
    const needed = LOOKBACK_LENGTH_DAYS[k]
    if (RANGE_LENGTH_DAYS[range] < needed) {
      setRange(smallestRangeFitting(k))
    }
  }

  const onRangeClick = (k: ContribRangeKey) => {
    setBrushIdx(null)
    // Snap up if the user picked a range shorter than the active lookback.
    const needed = LOOKBACK_LENGTH_DAYS[lookback]
    if (RANGE_LENGTH_DAYS[k] < needed) {
      setRange(smallestRangeFitting(lookback))
    } else {
      setRange(k)
    }
  }

  const toggleSector = (ticker: string) => {
    setHiddenSectors((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  const stale = (() => {
    if (!data?.weightsAsOf || !data?.asOfDate) return false
    const wd = new Date(data.weightsAsOf).getTime()
    const ad = new Date(data.asOfDate).getTime()
    return Number.isFinite(wd) && Number.isFinite(ad)
      ? (ad - wd) / 86_400_000 > 30
      : false
  })()

  const lookbackLabel = LOOKBACKS.find((l) => l.key === lookback)?.label ?? lookback.toUpperCase()
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? range.toUpperCase()

  // Even ticks over what is drawn in the brushed window: each bar's positive
  // and negative stack totals (visible sectors only) and the SPY line.
  const yAxis = useMemo(() => {
    const start = brushIdx?.start ?? 0
    const end = brushIdx?.end ?? flatSeries.length - 1
    const vals: number[] = []
    for (const row of flatSeries.slice(start, end + 1)) {
      let pos = 0, neg = 0
      for (const s of SECTORS) {
        if (hiddenSectors.has(s.ticker)) continue
        const v = row[s.ticker]
        if (typeof v === 'number') { if (v > 0) pos += v; else neg += v }
      }
      vals.push(pos, neg)
      if (!hideIndex) vals.push(row.spy_return)
    }
    return niceAxis(vals, { dp: 1, includeZero: true })
  }, [flatSeries, brushIdx, hiddenSectors, hideIndex])

  const legend = sectorLegendItems({
    hiddenSectors,
    hideIndex,
    onToggleSector: toggleSector,
    onToggleIndex: () => setHideIndex((v) => !v),
  })

  const subtitle = `Rolling ${lookbackLabel}-return decomposition · range: ${rangeLabel}${data?.weightsAsOf ? ` · weights as of ${data.weightsAsOf}${stale ? ' (stale)' : ''}` : ''}`

  return (
    <div className={eqStyles.eqShell}>
      {visibleStats.anchorDate && (
        <div className={eqStyles.eqControlLabel}>tiles: rolling {lookbackLabel} ending {visibleStats.anchorDate}</div>
      )}

      <SectorStatTiles
        indexReturn={visibleStats.indexReturn}
        sectorTiles={visibleSectorTiles}
        topN={6}
      />

      <ButtonRow items={LOOKBACKS} value={lookback} onChange={onLookbackClick} label="LOOKBACK:" />
      <ButtonRow items={RANGES} value={range} onChange={onRangeClick} label="RANGE:" />

      <AcmChartFrame title="SECTOR CONTRIBUTIONS" subtitle={subtitle} legend={legend} height={CHART_HEIGHT}>
        {stale && <EqWarning>Sector weights as of {data?.weightsAsOf} are more than 30 days old.</EqWarning>}
        {loading && <EqState>Loading…</EqState>}
        {error && <EqState error>Failed to load: {error}</EqState>}
        {!loading && !error && flatSeries.length === 0 && (
          <EqState>Insufficient history for selected lookback.</EqState>
        )}
        {!loading && !error && flatSeries.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={flatSeries} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.xAxis} interval="preserveStartEnd" minTickGap={40} />
              <YAxis
                {...chartTheme.yAxis}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                domain={yAxis.domain}
                ticks={yAxis.ticks}
                allowDataOverflow
              />
              <Tooltip content={<ChartTooltip />} cursor={chartTheme.barTooltipCursor} isAnimationActive={false} />
              <ReferenceLine y={0} {...chartTheme.referenceLines.zero} />

              {SECTORS.map((s) => (
                <Bar
                  key={s.ticker}
                  dataKey={s.ticker}
                  stackId="contrib"
                  fill={SECTOR_COLORS[s.ticker]}
                  hide={hiddenSectors.has(s.ticker)}
                  isAnimationActive={false}
                />
              ))}

              <Line
                type="monotone"
                dataKey="spy_return"
                stroke={INDEX_COLOR}
                strokeWidth={2}
                dot={false}
                hide={hideIndex}
                isAnimationActive={false}
              />

              <Brush
                dataKey="date"
                {...chartTheme.brush}
                onChange={(r: { startIndex?: number; endIndex?: number }) => {
                  if (r.startIndex == null || r.endIndex == null) return
                  setBrushIdx({ start: r.startIndex, end: r.endIndex })
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </AcmChartFrame>
    </div>
  )
}
