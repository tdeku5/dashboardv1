import type { Cell, LiveRow } from '../types'
import styles from './LiveRow.module.css'

// ── Staleness ─────────────────────────────────────────────────────────────────

const STALE_MS: Record<NonNullable<LiveRow['seriesFreq']>, number> = {
  daily:     14  * 24 * 60 * 60 * 1000,
  weekly:    14  * 24 * 60 * 60 * 1000,
  monthly:   60  * 24 * 60 * 60 * 1000,
  quarterly: 120 * 24 * 60 * 60 * 1000,
}

function checkStale(lastRawDate?: string, freq?: LiveRow['seriesFreq']): boolean {
  if (!lastRawDate) return false
  const t = Date.parse(lastRawDate + 'T12:00:00')
  return !isNaN(t) && (Date.now() - t) > STALE_MS[freq ?? 'monthly']
}

// ── Cell colour ───────────────────────────────────────────────────────────────

function cellColour(cell: Cell): string | undefined {
  if (!cell.dir || cell.dir === 'flat' || !cell.pos) return undefined
  const good =
    (cell.pos === 'up'   && cell.dir === 'up') ||
    (cell.pos === 'down' && cell.dir === 'down')
  return good ? 'var(--positive)' : 'var(--negative)'
}

// ── Regime signal ─────────────────────────────────────────────────────────────

type Signal = '+' | '-' | '|' | null

/**
 * Compares the last value in `history` against the trailing X-period mean
 * of `history` (inclusive of the last value).  Returns null if insufficient data.
 */
function calcSignal(history: number[], maWindow: number): Signal {
  if (history.length < 2) return null
  const curr   = history[history.length - 1]
  const window = history.slice(-maWindow)
  const ma     = window.reduce((a, b) => a + b, 0) / window.length
  const diff   = curr - ma
  if (Math.abs(diff) < 1e-10) return '|'
  return diff > 0 ? '+' : '-'
}

function signalColour(s: Signal): string | undefined {
  if (s === '+') return 'var(--positive)'
  if (s === '-') return 'var(--negative)'
  if (s === '|') return '#f59e0b'
  return undefined
}

function RegimeSignals({ history, maWindow }: { history?: number[]; maWindow: number }) {
  const curr = history && history.length >= 2
    ? calcSignal(history, maWindow)
    : null
  const prev = history && history.length >= 3
    ? calcSignal(history.slice(0, -1), maWindow)
    : null

  return (
    <>
      <div className={styles.sep} aria-hidden />
      <div className={styles.regimeCell}>
        <span className={styles.cellSub}>PREV</span>
        {prev !== null
          ? <span className={styles.regimeSignal} style={{ color: signalColour(prev) }}>{prev}</span>
          : <span className={styles.regimePlaceholder}>—</span>
        }
      </div>
      <div className={styles.regimeCell}>
        <span className={styles.cellSub}>CURR</span>
        {curr !== null
          ? <span className={styles.regimeSignal} style={{ color: signalColour(curr) }}>{curr}</span>
          : <span className={styles.regimePlaceholder}>—</span>
        }
      </div>
    </>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className={styles.skeletonRow}>
      <div className={styles.skeletonLabel}>
        <div className={`${styles.skeletonBar} ${styles.skeletonLabelMain}`} />
        <div className={`${styles.skeletonBar} ${styles.skeletonLabelSub}`} />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonCell}>
          <div className={`${styles.skeletonBar} ${styles.skeletonCellSub}`} />
          <div className={`${styles.skeletonBar} ${styles.skeletonCellVal}`} />
        </div>
      ))}
      {/* Separator + 2 regime skeleton cells */}
      <div className={styles.sep} aria-hidden />
      {[0, 1].map((i) => (
        <div key={i} className={styles.skeletonCell}>
          <div className={`${styles.skeletonBar} ${styles.skeletonCellSub}`} />
          <div className={`${styles.skeletonBar} ${styles.skeletonCellVal}`} />
        </div>
      ))}
    </div>
  )
}

// ── Error row ─────────────────────────────────────────────────────────────────

function ErrorRow({ row }: { row: LiveRow }) {
  return (
    <div className={styles.errorRow}>
      <span className={styles.errorLabel}>{row.label}</span>
      <span className={styles.errorMsg}>{row.errorMsg ?? 'Failed to load'}</span>
      <div className={styles.sep} aria-hidden />
      <div /><div />
    </div>
  )
}

// ── Ready row ─────────────────────────────────────────────────────────────────

function ReadyRow({ row, maWindow }: { row: LiveRow; maWindow: number }) {
  const stale = checkStale(row.lastRawDate, row.seriesFreq)

  return (
    <div className={styles.row}>
      {/* Label column */}
      <div className={styles.labelCell}>
        <div className={styles.labelTop}>
          <span className={styles.label}>{row.label}</span>
          {stale && (
            <span className={styles.staleWrap}>
              <span className={styles.staleIcon}>⚠</span>
              <div className={styles.staleTooltip}>
                Last observation: {row.lastDate ?? row.lastRawDate}
              </div>
            </span>
          )}
        </div>
        {row.lastDate && (
          <span className={styles.lastDate}>{row.lastDate}</span>
        )}
      </div>

      {/* 4 data cells — empty sentinel (sub='', val='—') renders as blank spacer */}
      {row.cells.map((cell, i) =>
        cell.sub === '' && cell.val === '—'
          ? <div key={i} />
          : (
            <div key={i} className={styles.cell}>
              <span className={styles.cellSub}>{cell.sub}</span>
              <span
                className={styles.cellVal}
                style={{ color: cellColour(cell) }}
              >
                {cell.val}
              </span>
            </div>
          )
      )}

      <RegimeSignals history={row.regimeHistory} maWindow={maWindow} />
    </div>
  )
}

// ── Public ────────────────────────────────────────────────────────────────────

export function LiveRow({ row, maWindow }: { row: LiveRow; maWindow: number }) {
  if (row.status === 'loading') return <SkeletonRow />
  if (row.status === 'error')   return <ErrorRow row={row} />
  return <ReadyRow row={row} maWindow={maWindow} />
}
