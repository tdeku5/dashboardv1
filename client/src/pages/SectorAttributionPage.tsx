import { useCallback } from 'react'
import { ReturnsHeatmap } from '../components/ReturnsHeatmap'
import { SectorContributionChart } from '../components/SectorContributionChart'
import { useSectorAttribution, type LookbackKey, type SectorAttributionRow } from '../hooks/useSectorAttribution'
import { AcmPageHeader } from '../components/acm'
import { EqState, eqStyles } from './equitiesShared'

// E1: OUTRIGHT (sector returns) and RELATIVE (sector − SPY, relative
// performance) are returns → the valence ReturnsHeatmap. Contribution tiles:
// see SectorStatTiles (classification pending the user's ruling).

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
    return <EqState>Loading sector attribution…</EqState>
  }
  if (error) {
    return <EqState error>Failed to load: {error}</EqState>
  }
  if (!data || data.sectors.length === 0) {
    const missing = data?.missingTickers ?? []
    return (
      <EqState>
        Data unavailable {missing.length ? `— check ingestion for: ${missing.join(', ')}` : '— no sector ETF data ingested.'}
      </EqState>
    )
  }

  const asOf = data.asOfDate ?? '—'

  return (
    <div className={eqStyles.eqShell}>
      <AcmPageHeader title="SECTOR ATTRIBUTION" subtitle="S&P 500 sector ETFs · outright and relative to SPY" asOf={asOf} />
      <div className={eqStyles.eqTwoUp}>
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
          <EqState>Relative view unavailable — SPY data not found in tv_series.</EqState>
        )}
      </div>

      <SectorContributionChart />
    </div>
  )
}
