import { SECTOR_COLORS, SECTOR_SHORT_NAME, INDEX_COLOR } from '../constants/sectorColors'
import styles from './SectorStatTiles.module.css'

export interface SectorTileInput {
  ticker: string
  return_: number
  contribution: number
  weight: number
}

interface Props {
  indexReturn: number | null
  sectorTiles: SectorTileInput[]
  // Number of sector tiles to show (excluding INDEX). Default 6.
  topN?: number
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  if (rounded === 0) return '0.00%'
  const sign = rounded > 0 ? '+' : '−'
  return `${sign}${Math.abs(rounded).toFixed(2)}%`
}

function fmtWeight(w: number): string {
  return `${(w * 100).toFixed(2)}%`
}

function returnColor(v: number | null, fallback: string): string {
  if (v == null || !Number.isFinite(v)) return '#728197'
  if (v < 0) return '#ef4444'
  return fallback
}

export function SectorStatTiles({ indexReturn, sectorTiles, topN = 6 }: Props) {
  // Largest absolute contributors first. Ties at display precision (2dp) are
  // broken by sector weight desc — larger weights have more inherent potential
  // to move the index, so they appear first when |contribution| is visually tied.
  const ranked = [...sectorTiles].sort((a, b) => {
    const absA = Math.round(Math.abs(a.contribution) * 100) / 100
    const absB = Math.round(Math.abs(b.contribution) * 100) / 100
    if (absB !== absA) return absB - absA
    return b.weight - a.weight
  }).slice(0, topN)

  return (
    <div className={styles.row}>
      <div className={styles.tile} style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
        <div className={styles.tileLabel}>INDEX</div>
        <div
          className={styles.tileValue}
          style={{ color: returnColor(indexReturn, INDEX_COLOR) }}
        >
          {fmtPct(indexReturn)}
        </div>
        <div className={styles.tileSub}>SPY</div>
      </div>

      {ranked.map((t) => {
        const color = SECTOR_COLORS[t.ticker] ?? '#94A3B8'
        return (
          <div
            key={t.ticker}
            className={styles.tile}
            style={{ borderColor: 'rgba(255,255,255,0.10)' }}
          >
            <div className={styles.tileLabel}>
              <span className={styles.dot} style={{ background: color }} />
              {SECTOR_SHORT_NAME[t.ticker] ?? t.ticker}
            </div>
            <div
              className={styles.tileValue}
              style={{ color: returnColor(t.contribution, color) }}
            >
              {fmtPct(t.contribution)}
            </div>
            <div className={styles.tileSub}>w: {fmtWeight(t.weight)}</div>
          </div>
        )
      })}
    </div>
  )
}
