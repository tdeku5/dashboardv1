// Shared shell for the non-US FX country pages (UK/EU/CAD/JPY/AUS). Each
// caller passes its model currency + the cross list (oriented so the model
// currency is the numerator of every series). This page then renders:
//
//   1. A returns dashboard (5D/1M/3M/6M/YTD) computed client-side from the
//      ORIENTED series — positive return = the model currency strengthened.
//   2. The CrossesStrengthChart below, on the same data.
//
// Returns logic mirrors server/src/fxPairReturns.ts:
//   - as-of date = min of latest dates across the available pairs (a single
//     stale pair pulls the table back to its last bar)
//   - master calendar = union of all available pairs' dates, truncated at as-of
//   - 5d = trading-day step (as-of − 5 on the master calendar)
//   - 1m/3m/6m = month-back date snapped to the nearest in-calendar trading day
//   - ytd = snapped to prior year's Dec 31
//   - per-row return = (cur − base) / base · 100, computed on the ORIENTED
//     series (so inversion is honored — not just sign-flipped from raw returns)

import { useCallback, useMemo } from 'react'
import type { CrossSpec } from '../components/CrossesStrengthChart'
import { CrossesStrengthChart } from '../components/CrossesStrengthChart'
import { ReturnsHeatmap, type RowGroup } from '../components/ReturnsHeatmap'
import { useTvSeriesMulti } from '../hooks/useTvSeriesMulti'
import type { TvSeriesPoint } from '../hooks/useTvSeries'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import styles from './SectorAttributionPage.module.css'

type Returns = Record<LookbackKey, number | null>

interface ModelRow {
  ticker: string  // display label (e.g. "GBPEUR")
  name: string
  returns: Returns
  currentPrice: number | null
}

interface Props {
  model: string
  crosses: ReadonlyArray<CrossSpec>
  // Optional row-group separators inside the heatmap. EU page uses this to
  // group HUF + PLN under an "EM" header beneath the DM rows.
  rowGroups?: RowGroup[]
}

// ── date utilities (same shape the server uses) ──────────────────────────────

const EMPTY_RETURNS: Returns = { '5d': null, '1m': null, '3m': null, '6m': null, ytd: null }

interface SeriesPoint { date: string; ts: number; close: number }

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function shiftMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 - months, d))
  return dt.toISOString().slice(0, 10)
}

function findOnOrBefore(arr: SeriesPoint[], isoDate: string): SeriesPoint | null {
  let lo = 0, hi = arr.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].date <= isoDate) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best >= 0 ? arr[best] : null
}

function snapDate(distinctAsc: string[], targetIso: string): string | null {
  let lo = 0, hi = distinctAsc.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (distinctAsc[mid] <= targetIso) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best >= 0 ? distinctAsc[best] : null
}

function pctChange(curr: number, base: number): number {
  return Math.round(((curr - base) / base) * 10000) / 100
}

// Apply orientation (invert if needed) AND project to the SeriesPoint shape
// the per-row return computation expects.
function orientSeries(raw: TvSeriesPoint[], invert: boolean): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (const p of raw) {
    const ts = parseInt(p.time, 10)
    if (!Number.isFinite(ts) || p.close == null || p.close <= 0) continue
    const close = invert ? 1 / p.close : p.close
    out.push({ ts, date: tsToDate(ts), close })
  }
  // Sort defensively — the API returns ascending but the orientation step
  // doesn't preserve that ordering guarantee in the type system.
  out.sort((a, b) => a.ts - b.ts)
  return out
}

// ── Component ────────────────────────────────────────────────────────────────

