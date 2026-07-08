import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan wages — THIN tab (decision e): the full Monthly Labour Survey wage
// tables (2020 base) are file-only, not on the e-Stat API, so the full MLS
// pipeline is DEFERRED. What IS API-available (via the Cabinet Office
// composite-indicator table): contractual cash earnings for MANUFACTURING
// (index, 2020=100, 1975→) and the Index of Regular Workers Employment as an
// already-computed YoY %. CRITICAL and visible on every earnings panel:
// contractual earnings exclude overtime & bonuses — in Japan the summer/winter
// bonus months (Jun–Jul, Dec) dominate total pay and are invisible here.

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = [
  'JP_MFG_EARNINGS', // contractual cash earnings, manufacturing, index 2020=100, 1975→
  'JP_REGEMP_YOY',   // Index of Regular Workers Employment, YoY % (MLS-derived), 1975→
] as const

const BONUS_CAVEAT =
  'Contractual earnings exclude overtime & bonuses; summer/winter bonus months (Jun–Jul, Dec) ' +
  'dominate total pay in Japan and are invisible in this series.'

const fmtIdxTick = (v: number): string => v.toFixed(0)
const fmtIdxTip = (v: number): string => v.toFixed(1)

// ── Local panel helpers (duplicated per-file per house convention) ───────────

type BrushIdx = { start: number; end: number }

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<BrushIdx>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  const onBrush = useCallback(({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))
  }, [])
  return { brush, onBrush }
}

function Panel({ title, subtitle, badge, legend, children }: {
  title: string
  subtitle?: string
  badge?: ReactNode
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      {legend != null && <div className={kit.legendRow}><div className={kit.legend}>{legend}</div></div>}
      <div className={kit.chartWrap}>{children}</div>
    </div>
  )
}

function Leg({ color, label }: { color: string; label: string }) {
  return (
    <span className={kit.legendItem} style={{ cursor: 'default' }}>
      <span className={kit.legendLine} style={{ background: color }} />
      {label}
    </span>
  )
}

// ── Panels ───────────────────────────────────────────────────────────────────

function MfgEarningsLevelPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, level: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Contractual Cash Earnings, Manufacturing — Level"
      subtitle={`Index 2020=100, 1975→ (Cabinet Office composite table). ${BONUS_CAVEAT}`}
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.mfg_earnings} />}
      legend={<Leg color="#a78bfa" label="Contractual earnings, mfg (2020=100)" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={48}
            tickFormatter={fmtIdxTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtIdxTip(v) : '-', 'Index (2020=100)'] as [string, string]} />
          <Line type="monotone" dataKey="level" name="level" stroke="#a78bfa" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

function RegEmpYoyPanel({ data }: { data: EstatPoint[] }) {
  const rows = useMemo(() => data.map(d => ({ date: d.date, yoy: d.value })), [data])
  const { brush, onBrush } = useBrush(rows.length, 240)

  return (
    <Panel
      title="Regular Workers Employment — YoY %"
      subtitle="Index of Regular Workers Employment, published directly as a year-over-year % (MLS-derived, Cabinet Office composite table) — YoY rate only, no level exists on the API"
      badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.regemp_mls} />}
      legend={<Leg color="#4ade80" label="Regular workers employment YoY %" />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate} minTickGap={60} />
          <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={54}
            tickFormatter={fmtPctTick} />
          <Tooltip {...TOOLTIP_STYLE}
            formatter={(v: unknown) =>
              [typeof v === 'number' ? fmtPctTooltip(v) : '-', 'YoY %'] as [string, string]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
          <Line type="monotone" dataKey="yoy" name="yoy" stroke="#4ade80" strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls legendType="none" />
          <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
            onChange={onBrush} {...BRUSH_STYLE} />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPWagesContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading e-Stat wage series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Monthly Labour Survey derivatives via the Cabinet Office composite-indicator table &mdash; monthly, 1975&rarr;.
        THIN tab: the full MLS wage pipeline (total cash earnings, real wages, bonuses) is DEFERRED &mdash;
        the 2020-base tables are file-only, not on the e-Stat API.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Contractual Cash Earnings, Manufacturing"
          subtitle={`Index 2020=100 — ${BONUS_CAVEAT}`}
          data={allData['JP_MFG_EARNINGS'] ?? []}
          badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.mfg_earnings} />}
        />
        <MfgEarningsLevelPanel data={allData['JP_MFG_EARNINGS'] ?? []} />
      </div>

      <RegEmpYoyPanel data={allData['JP_REGEMP_YOY'] ?? []} />
    </>
  )
}
