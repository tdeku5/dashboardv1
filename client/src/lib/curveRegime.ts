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
