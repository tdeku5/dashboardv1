import { useEffect, useState } from 'react'
import type { CavKey } from '../constants/crossAssetVol'

export type CavRangeKey =
  | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | '15y' | '20y' | 'all'

export type CavLookbackKey = '6m' | '1y' | '2y' | '5y' | '10y'

export type CavLevelsRow = {
  date: string
} & { [K in CavKey]: number | null }

export interface CavLevelsResponse {
  asOfDate: string | null
  range: CavRangeKey
  rangeStartDate: string | null
  series: CavLevelsRow[]
  missingSeries: CavKey[]
}

export interface CavZscoreCell {
  z: number | null
  value: number | null
  mean: number | null
  stdev: number | null
}

export type CavZscoreRow = {
  date: string
} & { [K in CavKey]: CavZscoreCell | null }

export interface CavZscoreResponse {
  asOfDate: string | null
  range: CavRangeKey
  rangeStartDate: string | null
  lookback: CavLookbackKey
  lookbackTradingDays: number
  series: CavZscoreRow[]
  notes: string[]
  firstValidDate: Record<CavKey, string | null>
  missingSeries: CavKey[]
}

interface HookResult<T> {
  loading: boolean
  error: string | null
  data: T | null
}

export function useCavLevels(range: CavRangeKey): HookResult<CavLevelsResponse> {
  const [data, setData] = useState<CavLevelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ range })
    fetch(`/api/macro/cross-asset-vol/levels?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CavLevelsResponse
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

export function useCavZscores(
  range: CavRangeKey,
  lookback: CavLookbackKey,
): HookResult<CavZscoreResponse> {
  const [data, setData] = useState<CavZscoreResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ range, lookback })
    fetch(`/api/macro/cross-asset-vol/zscores?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CavZscoreResponse
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
  }, [range, lookback])

  return { loading, error, data }
}
