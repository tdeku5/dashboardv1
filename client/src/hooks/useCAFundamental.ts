import { useEffect, useState } from 'react'

// cpi = headline (index → YoY + MoM + projections);
// core_cpi = BoC core trio (CPI-trim/median/common YoY + their average);
// labor = Canadian unemployment rate.
export type CAFundamentalTab = 'cpi' | 'core_cpi' | 'labor'

export interface CAFundamentalPoint {
  date: string
  value: number
}

export interface CAFundamentalProjectionPoint {
  date: string
  yoy: number
}

export interface CAFundamentalCoreLines {
  trim: CAFundamentalPoint[]
  median: CAFundamentalPoint[]
  common: CAFundamentalPoint[]
  average: CAFundamentalPoint[]
}

export interface CAFundamentalLatestReading {
  date: string
  indexLevel: number | null
  mom: number | null
  yoy: number | null
  // core snapshot (present only for core_cpi)
  trim?: number | null
  median?: number | null
  common?: number | null
  average?: number | null
}

export interface CAFundamentalResponse {
  tab: CAFundamentalTab
  kind: 'index' | 'multi_yoy' | 'rate'
  series: CAFundamentalPoint[]
  yoyHistorical: CAFundamentalPoint[]
  momHistorical: CAFundamentalPoint[]
  projections: {
    mom1: CAFundamentalProjectionPoint[]
    mom3avg: CAFundamentalProjectionPoint[]
    mom6avg: CAFundamentalProjectionPoint[]
  } | null
  coreLines: CAFundamentalCoreLines | null
  bocTarget: CAFundamentalPoint[]
  latestReading: CAFundamentalLatestReading
}

export function useCAFundamental(tab: CAFundamentalTab) {
  const [data, setData] = useState<CAFundamentalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/ca/fundamental/${tab}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<CAFundamentalResponse>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load CA fundamental data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  return { data, loading, error }
}
