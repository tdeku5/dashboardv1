import { SECTORS } from '../constants/sectors'
import { SECTOR_COLORS, SECTOR_SHORT_NAME, INDEX_COLOR } from '../constants/sectorColors'
import styles from './SectorLegendToggle.module.css'

interface Props {
  hiddenSectors: Set<string>
  hideIndex: boolean
  onToggleSector: (ticker: string) => void
  onToggleIndex: () => void
}

export function SectorLegendToggle({
  hiddenSectors,
  hideIndex,
  onToggleSector,
  onToggleIndex,
}: Props) {
  return (
    <div className={styles.row}>
      <button
        type="button"
        className={`${styles.chip} ${hideIndex ? styles.chipOff : ''}`}
        onClick={onToggleIndex}
      >
        <span className={styles.dot} style={{ background: INDEX_COLOR }} />
        <span className={styles.label}>INDEX</span>
      </button>

      {SECTORS.map((s) => {
        const off = hiddenSectors.has(s.ticker)
        const color = SECTOR_COLORS[s.ticker] ?? '#94A3B8'
        return (
          <button
            key={s.ticker}
            type="button"
            className={`${styles.chip} ${off ? styles.chipOff : ''}`}
            onClick={() => onToggleSector(s.ticker)}
          >
            <span className={styles.dot} style={{ background: color }} />
            <span className={styles.label}>{SECTOR_SHORT_NAME[s.ticker] ?? s.name}</span>
          </button>
        )
      })}
    </div>
  )
}
