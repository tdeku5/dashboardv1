import { useEffect, useState } from 'react'

export interface YieldChangeMetric {
  current: number
  previous: number
  changeBps: number
  sigma200d: number | null
  zScore: number | null
}

export type YieldChangeRowKey = '2Y' | '5Y' | '10Y' | '30Y' | '2s10s' | '10s30s'

export type YieldChangeCountry = Partial<Record<YieldChangeRowKey, YieldChangeMetric | null>>

export interface GlobalYieldChangesData {
  loading: boolean
  error: string | null
  asOfDate: string
  previousDate: string
  countries: Record<string, YieldChangeCountry>
}

interface ApiResponse {
  asOfDate: string
  previousDate: string
  countries: Record<string, YieldChangeCountry>
}

export function useGlobalYieldChanges(): GlobalYieldChangesData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOfDate, setAsOfDate] = useState('')
  const [previousDate, setPreviousDate] = useState('')
  const [countries, setCountries] = useState<Record<string, YieldChangeCountry>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/global/yield-changes')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setAsOfDate(json.asOfDate ?? '')
        setPreviousDate(json.previousDate ?? '')
        setCountries(json.countries ?? {})
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  return { loading, error, asOfDate, previousDate, countries }
}
