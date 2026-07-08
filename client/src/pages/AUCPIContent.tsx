import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea, Tooltip,
} from 'recharts'
import { fetchAbsBatch, type AbsPoint } from '../lib/abs'
import {
  type WD,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import {
  DistributionSection, buildDistribution, DIST_BUCKETS_WIDE, DIST_BUCKETS_NARROW,
} from '../components/charts/DistributionSection'
import { ProxyBadge } from '../components/ProxyBadge'
import { AU_PROXY_CAVEATS } from '../data/auProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Australia CPI — the dual-frequency showcase (docs/au-models-mapping.md
// decision a). Australia's complete Monthly CPI became the primary headline
// measure in Nov-2025 (index from Apr-2024, YoY from Apr-2025), while the
// QUARTERLY trimmed mean remains the RBA's stated primary underlying-inflation
// reference during the transition (through ~mid-2027). Every panel's frequency
// is unambiguous: titles carry [MONTHLY] or [QUARTERLY] tags, and monthly and
// quarterly series are NEVER mixed on one level axis (different bases:
// ~2023-24=100 vs 2011-12=100). Rate overlays are base-invariant and allowed.
// Long-history panels (distribution, explorer) run on the quarterly family.

type AllData = Record<string, AbsPoint[]>

const GROUPS_M = [
  { code: 'AU_CPIM_FOOD', label: 'Food & non-alc beverages', color: '#4ade80' },
  { code: 'AU_CPIM_ALCTOB', label: 'Alcohol & tobacco', color: '#94a3b8' },
  { code: 'AU_CPIM_CLOTHING', label: 'Clothing & footwear', color: '#e879f9' },
  { code: 'AU_CPIM_HOUSING', label: 'Housing', color: '#38bdf8' },
  { code: 'AU_CPIM_FURNISH', label: 'Furnishings & household', color: '#a78bfa' },
  { code: 'AU_CPIM_HEALTH', label: 'Health', color: '#fb7185' },
  { code: 'AU_CPIM_TRANSPORT', label: 'Transport', color: '#f59e0b' },
  { code: 'AU_CPIM_COMMS', label: 'Communication', color: '#22d3ee' },
  { code: 'AU_CPIM_RECREATION', label: 'Recreation & culture', color: '#fbbf24' },
  { code: 'AU_CPIM_EDUCATION', label: 'Education', color: '#86efac' },
  { code: 'AU_CPIM_INSURFIN', label: 'Insurance & financial', color: '#f472b6' },
] as const

const GROUPS_Q = GROUPS_M.map(g => ({ ...g, code: g.code.replace('AU_CPIM_', 'AU_CPIQ_') }))

const DIST_CODES_Q = [
  'AU_CPIQ_RENTS', 'AU_CPIQ_NEWDWELL', 'AU_CPIQ_ELECTRICITY', 'AU_CPIQ_GASFUELS',
  'AU_CPIQ_AUTOFUEL', 'AU_CPIQ_MEDSVCS', 'AU_CPIQ_MOTORVEH', 'AU_CPIQ_INSURANCE',
  'AU_CPIQ_TOBACCO', 'AU_CPIQ_FRUIT', 'AU_CPIQ_VEGETABLES', 'AU_CPIQ_DOMHOLIDAY',
  'AU_CPIQ_INTHOLIDAY', ...GROUPS_Q.map(g => g.code),
] as const

const ALL_CODES = [...new Set([
  'AU_CPI_M_HEADLINE', 'AU_CPI_M_SA', 'AU_CPI_M_TRIMMED', 'AU_CPI_M_WGTMED',
  'AU_CPI_Q_HEADLINE', 'AU_CPI_Q_TRIMMED', 'AU_CPI_Q_WGTMED',
  ...GROUPS_M.map(g => g.code),
  ...DIST_CODES_Q,
])]

/** YoY % from an index series at the given lag (12 = monthly, 4 = quarterly). */
function yoy(points: AbsPoint[], lag: number): Array<{ date: string; value: number }> {
  return points.slice(lag).map((p, i) => ({
    date: p.date,
    value: (p.value / points[i].value - 1) * 100,
  })).filter(p => Number.isFinite(p.value))
}

/** Merge named YoY series into date-union rows. */
function mergeRows(series: Array<{ key: string; pts: Array<{ date: string; value: number }> }>): Array<Record<string, number | string | null>> {
  const maps = series.map(s => new Map(s.pts.map(p => [p.date, p.value])))
  const dates = [...new Set(series.flatMap(s => s.pts.map(p => p.date)))].sort()
  return dates.map(date => {
    const row: Record<string, number | string | null> = { date }
    series.forEach((s, i) => { row[s.key] = maps[i].get(date) ?? null })
    return row
  })
}

const RBA_BAND = (
  <>
    <ReferenceArea y1={2} y2={3} fill="rgba(250, 204, 21, 0.06)" stroke="none" />
    <ReferenceLine y={2.5} stroke="rgba(250,204,21,0.45)" strokeDasharray="4 3" strokeWidth={1}
      label={{ value: 'RBA 2.5% midpoint', position: 'insideTopRight', fill: '#facc15', fontSize: 9 }} />
  </>
)

interface PanelSeries { key: string; label: string; color: string; width?: number; dash?: string }

function BandPanel({ title, subtitle, badgeKey, rows, series, defaultWindow }: {
  title: string
  subtitle: string
  badgeKey?: keyof typeof AU_PROXY_CAVEATS
  rows: Array<Record<string, number | string | null>>
  series: PanelSeries[]
  defaultWindow: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - defaultWindow), end: rows.length - 1 })
  }, [rows.length, defaultWindow])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            {title}
            {badgeKey && <ProxyBadge caveat={AU_PROXY_CAVEATS[badgeKey]} />}
          </div>
          <div className={kit.sectionSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {series.map(s => (
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
                if (typeof v !== 'number') return ['-', '']
                const s = series.find(x => x.key === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            {RBA_BAND}
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            {series.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash}
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

export function AUCPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAbsBatch(ALL_CODES).then(map => {
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

  // [MONTHLY] headline: NSA YoY + SA YoY (both from Apr-2025)
  const monthlyRows = useMemo(() => mergeRows([
    { key: 'm_nsa', pts: yoy(allData['AU_CPI_M_HEADLINE'] ?? [], 12) },
    { key: 'm_sa', pts: yoy(allData['AU_CPI_M_SA'] ?? [], 12) },
  ]), [allData])

  // [QUARTERLY→MONTHLY] RBA reference: quarterly trimmed/median YoY (1983→)
  // thick, monthly trimmed-mean YoY thin overlay — rates are base-invariant.
  const rbaRefRows = useMemo(() => mergeRows([
    { key: 'q_trim', pts: yoy(allData['AU_CPI_Q_TRIMMED'] ?? [], 4) },
    { key: 'q_med', pts: yoy(allData['AU_CPI_Q_WGTMED'] ?? [], 4) },
    { key: 'm_trim', pts: yoy(allData['AU_CPI_M_TRIMMED'] ?? [], 12) },
  ]), [allData])

  // [QUARTERLY] headline long history (1949→)
  const quarterlyHeadlineRows = useMemo(() => mergeRows([
    { key: 'q_head', pts: yoy(allData['AU_CPI_Q_HEADLINE'] ?? [], 4) },
  ]), [allData])

  // [MONTHLY] 11 groups YoY
  const groupRowsM = useMemo(() => mergeRows(
    GROUPS_M.map(g => ({ key: g.code, pts: yoy(allData[g.code] ?? [], 12) }))
  ), [allData])

  // [QUARTERLY] distribution over 24 long-history series (lag 4)
  const distWide = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, DIST_CODES_Q, DIST_BUCKETS_WIDE, 4) : [],
    [allData]
  )
  const distNarrow = useMemo(
    () => Object.keys(allData).length > 0 ? buildDistribution(allData, DIST_CODES_Q, DIST_BUCKETS_NARROW, 4) : [],
    [allData]
  )

  const explorerItems: ExplorerItem[] = useMemo(() => [
    { id: 'AU_CPI_Q_HEADLINE', label: 'CPI — All groups [QUARTERLY, 1948→]', depth: 0 },
    { id: 'AU_CPI_Q_TRIMMED', label: 'CPI — Trimmed mean [QUARTERLY, 1982→]', depth: 0 },
    { id: 'AU_CPI_Q_WGTMED', label: 'CPI — Weighted median [QUARTERLY, 1982→]', depth: 0 },
    { id: 'AU_CPI_M_HEADLINE', label: 'CPI — All groups [MONTHLY, 2024→]', depth: 0 },
    ...GROUPS_Q.map(g => ({ id: g.code, label: `CPI ${g.label} [QUARTERLY]`, depth: 1 })),
    ...DIST_CODES_Q.filter(c => !GROUPS_Q.some(g => g.code === c))
      .map(c => ({ id: c, label: `CPI ${c.replace('AU_CPIQ_', '').toLowerCase()} [QUARTERLY]`, depth: 1 })),
  ], [])

  const explorerData = useMemo(() => {
    const out: Record<string, WD[]> = {}
    for (const item of explorerItems) out[item.id] = allData[item.id] ?? []
    return out
  }, [allData, explorerItems])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} ABS CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        ABS (CPI / CPI_Q dataflows, wtd avg 8 capitals) &mdash; DUAL FREQUENCY: the complete Monthly CPI
        (Australia&rsquo;s primary headline since Nov-2025, index from Apr-2024) alongside the quarterly
        series (1948&rarr;). Different bases per frequency &mdash; levels never mixed; rate comparisons only.
      </div>

      <BandPanel
        title="Headline CPI — YoY [MONTHLY]"
        subtitle="Complete Monthly CPI, NSA + seasonally adjusted — YoY readable from Apr-2025 only (index from Apr-2024); SA uses interim methods on <2 years of data"
        badgeKey="monthly_cpi_floor"
        rows={monthlyRows}
        series={[
          { key: 'm_nsa', label: 'All groups (NSA)', color: '#e2e8f0', width: 2.2 },
          { key: 'm_sa', label: 'All groups (SA, interim)', color: '#facc15', width: 1.6 },
        ]}
        defaultWindow={30}
      />

      <BandPanel
        title="RBA Underlying Inflation Reference [QUARTERLY, monthly overlay]"
        subtitle="The QUARTERLY trimmed mean remains the RBA's stated primary underlying-inflation reference during the monthly transition (through ~mid-2027) — 40+ years of history vs the monthly measure's <2. Monthly trimmed mean overlaid as the timely read."
        badgeKey="trimmed_mean_reference"
        rows={rbaRefRows}
        series={[
          { key: 'q_trim', label: 'Trimmed mean [Q] — RBA reference', color: '#e2e8f0', width: 2.4 },
          { key: 'q_med', label: 'Weighted median [Q]', color: '#60a5fa', width: 1.6 },
          { key: 'm_trim', label: 'Trimmed mean [M] (interim SA)', color: '#facc15', width: 1.2, dash: '4 3' },
        ]}
        defaultWindow={120}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <BandPanel
          title="Headline CPI — YoY [QUARTERLY]"
          subtitle="All groups, 1949→ — the long-history continuity series (publishes through at least mid-2027)"
          badgeKey="dual_freq_cpi"
          rows={quarterlyHeadlineRows}
          series={[{ key: 'q_head', label: 'All groups YoY [Q]', color: '#e2e8f0', width: 1.8 }]}
          defaultWindow={160}
        />
        <BandPanel
          title="CPI Groups — YoY [MONTHLY]"
          subtitle="11 groups from the complete Monthly CPI — YoY from Apr-2025 (short history by construction)"
          badgeKey="monthly_cpi_floor"
          rows={groupRowsM}
          series={GROUPS_M.map(g => ({ key: g.code, label: g.label, color: g.color, width: 1.2 }))}
          defaultWindow={30}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <DistributionSection
          title="CPI Distribution — Wide Buckets [QUARTERLY]"
          subtitle="Share of 24 CPI groups & sub-indices by YoY range (4-quarter change; long history)"
          data={distWide}
          buckets={DIST_BUCKETS_WIDE}
        />
        <DistributionSection
          title="CPI Distribution — Narrow Buckets [QUARTERLY]"
          subtitle="Share of 24 CPI groups & sub-indices by YoY range"
          data={distNarrow}
          buckets={DIST_BUCKETS_NARROW}
        />
      </div>

      <SeriesExplorer
        title="Australia CPI Explorer"
        selectorLabel="Series"
        items={explorerItems}
        data={explorerData}
        defaultId="AU_CPI_Q_HEADLINE"
        unitLabel="Index (base varies by frequency — see series label)"
      />
    </>
  )
}

export { GROUPS_M as AU_CPI_GROUPS_M, DIST_CODES_Q as AU_CPI_DIST_CODES_Q, yoy as auYoy, mergeRows as auMergeRows }
