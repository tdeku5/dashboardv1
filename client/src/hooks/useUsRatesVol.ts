import { useCallback, useEffect, useState } from 'react'

export type VolRangeKey = '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | 'all'

export interface VolSeriesPoint {
  date: string
  move: number | null
  rvMove: number | null
  rv2y: number | null
  rv5y: number | null
  rv10y: number | null
  rv30y: number | null
  weightsRenormalized: boolean
  nObs: number
  premiumBp: number | null
  ratio: number | null
  premiumZ252: number | null
  ratioPct252: number | null
  premiumMean252: number | null
  premiumSd252: number | null
}

export interface VolLatest {
  date: string | null
  move: number | null
  rvMove: number | null
  premiumBp: number | null
  ratio: number | null
  premiumZ252: number | null
  ratioPct252: number | null
  weightsRenormalized: boolean
}

export interface ContributionRow {
  tenor: string
  weight: number
  rv: number | null
  contribution: number | null
  sharePct: number | null
}

export interface FlaggedRange { from: string; to: string; days: number }

export interface VolJoinStats {
  realizedRows: number
  impliedRows: number
  joined: number
  droppedRealizedOnly: number
  droppedImpliedOnly: number
  recentRealizedOnlyDates: string[]
}

export interface UsRatesVolResponse {
  range: VolRangeKey
  asOfImplied: string | null
  asOfRealized: string | null
  impliedTrailsRealized: boolean
  rangeStartDate: string | null
  lookbackDays: number
  series: VolSeriesPoint[]
  latest: VolLatest
  contributions: ContributionRow[]
  renormalizedRanges: FlaggedRange[]
  joinStats: VolJoinStats
}

interface HookResult {
  loading: boolean
  error: string | null
  data: UsRatesVolResponse | null
  reload: () => void
}

export function useUsRatesVol(range: VolRangeKey): HookResult {
  const [data, setData] = useState<UsRatesVolResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/rates/us/vol?${new URLSearchParams({ range })}`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<UsRatesVolResponse>
      })
      .then(json => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [range, nonce])

  return { loading, error, data, reload }
}
