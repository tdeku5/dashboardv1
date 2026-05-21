import { useEffect, useState } from 'react'

export type CountryLookbackKey = '5d' | '1m' | '3m' | '6m' | 'ytd'

export interface CountryReturns {
  '5d':  number | null
  '1m':  number | null
  '3m':  number | null
  '6m':  number | null
  ytd:   number | null
}

export interface CountryReturnsRow {
  displayName: string
  ticker: string
  currency: string
  currentPrice: number | null
  returnsLocal: CountryReturns
  returnsUsd: CountryReturns
}

export interface CountryReturnsResponse {
  asOfDate: string | null
  lookbackDates: Record<CountryLookbackKey, string | null>
  countries: CountryReturnsRow[]
  warnings: string[]
  missingIndexTickers?: string[]
  missingFxTickers?: string[]
}

interface HookResult {
  loading: boolean
  error: string | null
  data: CountryReturnsResponse | null
}

export function useCountryReturns(): HookResult {
  const [data, setData] = useState<CountryReturnsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/equities/global/country-returns')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as CountryReturnsResponse
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
