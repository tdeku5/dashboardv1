import { useEffect, useState } from 'react'

// One tv_series time series — { time (unix seconds, as string), close }.
// Pulls full available history (limit=50000 server-side cap) so the page's
// range buttons can slice client-side without re-fetching.

export interface TvSeriesPoint {
  time: string   // unix seconds (string, as stored)
  close: number
}

export interface TvSeriesState {
  loading: boolean
  error: string | null
  data: TvSeriesPoint[]
}

export function useTvSeries(symbol: string | null): TvSeriesState {
  const [state, setState] = useState<TvSeriesState>({ loading: true, error: null, data: [] })

  useEffect(() => {
    if (!symbol) { setState({ loading: false, error: null, data: [] }); return }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    fetch(`/api/tv/series/${encodeURIComponent(symbol)}?limit=50000`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        return body as { symbol: string; count: number; data: TvSeriesPoint[] }
      })
      .then(body => {
        if (cancelled) return
        setState({ loading: false, error: null, data: body.data ?? [] })
      })
      .catch(err => {
        if (cancelled) return
        setState({ loading: false, error: err instanceof Error ? err.message : String(err), data: [] })
      })
    return () => { cancelled = true }
  }, [symbol])

  return state
}
