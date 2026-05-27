import { useEffect, useState } from 'react'
import type { CrudeCurveData } from './useCrudeCurves'

// The server returns the same contract shape as the crude curves (code +
// current/offset1/offset2 + as-of/offset dates), so we reuse CrudeCurveData
// directly and render the metal strips through the shared CrudeCurvePanel.
// (The `product` field carries 'gold'/'silver' at runtime; the panel never
// reads it, so the structural reuse is safe.)
export interface MetalCurvesResponse {
  gold: CrudeCurveData
  silver: CrudeCurveData
}

interface HookResult {
  loading: boolean
  error: string | null
  data: MetalCurvesResponse | null
}

export function useMetalCurves(offset1: number, offset2: number): HookResult {
  const [data, setData] = useState<MetalCurvesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ offset1: String(offset1), offset2: String(offset2) })
    fetch(`/api/commodities/metals/curves?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as MetalCurvesResponse
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
  }, [offset1, offset2])

  return { loading, error, data }
}
