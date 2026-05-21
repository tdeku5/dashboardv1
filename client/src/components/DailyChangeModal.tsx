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

function fmtBpsSigned(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : '-'
  return `${sign}${Math.abs(v).toFixed(digits)} bps`
}

function fmtSigmaSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : '-'
  return `${sign}${Math.abs(v).toFixed(2)}σ`
}

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

  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        ref={contentRef}
        className={styles.content}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} daily changes`}
      >
        <div className={styles.titleRow}>
          <h2 className={styles.title}>
            {title}
            <span className={styles.titleSubtle}>· Daily Changes</span>
          </h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.lookbackRow}>
          <span className={styles.lookbackLabel}>LOOKBACK:</span>
          <div className={styles.lookbackButtons}>
            {LOOKBACK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLookback(opt.value)}
                className={lookback === opt.value ? styles.activeLookback : ''}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading daily changes…</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : data && data.series.length > 0 ? (
          <>
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.series} margin={{ top: 12, right: 36, left: 8, bottom: 12 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#728197"
                    tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                    ticks={xTicks}
                    tickFormatter={fmtDateTick}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#728197"
                    tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                    tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`}
                    label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    labelFormatter={(label: unknown) => String(label)}
                    formatter={(v: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)} bps` : '—',
                      'Δ',
                    ]}
                  />
                  <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
                  {sigma200d != null && (
                    <>
                      <ReferenceLine y={+sigma200d} stroke="#475569" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '+1σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                      <ReferenceLine y={-sigma200d} stroke="#475569" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '-1σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                      <ReferenceLine y={+2 * sigma200d} stroke="#3f4a5e" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '+2σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                      <ReferenceLine y={-2 * sigma200d} stroke="#3f4a5e" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '-2σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                      <ReferenceLine y={+3 * sigma200d} stroke="#334155" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '+3σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                      <ReferenceLine y={-3 * sigma200d} stroke="#334155" strokeDasharray="4 4" strokeWidth={1}
                        label={{ value: '-3σ', position: 'right', fill: '#64748B', fontSize: 9 }} />
                    </>
                  )}
                  <Bar dataKey="change_bps" isAnimationActive={false}>
                    {data.series.map((d, i) => (
                      <Cell key={i} fill={d.change_bps >= 0 ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.statStrip}>
              <span>
                <span className={styles.statLabel}>Latest:</span> {fmtBpsSigned(data.stats.latest_bps)} ({fmtSigmaSigned(data.stats.latest_sigma)})
              </span>
              <span className={styles.statSep}>·</span>
              <span>
                <span className={styles.statLabel}>Mean:</span> {fmtBpsSigned(data.stats.mean_bps)}
              </span>
              <span className={styles.statSep}>·</span>
              <span>
                <span className={styles.statLabel}>Stdev:</span>{' '}
                {data.stats.stdev_bps != null ? `${data.stats.stdev_bps.toFixed(1)} bps` : '—'}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.loading}>No data for selected window.</div>
        )}
      </div>
    </div>,
    document.body
  )
}
