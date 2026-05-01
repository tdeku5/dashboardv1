import { useEffect, useState } from 'react'

export interface GlobalCurveRow {
  tenor: string
  years: number
  US?: number | null
  UK?: number | null
  DE?: number | null
  FR?: number | null
  IT?: number | null
  CA?: number | null
  JP?: number | null
  AU?: number | null
  [key: string]: string | number | null | undefined
}

interface ApiResponse {
  asOfDate: string
  lookbackDate?: string
  tenors: GlobalCurveRow[]
  currentTenors?: GlobalCurveRow[]
  lookbackTenors?: GlobalCurveRow[]
}

export interface GlobalYieldCurveData {
  loading: boolean
  error: string | null
  asOfDate: string
  lookbackDate: string
  tenors: GlobalCurveRow[]            // alias of currentTenors for back-compat
  currentTenors: GlobalCurveRow[]
  lookbackTenors: GlobalCurveRow[]
}

export function useGlobalYieldCurves(lookbackDays: number = 0): GlobalYieldCurveData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOfDate, setAsOfDate] = useState('')
  const [lookbackDate, setLookbackDate] = useState('')
  const [currentTenors, setCurrentTenors] = useState<GlobalCurveRow[]>([])
  const [lookbackTenors, setLookbackTenors] = useState<GlobalCurveRow[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/global/yield-curves?lookbackDays=${lookbackDays}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setAsOfDate(json.asOfDate)
        setLookbackDate(json.lookbackDate ?? '')
        setCurrentTenors(json.currentTenors ?? json.tenors ?? [])
        setLookbackTenors(json.lookbackTenors ?? [])
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [lookbackDays])

  return {
    loading,
    error,
    asOfDate,
    lookbackDate,
    tenors: currentTenors,
    currentTenors,
    lookbackTenors,
  }
}
