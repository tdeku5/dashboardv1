import { useEffect, useState } from 'react'

export type ContribLookbackKey = '1d' | '1w' | '2w' | '1m' | '3m' | '6m' | '1y'
export type ContribRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export interface ContributionSeriesRow {
  date: string
  spy_return: number
  contributions: Record<string, number>
  closes: Record<string, number>
}

export interface ContributionResponse {
  asOfDate: string | null
  lookback: ContribLookbackKey
  lookbackDays: number
  range: ContribRangeKey
  rangeStartDate: string | null
  rangeEndDate: string | null
  weightsAsOf: string
  weights: Record<string, number>
  series: ContributionSeriesRow[]
  summary: {
    spy_return_total: number | null
    sector_returns_total: Record<string, number | null>
    sector_contributions_total: Record<string, number | null>
  }
}

interface HookResult {
  loading: boolean
  error: string | null
  data: ContributionResponse | null
}

export function useSectorContribution(
  lookback: ContribLookbackKey,
  range: ContribRangeKey,
): HookResult {
  const [data, setData] = useState<ContributionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ lookback, range })

    fetch(`/api/equities/us/sector-attribution-contribution?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ContributionResponse
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [lookback, range])

  return { loading, error, data }
}
