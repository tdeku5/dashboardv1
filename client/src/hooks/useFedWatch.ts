import { useEffect, useState } from 'react'

export interface FedWatchMeeting {
  meetingDate: string
  meetingMonth: string
  monthContract: string
  impliedAvgRate: number
  effrStart: number
  effrEnd: number
  expectedChange: number
  daysBeforeMeeting: number
  daysAfterMeeting: number
  probabilities: Record<string, number>
  calcSource: string
}

export interface FedWatchCumulativeRow {
  meetingDate: string
  meetingLabel: string
  targetRanges: Record<string, number>
}

export interface FedWatchResponse {
  asOfDate: string
  currentEFFR: number
  // Current policy lower bound (proxy + spread). Equals currentEFFR for
  // markets without a translation; differs for SR3 (policy ≈ SOFR − spread).
  // Use for the Summary table's Overnight Cash row when in policy units.
  currentPolicyRate: number
  currentTargetRange: string
  meetings: FedWatchMeeting[]
  cumulativeProbabilities: FedWatchCumulativeRow[]
  rangeColumns: string[]
  // Decimal offset between proxy (overnight) rate and policy rate. Zero for
  // US Fed Funds (EFFR floats within the target band, so the floor-bucket
  // label IS the band). Non-zero for ECB/BoE/etc. where the policy rate
  // sits a few bp above the overnight proxy.
  proxyToPolicySpread: number
  proxyToPolicySpreadSource: string
}

interface UseFedWatchResult extends FedWatchResponse {
  loading: boolean
  error: string | null
}

const EMPTY_RESULT: FedWatchResponse = {
  asOfDate: '',
  currentEFFR: 0,
  currentPolicyRate: 0,
  currentTargetRange: '',
  meetings: [],
  cumulativeProbabilities: [],
  rangeColumns: [],
  proxyToPolicySpread: 0,
  proxyToPolicySpreadSource: '',
}

export function useFedWatch(market?: string, date?: string): UseFedWatchResult {
  const [data, setData] = useState<FedWatchResponse>(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (market) params.set('market', market)
    const url = params.size > 0 ? `/api/futures/fedwatch?${params}` : '/api/futures/fedwatch'

    setLoading(true)
    setError(null)

    fetch(url)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`)
        }
        return json as FedWatchResponse
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
  }, [market, date])

  return { ...data, loading, error }
}
