// ── Legacy static types (panels.ts / PanelConfig) ────────────────────────────

export type ChangeDirection   = 'up' | 'down' | 'flat'
export type PositiveDirection = 'up' | 'down' | 'neutral'

export interface Indicator {
  id:                string
  label:             string
  value:             string
  change:            string
  direction:         ChangeDirection
  positiveDirection: PositiveDirection
  period:            string
}

export interface PanelConfig {
  id:          string
  title:       string
  accentColor: string
  indicators:  Indicator[]  // kept for shape compat; unused once live
}

// ── Live data types ───────────────────────────────────────────────────────────

/** A single computed column in a live data row. */
export interface Cell {
  sub: string                    // small sub-label: "YoY", "6mo Lag", etc.
  val: string                    // formatted display value
  dir?: 'up' | 'down' | 'flat'  // movement (undefined → no colour)
  pos?: 'up' | 'down'           // which direction is "good" (undefined → neutral)
}

/** One FRED series rendered as a row inside a panel. */
export interface LiveRow {
  id:           string
  label:        string
  cells:        [Cell, Cell, Cell, Cell]
  lastDate?:    string   // "Nov 2024"  – display
  lastRawDate?: string   // "2024-11-01" – staleness check
  seriesFreq?:  'daily' | 'weekly' | 'monthly' | 'quarterly'
  regimeHistory?: number[] // chronological series used for regime signals (YoY% for most series, raw level for UNRATE)
  status:       'loading' | 'ready' | 'error'
  errorMsg?:    string
}

/** Live data state for one dashboard panel. */
export interface LivePanelData {
  id:      string
  rows:    LiveRow[]
  loading: boolean
}
