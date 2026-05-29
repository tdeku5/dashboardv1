// Generalized "model-currency strength" panel — every line is a cross that
// has been oriented (inverted where the model currency was the quote) so
// rising = the model currency is strengthening against that counterparty.
//
// Two view modes (toggle):
//   View A — indexed to 100 at the visible window start (default).
//   View B — cumulative % change from the visible window start.
// Both re-baseline whenever the range button changes.
//
// This is the engine behind both:
//   • DmCrossesUsdStrengthChart   (US page — the original consumer)
//   • CrossesStrengthChart        (UK/EU/CAD/JPY/AUS pages — same UI, different model)

import { useMemo, useState } from 'react'
import {
  Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTvSeriesMulti } from '../hooks/useTvSeriesMulti'
import type { TvSeriesPoint } from '../hooks/useTvSeries'
import styles from '../pages/VolPage.module.css'

// `invert: true` → use 1 / value so the series flips to model-strength sense.
// `label` is what the legend shows; convention is "<display>" e.g. GBPEUR,
// optionally annotated " (inv)" when the source pair is oriented the other way.
export interface CrossSpec {
  symbol: string         // tv_series symbol to fetch (the SOURCE pair)
  label: string          // legend / tooltip / dataKey
  invert: boolean        // invert the close (1/x) to get the oriented series?
  color: string
}

interface Props {
  model: string                 // e.g. 'USD', 'GBP', 'EUR', 'CAD', 'JPY', 'AUD'
  crosses: ReadonlyArray<CrossSpec>
  // Caption fragment under the title. Default reads "rising = stronger <model>".
  subtitle?: string
  // Default range — US page uses 1Y; keep that across all pages by default.
  defaultRange?: RangeKey
}

const RANGES = [
  { key: '1m',  label: '1M',  days: 30 },
  { key: '3m',  label: '3M',  days: 90 },
  { key: '6m',  label: '6M',  days: 180 },
  { key: '1y',  label: '1Y',  days: 365 },
  { key: '2y',  label: '2Y',  days: 730 },
  { key: '5y',  label: '5Y',  days: 1825 },
  { key: 'max', label: 'MAX', days: -1 },
] as const
type RangeKey = typeof RANGES[number]['key']

type ViewMode = 'index' | 'pct'

