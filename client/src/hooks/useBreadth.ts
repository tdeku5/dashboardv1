import { useEffect, useState } from 'react'

export type BreadthRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export type BreadthSeriesKey = 'd20' | 'd50' | 'd200'

export interface BreadthSeriesRow {
  date: string
  d20:  number | null
  d50:  number | null
  d200: number | null
}

export interface BreadthResponse {
  asOfDate: string | null
  range: BreadthRangeKey
  rangeStartDate: string | null
  indexLabel: string
  series: BreadthSeriesRow[]
  missingSeries: BreadthSeriesKey[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: BreadthResponse | null
}

export function useBreadth(range: BreadthRangeKey): HookResult {
  const [data, setData] = useState<BreadthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ range })

    fetch(`/api/equities/us/breadth?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as BreadthResponse
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
  }, [range])

  return { loading, error, data }
}
