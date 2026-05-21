import { useMemo } from 'react'
import { CAV_KEYS, CAV_COLOR, CAV_LABEL, type CavKey } from '../constants/crossAssetVol'
import type { CavSummaryResponse, CavSummaryTicker } from '../hooks/useCavSummary'
import styles from './VolSummaryTable.module.css'

type ChangeKey = '1d' | '5d' | '1m' | '3m' | 'ytd'
type WindowKey = '6m' | '1y'

const CHANGE_COLS: ReadonlyArray<{ key: ChangeKey; label: string }> = [
  { key: '1d',  label: '1D' },
  { key: '5d',  label: '5D' },
  { key: '1m',  label: '1M' },
  { key: '3m',  label: '3M' },
  { key: 'ytd', label: 'YTD' },
]

const WINDOW_COLS: ReadonlyArray<{ key: WindowKey; label: string }> = [
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
]

// Point-change formatter: vol indices are quoted in points, so 1D/5D/1M/3M/YTD
// columns show absolute moves rather than percent changes. "+3.21" reads
// directly as "VIX up 3.21 points," which is how desks talk about vol moves.
function fmtPoints(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 100) / 100
  if (rounded === 0) return '0.00'
  const sign = rounded > 0 ? '+' : '−'
  return `${sign}${Math.abs(rounded).toFixed(2)}`
}

