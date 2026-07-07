import type { QuickPeriod } from '../../lib/seriesTransforms'
import styles from './ChartKit.module.css'

/** Range quick-select button row shared by the parameterized chart sections. */
export function QuickSelectRow({
  period,
  onSelect,
  periods,
}: {
  period: string
  onSelect: (label: string, count: number) => void
  periods: readonly QuickPeriod[]
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {periods.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${period === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.count)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
