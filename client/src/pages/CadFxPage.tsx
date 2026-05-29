// CAD FX page — loonie crosses, oriented with CAD as numerator. Every CADxxx
// source pair is already CAD-first; only CADUSD needs inverting (from USDCAD).
// EURCAD/CADEUR dedup: this page uses CADEUR (CAD-first); the EU page uses
// EURCAD. Never both on one page.

import { ModelCurrencyFxPage } from './ModelCurrencyFxPage'
import type { CrossSpec } from '../components/CrossesStrengthChart'

const CAD_CROSSES: ReadonlyArray<CrossSpec> = [
  { symbol: 'CADGBP', label: 'CADGBP', invert: false, color: '#a78bfa' },
  { symbol: 'CADEUR', label: 'CADEUR', invert: false, color: '#60a5fa' },
  { symbol: 'CADJPY', label: 'CADJPY', invert: false, color: '#f472b6' },
  { symbol: 'CADAUD', label: 'CADAUD', invert: false, color: '#22d3ee' },
  { symbol: 'CADCHF', label: 'CADCHF', invert: false, color: '#fbbf24' },
  { symbol: 'CADCNH', label: 'CADCNH', invert: false, color: '#e2e8f0' },
  { symbol: 'USDCAD', label: 'CADUSD', invert: true,  color: '#facc15' },
]

export function CadFxPage() {
  return <ModelCurrencyFxPage model="CAD" crosses={CAD_CROSSES} />
}
