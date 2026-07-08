import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Australia PPI dashboard — ABS Producer Price Indexes, Final Demand
// (excluding exports), quarterly. DIRECT equivalents of the US PPI Final
// Demand concept — no proxy badges on this page. The YoY and QoQ rates are
// ABS-PUBLISHED series (AU_PPI_YOY / AU_PPI_QOQ), not terminal-computed; the
// only terminal-computed line here is the quarterly CPI YoY on the
// pass-through panel (from AU_CPI_Q_HEADLINE at lag 4), and it is labeled
// as such.

const CODES = ['AU_PPI', 'AU_PPI_YOY', 'AU_PPI_QOQ', 'AU_CPI_Q_HEADLINE'] as const

type AllData = Record<string, AbsPoint[]>

// ── Helpers (duplicated per-file per house convention) ───────────────────────

/** YoY % from an index series at the given lag (4 = quarterly). */
function yoy(points: AbsPoint[], lag: number): Array<{ date: string; value: number }> {
  return points.slice(lag).map((p, i) => ({
    date: p.date,
    value: (p.value / points[i].value - 1) * 100,
  })).filter(p => Number.isFinite(p.value))
}

/** Merge named series into date-union rows. */
function mergeRows(series: Array<{ key: string; pts: Array<{ date: string; value: number }> }>): Array<Record<string, number | string | null>> {
  const maps = series.map(s => new Map(s.pts.map(p => [p.date, p.value])))
  const dates = [...new Set(series.flatMap(s => s.pts.map(p => p.date)))].sort()
  return dates.map(date => {
    const row: Record<string, number | string | null> = { date }
    series.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
    return row
  })
}

function useBrush(rowCount: number, defaultWindow: number) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rowCount) return
    setBrush({ start: Math.max(0, rowCount - defaultWindow), end: rowCount - 1 })
  }, [rowCount, defaultWindow])
  return { brush, setBrush }
}

// ── Panel 1: PPI level + PUBLISHED YoY (dual axis) ───────────────────────────

function LevelYoyPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeRows([
    { key: 'level', pts: (allData['AU_PPI'] ?? []).map(p => ({ date: p.date, value: p.value })) },
    { key: 'yoyPub', pts: (allData['AU_PPI_YOY'] ?? []).map(p => ({ date: p.date, value: p.value })) },
  ]), [allData])
  const { brush, setBrush } = useBrush(rows.length, 120)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>PPI Final Demand — Level &amp; Published YoY [QUARTERLY]</div>
          <div className={kit.sectionSubtitle}>
            Index (left) with the ABS-PUBLISHED YoY rate (right) — the YoY line is the ABS series, not terminal-computed
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            PPI index (level)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#f59e0b' }} />
            YoY % (ABS-published)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis yAxisId="level" tick={TICK} tickLine={false} axisLine={false} width={58}
              domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
            <YAxis yAxisId="pct" orientation="right" tick={TICK} tickLine={false} axisLine={false}
              width={52} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return name === 'level'
                  ? [v.toFixed(1), 'PPI index'] as [string, string]
                  : [fmtPctTooltip(v), 'YoY (ABS-published)'] as [string, string]
              }} />
            <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            <Line yAxisId="level" type="monotone" dataKey="level" name="level"
              stroke="#e2e8f0" strokeWidth={2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Line yAxisId="pct" type="monotone" dataKey="yoyPub" name="yoyPub"
              stroke="#f59e0b" strokeWidth={1.6}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Panel 2: PUBLISHED QoQ bars ──────────────────────────────────────────────

function QoqPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() =>
    (allData['AU_PPI_QOQ'] ?? []).map(p => ({ date: p.date, qoq: p.value })),
  [allData])
  const { brush, setBrush } = useBrush(rows.length, 120)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>PPI — Published QoQ [QUARTERLY]</div>
          <div className={kit.sectionSubtitle}>
            Quarter-over-quarter %Δ — ABS-published rate series, not terminal-computed
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#4ade80' }} />
            QoQ % (ABS-published)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [fmtPctTooltip(v), 'QoQ (ABS-published)'] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="qoq" name="qoq" isAnimationActive={false} legendType="none">
              {rows.map(r => (
                <Cell key={r.date} fill={r.qoq >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'} />
              ))}
            </Bar>
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Panel 3: PPI vs CPI pass-through overlay ─────────────────────────────────

function PassThroughPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => mergeRows([
    { key: 'ppiYoy', pts: (allData['AU_PPI_YOY'] ?? []).map(p => ({ date: p.date, value: p.value })) },
    { key: 'cpiYoy', pts: yoy(allData['AU_CPI_Q_HEADLINE'] ?? [], 4) },
  ]).filter(r => typeof r.date === 'string' && r.date >= '1998-01-01'), [allData])
  const { brush, setBrush } = useBrush(rows.length, 120)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>PPI vs CPI — Pass-through [QUARTERLY]</div>
          <div className={kit.sectionSubtitle}>
            PPI YoY (ABS-published) vs headline CPI YoY (terminal-computed from AU_CPI_Q_HEADLINE, lag 4) — factory-gate to consumer pass-through
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#f59e0b' }} />
            PPI YoY (ABS-published)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            CPI YoY (terminal-computed)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                const lbl = name === 'ppiYoy' ? 'PPI YoY (published)' : 'CPI YoY (computed)'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Line type="monotone" dataKey="ppiYoy" name="ppiYoy"
              stroke="#f59e0b" strokeWidth={2.2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Line type="monotone" dataKey="cpiYoy" name="cpiYoy"
              stroke="#e2e8f0" strokeWidth={1.6}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function AUPPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ABS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} ABS PPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS Producer Price Indexes, Final Demand (excl. exports), quarterly, 1998&rarr; &mdash; DIRECT
        equivalents of the US PPI Final Demand concept. YoY and QoQ rates are ABS-PUBLISHED series;
        only the CPI overlay on the pass-through panel is terminal-computed (and labeled).
      </div>

      <LevelYoyPanel allData={allData} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <QoqPanel allData={allData} />
        <PassThroughPanel allData={allData} />
      </div>
    </>
  )
}
