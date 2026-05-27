import { useEffect, useState } from 'react'

// cpi = headline (index → YoY + MoM + projections);
// core_cpi = Japan core (ex fresh food) index → same decomposition;
// labor = Japanese unemployment rate (NSA).
export type JPFundamentalTab = 'cpi' | 'core_cpi' | 'labor'

export interface JPFundamentalPoint {
  date: string
  value: number
}

export interface JPFundamentalProjectionPoint {
  date: string
  yoy: number
}

export interface JPFundamentalLatestReading {
  date: string
  indexLevel: number | null
  mom: number | null
  yoy: number | null
}

export interface JPFundamentalResponse {
  tab: JPFundamentalTab
  kind: 'index' | 'rate'
  series: JPFundamentalPoint[]
  yoyHistorical: JPFundamentalPoint[]
  momHistorical: JPFundamentalPoint[]
  projections: {
    mom1: JPFundamentalProjectionPoint[]
    mom3avg: JPFundamentalProjectionPoint[]
    mom6avg: JPFundamentalProjectionPoint[]
  } | null
  bojRate: JPFundamentalPoint[]
  latestReading: JPFundamentalLatestReading
}

export function useJPFundamental(tab: JPFundamentalTab) {
  const [data, setData] = useState<JPFundamentalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/jp/fundamental/${tab}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<JPFundamentalResponse>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load JP fundamental data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  return { data, loading, error }
}
