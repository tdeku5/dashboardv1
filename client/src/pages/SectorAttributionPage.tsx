import { useCallback } from 'react'
import { ReturnsHeatmap } from '../components/ReturnsHeatmap'
import { SectorContributionChart } from '../components/SectorContributionChart'
import { useSectorAttribution, type LookbackKey, type SectorAttributionRow } from '../hooks/useSectorAttribution'
import styles from './SectorAttributionPage.module.css'

function outrightAccessor(s: SectorAttributionRow, lb: LookbackKey): number | null {
  return s.returns[lb]
}

export function SectorAttributionPage() {
  const { data, loading, error } = useSectorAttribution()

  const benchmark = data?.benchmark ?? null
  const relativeAccessor = useCallback(
    (s: SectorAttributionRow, lb: LookbackKey): number | null => {
      if (!benchmark) return null
      const v = s.returns[lb]
      const bv = benchmark.returns[lb]
      return v != null && bv != null ? v - bv : null
    },
    [benchmark],
  )

  if (loading) {
    return <div className={styles.placeholder}>Loading sector attribution…</div>
  }
  if (error) {
    return <div className={styles.placeholder}>Failed to load: {error}</div>
  }
  if (!data || data.sectors.length === 0) {
    const missing = data?.missingTickers ?? []
    return (
      <div className={styles.placeholder}>
        Data unavailable {missing.length ? `— check ingestion for: ${missing.join(', ')}` : '— no sector ETF data ingested.'}
      </div>
    )
  }

  const asOf = data.asOfDate ?? '—'

  return (
    <div className={styles.shell}>
      <div className={styles.heatmapsRow}>
        <ReturnsHeatmap
          title="OUTRIGHT"
          subtitle={`as of ${asOf}`}
          rows={data.sectors}
          valueAccessor={outrightAccessor}
          missingTickers={data.missingTickers}
          gradientMode="column"
        />

        {benchmark ? (
          <ReturnsHeatmap
            title={`RELATIVE (vs ${benchmark.ticker})`}
            subtitle={`as of ${asOf} · vs ${benchmark.ticker}`}
            rows={data.sectors}
            valueAccessor={relativeAccessor}
            missingTickers={data.missingTickers}
            gradientMode="column"
          />
        ) : (
          <div className={styles.relativePlaceholder}>
            Relative view unavailable — SPY data not found in tv_series.
          </div>
        )}
      </div>

      <SectorContributionChart />
    </div>
  )
}
