export type CurveRegime =
  | 'Bull Steepener'
  | 'Bear Steepener'
  | 'Steepener Twist'
  | 'Bull Flattener'
  | 'Bear Flattener'
  | 'Flattener Twist'
  | 'Neutral'

export function classifyRegime(
  shortChange: number,
  longChange: number,
  spreadChange: number,
): CurveRegime {
  if (spreadChange > 0) {
    if (shortChange < 0 && longChange < 0) return 'Bull Steepener'
    if (shortChange > 0 && longChange > 0) return 'Bear Steepener'
    return 'Steepener Twist'
  }
  if (spreadChange < 0) {
    if (shortChange < 0 && longChange < 0) return 'Bull Flattener'
    if (shortChange > 0 && longChange > 0) return 'Bear Flattener'
    return 'Flattener Twist'
  }
  return 'Neutral'
}

export const REGIME_COLORS: Record<string, string> = {
  'Bull Steepener': '#66bb6a',
  'Bear Steepener': '#c62828',
  'Steepener Twist': '#ffee58',
  'Bull Flattener': '#42a5f5',
  'Bear Flattener': '#ab47bc',
  'Flattener Twist': '#ff9100',
  'Neutral': '#728197',
}

export interface SpreadChartPoint {
  date: string
  spread: number
  shortYield: number
  longYield: number
  regime: CurveRegime | null
}

export function buildSpreadChartData(
  shortSeries: { date: string; value: number }[],
  longSeries: { date: string; value: number }[],
  regimeLookback: number,
): SpreadChartPoint[] {
  const shortMap = new Map(shortSeries.map(p => [p.date, p.value]))
  const aligned = longSeries
    .filter(p => shortMap.has(p.date))
    .map(p => ({
      date: p.date,
      shortYield: shortMap.get(p.date)!,
      longYield: p.value,
      spread: (p.value - shortMap.get(p.date)!) * 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return aligned.map((point, idx) => {
    const lookbackIdx = idx - regimeLookback
    if (lookbackIdx < 0) {
      return { ...point, regime: null }
    }
    const prior = aligned[lookbackIdx]
    return {
      ...point,
      regime: classifyRegime(
        point.shortYield - prior.shortYield,
        point.longYield - prior.longYield,
        point.spread - prior.spread,
      ),
    }
  })
}

export interface CreditRegimePoint {
  date: string
  oas: number
  yield2y: number
  yield10y: number
  roc: number | null
  regime: CurveRegime | null
}

// Aligns a credit-spread (OAS) series to a 2Y/10Y yield pair and tags each
// session with the prevailing 2s10s curve regime over `regimeLookback`
// sessions, plus the point change in OAS (bps) over `rocLookback` sessions.
// Both the level chart (dataKey="oas") and the rate-of-change chart
// (dataKey="roc") read the same array. Sessions without enough prior history
// carry regime=null (rendered neutral) / roc=null (no bar). Output is filtered
// to dates >= `cutoff` (pass null for no cutoff). Reuses classifyRegime so the
// EU Credit tab stays identical to the US one — only the inputs differ.
export function buildCreditRegimeData(
  hyOas: { date: string; value: number }[],
  short: { date: string; value: number }[],
  long: { date: string; value: number }[],
  regimeLookback: number,
  rocLookback: number,
  cutoff: string | null,
): CreditRegimePoint[] {
  const map2 = new Map(short.map(p => [p.date, p.value]))
  const map10 = new Map(long.map(p => [p.date, p.value]))

  const aligned = hyOas
    .filter(p => map2.has(p.date) && map10.has(p.date))
    .map(p => ({ date: p.date, oas: p.value, yield2y: map2.get(p.date)!, yield10y: map10.get(p.date)! }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return aligned
    .map((point, idx) => {
      let regime: CurveRegime | null = null
      const regimeIdx = idx - regimeLookback
      if (regimeIdx >= 0) {
        const prior = aligned[regimeIdx]
        regime = classifyRegime(
          point.yield2y - prior.yield2y,
          point.yield10y - prior.yield10y,
          (point.yield10y - point.yield2y) - (prior.yield10y - prior.yield2y),
        )
      }
      let roc: number | null = null
      const rocIdx = idx - rocLookback
      if (rocIdx >= 0) roc = (point.oas - aligned[rocIdx].oas) * 100
      return { ...point, regime, roc }
    })
    .filter(p => !cutoff || p.date >= cutoff)
}
