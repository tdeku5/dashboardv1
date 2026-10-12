import { useEffect, useState } from 'react'

export type CurveRegimeName =
  | 'Bull Steepener' | 'Bear Steepener' | 'Steepener Twist'
  | 'Bull Flattener' | 'Bear Flattener' | 'Flattener Twist'
  | 'Neutral'

export type NextMove = 'HIKE' | 'CUT' | 'UNCH' | null

export interface RatesSummaryRow {
  country: string
  delta2Y: number | null
  delta5Y: number | null
  delta10Y: number | null
  delta30Y: number | null
  regime2s10s: CurveRegimeName | null
  /** Spread Δ in bps over the REGIME lookback — the number behind the label
   *  to its left, not the yield-Δ window. */
  delta2s10s: number | null
  regime10s30s: CurveRegimeName | null
  delta10s30s: number | null
  nextMove: NextMove
  terminalMinusOcr: number | null
  /** Implied policy rate at curveDate+6M minus terminal, bps. Null when the
   *  strip does not reach the horizon — never 0. */
  fwd6mMinusTerminal: number | null
  fwd12mMinusTerminal: number | null
}

export interface RatesSummaryResponse {
  asOfDate: string
  yieldLookbackDate: string
  regimeLookbackDate: string
  yieldLookback: string
  regimeLookback: string
  /** Trading days in the regime window. Drives the Δ column header labels, so
   *  the label can never disagree with the data it describes. */
  regimeLookbackDays: number
  /** Strip date the forward horizons were anchored to (not the wall clock). */
  curveDate: string
  fwd6mDate: string
  fwd12mDate: string
  rows: RatesSummaryRow[]
}

export interface GlobalRatesSummaryData {
  loading: boolean
  error: string | null
  data: RatesSummaryResponse | null
}

export function useGlobalRatesSummary(
  yieldLookback: string,
  regimeLookback: string,
): GlobalRatesSummaryData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RatesSummaryResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const url = `/api/global/rates-summary?yieldLookback=${encodeURIComponent(yieldLookback)}&regimeLookback=${encodeURIComponent(regimeLookback)}`
    fetch(url)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as RatesSummaryResponse
      })
      .then(json => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [yieldLookback, regimeLookback])

  return { loading, error, data }
}
