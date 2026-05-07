import { useEffect, useState } from 'react'

export interface GlobalSpreadCountry {
  marketKey: string
  displayName: string
  shortName: string
}

export interface GlobalSpreadRow {
  position: number
  label: string
  [marketKey: string]: string | number | undefined
}

export interface GlobalCalendarSpreadsData {
  loading: boolean
  error: string | null
  asOfDate: string
  countries: GlobalSpreadCountry[]
  strides: Record<number, GlobalSpreadRow[]>
}

interface ApiResponse {
  asOfDate: string
  lookbackDays: number
  countries: GlobalSpreadCountry[]
  strides: Record<number, GlobalSpreadRow[]>
}

const EMPTY_STRIDES: Record<number, GlobalSpreadRow[]> = { 1: [], 2: [], 3: [], 4: [] }

export function useGlobalCalendarSpreads(lookbackDays: number = 0): GlobalCalendarSpreadsData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOfDate, setAsOfDate] = useState('')
  const [countries, setCountries] = useState<GlobalSpreadCountry[]>([])
  const [strides, setStrides] = useState<Record<number, GlobalSpreadRow[]>>(EMPTY_STRIDES)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/global/calendar-spreads?lookbackDays=${lookbackDays}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setAsOfDate(json.asOfDate)
        setCountries(json.countries)
        setStrides(json.strides)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [lookbackDays])

  return { loading, error, asOfDate, countries, strides }
}
