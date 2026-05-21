import { useEffect, useState } from 'react'

export interface CavSummaryChanges {
  '1d':  number | null
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  'ytd': number | null
}

export interface CavSummaryWindowed {
  '6m': number | null
  '1y': number | null
}

export interface CavSummaryTicker {
  ticker: string
  current: number | null
  changes: CavSummaryChanges
  zscore: CavSummaryWindowed
  ivRank: CavSummaryWindowed
  ivPercentile: CavSummaryWindowed
}

export interface CavSummaryResponse {
  asOfDate: string | null
  lookbackDates: {
    '1d':  string | null
    '5d':  string | null
    '1m':  string | null
    '3m':  string | null
    'ytd': string | null
  }
  tickers: CavSummaryTicker[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: CavSummaryResponse | null
}

export function useCavSummary(): HookResult {
  const [data, setData] = useState<CavSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/macro/cross-asset-vol/summary')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CavSummaryResponse
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
  }, [])

  return { loading, error, data }
}
