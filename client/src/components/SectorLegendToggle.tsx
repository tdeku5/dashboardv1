import type { AcmLegendItem } from './acm'
import { SECTORS } from '../constants/sectors'
import { SECTOR_COLORS, SECTOR_SHORT_NAME, INDEX_COLOR } from '../constants/sectorColors'

// E1: the sector legend is the chart frame's legend (AcmChartFrame); this
// builds its items — INDEX first, then the sectors in display order, each in
// its registry identity colour. Clicking toggles the series.
interface Args {
  hiddenSectors: Set<string>
  hideIndex: boolean
  onToggleSector: (ticker: string) => void
  onToggleIndex: () => void
}

export function sectorLegendItems({ hiddenSectors, hideIndex, onToggleSector, onToggleIndex }: Args): AcmLegendItem[] {
  return [
    { label: 'INDEX', color: INDEX_COLOR, hidden: hideIndex, onClick: onToggleIndex },
    ...SECTORS.map((s) => ({
      label: SECTOR_SHORT_NAME[s.ticker] ?? s.name,
      color: SECTOR_COLORS[s.ticker],
      hidden: hiddenSectors.has(s.ticker),
      onClick: () => onToggleSector(s.ticker),
    })),
  ]
}
