import { useEffect, useState } from 'react'
import type { CrudeCurveData } from './useCrudeCurves'

// VIX futures curve hook. Returns a `CrudeCurveData`-shaped object so the
// CrudeCurvePanel renders it unchanged — the only difference is the formatters
// the page passes in (vol points, not $/bbl). One offset (no offset2).

export interface UseVixFuturesCurveResult {
  loading: boolean
  error: string | null
  data: CrudeCurveData | null
}

export function useVixFuturesCurve(offset: number): UseVixFuturesCurveResult {
  const [data, setData] = useState<CrudeCurveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/equities/us/vix-futures-curve?offset=${offset}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        // Server returns the same shape as CrudeCurveData (with product='vix'
        // and contracts whose offset2 is always null) — structurally compatible.
        return json as CrudeCurveData
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
  }, [offset])

  return { loading, error, data }
}
