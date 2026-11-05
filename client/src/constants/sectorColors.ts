import { SECTOR_COLORS as REGISTRY_SECTOR_COLORS, SECTOR_INDEX_COLOR } from './identityColors'

// Stable per-sector palette for the contribution chart, legend and tiles: the
// identity registry's SECTOR_COLORS (E1; XLB lifted in Phase 1 for contrast).
export const SECTOR_COLORS: Record<string, string> = REGISTRY_SECTOR_COLORS

/** The SPY / index line. */
export const INDEX_COLOR = SECTOR_INDEX_COLOR

// Short labels used in compact tile rows / legend chips.
export const SECTOR_SHORT_NAME: Record<string, string> = {
  XLK:  'Info Tech',
  XLE:  'Energy',
  XLV:  'Health Care',
  XLF:  'Financials',
  XLY:  'Cons. Disc.',
  XLP:  'Cons. Staples',
  XLI:  'Industrials',
  XLC:  'Comm. Services',
  XLB:  'Materials',
  XLU:  'Utilities',
  XLRE: 'Real Estate',
}
