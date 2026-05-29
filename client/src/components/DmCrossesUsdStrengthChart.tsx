// 10 DM USD crosses, normalized so every line reads as "USD strength" — rising
// = stronger USD. Crosses come in two quote conventions:
//
//   USD-base (USDxxx): rising rate already means stronger USD → keep as-is.
//   USD-quote (xxxUSD): rising rate means *weaker* USD → invert (1/x).
//
// This file used to host the whole chart; it now just wraps the generalized
// CrossesStrengthChart with the US-specific cross list. All other model pages
// (UK, EU, CAD, JPY, AUS) call CrossesStrengthChart directly with their lists.

import { CrossesStrengthChart, type CrossSpec } from './CrossesStrengthChart'

const CROSSES: ReadonlyArray<CrossSpec> = [
  // USD as quote → INVERT so rising = stronger USD
  { symbol: 'EURUSD', label: 'EURUSD (inv)', invert: true,  color: '#60a5fa' },
  { symbol: 'GBPUSD', label: 'GBPUSD (inv)', invert: true,  color: '#a78bfa' },
  { symbol: 'AUDUSD', label: 'AUDUSD (inv)', invert: true,  color: '#22d3ee' },
  { symbol: 'NZDUSD', label: 'NZDUSD (inv)', invert: true,  color: '#34d399' },
  // USD as base → KEEP AS-IS (rising rate already means stronger USD)
  { symbol: 'USDCAD', label: 'USDCAD',       invert: false, color: '#f87171' },
  { symbol: 'USDJPY', label: 'USDJPY',       invert: false, color: '#f472b6' },
  { symbol: 'USDCHF', label: 'USDCHF',       invert: false, color: '#fbbf24' },
  { symbol: 'USDNOK', label: 'USDNOK',       invert: false, color: '#fb923c' },
  { symbol: 'USDSEK', label: 'USDSEK',       invert: false, color: '#4ade80' },
  { symbol: 'USDCNH', label: 'USDCNH',       invert: false, color: '#e2e8f0' },
]

export function DmCrossesUsdStrengthChart() {
  return (
    <CrossesStrengthChart
      model="USD"
      crosses={CROSSES}
      // Preserves the previous subtitle, which calls out the inversion explicitly.
      subtitle="All crosses normalized to USD strength (rising = stronger USD) · EUR/GBP/AUD/NZD inverted"
    />
  )
}
