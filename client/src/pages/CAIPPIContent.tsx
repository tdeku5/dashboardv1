import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada IPPI dashboard — the PPI proxy for the Canada Economic Data Models.
// StatCan table 18-10-0265 (monthly, NSA, history from 1956). Both series are
// PROXY substitutes for the US PPI Final Demand concepts (factory-gate
// industrial products only; no services/final-demand coverage), so every panel
// carries the corresponding ippi_* ProxyBadge.

const CODES = ['CA_IPPI', 'CA_IPPI_CORE'] as const

type AllData = Record<string, StatcanPoint[]>

const YOY_LINES = [
  { code: 'CA_IPPI', key: 'ippi', label: 'IPPI — Total', color: '#e2e8f0' },
  { code: 'CA_IPPI_CORE', key: 'core', label: 'IPPI ex Energy & Petroleum', color: '#60a5fa' },
] as const

const EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CA_IPPI', label: 'IPPI — Total, Industrial product price index', depth: 0 },
  { id: 'CA_IPPI_CORE', label: 'IPPI — ex Energy & Petroleum Products', depth: 0 },
]

// ── IPPI vs Core YoY panel (two lines, date-union alignment) ─────────────────

function IppiYoyPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const maps = YOY_LINES.map(s => {
      const yoy = computeChangePct(allData[s.code] ?? [], 12)
      return new Map(yoy.map(p => [p.date, p.value]))
    })
    const dates = new Set<string>()
    for (const s of YOY_LINES) for (const p of allData[s.code] ?? []) dates.add(p.date)
    return [...dates].sort().map(date => {
      const row: Record<string, number | string | null> = { date }
      YOY_LINES.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 240), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            IPPI vs Core — YoY
            <ProxyBadge caveat={CA_PROXY_CAVEATS.ippi_headline} />
          </div>
          <div className={kit.sectionSubtitle}>
            Year-over-year %Δ — total vs ex energy &amp; petroleum products (NSA)
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {YOY_LINES.map(s => (
            <span key={s.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
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
                const s = YOY_LINES.find(x => x.key === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            {YOY_LINES.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={s.key === 'ippi' ? 2.2 : 1.6}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            ))}
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

export function CAIPPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load StatCan data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const explorerData = useMemo(() => {
    const out: Record<string, StatcanPoint[]> = {}
    for (const item of EXPLORER_ITEMS) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData])

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} StatCan IPPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada (18-10-0265) &mdash; monthly, factory-gate industrial product prices, not seasonally adjusted
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Industrial Product Price Index"
          subtitle="Total, all industrial products (v1230995983) — YoY / annualized (NSA)"
          data={allData['CA_IPPI'] ?? []}
          badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.ippi_headline} />}
        />
        <RatesChart
          title="IPPI ex Energy & Petroleum"
          subtitle="Excluding energy and petroleum products (v1230995984) — YoY / annualized (NSA)"
          data={allData['CA_IPPI_CORE'] ?? []}
          badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.ippi_core} />}
        />
      </div>

      <IppiYoyPanel allData={allData} />

      <SeriesExplorer
        title="Canada IPPI Explorer"
        selectorLabel="Series"
        items={EXPLORER_ITEMS}
        data={explorerData}
        defaultId="CA_IPPI"
        unitLabel="Index, NSA"
      />
    </>
  )
}
