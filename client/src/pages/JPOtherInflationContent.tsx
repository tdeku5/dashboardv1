import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import kit from '../components/charts/ChartKit.module.css'

// Japan "Other Inflation" dashboard — the Japan-specific CPI mechanics off
// e-Stat table 0003427113 (monthly, 2020=100, NSA except the _SA variants).
// Goods vs services (Japan's services inflation is the BoJ's wage-passthrough
// watch), the energy & fresh-food block (exactly what separates "core" from
// "core-core"), Japan's structurally-flat rent story (house rent + imputed
// rent ≈ a fifth of the basket and barely moves — the standing drag on
// headline), and the durability split. All series are DIRECT e-Stat indices —
// no proxy badges on this page.

const CODES = [
  'CPI_HEADLINE_JP',
  'JP_CPI_GOODS', 'JP_CPI_SERVICES', 'JP_CPI_GOODS_SA', 'JP_CPI_SERVICES_SA',
  'JP_CPI_ENERGY', 'JP_CPI_FRESHFOOD', 'JP_CPI_GASOLINE', 'JP_CPI_ELECTRICITY', 'JP_CPI_GAS',
  'JP_CPI_RENT', 'JP_CPI_EXIMPRENT',
  'JP_CPI_DUR', 'JP_CPI_SEMIDUR', 'JP_CPI_NONDUR',
] as const

type AllData = Record<string, EstatPoint[]>

interface LineDef {
  code: string
  key: string
  label: string
  color: string
  width?: number
}

// ── Helpers (duplicated per-file per house convention) ───────────────────────

/** Calendar-month YoY map from a raw index series (robust to gaps). */
function yoyMapOf(data: EstatPoint[]): Map<string, number | null> {
  const idx = new Map(data.map(p => [p.date, p.value]))
  const out = new Map<string, number | null>()
  for (const p of data) {
    const [y, m] = p.date.split('-').map(Number)
    const prior = idx.get(`${y - 1}-${String(m).padStart(2, '0')}-01`)
    out.set(p.date, prior != null && prior !== 0 ? (p.value / prior - 1) * 100 : null)
  }
  return out
}

// ── Generic multi-line YoY panel (date-union alignment, toggleable legend) ───

function MultiLineYoyPanel({
  title, subtitle, lines, allData, defaultMonths = 180,
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
          <div className={kit.sectionTitle}>{title}</div>
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
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
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

export function JPOtherInflationContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(CODES).then(map => {
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

  if (loading) return <div className={kit.statusBlock}>Loading {CODES.length} e-Stat CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau of Japan (e-Stat 0003427113) &mdash; monthly, 2020=100, NSA except the SA goods/services panel
        (SA history starts 2010). Japan-specific inflation mechanics: goods/services split, the fresh-food &amp; energy
        wedge between core and core-core, the structurally-flat rent block, and the durability split.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="Goods vs Services — YoY (NSA)"
          subtitle="Services inflation is the BoJ's wage-passthrough watch — goods carry the imported/energy shocks"
          lines={[
            { code: 'JP_CPI_GOODS', key: 'goods', label: 'Goods', color: '#f59e0b', width: 2.2 },
            { code: 'JP_CPI_SERVICES', key: 'services', label: 'Services', color: '#60a5fa', width: 2.2 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title="Goods vs Services — YoY (SA)"
          subtitle="Seasonally adjusted variants — cleaner momentum read; SA history starts 2010"
          lines={[
            { code: 'JP_CPI_GOODS_SA', key: 'goodsSa', label: 'Goods (SA)', color: '#f59e0b', width: 2.2 },
            { code: 'JP_CPI_SERVICES_SA', key: 'servicesSa', label: 'Services (SA)', color: '#60a5fa', width: 2.2 },
          ]}
          allData={allData}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title="Energy & Fresh Food — YoY"
          subtitle="Exactly what separates the two cores: fresh food is excluded from &ldquo;core&rdquo;; energy only drops out at &ldquo;core-core&rdquo;"
          lines={[
            { code: 'JP_CPI_ENERGY', key: 'energy', label: 'Energy', color: '#f59e0b', width: 2.2 },
            { code: 'JP_CPI_FRESHFOOD', key: 'fresh', label: 'Fresh Food', color: '#4ade80', width: 2.2 },
            { code: 'JP_CPI_GASOLINE', key: 'gasoline', label: 'Gasoline', color: '#ec4899', width: 1.3 },
            { code: 'JP_CPI_ELECTRICITY', key: 'electricity', label: 'Electricity', color: '#60a5fa', width: 1.3 },
            { code: 'JP_CPI_GAS', key: 'gas', label: 'Gas (piped)', color: '#a78bfa', width: 1.3 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title="Rent & Imputed Rent — YoY"
          subtitle="Japan's structurally-flat rent story: house rent barely moves, so CPI ex imputed rent runs persistently above headline"
          lines={[
            { code: 'CPI_HEADLINE_JP', key: 'headline', label: 'Headline (all items)', color: '#e2e8f0', width: 2.2 },
            { code: 'JP_CPI_RENT', key: 'rent', label: 'House Rent', color: '#38bdf8', width: 1.8 },
            { code: 'JP_CPI_EXIMPRENT', key: 'exImpRent', label: 'All items ex Imputed Rent', color: '#f59e0b', width: 1.8 },
          ]}
          allData={allData}
        />
      </div>

      <MultiLineYoyPanel
        title="Durability Split — YoY"
        subtitle="Durable vs semi-durable vs non-durable goods — durables carried Japan's long goods deflation; non-durables carry the food/energy shocks"
        lines={[
          { code: 'JP_CPI_DUR', key: 'dur', label: 'Durable Goods', color: '#60a5fa', width: 2.0 },
          { code: 'JP_CPI_SEMIDUR', key: 'semidur', label: 'Semi-durable Goods', color: '#f59e0b', width: 2.0 },
          { code: 'JP_CPI_NONDUR', key: 'nondur', label: 'Non-durable Goods', color: '#4ade80', width: 2.0 },
        ]}
        allData={allData}
      />
    </>
  )
}
