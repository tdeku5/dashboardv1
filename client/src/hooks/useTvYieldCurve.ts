import { useEffect, useState } from 'react'

export interface TenorConfig {
  key: string
  label: string
  years: number
}

interface TenorResponse {
  key: string
  label: string
  years: number
  data: { date: string; value: number }[]
}

interface ApiResponse {
  country: string
  displayName: string
  tenors: TenorResponse[]
}

export interface TvYieldCurveData {
  loading: boolean
  error: string | null
  data: Record<string, { date: string; value: number }[]>
  tenors: TenorConfig[]
  displayName: string
}

export function useTvYieldCurve(pageKey: string): TvYieldCurveData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Record<string, { date: string; value: number }[]>>({})
  const [tenors, setTenors] = useState<TenorConfig[]>([])
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/tv/yield-curve/${pageKey}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        const dataMap: Record<string, { date: string; value: number }[]> = {}
        const tenorConfigs: TenorConfig[] = []
        for (const t of json.tenors) {
          if (t.data.length > 0) {
            dataMap[t.key] = t.data
            tenorConfigs.push({ key: t.key, label: t.label, years: t.years })
          }
        }
        setData(dataMap)
        setTenors(tenorConfigs)
        setDisplayName(json.displayName)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [pageKey])

  return { loading, error, data, tenors, displayName }
}
