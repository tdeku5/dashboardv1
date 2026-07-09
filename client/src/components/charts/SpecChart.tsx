import { useState, useEffect, type ReactNode } from 'react'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fmtAxisDate, fmtFullDate, TICK, TOOLTIP_STYLE } from '../../lib/seriesTransforms'
import { renderChart, frequencyBucket, type ChartSpecV1, type RenderResult } from '../../lib/hephaestus'
import styles from './ChartKit.module.css'

/*
 * <SpecChart> — the generic renderer for Hephaestus ChartSpecV1 specs. Posts
 * the spec to /api/hephaestus/render (the ONE render path, shared with saved
 * charts) and draws the aligned rows. All lines set connectNulls: with the
 * no-fill alignment rule, a lower-frequency series has null cells on the
 * higher-frequency x-axis dates — connectNulls draws it as a continuous line
 * between its true observations instead of disconnected dots.
 */

// Distinct line palette; first two match the Misc. Charts headline/core
// convention (near-white lead + amber contrast).
const SPEC_PALETTE = ['#e2e8f0', '#f59e0b', '#3b82f6', '#22c55e', '#ec4899', '#a78bfa', '#14b8a6', '#ef4444']

function annotationFor(result: RenderResult): string | null {
  const notes: string[] = []
  const buckets = new Set(result.series.map(s => frequencyBucket(s.frequency)).filter(Boolean))
  if (buckets.size > 1) notes.push(`mixed frequencies (${[...buckets].join(' / ')})`)
  const sa = new Set(result.series.map(s => s.seasonal_adjustment).filter((v): v is string => v !== null))
  if (sa.size > 1) notes.push('mixes SA and NSA series')
  return notes.length > 0 ? notes.join(' · ') : null
}

export function SpecChart({ spec, headerExtra }: { spec: ChartSpecV1; headerExtra?: ReactNode }) {
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    renderChart(spec)
      .then(r => { if (!cancelled) setResult(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [spec])

  const toggle = (key: string) => setHidden(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const hasRight = result?.series.some(s => s.axis === 'right') ?? false
  const annotation = result ? annotationFor(result) : null

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{spec.title}</div>
          {annotation && <div className={styles.sectionSubtitle}>⚠ {annotation}</div>}
        </div>
        {headerExtra}
      </div>

      {result && (
        <div className={styles.legendRow}>
          <div className={styles.legend}>
            {result.series.map((s, i) => (
              <button key={s.key} type="button"
                className={`${styles.legendItem} ${hidden.has(s.key) ? styles.legendItemOff : ''}`}
                onClick={() => toggle(s.key)}>
                <span className={styles.legendLine} style={{ background: SPEC_PALETTE[i % SPEC_PALETTE.length] }} />
                {s.label}{s.units ? ` (${s.units})` : ''}{s.axis === 'right' ? ' →' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {!result && !error && (
        <div className={styles.statusBlock}>Forging…</div>
      )}
      {error && (
        <div className={styles.statusBlock} style={{ color: 'var(--negative, #ef4444)' }}>
          Render failed: {error}
        </div>
      )}

      {result && (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                tickFormatter={fmtAxisDate} minTickGap={60} />
              <YAxis yAxisId="left" tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={['auto', 'auto']}
                label={result.leftAxisLabel
                  ? { value: result.leftAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#64748B' } }
                  : undefined} />
              {hasRight && (
                <YAxis yAxisId="right" orientation="right" tick={TICK} tickLine={false} axisLine={false} width={58}
                  domain={['auto', 'auto']}
                  label={result.rightAxisLabel
                    ? { value: result.rightAxisLabel, angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#64748B' } }
                    : undefined} />
              )}
              <Tooltip {...TOOLTIP_STYLE}
                labelFormatter={(d: unknown) => (typeof d === 'string' ? fmtFullDate(d) : '')}
                formatter={(v: unknown, name: unknown) =>
                  (typeof v === 'number' ? [v.toLocaleString(undefined, { maximumFractionDigits: 4 }), String(name)] : ['-', String(name)]) as [string, string]} />
              {result.series.map((s, i) => !hidden.has(s.key) && (
                <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.label}
                  stroke={SPEC_PALETTE[i % SPEC_PALETTE.length]} strokeWidth={i === 0 ? 2 : 1.8}
                  dot={false} isAnimationActive={false} connectNulls legendType="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {result && result.warnings.length > 0 && (
        <div className={styles.lastUpdated} title={result.warnings.join('\n')}>
          {result.warnings.join(' · ')}
        </div>
      )}
    </div>
  )
}