function fmtCurrent(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

function fmtZ(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : '−'
  return `${sign}${Math.abs(v).toFixed(2)}σ`
}

function fmtPct0(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Math.round(v)}%`
}

// Point-change cell shading: per-column scaling against max-abs of the visible
// rows. Positive = blue, negative = red. Mirrors the returns-heatmap palette
// used elsewhere on the dashboard.
function changeBg(value: number | null, columnMaxAbs: number): string | undefined {
  if (value == null || !Number.isFinite(value) || columnMaxAbs <= 0) return undefined
  const intensity = Math.min(Math.abs(value) / columnMaxAbs, 1)
  if (intensity === 0) return undefined
  const alpha = 0.06 + intensity * 0.55
  return value >= 0
    ? `rgba(37, 99, 235, ${alpha})`
    : `rgba(220, 38, 38, ${alpha})`
}

// Z-score shading: signed gradient with intensity = |z| / 3 so ±3σ saturates.
// Positive z (elevated vol) = red (stress), negative (suppressed vol) = blue.
// Same red/blue convention as the point-change columns, with a flipped sign:
// for changes, blue = up; for z, red = up. Both axes carry signed information
// so they share the palette but each direction is calibrated separately.
function zBg(value: number | null): string | undefined {
  if (value == null || !Number.isFinite(value) || value === 0) return undefined
  const intensity = Math.min(Math.abs(value) / 3, 1)
  const alpha = 0.06 + intensity * 0.55
  return value > 0
    ? `rgba(220, 38, 38, ${alpha})`
    : `rgba(37, 99, 235, ${alpha})`
}

// Single-hue gradient for rank/percentile. 0% = neutral, 100% = fully saturated.
// Rank columns use green, percentile columns use orange so a quick scan reveals
// when range-proximity and distributional-frequency diverge for a given ticker.
// Bounded 0-100 so direction (sign) is not meaningful here.
const RANK_HUE = '34, 197, 94'      // #22c55e — dashboard's standard green
const PCTILE_HUE = '249, 115, 22'   // #f97316 — orange
function rankBg(value: number | null, hue: string): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  const intensity = Math.max(0, Math.min(value, 100)) / 100
  if (intensity === 0) return undefined
  const alpha = intensity * 0.55
  return `rgba(${hue}, ${alpha})`
}

interface Props {
  asOfDate: string | null
  data: CavSummaryResponse | null
  loading: boolean
  error: string | null
}

export function VolSummaryTable({ asOfDate, data, loading, error }: Props) {
  const tickers = data?.tickers ?? []

  // Per-column max-abs across the 5 rows for change-column shading. Computed
  // up-front so each cell pulls the same anchor.
  const changeMaxAbs = useMemo(() => {
    const out: Record<ChangeKey, number> = { '1d': 0, '5d': 0, '1m': 0, '3m': 0, 'ytd': 0 }
    for (const col of CHANGE_COLS) {
      let m = 0
      for (const t of tickers) {
        const v = t.changes[col.key]
        if (v != null && Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v)
      }
      out[col.key] = m
    }
    return out
  }, [tickers])

  const tickerRows: Array<{ key: CavKey; row: CavSummaryTicker | null }> = useMemo(() => {
    const byTicker = new Map<string, CavSummaryTicker>()
    for (const t of tickers) byTicker.set(t.ticker.toUpperCase(), t)
    return CAV_KEYS.map((k) => ({
      key: k,
      row: byTicker.get(CAV_LABEL[k].toUpperCase()) ?? null,
    }))
  }, [tickers])

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>VOL SUMMARY</div>
        <div className={styles.panelSubtitle}>as of {asOfDate ?? '—'}</div>
      </div>

      {loading && <div className={styles.placeholder}>Loading…</div>}
      {error && <div className={styles.placeholder}>Failed to load: {error}</div>}
      {!loading && !error && tickerRows.length === 0 && (
        <div className={styles.placeholder}>No data.</div>
      )}

      {!loading && !error && tickerRows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.tickerCol}>Ticker</th>
                <th>Current</th>
                {CHANGE_COLS.map((c, i) => (
                  <th key={c.key} className={i === 0 ? styles.groupSep : undefined}>{c.label}</th>
                ))}
                {WINDOW_COLS.map((w, i) => (
                  <th key={`z-${w.key}`} className={i === 0 ? styles.groupSep : undefined}>{w.label} Z</th>
                ))}
                {WINDOW_COLS.map((w, i) => (
                  <th key={`r-${w.key}`} className={i === 0 ? styles.groupSep : undefined}>{w.label} Rank</th>
                ))}
                {WINDOW_COLS.map((w, i) => (
                  <th key={`p-${w.key}`} className={i === 0 ? styles.groupSep : undefined}>{w.label} %ile</th>
                ))}
              </tr>
            </thead>
            <tbody className={styles.tbody}>
              {tickerRows.map(({ key, row }) => (
                <tr key={key}>
                  <td className={styles.tickerCell}>
                    <span className={styles.tickerDot} style={{ background: CAV_COLOR[key] }} />
                    <span className={styles.tickerLabel}>{CAV_LABEL[key]}</span>
                  </td>
                  <td className={styles.currentCell}>{fmtCurrent(row?.current ?? null)}</td>

                  {CHANGE_COLS.map((c, i) => {
                    const v = row?.changes[c.key] ?? null
                    return (
                      <td
                        key={c.key}
                        className={i === 0 ? styles.groupSep : undefined}
                        style={{ background: changeBg(v, changeMaxAbs[c.key]) }}
                      >
                        {fmtPoints(v)}
                      </td>
                    )
                  })}

                  {WINDOW_COLS.map((w, i) => {
                    const v = row?.zscore[w.key] ?? null
                    const tail = v != null && Math.abs(v) > 2
                    return (
                      <td
                        key={`z-${w.key}`}
                        className={`${i === 0 ? styles.groupSep : ''} ${tail ? styles.boldCell : ''}`}
                        style={{ background: zBg(v) }}
                      >
                        {fmtZ(v)}
                      </td>
                    )
                  })}

                  {WINDOW_COLS.map((w, i) => {
                    const v = row?.ivRank[w.key] ?? null
                    return (
                      <td
                        key={`r-${w.key}`}
                        className={i === 0 ? styles.groupSep : undefined}
                        style={{ background: rankBg(v, RANK_HUE) }}
                      >
                        {fmtPct0(v)}
                      </td>
                    )
                  })}

                  {WINDOW_COLS.map((w, i) => {
                    const v = row?.ivPercentile[w.key] ?? null
                    return (
                      <td
                        key={`p-${w.key}`}
                        className={i === 0 ? styles.groupSep : undefined}
                        style={{ background: rankBg(v, PCTILE_HUE) }}
                      >
                        {fmtPct0(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
