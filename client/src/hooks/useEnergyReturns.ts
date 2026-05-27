import { useEffect, useState } from 'react'
import type { LookbackKey } from './useSectorAttribution'
import type { MetalReturns, MetalReturnsRow } from './useMetalsReturns'

// Same row/return shape as metals — continuous front-month returns.
export type EnergyReturns = MetalReturns
export type EnergyReturnsRow = MetalReturnsRow

export interface EnergyReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<LookbackKey, string | null>
  energy: EnergyReturnsRow[]
  missingTickers?: string[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: EnergyReturnsResponse | null
}

export function useEnergyReturns(): HookResult {
  const [data, setData] = useState<EnergyReturnsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/commodities/energy/returns')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as EnergyReturnsResponse
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
