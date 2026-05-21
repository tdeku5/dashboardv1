import { useMemo } from 'react'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import styles from './ReturnsHeatmap.module.css'

const LOOKBACKS: ReadonlyArray<{ key: LookbackKey; label: string }> = [
  { key: '5d',  label: '5D' },
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: '6m',  label: '6M' },
  { key: 'ytd', label: 'YTD' },
]

interface BaseRow {
  ticker: string
  name: string
}

// Row group separator: a thin labeled divider rendered immediately before
// the row at `beforeIndex` (an index into `rows`). Use beforeIndex=0 to label
// the first group at the top.
export interface RowGroup {
  label: string
  beforeIndex: number
}

interface Props<R extends BaseRow> {
  title: string
  subtitle: string
  rows: R[]
  valueAccessor: (row: R, lookback: LookbackKey) => number | null
  missingTickers?: string[]
  // Optional label for the row-header column (default: "Sector").
  rowHeaderLabel?: string
  // Optional region/group separators rendered between rows.
  rowGroups?: RowGroup[]
  // 'table' = single saturation reference across all cells (default).
  // 'column' = each lookback column scales against its own |max|, useful when
  // cross-column magnitudes differ a lot (e.g. 5D vs YTD FX returns).
  gradientMode?: 'table' | 'column'
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  if (rounded === 0) return '0.00%'
  const sign = rounded > 0 ? '+' : '−'
  return `${sign}${Math.abs(rounded).toFixed(2)}%`
}

// Saturation reference passed in from the parent — each heatmap calibrates
// against its own value range so neither washes out next to the other.
function cellBg(value: number | null, maxAbs: number): string | undefined {
  if (value == null || !Number.isFinite(value) || maxAbs <= 0) return undefined
  const intensity = Math.min(Math.abs(value) / maxAbs, 1)
  if (intensity === 0) return undefined
  const alpha = 0.06 + intensity * 0.78
  return value >= 0
    ? `rgba(37, 99, 235, ${alpha})`
    : `rgba(220, 38, 38, ${alpha})`
}

function cellTextColor(value: number | null, maxAbs: number): string | undefined {
  if (value == null || !Number.isFinite(value) || maxAbs <= 0) return undefined
  return Math.abs(value) / maxAbs > 0.5 ? '#ffffff' : undefined
}

export function ReturnsHeatmap<R extends BaseRow>({
  title,
  subtitle,
  rows,
  valueAccessor,
  missingTickers,
  rowHeaderLabel = 'Sector',
  rowGroups,
  gradientMode = 'table',
}: Props<R>) {
  const groupByIndex = useMemo(() => {
    const m = new Map<number, string>()
    if (rowGroups) for (const g of rowGroups) m.set(g.beforeIndex, g.label)
    return m
  }, [rowGroups])
  const cellValues = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const r of rows) {
      for (const lb of LOOKBACKS) {
        m.set(`${r.ticker}|${lb.key}`, valueAccessor(r, lb.key))
      }
    }
    return m
  }, [rows, valueAccessor])

  const tableMaxAbs = useMemo(() => {
    let max = 0
    for (const v of cellValues.values()) {
      if (v != null && Number.isFinite(v)) {
        const a = Math.abs(v)
        if (a > max) max = a
      }
    }
    return max
  }, [cellValues])

  const columnMaxAbs = useMemo(() => {
    const m: Record<string, number> = {}
    for (const lb of LOOKBACKS) {
      let max = 0
      for (const r of rows) {
        const v = cellValues.get(`${r.ticker}|${lb.key}`)
        if (v != null && Number.isFinite(v)) {
          const a = Math.abs(v)
          if (a > max) max = a
        }
      }
      m[lb.key] = max
    }
    return m
  }, [rows, cellValues])

  const refForLookback = (lb: LookbackKey): number =>
    gradientMode === 'column' ? columnMaxAbs[lb] ?? 0 : tableMaxAbs

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>

      {missingTickers && missingTickers.length > 0 && (
        <div className={styles.warning}>
          Missing data for: {missingTickers.join(', ')}
        </div>
      )}

      <div className={styles.table} role="table" aria-label={`${title} heatmap`}>
        <div className={`${styles.row} ${styles.headRow}`} role="row">
          <div className={`${styles.cell} ${styles.sectorCell} ${styles.headCell}`} role="columnheader">{rowHeaderLabel}</div>
          {LOOKBACKS.map((lb) => (
            <div
              key={lb.key}
              className={`${styles.cell} ${styles.dataCell} ${styles.headCell}`}
              role="columnheader"
            >
              {lb.label}
            </div>
          ))}
        </div>

        {rows.map((r, idx) => {
          const groupLabel = groupByIndex.get(idx)
          return (
            <div key={r.ticker} style={{ display: 'contents' }}>
              {groupLabel && (
                <div className={styles.groupRow} role="row" aria-label={groupLabel}>
                  <div className={styles.groupLabel}>{groupLabel}</div>
                </div>
              )}
              <div className={styles.row} role="row">
                <div className={`${styles.cell} ${styles.sectorCell}`} role="rowheader">
                  <span className={styles.sectorName} title={r.name || r.ticker}>
                    {r.name || r.ticker}
                  </span>
                  {r.name && r.ticker && r.name !== r.ticker && (
                    <span className={styles.sectorTicker}>{r.ticker}</span>
                  )}
                </div>
                {LOOKBACKS.map((lb) => {
                  const v = cellValues.get(`${r.ticker}|${lb.key}`) ?? null
                  const ref = refForLookback(lb.key)
                  const bg = cellBg(v, ref)
                  const color = cellTextColor(v, ref)
                  return (
                    <div
                      key={lb.key}
                      className={styles.cell + ' ' + styles.dataCell}
                      style={{ background: bg, color }}
                      role="cell"
                    >
                      {fmtPct(v)}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
