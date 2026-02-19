import { useState, useEffect, useCallback } from 'react'
import { fetchFredSeries, FredConfigError } from '../lib/fred'
import { SERIES_DEFS } from '../data/seriesConfig'
import type { LiveRow, LivePanelData } from '../types'

const OBS_START = '2022-01-01'

function buildLoadingMap(): Map<string, LivePanelData> {
  const map = new Map<string, LivePanelData>()

  for (const def of SERIES_DEFS) {
    const loadingRow: LiveRow = {
      id:     def.fredId,
      label:  def.label,
      status: 'loading',
      cells: [
        { sub: '', val: '' },
        { sub: '', val: '' },
        { sub: '', val: '' },
        { sub: '', val: '' },
      ],
    }

    const existing = map.get(def.panelId)
    if (existing) {
      existing.rows.push(loadingRow)
    } else {
      map.set(def.panelId, { id: def.panelId, rows: [loadingRow], loading: true })
    }
  }

  return map
}

export interface FredDataResult {
  panelMap:     Map<string, LivePanelData>
  lastUpdated:  Date | null
  refresh:      () => void
  isRefreshing: boolean
  configError?: FredConfigError
}

export function useFredData(): FredDataResult {
  const [panelMap, setPanelMap]         = useState<Map<string, LivePanelData>>(buildLoadingMap)
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null)
  const [refreshKey, setRefreshKey]     = useState(0)
  const [configError, setConfigError]   = useState<FredConfigError | undefined>(undefined)

  const refresh = useCallback(() => {
    setPanelMap(buildLoadingMap())
    setConfigError(undefined)
    setRefreshKey(k => k + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      const results = await Promise.allSettled(
        SERIES_DEFS.map(async (def) => {
          const raw      = await fetchFredSeries(def.fredId, {
            observationStart:  OBS_START,
            frequency:         def.frequency,
            aggregationMethod: def.aggMethod,
          })
          const computed = def.compute(raw)
          return { def, computed }
        })
      )

      if (cancelled) return

      // If every series failed and at least one failure is a config error,
      // surface the config error screen instead of row-level error states.
      const allFailed = results.every(r => r.status === 'rejected')
      const firstConfigErr = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason)
        .find((e): e is FredConfigError => e instanceof FredConfigError)

      if (allFailed && firstConfigErr) {
        setConfigError(firstConfigErr)
        // Still update the map so rows show error state if user dismisses/retries
      } else {
        setConfigError(undefined)
      }

      const next = new Map<string, LivePanelData>()

      for (let i = 0; i < SERIES_DEFS.length; i++) {
        const def    = SERIES_DEFS[i]
        const result = results[i]

        let row: LiveRow

        if (result.status === 'fulfilled') {
          const { computed } = result.value
          row = {
            id:          def.fredId,
            label:       def.label,
            status:      'ready',
            lastDate:    computed.lastDate,
            lastRawDate: computed.lastRawDate,
            seriesFreq:  def.staleFreq ?? 'monthly',
            cells:       computed.cells,
            regimeHistory: computed.regimeHistory,
          }
        } else {
          const msg = result.reason instanceof Error
            ? result.reason.message
            : 'Fetch failed'
          row = {
            id:       def.fredId,
            label:    def.label,
            status:   'error',
            errorMsg: msg,
            cells: [
              { sub: '', val: '—' },
              { sub: '', val: '—' },
              { sub: '', val: '—' },
              { sub: '', val: '—' },
            ],
          }
        }

        const existing = next.get(def.panelId)
        if (existing) {
          existing.rows.push(row)
        } else {
          next.set(def.panelId, { id: def.panelId, rows: [row], loading: false })
        }
      }

      setPanelMap(next)
      setLastUpdated(new Date())
    }

    fetchAll()
    return () => { cancelled = true }
  }, [refreshKey])

  const isRefreshing = [...panelMap.values()].some(p => p.loading)

  return { panelMap, lastUpdated, refresh, isRefreshing, configError }
}
