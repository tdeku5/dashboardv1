// AUS FX page — aussie crosses, oriented with AUD as numerator. EUR and CAD
// are quoted with AUD second in the ingest, so those two need inverting.

import { ModelCurrencyFxPage } from './ModelCurrencyFxPage'
import type { CrossSpec } from '../components/CrossesStrengthChart'

const AUD_CROSSES: ReadonlyArray<CrossSpec> = [
  { symbol: 'AUDGBP', label: 'AUDGBP', invert: false, color: '#a78bfa' },
  { symbol: 'EURAUD', label: 'AUDEUR', invert: true,  color: '#60a5fa' },
  { symbol: 'CADAUD', label: 'AUDCAD', invert: true,  color: '#f87171' },
  { symbol: 'AUDJPY', label: 'AUDJPY', invert: false, color: '#f472b6' },
  { symbol: 'AUDCHF', label: 'AUDCHF', invert: false, color: '#fbbf24' },
  { symbol: 'AUDCNH', label: 'AUDCNH', invert: false, color: '#e2e8f0' },
  { symbol: 'AUDUSD', label: 'AUDUSD', invert: false, color: '#facc15' },
]

export function AusFxPage() {
  return <ModelCurrencyFxPage model="AUD" crosses={AUD_CROSSES} />
}
