import { ReturnsHeatmap } from './ReturnsHeatmap'
import { useEnergyReturns, type EnergyReturnsRow } from '../hooks/useEnergyReturns'
import type { LookbackKey } from '../hooks/useSectorAttribution'

const returnsAccessor = (row: EnergyReturnsRow, lb: LookbackKey): number | null =>
  row.returns[lb] ?? null

// `ENERGY RETURNS` heatmap shown at the top of the Energy page, above the Crude
// Oil sub-section. Reuses the shared ReturnsHeatmap (same as equities/metals).
export function EnergyReturnsSection() {
  const { data, error } = useEnergyReturns()
  const rows = data?.energy ?? []
  const asOf = data?.asOfDate ?? '—'
  const subtitle = error ? error : `as of ${asOf}`

  return (
    <div style={{ marginBottom: 14 }}>
      <ReturnsHeatmap
        title="ENERGY RETURNS"
        subtitle={subtitle}
        rows={rows}
        valueAccessor={returnsAccessor}
        missingTickers={data?.missingTickers}
        rowHeaderLabel="Contract"
        gradientMode="column"
      />
    </div>
  )
}
