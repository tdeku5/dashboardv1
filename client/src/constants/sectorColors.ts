// Stable per-sector palette used in the contribution chart, legend chips, and
// any future sector-keyed visualization. Source-of-truth — import from here
// instead of hardcoding hex codes elsewhere.
export const SECTOR_COLORS: Record<string, string> = {
  XLK:  '#3b82f6', // Technology — blue
  XLE:  '#f97316', // Energy — orange
  XLV:  '#06b6d4', // Health Care — cyan
  XLF:  '#10b981', // Financials — green-blue
  XLY:  '#ec4899', // Consumer Discretionary — pink
  XLP:  '#84cc16', // Consumer Staples — lime
  XLI:  '#64748b', // Industrials — steel
  XLC:  '#6366f1', // Communication Services — indigo
  XLB:  '#a16207', // Materials — brown
  XLU:  '#eab308', // Utilities — gold
  XLRE: '#14b8a6', // Real Estate — teal
}

export const INDEX_COLOR = '#ffffff'

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
