import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtSignedFixed, niceAxis, roundForDisplay, signColor } from './acm'
import { cx } from './acm/acmFormat'
import { chartTheme, referenceLabelStyle, referenceLines } from './acm/chartTheme'
import { toneClass } from './acm/tones'
import { rateChangeTone } from '../pages/ratesShared'
import styles from './DailyChangeModal.module.css'

export type DailyChangeLookback = '6m' | '1y' | '2y' | '5y'

const LOOKBACK_OPTIONS: { value: DailyChangeLookback; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' },
  { value: '5y', label: '5Y' },
]

interface ApiResponse {
  country: string
  tenor: string
  lookback: string
  asOfDate: string
  sigma200d: number | null
  series: { date: string; change_bps: number }[]
  stats: {
    latest_bps: number
    latest_sigma: number | null
    mean_bps: number
    stdev_bps: number | null
  }
}

interface DailyChangeModalProps {
  country: string
  countryLabel: string
  tenor: string
  onClose: () => void
}

// R5d: daily yield CHANGES → rule 6 (increase red, decrease green); a value
// that rounds to zero prints unsigned and untoned (near-zero rule). σ bands and
// Stdev are unsigned levels. Portalled to <body>, so the backdrop carries
// acm-root itself (component-level root rule).

function fmtBpsSigned(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, digits, ' bps')
}

function fmtSigmaSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtSignedFixed(v, 2, 'σ')
}

/** Rule-6 class for a bp change shown at `digits` decimals. */
const changeClass = (v: number | null | undefined, digits = 1) => toneClass(rateChangeTone(v ?? null, digits))

function fmtDateTick(date: string): string {
  // YYYY-MM-DD → "Jan '25"
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  const month = d.toLocaleString('en-US', { month: 'short' })
  return `${month} '${String(d.getFullYear()).slice(-2)}`
}

export function DailyChangeModal({ country, countryLabel, tenor, onClose }: DailyChangeModalProps) {
  const [lookback, setLookback] = useState<DailyChangeLookback>('1y')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ country, tenor, lookback })
    fetch(`/api/global/daily-change-history?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        return json as ApiResponse
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [country, tenor, lookback])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
    if (e.key === 'Tab' && contentRef.current) {
      // Simple focus trap
      const focusables = contentRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  useEffect(() => {
    // Focus first focusable in the modal on open
    const t = setTimeout(() => {
      const btn = contentRef.current?.querySelector<HTMLElement>('button')
      btn?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const titleTenor = tenor
  const title = `${countryLabel} ${titleTenor}`

  const sigma200d = data?.sigma200d ?? null

  const xTicks = useMemo<string[]>(() => {
    if (!data?.series || data.series.length === 0) return []
    // ~4 evenly spaced ticks
    const n = data.series.length
    const targetCount = 4
    const step = Math.max(1, Math.floor(n / targetCount))
    const ticks: string[] = []
    for (let i = 0; i < n; i += step) ticks.push(data.series[i].date)
    if (ticks[ticks.length - 1] !== data.series[n - 1].date) ticks.push(data.series[n - 1].date)
    return ticks
  }, [data?.series])

  const yAxis = useMemo(() => niceAxis((data?.series ?? []).map(d => d.change_bps), { dp: 0, includeZero: true }), [data?.series])
  const sigmaLine = (k: number) => {
    if (sigma200d == null) return null
    const line = k === 1 ? referenceLines.level : referenceLines.levelFaint
    return [1, -1].map(sign => (
      <ReferenceLine
        key={`${sign * k}s`}
        y={sign * k * sigma200d}
        {...line}
        label={{ value: `${sign > 0 ? '+' : '-'}${k}σ`, position: 'right', ...referenceLabelStyle }}
      />
    ))
  }

  return createPortal(
    <div className={cx('acm-root', styles.dmBackdrop)} onClick={onClose} role="presentation">
      <div
        ref={contentRef}
        className={styles.dmContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} daily changes`}
      >
        <div className={styles.dmTitleRow}>
          <h2 className={styles.dmTitle}>
            {title}
            <span className={styles.dmTitleSubtle}>· Daily Changes</span>
          </h2>
          <button type="button" className={styles.dmClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.dmLookbackRow}>
          <span className={styles.dmLookbackLabel}>LOOKBACK:</span>
          <div className={styles.dmToggleGroup}>
            {LOOKBACK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={lookback === opt.value}
                onClick={() => setLookback(opt.value)}
                className={cx(styles.dmToggle, lookback === opt.value && styles.dmToggleActive)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className={styles.dmState}>Loading daily changes…</div>
        ) : error ? (
          <div className={cx(styles.dmState, styles.dmStateError)}>{error}</div>
        ) : data && data.series.length > 0 ? (
          <>
            <div className={styles.dmChart}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series} margin={{ top: 12, right: 36, left: 8, bottom: 12 }}>
                  <CartesianGrid {...chartTheme.grid} vertical={false} />
                  <XAxis dataKey="date" {...chartTheme.xAxis} ticks={xTicks} tickFormatter={fmtDateTick} interval="preserveStartEnd" />
                  <YAxis
                    {...chartTheme.yAxis}
                    domain={yAxis.domain}
                    ticks={yAxis.ticks}
                    tickFormatter={(v: number) => fmtSignedFixed(v, 0)}
                    label={{ ...chartTheme.axisLabel, value: 'bps', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip
                    {...chartTheme.tooltip}
                    cursor={chartTheme.barTooltipCursor}
                    labelFormatter={(label: unknown) => String(label)}
                    formatter={(v: unknown) => [typeof v === 'number' ? fmtSignedFixed(v, 2, ' bps') : '—', 'Δ']}
                  />
                  <ReferenceLine y={0} {...referenceLines.zero} />
                  {sigmaLine(1)}
                  {sigmaLine(2)}
                  {sigmaLine(3)}
                  <Bar dataKey="change_bps" isAnimationActive={false}>
                    {data.series.map((d, i) => {
                      // Rule 6: yield up red, down green; a change that prints as 0.00 is neutral.
                      const shown = roundForDisplay(d.change_bps, 2)
                      return <Cell key={i} fill={shown > 0 ? signColor('acm-negative') : shown < 0 ? signColor('acm-positive') : 'var(--acm-text-tertiary)'} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.dmStats}>
              <span>
                <span className={styles.dmStatLabel}>Latest:</span>{' '}
                <span className={changeClass(data.stats.latest_bps)}>{fmtBpsSigned(data.stats.latest_bps)} ({fmtSigmaSigned(data.stats.latest_sigma)})</span>
              </span>
              <span className={styles.dmStatSep}>·</span>
              <span>
                <span className={styles.dmStatLabel}>Mean:</span>{' '}
                <span className={changeClass(data.stats.mean_bps)}>{fmtBpsSigned(data.stats.mean_bps)}</span>
              </span>
              <span className={styles.dmStatSep}>·</span>
              <span>
                <span className={styles.dmStatLabel}>Stdev:</span>{' '}
                {data.stats.stdev_bps != null ? `${data.stats.stdev_bps.toFixed(1)} bps` : '—'}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.dmState}>No data for selected window.</div>
        )}
      </div>
    </div>,
    document.body
  )
}
