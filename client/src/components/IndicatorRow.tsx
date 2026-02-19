import { Indicator, ChangeDirection, PositiveDirection } from '../types'
import styles from './IndicatorRow.module.css'

function changeColor(direction: ChangeDirection, positiveDir: PositiveDirection): string {
  if (direction === 'flat' || positiveDir === 'neutral') return 'var(--neutral)'
  const good =
    (positiveDir === 'up'   && direction === 'up') ||
    (positiveDir === 'down' && direction === 'down')
  return good ? 'var(--positive)' : 'var(--negative)'
}

interface Props {
  indicator: Indicator
}

export function IndicatorRow({ indicator }: Props) {
  const color = changeColor(indicator.direction, indicator.positiveDirection)

  return (
    <div className={styles.row}>
      <span className={styles.label}>{indicator.label}</span>
      <span className={styles.value}>{indicator.value}</span>
      <span className={styles.change} style={{ color }}>{indicator.change}</span>
      <span className={styles.period}>{indicator.period}</span>
    </div>
  )
}
