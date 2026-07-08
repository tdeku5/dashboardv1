import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch, type EurostatPoint } from '../lib/eurostat'
import {
  computeChangePct,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 "Other Inflation" dashboard — one parameterized page serving DE / FR /
// IT. The HICP special aggregates the ECB actually talks about: goods vs
// services, the energy/food wedge between headline and core, non-energy
// industrial goods (NEIG), and the durability split. All series are DIRECT
// harmonized indices from the ECB `HICP` dataflow (monthly, NSA, 2025=100) —
// no proxy badges. Aggregates follow e-COICOP 2 (the 2026 classification; no
// separate tobacco item exists post-restructure — tobacco sits inside food
// incl. alcohol & tobacco).

type AllData = Record<string, EurostatPoint[]>

function codesFor(cc: Eu3Country) {
  const p = (stem: string) => `${cc}_${stem}`
  return {
    headline: p('HICP'),
    goods: p('HICP_GOODS'),
    services: p('HICP_SERVICES'),
    energy: p('HICP_ENERGY'),
    food: p('HICP_FOOD'),
    foodun: p('HICP_FOODUN'),
    neig: p('HICP_NEIG'),
    dur: p('HICP_DUR'),
    semidur: p('HICP_SEMIDUR'),
    nondur: p('HICP_NONDUR'),
  }
}

interface LineDef {
  code: string
  key: string
  label: string
  color: string
  width?: number
  dash?: string
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
    const maps = lines.map(s => {
      const yoy = computeChangePct(allData[s.code] ?? [], 12)
      return new Map(yoy.map(p => [p.date, p.value]))
    })
    const dates = new Set<string>()
    for (const s of lines) for (const p of allData[s.code] ?? []) dates.add(p.date)
    return [...dates].sort().map(date => {
      const row: Record<string, number | string | null> = { date }
      lines.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData, lines])

  const [vis, setVis] = useState<Set<string>>(() => new Set(lines.map(s => s.key)))
  const toggle = (key: string) => setVis(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultMonths), end: rows.length - 1 })
  }, [rows.length, defaultMonths])

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
              className={`${kit.legendItem} ${vis.has(s.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(s.key)}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className={kit.statusBlock}>No data</div>
      ) : (
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
              {lines.filter(s => vis.has(s.key)).map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                  stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
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
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function EU3OtherInflationContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo(() => codesFor(cc), [cc])
  const allCodes = useMemo(() => [
    codes.headline, codes.goods, codes.services,
    codes.energy, codes.food, codes.foodun,
    codes.neig, codes.dur, codes.semidur, codes.nondur,
  ], [codes])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchEu3Batch(allCodes).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load HICP data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} HICP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const country = EU3_COUNTRY_LABEL[cc]

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ECB Data Portal (HICP dataflow) &mdash; monthly special aggregates, 2025=100, NSA.
        Aggregates follow e-COICOP 2 (2026 classification; no separate tobacco item exists post-restructure).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title={`${country} — Goods vs Services YoY`}
          subtitle="All-goods vs all-services year-over-year %Δ, headline for reference (NSA)"
          lines={[
            { code: codes.headline, key: 'headline', label: 'Headline (all items)', color: '#e2e8f0', width: 1.4, dash: '5 3' },
            { code: codes.goods, key: 'goods', label: 'Goods (all)', color: '#38bdf8', width: 2 },
            { code: codes.services, key: 'services', label: 'Services', color: '#f472b6', width: 2 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title={`${country} — Energy & Food YoY`}
          subtitle="The wedge between headline and core: what the ex-energy/food aggregates strip out (NSA)"
          lines={[
            { code: codes.energy, key: 'energy', label: 'Energy', color: '#f59e0b', width: 2 },
            { code: codes.food, key: 'food', label: 'Food incl. alcohol & tobacco', color: '#4ade80', width: 1.8 },
            { code: codes.foodun, key: 'foodun', label: 'Unprocessed food', color: '#38bdf8', width: 1.6 },
          ]}
          allData={allData}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <MultiLineYoyPanel
          title={`${country} — NEIG vs Services YoY`}
          subtitle="Non-energy industrial goods vs services — the ECB's core goods/services split (NSA)"
          lines={[
            { code: codes.neig, key: 'neig', label: 'Non-energy industrial goods', color: '#60a5fa', width: 2 },
            { code: codes.services, key: 'services', label: 'Services', color: '#f472b6', width: 2 },
          ]}
          allData={allData}
        />
        <MultiLineYoyPanel
          title={`${country} — Durability Split YoY`}
          subtitle="Durables vs semi-durables vs non-durables year-over-year %Δ (NSA)"
          lines={[
            { code: codes.dur, key: 'dur', label: 'Durables', color: '#a78bfa', width: 2 },
            { code: codes.semidur, key: 'semidur', label: 'Semi-durables', color: '#fbbf24', width: 1.8 },
            { code: codes.nondur, key: 'nondur', label: 'Non-durables', color: '#22d3ee', width: 1.8 },
          ]}
          allData={allData}
        />
      </div>
    </>
  )
}
