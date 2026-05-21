export type CavKey = 'vix' | 'move' | 'gvz' | 'ovx' | 'bvol'

export interface CavSeriesDef {
  key: CavKey
  // Short label shown on legend chips and tooltips.
  label: string
  // Long descriptor shown in subtitles / "missing data" notices.
  longName: string
  // Stable color used across both charts and the legend.
  color: string
}

// User-specified display order and palette. Each ticker maps to a distinct
// hue so the levels chart, z-score chart, legend chips, and summary table
// share a coherent color identity.
export const CROSS_ASSET_VOL_SERIES: ReadonlyArray<CavSeriesDef> = [
  { key: 'vix',  label: 'VIX',  longName: 'Equity Vol (VIX)',   color: '#ef4444' },
  { key: 'move', label: 'MOVE', longName: 'Rates Vol (MOVE)',   color: '#3b82f6' },
  { key: 'gvz',  label: 'GVZ',  longName: 'Gold Vol (GVZ)',     color: '#eab308' },
  { key: 'ovx',  label: 'OVX',  longName: 'Oil Vol (OVX)',      color: '#10b981' },
  { key: 'bvol', label: 'BVOL', longName: 'Bitcoin Vol (BVOL)', color: '#a855f7' },
]

export const CAV_KEYS: ReadonlyArray<CavKey> = CROSS_ASSET_VOL_SERIES.map(s => s.key)

export const CAV_COLOR: Record<CavKey, string> =
  Object.fromEntries(CROSS_ASSET_VOL_SERIES.map(s => [s.key, s.color])) as Record<CavKey, string>

export const CAV_LABEL: Record<CavKey, string> =
  Object.fromEntries(CROSS_ASSET_VOL_SERIES.map(s => [s.key, s.label])) as Record<CavKey, string>

export const CAV_LONG_NAME: Record<CavKey, string> =
  Object.fromEntries(CROSS_ASSET_VOL_SERIES.map(s => [s.key, s.longName])) as Record<CavKey, string>
