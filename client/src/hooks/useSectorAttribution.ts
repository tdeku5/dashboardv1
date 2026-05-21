import { useEffect, useState } from 'react'

export type LookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface SectorReturns {
  '5d': number | null
  '1m': number | null
  '3m': number | null
  '6m': number | null
  ytd: number | null
}

export interface SectorAttributionRow {
  ticker: string
  name: string
  currentPrice: number | null
  returns: SectorReturns
}

export interface BenchmarkBlock {
  ticker: string
  currentPrice: number | null
  returns: SectorReturns
}

export interface SectorAttributionResponse {
  asOfDate: string | null
  lookbackDates: Record<LookbackKey, string | null>
  benchmark: BenchmarkBlock | null
  sectors: SectorAttributionRow[]
  missingTickers?: string[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: SectorAttributionResponse | null
}

export function useSectorAttribution(): HookResult {
  const [data, setData] = useState<SectorAttributionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/equities/us/sector-attribution')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as SectorAttributionResponse
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
