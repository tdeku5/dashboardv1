import { useEffect, useState } from 'react'

export interface FuturesCurvePoint {
  symbol: string
  monthCode: string
  year: number
  expiryLabel: string
  expiryDate: string
  lastPrice: number
  impliedRate: number
  volume: number | null
  openInterest: number | null
}

export interface FuturesCurveResponse {
  currentCurve: FuturesCurvePoint[]
  lookbackCurve: FuturesCurvePoint[]
  currentDate: string
  lookbackDate: string
  availableDates: string[]
  lookbackDays: number
  rootSymbol: string
  trimmedStaleSymbols: string[]
  lastGoodContract: string | null
}

interface UseFuturesCurveResult extends FuturesCurveResponse {
  loading: boolean
  error: string | null
}

const EMPTY_RESULT: FuturesCurveResponse = {
  currentCurve: [],
  lookbackCurve: [],
  currentDate: '',
  lookbackDate: '',
  availableDates: [],
  lookbackDays: 0,
  rootSymbol: '',
  trimmedStaleSymbols: [],
  lastGoodContract: null,
}

export function useFuturesCurve(rootSymbol: string, lookbackDays: number, date?: string): UseFuturesCurveResult {
  const [data, setData] = useState<FuturesCurveResponse>(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ lookbackDays: String(lookbackDays) })
    if (date) params.set('date', date)

    setLoading(true)
    setError(null)

    fetch(`/api/futures/curve/${rootSymbol}?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`)
        }
        return json as FuturesCurveResponse
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

    return () => {
      cancelled = true
    }
  }, [rootSymbol, lookbackDays, date])

  return { ...data, loading, error }
}
