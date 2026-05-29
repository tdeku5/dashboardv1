// UK FX page — sterling crosses, oriented so GBP is always the numerator.
// Lines marked "(inv)" come from a source pair where GBP is the QUOTE
// currency; inverting (1/x) flips the series so rising = stronger sterling.

import { ModelCurrencyFxPage } from './ModelCurrencyFxPage'
import type { CrossSpec } from '../components/CrossesStrengthChart'

const GBP_CROSSES: ReadonlyArray<CrossSpec> = [
  { symbol: 'EURGBP', label: 'GBPEUR', invert: true,  color: '#60a5fa' },
  { symbol: 'AUDGBP', label: 'GBPAUD', invert: true,  color: '#22d3ee' },
  { symbol: 'CADGBP', label: 'GBPCAD', invert: true,  color: '#f87171' },
  { symbol: 'JPYGBP', label: 'GBPJPY', invert: true,  color: '#f472b6' },
  { symbol: 'CHFGBP', label: 'GBPCHF', invert: true,  color: '#fbbf24' },
  { symbol: 'GBPCNH', label: 'GBPCNH', invert: false, color: '#e2e8f0' },
  { symbol: 'GBPUSD', label: 'GBPUSD', invert: false, color: '#facc15' },
]

export function UkFxPage() {
  return <ModelCurrencyFxPage model="GBP" crosses={GBP_CROSSES} />
}
