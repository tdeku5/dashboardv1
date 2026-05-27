import { useEffect, useState } from 'react'

// Australian fundamental model tabs. CPI is split monthly vs quarterly to track
// the 2025-27 transition: m_* = new Monthly CPI (RBA's official headline target),
// q_* = continuing quarterly series (RBA's preferred underlying gauges). Each CPI
// tab is a raw index → YoY + sequential change + projections. labor = unemployment
// rate (SA + trend lines, pass-through).
export type AUFundamentalTab =
  | 'm_headline' | 'm_trimmed' | 'm_wgtmed'
  | 'q_headline' | 'q_trimmed' | 'q_wgtmed'
  | 'labor'

export interface AUFundamentalPoint {
  date: string
  value: number
}

export interface AUFundamentalProjectionPoint {
  date: string
  yoy: number
}

export interface AUFundamentalLatestReading {
  date: string
  indexLevel: number | null
  seq: number | null   // MoM (monthly) or QoQ (quarterly) % change
  yoy: number | null
}

export interface AUFundamentalResponse {
  tab: AUFundamentalTab
  kind: 'index' | 'rate'
  freq: 'M' | 'Q'
  paceWindows?: [number, number, number]   // projection pace windows in periods
  series: AUFundamentalPoint[]
  seriesTrend?: AUFundamentalPoint[]        // labor only: ABS trend line
  yoyHistorical: AUFundamentalPoint[]
  seqHistorical: AUFundamentalPoint[]
  projections: {
    p1: AUFundamentalProjectionPoint[]
    p2: AUFundamentalProjectionPoint[]
    p3: AUFundamentalProjectionPoint[]
  } | null
  rbaRate: AUFundamentalPoint[]
  latestReading: AUFundamentalLatestReading
}

export function useAUFundamental(tab: AUFundamentalTab) {
  const [data, setData] = useState<AUFundamentalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/au/fundamental/${tab}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<AUFundamentalResponse>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load AU fundamental data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  return { data, loading, error }
}
