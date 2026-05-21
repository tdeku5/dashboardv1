import { useEffect, useState } from 'react'
import type { UsIndexKey } from '../constants/usIndices'

export type IndexLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'
export type IndexRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export interface IndexReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface IndexReturnsRow {
  key: UsIndexKey
  ticker: string
  displayName: string
  currentPrice: number | null
  returns: IndexReturns
}

export interface IndexReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<IndexLookbackKey, string | null>
  indices: IndexReturnsRow[]
  missingTickers?: string[]
}

export type IndexLevelsRow = {
  date: string
} & { [K in UsIndexKey]: number | null }

export interface IndexLevelsResponse {
  asOfDate: string | null
  range: IndexRangeKey
  rangeStartDate: string | null
  series: IndexLevelsRow[]
  missingTickers: UsIndexKey[]
}

interface HookResult<T> {
  loading: boolean
  error: string | null
  data: T | null
}

export function useUsIndexReturns(): HookResult<IndexReturnsResponse> {
  const [data, setData] = useState<IndexReturnsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/equities/us/index-returns')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as IndexReturnsResponse
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

export function useUsIndexLevels(range: IndexRangeKey): HookResult<IndexLevelsResponse> {
  const [data, setData] = useState<IndexLevelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ range })
    fetch(`/api/equities/us/index-levels?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as IndexLevelsResponse
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
