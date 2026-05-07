import { useEffect, useState } from 'react'

export interface CrudeCurveContract {
  code: string
  current: number | null
  offset1: number | null
  offset2: number | null
}

export interface CrudeCurveData {
  product: 'wti' | 'brent'
  asOf: string
  offset1Date: string | null
  offset1Days: number
  offset2Date: string | null
  offset2Days: number
  contracts: CrudeCurveContract[]
}

export interface CrudeCurvesResponse {
  wti: CrudeCurveData
  brent: CrudeCurveData
}

interface HookResult {
  loading: boolean
  error: string | null
  data: CrudeCurvesResponse | null
}

export function useCrudeCurves(offset1: number, offset2: number): HookResult {
  const [data, setData] = useState<CrudeCurvesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      offset1: String(offset1),
      offset2: String(offset2),
    })

    fetch(`/api/commodities/crude/curves?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CrudeCurvesResponse
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
