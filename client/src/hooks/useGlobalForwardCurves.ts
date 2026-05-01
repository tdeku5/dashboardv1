import { useEffect, useState } from 'react'

export interface GlobalForwardPoint {
  code: string
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
  lookbackDate?: string
  contracts: GlobalForwardPoint[]
  currentContracts?: GlobalForwardPoint[]
  lookbackContracts?: GlobalForwardPoint[]
}

export interface GlobalForwardCurveData {
  loading: boolean
  error: string | null
  asOfDate: string
  lookbackDate: string
  contracts: GlobalForwardPoint[]
  currentContracts: GlobalForwardPoint[]
  lookbackContracts: GlobalForwardPoint[]
}

export function useGlobalForwardCurves(lookbackDays: number = 0): GlobalForwardCurveData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asOfDate, setAsOfDate] = useState('')
  const [lookbackDate, setLookbackDate] = useState('')
  const [currentContracts, setCurrentContracts] = useState<GlobalForwardPoint[]>([])
  const [lookbackContracts, setLookbackContracts] = useState<GlobalForwardPoint[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/global/forward-curves?lookbackDays=${lookbackDays}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setAsOfDate(json.asOfDate)
        setLookbackDate(json.lookbackDate ?? '')
        setCurrentContracts(json.currentContracts ?? json.contracts ?? [])
        setLookbackContracts(json.lookbackContracts ?? [])
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
    contracts: currentContracts,
    currentContracts,
    lookbackContracts,
  }
}
