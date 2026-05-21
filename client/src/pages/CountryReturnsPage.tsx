import { useCallback, useMemo } from 'react'
import { ReturnsHeatmap } from '../components/ReturnsHeatmap'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import {
  useCountryReturns,
  type CountryReturnsRow as RawCountryRow,
} from '../hooks/useCountryReturns'
import styles from './SectorAttributionPage.module.css'

interface HeatmapRow {
  ticker: string
  name: string
  source: RawCountryRow
}

export function CountryReturnsPage() {
  const { data, loading, error } = useCountryReturns()

  const rows: HeatmapRow[] = useMemo(() => {
    if (!data) return []
    return data.countries.map((c) => ({
      ticker: c.ticker,
      name: c.displayName,
      source: c,
    }))
  }, [data])

  const localAccessor = useCallback(
    (r: HeatmapRow, lb: LookbackKey): number | null => r.source.returnsLocal[lb],
    [],
  )
  const usdAccessor = useCallback(
    (r: HeatmapRow, lb: LookbackKey): number | null => r.source.returnsUsd[lb],
    [],
  )

  if (loading) {
    return <div className={styles.placeholder}>Loading country returns…</div>
  }
  if (error) {
    return <div className={styles.placeholder}>Failed to load: {error}</div>
  }
  if (!data || data.countries.length === 0) {
    return <div className={styles.placeholder}>Country returns unavailable.</div>
  }

  const asOf = data.asOfDate ?? '—'
  const missingFxLabels = (data.missingFxTickers ?? []).join(', ')

  return (
    <div className={styles.shell}>
      {data.warnings.length > 0 && (
        <div className={styles.relativePlaceholder}>
          {data.warnings.join(' · ')}
        </div>
      )}

      <div className={styles.heatmapsRow}>
        <ReturnsHeatmap
          title="LOCAL CURRENCY"
          subtitle={`as of ${asOf}`}
          rows={rows}
          valueAccessor={localAccessor}
          missingTickers={data.missingIndexTickers}
          rowHeaderLabel="Country"
          gradientMode="column"
        />

        <ReturnsHeatmap
          title="USD"
          subtitle={
            missingFxLabels
              ? `as of ${asOf} · USD conversion missing: ${missingFxLabels}`
              : `as of ${asOf}`
          }
          rows={rows}
          valueAccessor={usdAccessor}
          missingTickers={data.missingIndexTickers}
          rowHeaderLabel="Country"
          gradientMode="column"
        />
      </div>
    </div>
  )
}
