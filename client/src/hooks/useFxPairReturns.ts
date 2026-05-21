import { useEffect, useState } from 'react'

export type FxLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface FxReturns {
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  '6m':  number | null
  ytd:   number | null
}

export interface FxPairRow {
  pair: string
  currentPrice: number | null
  returns: FxReturns
}

export interface FxEmPairRow extends FxPairRow {
  region: string
}

export interface FxPairReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<FxLookbackKey, string | null>
  dmPairs: FxPairRow[]
  emPairs: FxEmPairRow[]
  warnings: string[]
  missingDmPairs?: string[]
  missingEmPairs?: string[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: FxPairReturnsResponse | null
}

export function useFxPairReturns(): HookResult {
  const [data, setData] = useState<FxPairReturnsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/fx/global/pair-returns')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as FxPairReturnsResponse
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
