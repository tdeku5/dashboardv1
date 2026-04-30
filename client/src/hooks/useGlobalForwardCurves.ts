import { useEffect, useState } from 'react'

export interface GlobalForwardPoint {
  expiryDate: string
  expiryDisplay: string
  US?: number | null
  UK?: number | null
  EU?: number | null
  CA?: number | null
  JP?: number | null
  AU?: number | null
  [key: string]: string | number | null | undefined
}

interface ApiResponse {
  asOfDate: string
  contracts: GlobalForwardPoint[]
}

export interface GlobalForwardCurveData {
  loading: boolean
  error: string | null
  asOfDate: string
  contracts: GlobalForwardPoint[]
}

export function useGlobalForwardCurves(): GlobalForwardCurveData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOfDate, setAsOfDate] = useState('')
  const [contracts, setContracts] = useState<GlobalForwardPoint[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/global/forward-curves')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setAsOfDate(json.asOfDate)
        setContracts(json.contracts)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  return { loading, error, asOfDate, contracts }
}
