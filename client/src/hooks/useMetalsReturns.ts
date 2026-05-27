import { useEffect, useState } from 'react'
import type { LookbackKey } from './useSectorAttribution'

export interface MetalReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface MetalReturnsRow {
  key: string
  ticker: string
  name: string
  currentPrice: number | null
  returns: MetalReturns
}

export interface MetalsReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<LookbackKey, string | null>
  metals: MetalReturnsRow[]
  missingTickers?: string[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: MetalsReturnsResponse | null
}

export function useMetalsReturns(): HookResult {
  const [data, setData] = useState<MetalsReturnsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/commodities/metals/returns')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as MetalsReturnsResponse
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
