import { AcmStatStrip, AcmStatTile } from './acm'
import { SECTOR_COLORS, SECTOR_SHORT_NAME } from '../constants/sectorColors'
import { fmtSignedPct, returnTone } from '../pages/equitiesShared'
import styles from './SectorStatTiles.module.css'

// E1 colour rules:
//  • INDEX tile — SPY's rolling return: valence (up = positive, down =
//    negative); none when it prints as 0.00%.
//  • Sector tiles — CONTRIBUTIONS (weight × sector return, in index-return
//    points; they sum to the index return). Whether they read as returns
//    (valence) or shares of a total (plain) is pending the user's ruling, so
//    they render plain primary text for now. (Were red when negative, the
//    sector colour otherwise.) The sector's identity colour stays on the
//    tile's swatch bar.

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

const fmtPct = (v: number) => fmtSignedPct(v, 2)
const fmtWeight = (w: number) => `${(w * 100).toFixed(2)}%`

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
    <AcmStatStrip>
      <AcmStatTile label="INDEX · SPY" value={indexReturn} format={fmtPct} tone={returnTone(indexReturn)} />
      {ranked.map((t) => (
        <div key={t.ticker} className={styles.sstIdentity} style={{ ['--sst-identity' as string]: SECTOR_COLORS[t.ticker] }}>
          <AcmStatTile
            label={SECTOR_SHORT_NAME[t.ticker] ?? t.ticker}
            value={t.contribution}
            format={fmtPct}
            delta={{ value: fmtWeight(t.weight), label: 'weight' }}
          />
        </div>
      ))}
    </AcmStatStrip>
  )
}
