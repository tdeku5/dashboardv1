import { useEffect, useState } from 'react'

export interface OvernightRateLatest {
  date: string
  value: number
  source: string
  stale_days: number
}

type Codes = ReadonlyArray<string>

export function useOvernightRates(codes: Codes): {
  data: Record<string, OvernightRateLatest | null>
  loading: boolean
  error: string | null
} {
  const [data, setData] = useState<Record<string, OvernightRateLatest | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Stable key over the requested codes — re-fires only when the set changes.
  const codesKey = [...codes].join(',')

  useEffect(() => {
    let cancelled = false
    if (!codesKey) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/overnight-rates/latest?series=${encodeURIComponent(codesKey)}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        return json as Record<string, OvernightRateLatest | null>
      })
      .then((json) => {
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [codesKey])

  return { data, loading, error }
}
