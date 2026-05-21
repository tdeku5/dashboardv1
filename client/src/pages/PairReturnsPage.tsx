import { useCallback, useMemo } from 'react'
import { ReturnsHeatmap, type RowGroup } from '../components/ReturnsHeatmap'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import {
  useFxPairReturns,
  type FxPairRow,
  type FxEmPairRow,
} from '../hooks/useFxPairReturns'
import styles from './SectorAttributionPage.module.css'

interface DmHeatmapRow {
  ticker: string
  name: string
  source: FxPairRow
}

interface EmHeatmapRow {
  ticker: string
  name: string
  region: string
  source: FxEmPairRow
}

export function PairReturnsPage() {
  const { data, loading, error } = useFxPairReturns()

  const dmRows: DmHeatmapRow[] = useMemo(() => {
    if (!data) return []
    // Single name column for FX — the pair code IS the standard name. Setting
    // name = ticker tells ReturnsHeatmap to render only the bright label
    // (it suppresses the dim ticker when name === ticker).
    return data.dmPairs.map((p) => ({ ticker: p.pair, name: p.pair, source: p }))
  }, [data])

  const emRows: EmHeatmapRow[] = useMemo(() => {
    if (!data) return []
    return data.emPairs.map((p) => ({
      ticker: p.pair,
      name: p.pair,
      region: p.region,
      source: p,
    }))
  }, [data])

  // Region separators: emit one before each row whose region differs from the
  // previous row's region. Groups are derived from the response order rather
  // than a parallel constant.
  const emGroups: RowGroup[] = useMemo(() => {
    const out: RowGroup[] = []
    let prev: string | null = null
    emRows.forEach((r, i) => {
      if (r.region !== prev) {
        out.push({ label: r.region, beforeIndex: i })
        prev = r.region
      }
    })
    return out
  }, [emRows])

  const dmAccessor = useCallback(
    (r: DmHeatmapRow, lb: LookbackKey): number | null => r.source.returns[lb],
    [],
  )
  const emAccessor = useCallback(
    (r: EmHeatmapRow, lb: LookbackKey): number | null => r.source.returns[lb],
    [],
  )

  if (loading) {
    return <div className={styles.placeholder}>Loading pair returns…</div>
  }
  if (error) {
    return <div className={styles.placeholder}>Failed to load: {error}</div>
  }
  if (!data || (data.dmPairs.length === 0 && data.emPairs.length === 0)) {
    return <div className={styles.placeholder}>Pair returns unavailable.</div>
  }

  const asOf = data.asOfDate ?? '—'

  const dmAvailable = dmRows.some(r => r.source.currentPrice != null)
  const emAvailable = emRows.some(r => r.source.currentPrice != null)

  return (
    <div className={styles.shell}>
      {data.warnings.length > 0 && (
        <div className={styles.relativePlaceholder}>
          {data.warnings.join(' · ')}
        </div>
      )}

      <div className={styles.heatmapsRow}>
        {dmAvailable ? (
          <ReturnsHeatmap
            title="DM"
            subtitle={`as of ${asOf}`}
            rows={dmRows}
            valueAccessor={dmAccessor}
            missingTickers={data.missingDmPairs}
            rowHeaderLabel="Pair"
            gradientMode="column"
          />
        ) : (
          <div className={styles.relativePlaceholder}>
            DM pair returns unavailable.
          </div>
        )}

        {emAvailable ? (
          <ReturnsHeatmap
            title="EM"
            subtitle={`as of ${asOf}`}
            rows={emRows}
            valueAccessor={emAccessor}
            missingTickers={data.missingEmPairs}
            rowHeaderLabel="Pair"
            rowGroups={emGroups}
            gradientMode="column"
          />
        ) : (
          <div className={styles.relativePlaceholder}>
            EM pair returns unavailable.
          </div>
        )}
      </div>
    </div>
  )
}