// ── helpers ──────────────────────────────────────────────────────────────────
const tsToMs = (s: string): number => Number(s) * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtAxisDate = (ms: number): string => {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`
}
const fmtFullDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function tsMapByDay(points: TvSeriesPoint[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const p of points) {
    const d = new Date(tsToMs(p.time))
    const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    m.set(dayMs, p.close)
  }
  return m
}

function rangeCutoff(range: RangeKey): number {
  if (range === 'max') return -Infinity
  return Date.now() - RANGES.find(r => r.key === range)!.days * 24 * 3600 * 1000
}

function CustomTooltip({ active, payload, label, viewMode }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: number | string
  viewMode: ViewMode
}) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  const rows = payload.filter(p => typeof p.value === 'number' && Number.isFinite(p.value))
  if (rows.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{fmtFullDate(label)}</div>
      {rows
        .sort((a, b) => (b.value as number) - (a.value as number))
        .map((p, i) => (
        <div key={i} className={styles.tooltipRow} style={{ color: p.color }}>
          <span>{p.name}</span>
          <span>{viewMode === 'index'
            ? (p.value as number).toFixed(2)
            : `${(p.value as number) >= 0 ? '+' : ''}${(p.value as number).toFixed(2)}%`}</span>
        </div>
      ))}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function CrossesStrengthChart({ model, crosses, subtitle, defaultRange = '1y' }: Props) {
  const [range, setRange] = useState<RangeKey>(defaultRange)
  const [viewMode, setViewMode] = useState<ViewMode>('index')
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  // One batched fetch covers all source symbols regardless of how many the
  // model page asks for. Keys are SOURCE pair codes — orientation is applied
  // downstream inside the useMemo so the cache stays canonical.
  const symbols = useMemo(() => crosses.map(c => c.symbol), [crosses])
  const { data: rawByPair, loading, error } = useTvSeriesMulti(symbols)

  const data = useMemo(() => {
    // 1. Per-cross day → ORIENTED close map. Inversion happens here so the
    //    pipeline below treats every series as already "model-strength".
    const maps = crosses.map(c => {
      const raw = tsMapByDay(rawByPair.get(c.symbol) ?? [])
      if (!c.invert) return { spec: c, byDay: raw }
      const inv = new Map<number, number>()
      for (const [k, v] of raw) if (v > 0) inv.set(k, 1 / v)
      return { spec: c, byDay: inv }
    })

    // 2. Union of days across all symbols, then filter to the visible window.
    const cutoff = rangeCutoff(range)
    const dayset = new Set<number>()
    for (const m of maps) for (const k of m.byDay.keys()) if (k >= cutoff) dayset.add(k)
    const days = [...dayset].sort((a, b) => a - b)
    if (days.length === 0) return []

    // 3. Pick each cross's baseline = its first non-null value in-window.
    //    Different crosses may anchor at different first days; each line
    //    starts at 100 / 0% on its own first visible point.
    const baselines = new Map<string, number>()
    for (const m of maps) {
      for (const t of days) {
        const v = m.byDay.get(t)
        if (v != null) { baselines.set(m.spec.label, v); break }
      }
    }

    // 4. Project to view mode. We key the row by `label` (not source symbol)
    //    so two crosses sharing a source pair (shouldn't happen here, but
    //    defensively) would still get distinct lines.
    return days.map(t => {
      const row: Record<string, number | null> & { t: number } = { t }
      for (const m of maps) {
        const v = m.byDay.get(t)
        const base = baselines.get(m.spec.label)
        if (v == null || base == null || base === 0) { row[m.spec.label] = null; continue }
        row[m.spec.label] = viewMode === 'index'
          ? (v / base) * 100
          : (v / base - 1) * 100
      }
      return row
    })
  }, [rawByPair, crosses, range, viewMode])

  function toggleSeries(label: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.panelTitle}>{model} CROSSES — {model} STRENGTH</div>
          <div className={styles.panelSubtitle}>
            {subtitle ?? `All crosses normalized to ${model} strength (rising = stronger ${model})`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className={styles.rangeRow}>
            <button
              className={`${styles.rangeBtn} ${viewMode === 'index' ? styles.rangeBtnOn : ''}`}
              onClick={() => setViewMode('index')}
            >Indexed 100</button>
            <button
              className={`${styles.rangeBtn} ${viewMode === 'pct' ? styles.rangeBtnOn : ''}`}
              onClick={() => setViewMode('pct')}
            >Cumulative %</button>
          </div>
          <div className={styles.rangeRow}>
            {RANGES.map(r => (
              <button
                key={r.key}
                className={`${styles.rangeBtn} ${range === r.key ? styles.rangeBtnOn : ''}`}
                onClick={() => setRange(r.key)}
              >{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Click-to-toggle legend */}
      <div className={styles.legend}>
        {crosses.map(c => (
          <button
            key={c.label}
            onClick={() => toggleSeries(c.label)}
            style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              color: hidden.has(c.label) ? '#475569' : '#94A3B8',
              opacity: hidden.has(c.label) ? 0.55 : 1,
              fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
            }}
            title={hidden.has(c.label) ? 'Show ' + c.label : 'Hide ' + c.label}
          >
            <span style={{ width: 12, height: 3, borderRadius: 1, display: 'inline-block', background: hidden.has(c.label) ? '#475569' : c.color }} />
            {c.label}
          </button>
        ))}
      </div>

      {loading
        ? <div className={styles.placeholder}>Loading…</div>
        : error
          ? <div className={styles.placeholder}>{error}</div>
          : data.length === 0
            ? <div className={styles.placeholder}>No data in selected range.</div>
            : (
              <ResponsiveContainer width="100%" height={520}>
                <LineChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 6 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                    stroke="#728197" tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    tickFormatter={fmtAxisDate} minTickGap={40}
                  />
                  <YAxis
                    stroke="#728197" tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    tickFormatter={(v: number) => viewMode === 'index' ? v.toFixed(0) : `${v.toFixed(1)}%`}
                    domain={['auto', 'auto']} width={56}
                  />
                  <Tooltip content={<CustomTooltip viewMode={viewMode} />} />
                  <ReferenceLine y={viewMode === 'index' ? 100 : 0} stroke="#475569" strokeDasharray="4 4" />
                  {crosses.map(c => (
                    <Line
                      key={c.label}
                      type="monotone"
                      dataKey={c.label}
                      name={c.label}
                      stroke={c.color}
                      strokeWidth={1.4}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      hide={hidden.has(c.label)}
                    />
                  ))}
                  <Brush dataKey="t" height={22} stroke="#728197" fill="#0d1520" travellerWidth={8} tickFormatter={(ms: number) => fmtAxisDate(ms)} />
                </LineChart>
              </ResponsiveContainer>
            )
      }
    </div>
  )
}
