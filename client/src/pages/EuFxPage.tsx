// EU FX page — euro crosses, oriented with EUR as numerator. Every source
// pair already has EUR first, so no inversions are needed here.
//
// HUF and PLN are included alongside the DM crosses in one combined view
// (per spec). They flow through the same heatmap and chart as the DM lines —
// no separate panel.

import { ModelCurrencyFxPage } from './ModelCurrencyFxPage'
import type { CrossSpec } from '../components/CrossesStrengthChart'
import type { RowGroup } from '../components/ReturnsHeatmap'

const EUR_CROSSES: ReadonlyArray<CrossSpec> = [
  { symbol: 'EURGBP', label: 'EURGBP', invert: false, color: '#a78bfa' },
  { symbol: 'EURJPY', label: 'EURJPY', invert: false, color: '#f472b6' },
  { symbol: 'EURCAD', label: 'EURCAD', invert: false, color: '#f87171' },
  { symbol: 'EURCHF', label: 'EURCHF', invert: false, color: '#fbbf24' },
  { symbol: 'EURCNH', label: 'EURCNH', invert: false, color: '#e2e8f0' },
  { symbol: 'EURAUD', label: 'EURAUD', invert: false, color: '#22d3ee' },
  { symbol: 'EURUSD', label: 'EURUSD', invert: false, color: '#facc15' },
  // EM crosses (CEEMEA). Distinct hues so they don't collide with the DM
  // palette in the 9-line chart.
  { symbol: 'EURHUF', label: 'EURHUF', invert: false, color: '#c084fc' },
  { symbol: 'EURPLN', label: 'EURPLN', invert: false, color: '#fb7185' },
]

// Light row-group separators inside the heatmap distinguish the EM pairs
// from the DM block above without breaking them into a separate component.
const EUR_ROW_GROUPS: RowGroup[] = [
  { label: 'DM', beforeIndex: 0 },
  { label: 'EM', beforeIndex: 7 },  // HUF is row 7 (zero-indexed)
]

export function EuFxPage() {
  return <ModelCurrencyFxPage model="EUR" crosses={EUR_CROSSES} rowGroups={EUR_ROW_GROUPS} />
}
