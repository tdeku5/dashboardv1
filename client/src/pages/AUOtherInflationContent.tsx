import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia "Other Inflation" dashboard — the Monthly-CPI-only special
// aggregates (docs/au-models-mapping.md finding): tradables/non-tradables,
// goods/services, discretionary/non-discretionary, and the exclusion measures
// (ex food & energy — the US-core analog! — ex volatile items, and ex volatile
// items & holiday travel) exist ONLY in the complete Monthly CPI dataflow.
// No quarterly variants of these aggregates are published, so every panel is
// [MONTHLY] with the short-history floor: index from Apr-2024, YoY readable
// from Apr-2025 only. Every panel carries the monthly_cpi_floor ProxyBadge.

const CODES = [
  'AU_CPIM_TRADABLES', 'AU_CPIM_NONTRADABLES',
  'AU_CPIM_GOODS', 'AU_CPIM_SERVICES',
  'AU_CPIM_DISCRETIONARY', 'AU_CPIM_NONDISCRETIONARY',
  'AU_CPIM_XFE', 'AU_CPIM_EXVOLATILE', 'AU_CPIM_EXVOLHOL',
] as const

const PAGE_CAPTION =
  'special aggregates exist ONLY in the Monthly CPI — no quarterly variants are published; YoY from Apr-2025'

type AllData = Record<string, AbsPoint[]>

interface LineDef {
  code: string
  key: string
  label: string
  color: string
  width?: number
}

// ── Helpers (duplicated per-file per house convention) ───────────────────────

/** Calendar-month YoY map from a raw index series (robust to gaps; lag 12). */
function yoyMapOf(data: AbsPoint[]): Map<string, number | null> {
  const idx = new Map(data.map(p => [p.date, p.value]))
  const out = new Map<string, number | null>()
  for (const p of data) {
    const [y, m] = p.date.split('-').map(Number)
    const prior = idx.get(`${y - 1}-${String(m).padStart(2, '0')}-01`)
    out.set(p.date, prior != null && prior !== 0 ? (p.value / prior - 1) * 100 : null)
  }
  return out
}

const RBA_BAND = (
  <>
    <ReferenceArea y1={2} y2={3} fill="rgba(250, 204, 21, 0.06)" stroke="none" />
    <ReferenceLine y={2.5} stroke="rgba(250,204,21,0.45)" strokeDasharray="4 3" strokeWidth={1}
      label={{ value: 'RBA 2.5% midpoint', position: 'insideTopRight', fill: '#facc15', fontSize: 9 }} />
  </>
)

// ── Generic multi-line YoY panel (date-union rows, toggleable legend) ────────

function MultiLineYoyPanel({
  title, subtitle, lines, allData, defaultMonths = 30,
}: {
  title: string
  subtitle: string
  lines: readonly LineDef[]
  allData: AllData
  defaultMonths?: number
}) {
  const rows = useMemo(() => {
    const maps = lines.map(s => yoyMapOf(allData[s.code] ?? []))
    const dates = new Set<string>()
    for (const s of lines) for (const p of allData[s.code] ?? []) dates.add(p.date)
    return [...dates].sort().map(date => {
      const row: Record<string, number | string | null> = { date }
      lines.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData, lines])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultMonths), end: rows.length - 1 })
  }, [rows.length, defaultMonths])

  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setHidden(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            {title}
            <ProxyBadge caveat={AU_PROXY_CAVEATS.monthly_cpi_floor} />
          </div>
          <div className={kit.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(s => (
            <button key={s.key} type="button"
              className={`${kit.legendItem} ${hidden.has(s.key) ? kit.legendItemOff : ''}`}
              onClick={() => toggle(s.key)}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </button>
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
                const s = lines.find(x => x.key === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            {RBA_BAND}
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            {lines.filter(s => !hidden.has(s.key)).map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={s.width ?? 1.8}
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

export function AUOtherInflationContent() {
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

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} ABS Monthly CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS (complete Monthly CPI dataflow, wtd avg 8 capitals, index ~2023-24=100) &mdash; {PAGE_CAPTION}.
        All panels YoY at lag 12 against the RBA 2&ndash;3% target band.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="Tradables vs Non-tradables — YoY [MONTHLY]"
          subtitle="Tradables carry the imported/exchange-rate shocks; non-tradables are the domestic (wage-sensitive) inflation read"
          lines={[
            { code: 'AU_CPIM_TRADABLES', key: 'trad', label: 'Tradables', color: '#f59e0b', width: 2.2 },
            { code: 'AU_CPIM_NONTRADABLES', key: 'nontrad', label: 'Non-tradables', color: '#60a5fa', width: 2.2 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title="Goods vs Services — YoY [MONTHLY]"
          subtitle="Services inflation is the sticky domestic component; goods carry the supply-chain and energy swings"
          lines={[
            { code: 'AU_CPIM_GOODS', key: 'goods', label: 'Goods', color: '#f59e0b', width: 2.2 },
            { code: 'AU_CPIM_SERVICES', key: 'services', label: 'Services', color: '#60a5fa', width: 2.2 },
          ]}
          allData={allData}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="Discretionary vs Non-discretionary — YoY [MONTHLY]"
          subtitle="ABS cost-of-living split: non-discretionary (essentials) inflation is what households cannot substitute away from"
          lines={[
            { code: 'AU_CPIM_DISCRETIONARY', key: 'disc', label: 'Discretionary', color: '#e879f9', width: 2.2 },
            { code: 'AU_CPIM_NONDISCRETIONARY', key: 'nondisc', label: 'Non-discretionary', color: '#4ade80', width: 2.2 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title="Exclusion Measures — YoY [MONTHLY]"
          subtitle="Ex food & energy is the closest US-core analog; ex volatile items (fruit/veg & fuel) and ex volatile & holiday travel are the ABS's own monthly underlying cuts"
          lines={[
            { code: 'AU_CPIM_XFE', key: 'xfe', label: 'Ex food & energy (US-core analog)', color: '#e2e8f0', width: 2.4 },
            { code: 'AU_CPIM_EXVOLATILE', key: 'exvol', label: 'Ex volatile items', color: '#fbbf24', width: 1.6 },
            { code: 'AU_CPIM_EXVOLHOL', key: 'exvolhol', label: 'Ex volatile & holiday travel', color: '#38bdf8', width: 1.6 },
          ]}
          allData={allData}
        />
      </div>
    </>
  )
}
