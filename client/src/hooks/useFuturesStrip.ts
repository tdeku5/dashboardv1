import { useEffect, useState } from 'react'

export interface StripContract {
  symbol: string
  monthCode: string
  year: number
  expiryLabel: string
  lastPrice: number
  impliedRate: number
  volume: number
  openInterest: number
  pxChg1d: number | null
  pxChg5d: number | null
  pxChg1m: number | null
  oiChg: number | null
}

export interface FuturesStripData {
  rootSymbol: string
  latestDate: string
  lookbackDates: {
    '1d': string | null
    '5d': string | null
    '1m': string | null
  }
  contracts: StripContract[]
}

interface UseFuturesStripResult {
  data: FuturesStripData | null
  loading: boolean
  error: string | null
}

export function useFuturesStrip(rootSymbol: string): UseFuturesStripResult {
  const [data, setData] = useState<FuturesStripData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    fetch(`/api/futures/strip/${rootSymbol}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`)
        }
        return json as FuturesStripData
      })
      .then((result) => {
        if (cancelled) return
        setData(result)
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
  }, [rootSymbol])

  return { data, loading, error }
}
