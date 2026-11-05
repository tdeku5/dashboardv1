import { useMemo } from 'react'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import { AcmPanel, fmtSignedFixed, roundForDisplay } from './acm'
import { cx } from './acm/acmFormat'
import styles from './ReturnsHeatmap.module.css'

// Named heatmap (design notes rule 3), E1: returns are VALENCE — up fills from
// --acm-heat-positive-*, down from --acm-heat-negative-* (was blue / red).
// Four steps by |value| ÷ the column's (or table's) max |value|, as the STIR
// strip: (0, 25%] → 1 … (75, 100%] → 4. A value that prints as 0.00% gets no
// fill (near-zero rule). Cell text is always primary; no tone, no alerts.
// Shared with FX, COMMODITIES and EQUITIES GLOBAL (props unchanged); puts
// acm-root on its own outermost element (component-level root rule).

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

/** Signed 2dp percent, ASCII '-'; '0.00%' when it rounds to zero. */
function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, 2, '%')
}

const HEAT_THRESHOLDS = [0.25, 0.5, 0.75] as const

/** The valence heat class for a cell; undefined (no fill) for null or a value that prints as zero. */
export function returnsHeatClass(value: number | null, maxAbs: number): string | undefined {
  if (value == null || !Number.isFinite(value) || maxAbs <= 0) return undefined
  const shown = roundForDisplay(value, 2)
  if (shown === 0) return undefined
  const intensity = Math.min(Math.abs(value) / maxAbs, 1)
  const step = 1 + HEAT_THRESHOLDS.filter((t) => intensity > t).length
  return styles[`rhHeat${shown > 0 ? 'Positive' : 'Negative'}${step}`]
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
    <AcmPanel title={title} actions={<span className={styles.rhSubtitle}>{subtitle}</span>}>
      {missingTickers && missingTickers.length > 0 && (
        <div className={styles.rhWarning}>Missing data for: {missingTickers.join(', ')}</div>
      )}

      <div className={styles.rhTable} role="table" aria-label={`${title} heatmap`}>
        <div className={cx(styles.rhRow, styles.rhHeadRow)} role="row">
          <div className={cx(styles.rhCell, styles.rhNameCell, styles.rhHeadCell)} role="columnheader">{rowHeaderLabel}</div>
          {LOOKBACKS.map((lb) => (
            <div key={lb.key} className={cx(styles.rhCell, styles.rhDataCell, styles.rhHeadCell)} role="columnheader">
              {lb.label}
            </div>
          ))}
        </div>

        {rows.map((r, idx) => {
          const groupLabel = groupByIndex.get(idx)
          return (
            <div key={r.ticker} className={styles.rhContents}>
              {groupLabel && (
                <div className={styles.rhGroupRow} role="row" aria-label={groupLabel}>
                  <div className={styles.rhGroupLabel}>{groupLabel}</div>
                </div>
              )}
              <div className={styles.rhRow} role="row">
                <div className={cx(styles.rhCell, styles.rhNameCell)} role="rowheader">
                  <span className={styles.rhName} title={r.name || r.ticker}>
                    {r.name || r.ticker}
                  </span>
                  {r.name && r.ticker && r.name !== r.ticker && (
                    <span className={styles.rhTicker}>{r.ticker}</span>
                  )}
                </div>
                {LOOKBACKS.map((lb) => {
                  const v = cellValues.get(`${r.ticker}|${lb.key}`) ?? null
                  return (
                    <div
                      key={lb.key}
                      data-heat-cell
                      className={cx(styles.rhCell, styles.rhDataCell, 'acm-num', returnsHeatClass(v, refForLookback(lb.key)))}
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
    </AcmPanel>
  )
}
