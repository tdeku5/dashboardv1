import { useEffect, useState } from 'react'

export type UKFundamentalTab = 'cpi' | 'core_cpi' | 'labor' | 'growth'

export interface UKFundamentalPoint {
  date: string
  value: number
}

export interface UKFundamentalProjectionPoint {
  date: string
  yoy: number
}

export interface UKFundamentalLatestReading {
  date: string
  indexLevel: number
  mom: number | null
  yoy: number | null
}

export interface UKFundamentalResponse {
  tab: UKFundamentalTab
  series: UKFundamentalPoint[]
  yoyHistorical: UKFundamentalPoint[]
  momHistorical: UKFundamentalPoint[]
  projections: {
    mom1: UKFundamentalProjectionPoint[]
    mom3avg: UKFundamentalProjectionPoint[]
    mom6avg: UKFundamentalProjectionPoint[]
  } | null
  bankRate: UKFundamentalPoint[]
  latestReading: UKFundamentalLatestReading
}

export function useUKFundamental(tab: UKFundamentalTab) {
  const [data, setData] = useState<UKFundamentalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/uk/fundamental/${tab}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<UKFundamentalResponse>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load UK fundamental data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  return { data, loading, error }
}
