import { useEffect, useState } from 'react'

export type BasisLookback = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max'
export type BasisMetal = 'gold' | 'silver'

export interface BasisPoint {
  date: string
  front: number
  spot: number
  basis: number
}

export interface MetalBasisResponse {
  metal: BasisMetal
  symbols: { front: string; spot: string }
  lookback: BasisLookback
  startDate: string | null
  endDate: string | null
  series: BasisPoint[]
  error?: string
}

interface HookResult {
  loading: boolean
  error: string | null
  data: MetalBasisResponse | null
}

export function useMetalBasis(metal: BasisMetal, lookback: BasisLookback): HookResult {
  const [data, setData] = useState<MetalBasisResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/commodities/metals/basis/${metal}?lookback=${lookback}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as MetalBasisResponse
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
  }, [metal, lookback])

  return { loading, error, data }
}