export function ModelCurrencyFxPage({ model, crosses, rowGroups }: Props) {
  const symbols = useMemo(() => crosses.map(c => c.symbol), [crosses])
  const { data: raw, loading, error } = useTvSeriesMulti(symbols)

  // Orient each cross's raw series — this is the single, canonical "model
  // strength" feed used by BOTH the returns table and the chart below.
  const oriented = useMemo(() => {
    const out = new Map<string, SeriesPoint[]>()
    for (const c of crosses) {
      out.set(c.label, orientSeries(raw.get(c.symbol) ?? [], c.invert))
    }
    return out
  }, [raw, crosses])

  // Compute the as-of date + master calendar + returns table once per
  // dataset change. We follow the server's algorithm exactly so the numbers
  // on UK/EU/CAD/JPY/AUS pages line up with how the US page already works.
  const { asOfDate, rows, missingPairs } = useMemo(() => {
    const missing: string[] = []
    const usable: Array<{ spec: CrossSpec; series: SeriesPoint[] }> = []
    for (const c of crosses) {
      const arr = oriented.get(c.label) ?? []
      if (arr.length === 0) missing.push(c.label)
      else usable.push({ spec: c, series: arr })
    }
    if (usable.length === 0) {
      return { asOfDate: null as string | null, rows: [] as ModelRow[], missingPairs: missing }
    }

    // as-of = min(last-dates), so a stale pair pulls the table back rather
    // than silently feeding fresh returns against a stale comparator.
    let asOf: string | null = null
    for (const u of usable) {
      const last = u.series[u.series.length - 1].date
      if (asOf === null || last < asOf) asOf = last
    }
    if (!asOf) return { asOfDate: null, rows: [] as ModelRow[], missingPairs: missing }

    // Master calendar = union of all available dates ≤ as-of.
    const dset = new Set<string>()
    for (const u of usable) for (const r of u.series) if (r.date <= asOf) dset.add(r.date)
    const cal = [...dset].sort()
    const idx = cal.length - 1

    const fiveD = idx - 5 >= 0 ? cal[idx - 5] : cal[0] ?? null
    const oneM  = snapDate(cal, shiftMonths(asOf, 1))
    const threeM = snapDate(cal, shiftMonths(asOf, 3))
    const sixM  = snapDate(cal, shiftMonths(asOf, 6))
    const yr    = parseInt(asOf.slice(0, 4), 10)
    const ytd   = snapDate(cal, `${yr - 1}-12-31`)

    const computed: ModelRow[] = crosses.map(c => {
      const arr = oriented.get(c.label) ?? []
      if (arr.length === 0) {
        return { ticker: c.label, name: c.label, returns: { ...EMPTY_RETURNS }, currentPrice: null }
      }
      const cur = findOnOrBefore(arr, asOf!)
      const r = (date: string | null) => {
        const base = date ? findOnOrBefore(arr, date) : null
        return cur && base ? pctChange(cur.close, base.close) : null
      }
      return {
        ticker: c.label,
        name: c.label,
        returns: {
          '5d': r(fiveD),
          '1m': r(oneM),
          '3m': r(threeM),
          '6m': r(sixM),
          ytd: r(ytd),
        },
        currentPrice: cur ? cur.close : null,
      }
    })

    return { asOfDate: asOf, rows: computed, missingPairs: missing }
  }, [oriented, crosses])

  const accessor = useCallback(
    (row: ModelRow, lb: LookbackKey): number | null => row.returns[lb],
    [],
  )

  if (loading) return <div className={styles.placeholder}>Loading {model} pair returns…</div>
  if (error)   return <div className={styles.placeholder}>Failed to load {model} pairs: {error}</div>
  if (rows.length === 0) {
    return <div className={styles.placeholder}>No {model} pair data available.</div>
  }

  const asOf = asOfDate ?? '—'

  // Side-by-side: dashboard left, crosses chart right. heatmapsRow gives the
  // 1fr 1fr grid with align-items:start so the (shorter) heatmap top-aligns
  // with the (fixed-height) chart panel rather than stretching to match it.
  // The US page does NOT route through this shell, so its three-section
  // layout is unaffected.
  return (
    <div className={styles.heatmapsRow}>
      <ReturnsHeatmap
        title={`${model} CROSSES`}
        subtitle={`as of ${asOf} · all crosses oriented with ${model} as numerator (rising = stronger ${model})`}
        rows={rows}
        valueAccessor={accessor}
        missingTickers={missingPairs.length > 0 ? missingPairs : undefined}
        rowHeaderLabel="Pair"
        rowGroups={rowGroups}
        gradientMode="column"
      />
      <CrossesStrengthChart model={model} crosses={crosses} />
    </div>
  )
}
