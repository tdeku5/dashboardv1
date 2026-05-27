import { useEffect, useState } from 'react'

// hicp = headline; core_hicp = supercore (market core, excl. energy & food);
// labor = euro-area unemployment rate.
export type EUFundamentalTab = 'hicp' | 'core_hicp' | 'labor'

export interface EUFundamentalPoint {
  date: string
  value: number
}

export interface EUFundamentalProjectionPoint {
  date: string
  yoy: number
}

export interface EUFundamentalLatestReading {
  date: string
  indexLevel: number
  mom: number | null
  yoy: number | null
}

export interface EUFundamentalResponse {
  tab: EUFundamentalTab
  series: EUFundamentalPoint[]
  yoyHistorical: EUFundamentalPoint[]
  momHistorical: EUFundamentalPoint[]
  projections: {
    mom1: EUFundamentalProjectionPoint[]
    mom3avg: EUFundamentalProjectionPoint[]
    mom6avg: EUFundamentalProjectionPoint[]
  } | null
  dfr: EUFundamentalPoint[]
  latestReading: EUFundamentalLatestReading
}

export function useEUFundamental(tab: EUFundamentalTab) {
  const [data, setData] = useState<EUFundamentalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/eu/fundamental/${tab}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<EUFundamentalResponse>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load EU fundamental data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  return { data, loading, error }
}
