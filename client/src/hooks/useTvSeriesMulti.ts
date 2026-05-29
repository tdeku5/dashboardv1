import { useEffect, useMemo, useRef, useState } from 'react'
import type { TvSeriesPoint } from './useTvSeries'

// Batched multi-symbol fetcher for tv_series. Issues one /api/tv/series/<sym>
// request per symbol in parallel, but from a single useEffect — so callers
// with variable-length symbol lists don't run afoul of React's rules-of-hooks
// (which forbid calling useTvSeries() inside a loop whose length can change
// between renders).
//
// Returns a Map keyed by symbol so consumers can look up series by name and
// avoid index-juggling between the symbol array and a parallel data array.

export interface TvSeriesMultiState {
  loading: boolean
  error: string | null
  data: Map<string, TvSeriesPoint[]>
}

export function useTvSeriesMulti(symbols: ReadonlyArray<string>): TvSeriesMultiState {
  // Memoize the dependency on the symbol set's content (not the array
  // identity) — callers tend to pass fresh array literals each render.
  const symbolsKey = useMemo(() => symbols.join('|'), [symbols])
  // Keep the resolved symbol list around so the effect closure reads the
  // same order it was scheduled with.
  const symbolsRef = useRef<string[]>([])
  symbolsRef.current = [...symbols]

  const [state, setState] = useState<TvSeriesMultiState>({
    loading: true, error: null, data: new Map(),
  })

  useEffect(() => {
    const list = symbolsRef.current
    if (list.length === 0) {
      setState({ loading: false, error: null, data: new Map() })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    Promise.all(list.map(async sym => {
      const res = await fetch(`/api/tv/series/${encodeURIComponent(sym)}?limit=50000`)
      const body = await res.json() as { symbol?: string; data?: TvSeriesPoint[]; error?: string }
      if (!res.ok) throw new Error(`${sym}: ${body.error ?? 'HTTP ' + res.status}`)
      return { sym, data: body.data ?? [] }
    }))
      .then(results => {
        if (cancelled) return
        const map = new Map<string, TvSeriesPoint[]>()
        for (const r of results) map.set(r.sym, r.data)
        setState({ loading: false, error: null, data: map })
      })
      .catch(err => {
        if (cancelled) return
        setState({ loading: false, error: err instanceof Error ? err.message : String(err), data: new Map() })
      })

    return () => { cancelled = true }
    // symbolsKey is the content-addressed dep; symbolsRef is read at execution.
  }, [symbolsKey])

  return state
}
