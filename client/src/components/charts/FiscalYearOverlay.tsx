import { useState, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import styles from './ChartKit.module.css'

// Multi-fiscal-year cumulative overlay line chart with clickable FY legend and
// YTD-vs-prior stats row. Extracted from MtsPage.tsx (2026-07, UK models
// Phase 3); rendering identical, with the fiscal-year calendar (month labels),
// styles map and value formatters parameterized so the same component serves
// the US Oct–Sep and UK Apr–Mar fiscal years.

export interface FYStyle { color: string; width: number; opacity: number }

const FALLBACK_STYLE: FYStyle = { color: '#64748b', width: 1, opacity: 0.3 }

const DEFAULT_PALETTE = ['#3b82f6', '#2da0a1', '#22c55e', '#10b981', '#06b6d4', '#6366f1', '#8b5cf6', '#38bdf8', '#a78bfa', '#818cf8']

/** Default styling: current FY red & thick, others muted palette colors. */
export function defaultFyStyles(fys: string[], currentFY: string): Record<string, FYStyle> {
  const out: Record<string, FYStyle> = {}
  fys.forEach((fy, i) => {
    out[fy] = fy === currentFY
      ? { color: '#ef4444', width: 2.5, opacity: 1 }
      : { color: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length], width: 1, opacity: 0.45 }
  })
  return out
}

export function FiscalYearOverlay({
  title,
  subtitle,
  badge,
  fiscalYears,
  currentFY,
  comparisonFY,
  monthLabels,
  valueFormatter,
  exactFormatter,
  fyStyles,
  fyPrefix = 'FY',
  lastUpdated,
  height = 520,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  /** periodIndex is 1-based within the fiscal year; values pre-scaled to display units */
  fiscalYears: Record<string, Array<{ periodIndex: number; value: number }>>
  currentFY: string
  comparisonFY?: string
  monthLabels: string[]
  valueFormatter: (v: number) => string
  exactFormatter: (v: number) => string
  fyStyles?: Record<string, FYStyle>
  fyPrefix?: string
  lastUpdated?: string
  height?: number
}) {
  const [hiddenFYs, setHiddenFYs] = useState<Set<string>>(new Set())

  const fys = useMemo(() => Object.keys(fiscalYears).sort(), [fiscalYears])
  const stylesMap = useMemo(
    () => fyStyles ?? defaultFyStyles(fys, currentFY),
    [fyStyles, fys, currentFY]
  )

  const chartData = useMemo(() => {
    const byPeriod: Record<number, Record<string, number>> = {}
    for (const [fy, rows] of Object.entries(fiscalYears)) {
      for (const r of rows) {
        if (!byPeriod[r.periodIndex]) byPeriod[r.periodIndex] = { periodIndex: r.periodIndex }
        byPeriod[r.periodIndex][fy] = r.value
      }
    }
    return Object.values(byPeriod).sort((a, b) => a.periodIndex - b.periodIndex)
  }, [fiscalYears])

  const stats = useMemo(() => {
    const currentRows = fiscalYears[currentFY]
    if (!currentRows?.length) return null
    const latest = currentRows[currentRows.length - 1]

    let delta: number | null = null
    let deltaPct: number | null = null
    if (comparisonFY) {
      const compRows = fiscalYears[comparisonFY]
      const match = compRows?.find(r => r.periodIndex === latest.periodIndex)
      if (match) {
        delta = latest.value - match.value
        deltaPct = match.value !== 0 ? ((latest.value - match.value) / Math.abs(match.value)) * 100 : null
      }
    }
    return { periodIndex: latest.periodIndex, ytd: latest.value, delta, deltaPct }
  }, [fiscalYears, currentFY, comparisonFY])

  const toggleFY = (fy: string) => {
    setHiddenFYs(prev => {
      const next = new Set(prev)
      if (next.has(fy)) next.delete(fy); else next.add(fy)
      return next
    })
  }

  interface OverlayTooltipProps {
    active?: boolean
    label?: number | string
    payload?: ReadonlyArray<{ dataKey?: string | number; name?: string | number; color?: string; value?: number | string }>
  }

  const OverlayTooltip = ({ active, payload, label }: OverlayTooltipProps) => {
    if (!active || !payload?.length) return null
    return (
      <div className={styles.overlayTooltip}>
        <p className={styles.overlayTooltipLabel}>{monthLabels[(label as number) - 1] ?? label}</p>
        {payload.map(p => (
          <p key={String(p.dataKey)} style={{ color: p.color }}>
            {fyPrefix}{String(p.name)}: {exactFormatter(Number(p.value ?? 0))}
          </p>
        ))}
      </div>
    )
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={styles.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>

      {stats && (
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{fyPrefix}{currentFY} YTD (Month {stats.periodIndex})</span>
            <span className={styles.statValue} style={{ color: stats.ytd >= 0 ? '#22c55e' : '#ef4444' }}>
              {exactFormatter(stats.ytd)}
            </span>
          </div>
          {stats.delta !== null && comparisonFY && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>vs {fyPrefix}{comparisonFY}</span>
              <span className={styles.statValue} style={{ color: stats.delta >= 0 ? '#22c55e' : '#ef4444' }}>
                {stats.delta > 0 ? '+' : ''}{exactFormatter(stats.delta)}
                {stats.deltaPct !== null && (
                  <span className={styles.statPct}> ({stats.deltaPct >= 0 ? '+' : ''}{stats.deltaPct.toFixed(1)}%)</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {fys.map(fy => {
            const s = stylesMap[fy] ?? FALLBACK_STYLE
            const hidden = hiddenFYs.has(fy)
            return (
              <div
                key={fy}
                className={styles.legendItem}
                style={{ opacity: hidden ? 0.35 : 1 }}
                onClick={() => toggleFY(fy)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') toggleFY(fy)
                }}
              >
                <span
                  className={styles.legendLine}
                  style={{
                    background: s.color,
                    opacity: s.opacity,
                    height: fy === currentFY ? 3 : 2,
                  }}
                />
                {fyPrefix}{fy}
              </div>
            )
          })}
        </div>
      </div>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="periodIndex"
              tickFormatter={(v: number) => monthLabels[v - 1] ?? ''}
              stroke="var(--text-primary)"
              fontSize={12}
            />
            <YAxis
              stroke="var(--text-primary)"
              fontSize={12}
              tickFormatter={valueFormatter}
            />
            <Tooltip content={OverlayTooltip} />
            {fys.map(fy => {
              if (hiddenFYs.has(fy)) return null
              const s = stylesMap[fy] ?? FALLBACK_STYLE
              return (
                <Line
                  key={fy}
                  type="monotone"
                  dataKey={fy}
                  name={fy}
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeOpacity={s.opacity}
                  dot={false}
                  connectNulls
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className={styles.loading} style={{ height }}>Loading…</div>
      )}

      {lastUpdated && (
        <p className={styles.lastUpdated}>Last updated: {lastUpdated}</p>
      )}
    </section>
  )
}
