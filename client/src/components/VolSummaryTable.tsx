import { useMemo } from 'react'
import { CAV_KEYS, CAV_LABEL, type CavKey } from '../constants/crossAssetVol'
import type { CavSummaryResponse, CavSummaryTicker } from '../hooks/useCavSummary'
import { AcmDataTable, AcmPanel, fmtSignedFixed, type AcmColumn, type AlertLevel } from './acm'
import styles from './VolSummaryTable.module.css'

// M1 (MACRO): non-rates colour rules.
//  • Current: a vol LEVEL → plain primary text.
//  • 1D / 5D / 1M / 3M / YTD point changes: vol CHANGES — classification is
//    pending the user's ruling (neither a return nor a yield), so they render
//    plain for now: no fill, no tone. (Were a blue-up / red-down fill.)
//  • 6M / 1Y Z: the alert family as a cell tint + outline only (Phase 0
//    Decision 2): |z| > 2 alert-mild, |z| > 3 alert-strong; text primary.
//    (Was a red / blue gradient.)
//  • IV rank / IV percentile: plain until alert thresholds for a 0–100 scale
//    are ruled on. (Were green / orange single-hue fills.)

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

/** Vol indices are quoted in points: "+3.21" = up 3.21 points; 0.00 when it rounds to zero. */
const fmtPoints = (v: number) => fmtSignedFixed(v, 2)
const fmtZ = (v: number) => fmtSignedFixed(v, 2, 'σ')
const fmtPct0 = (v: number) => `${Math.round(v)}%`

/** Phase 0 Decision 2: |z| > 3 strong, |z| > 2 mild (on the displayed 2dp value). */
export function zAlertLevel(z: number | null | undefined): AlertLevel | undefined {
  if (z == null || !Number.isFinite(z)) return undefined
  const a = Math.abs(Number(z.toFixed(2)))
  if (a > 3) return 'strong'
  if (a > 2) return 'mild'
  return undefined
}

interface Row { key: CavKey; row: CavSummaryTicker | null }

interface Props {
  asOfDate: string | null
  data: CavSummaryResponse | null
  loading: boolean
  error: string | null
}

export function VolSummaryTable({ asOfDate, data, loading, error }: Props) {
  const tickers = data?.tickers ?? []

  const tickerRows: Row[] = useMemo(() => {
    const byTicker = new Map<string, CavSummaryTicker>()
    for (const t of tickers) byTicker.set(t.ticker.toUpperCase(), t)
    return CAV_KEYS.map((k) => ({ key: k, row: byTicker.get(CAV_LABEL[k].toUpperCase()) ?? null }))
  }, [tickers])

  const columns: AcmColumn<Row>[] = useMemo(() => [
    { key: 'ticker', header: 'Ticker', kind: 'label', value: (r) => CAV_LABEL[r.key] },
    { key: 'current', header: 'Current', kind: 'num', value: (r) => r.row?.current ?? null, format: (v) => v.toFixed(2) },
    ...CHANGE_COLS.map((c): AcmColumn<Row> => ({
      key: `chg-${c.key}`, header: c.label, kind: 'num', value: (r) => r.row?.changes[c.key] ?? null, format: fmtPoints,
    })),
    ...WINDOW_COLS.map((w): AcmColumn<Row> => ({
      key: `z-${w.key}`, header: `${w.label} Z`, kind: 'num', value: (r) => r.row?.zscore[w.key] ?? null, format: fmtZ,
      alert: (r) => zAlertLevel(r.row?.zscore[w.key]),
    })),
    ...WINDOW_COLS.map((w): AcmColumn<Row> => ({
      key: `r-${w.key}`, header: `${w.label} Rank`, kind: 'num', value: (r) => r.row?.ivRank[w.key] ?? null, format: fmtPct0,
    })),
    ...WINDOW_COLS.map((w): AcmColumn<Row> => ({
      key: `p-${w.key}`, header: `${w.label} %ile`, kind: 'num', value: (r) => r.row?.ivPercentile[w.key] ?? null, format: fmtPct0,
    })),
  ], [])

  return (
    <AcmPanel title="VOL SUMMARY" actions={<span className={styles.vstAsOf}>as of {asOfDate ?? '—'}</span>}>
      {loading && <div className={styles.vstState}>Loading…</div>}
      {error && <div className={`${styles.vstState} ${styles.vstStateError}`}>Failed to load: {error}</div>}
      {!loading && !error && tickerRows.length === 0 && <div className={styles.vstState}>No data.</div>}
      {!loading && !error && tickerRows.length > 0 && (
        <AcmDataTable columns={columns} rows={tickerRows} rowKey={(r) => r.key} />
      )}
    </AcmPanel>
  )
}
