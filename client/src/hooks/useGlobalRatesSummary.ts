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
  regime10s30s: CurveRegimeName | null
  nextMove: NextMove
  terminalMinusOcr: number | null
  frontMinus12m: number | null
}

export interface RatesSummaryResponse {
  asOfDate: string
  yieldLookbackDate: string
  regimeLookbackDate: string
  yieldLookback: string
  regimeLookback: string
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
