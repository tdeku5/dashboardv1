import type { ReactNode } from 'react'
import '../../styles/acm-tokens.css'
import styles from './AcmDataTable.module.css'
import { cx, displayValue, type AlertLevel, type CellValue, type SignTone } from './acmFormat'
import { alertClass, toneClass } from './tones'

/**
 * A column is either a text LABEL (left-aligned, sans) or a NUMBER
 * (right-aligned, mono, tabular figures).
 *
 * Colour channels (Rule 2): `tone` colours the value TEXT (valence or
 * direction); `alert` tints the CELL background + outline. Heatmap fills are
 * deliberately not offered — they live only in the named heatmap components.
 */
export interface AcmColumn<Row> {
  key: string
  header: ReactNode
  kind: 'label' | 'num'
  value: (row: Row) => CellValue
  /** Number formatting (precision, units, '+'). The table maps U+2212 → '-'. */
  format?: (v: number) => string
  tone?: (row: Row) => SignTone | undefined
  alert?: (row: Row) => AlertLevel | undefined
  /** Header tooltip / long name. */
  title?: string
}

interface Props<Row> {
  columns: ReadonlyArray<AcmColumn<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row, index: number) => string
  /** Keep the header visible while the table scrolls inside a bounded parent. */
  stickyHeader?: boolean
  caption?: string
  className?: string
}

export function AcmDataTable<Row>({ columns, rows, rowKey, stickyHeader, caption, className }: Props<Row>) {
  return (
    <div className={cx('acm-root', styles.wrap, className)}>
      <table className={cx(styles.table, stickyHeader && styles.sticky)}>
        {caption && <caption className={styles.caption}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                scope="col"
                title={c.title}
                className={cx(styles.th, c.kind === 'num' ? styles.num : styles.label)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className={styles.tr}>
              {columns.map(c => {
                const raw = c.value(row)
                const isNull = displayValue(raw) === displayValue(null)
                return (
                  <td
                    key={c.key}
                    data-null={isNull || undefined}
                    className={cx(
                      styles.td,
                      c.kind === 'num' ? cx(styles.num, 'acm-num') : styles.label,
                      alertClass(c.alert?.(row)),
                    )}
                  >
                    <span className={cx(isNull ? styles.null : toneClass(c.tone?.(row)))}>
                      {displayValue(raw, c.format)}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
