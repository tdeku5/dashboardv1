// JPY FX page — yen crosses, oriented with JPY as numerator. JPY is the
// quote currency on most majors (EURJPY, USDJPY, AUDJPY, CADJPY) so most
// sources need inverting; rising line = stronger yen.

import { ModelCurrencyFxPage } from './ModelCurrencyFxPage'
import type { CrossSpec } from '../components/CrossesStrengthChart'

const JPY_CROSSES: ReadonlyArray<CrossSpec> = [
  { symbol: 'JPYGBP', label: 'JPYGBP', invert: false, color: '#a78bfa' },
  { symbol: 'EURJPY', label: 'JPYEUR', invert: true,  color: '#60a5fa' },
  { symbol: 'CADJPY', label: 'JPYCAD', invert: true,  color: '#f87171' },
  { symbol: 'AUDJPY', label: 'JPYAUD', invert: true,  color: '#22d3ee' },
  { symbol: 'JPYCHF', label: 'JPYCHF', invert: false, color: '#fbbf24' },
  { symbol: 'CNHJPY', label: 'JPYCNH', invert: true,  color: '#e2e8f0' },
  { symbol: 'USDJPY', label: 'JPYUSD', invert: true,  color: '#facc15' },
]

export function JpyFxPage() {
  return <ModelCurrencyFxPage model="JPY" crosses={JPY_CROSSES} />
}
