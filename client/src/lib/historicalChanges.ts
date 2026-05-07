// Shared lookback-window definitions and helpers for the per-tenor
// "historical yield changes" heatmap that ships on both the US UST tab
// and each country curve page.

export interface HistLookback {
  label: string
  tradingDays: number | null  // null = YTD (special-cased in histLookbackChange)
}

export const HIST_LOOKBACKS: ReadonlyArray<HistLookback> = [
  { label: '5D',  tradingDays: 5 },
  { label: '1M',  tradingDays: 21 },
  { label: '3M',  tradingDays: 63 },
  { label: '6M',  tradingDays: 126 },
  { label: 'YTD', tradingDays: null },
] as const

export interface HistSeriesPoint { date: string; value: number }

// Returns the bps change for a `{date, value}` series over `tradingDays`
// trading days, or YTD when `tradingDays` is null. Multiplies by 100 to
// convert from percentage points (the FRED/tv_series unit) to bps.
//
// Returns null when:
// - the series is empty
// - the series is shorter than `tradingDays + 1` rows
// - YTD is requested but no row from the current calendar year exists
export function histLookbackChange(
  series: HistSeriesPoint[],
  tradingDays: number | null,
): number | null {
  if (!series || series.length === 0) return null
  const latestIdx = series.length - 1
  const latest = series[latestIdx].value

  if (tradingDays === null) {
    const currentYear = new Date(series[latestIdx].date).getUTCFullYear()
    const firstOfYear = series.find(p => new Date(p.date).getUTCFullYear() === currentYear)
    if (!firstOfYear) return null
    return (latest - firstOfYear.value) * 100
  }

  if (latestIdx - tradingDays < 0) return null
  const prior = series[latestIdx - tradingDays].value
  return (latest - prior) * 100
}
