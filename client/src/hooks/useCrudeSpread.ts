import { useEffect, useState } from 'react'

export type SpreadLookback = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max'

export interface SpreadPoint {
  date: string
  brent: number
  wti: number
  spread: number
}

export interface SpreadStats {
  current: number
  min: number
  max: number
  mean: number
  median: number
  stdev: number
  zscore: number
}

export interface CrudeSpreadResponse {
  symbols: { brent: string; wti: string }
  lookback: SpreadLookback
  startDate: string | null
  endDate: string | null
  series: SpreadPoint[]
  stats: SpreadStats | null
  error?: string
}

interface HookResult {
  loading: boolean
  error: string | null
  data: CrudeSpreadResponse | null
}

export function useCrudeSpread(lookback: SpreadLookback): HookResult {
  const [data, setData] = useState<CrudeSpreadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/commodities/crude/spread?lookback=${lookback}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CrudeSpreadResponse
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
  }, [lookback])

  return { loading, error, data }
}
