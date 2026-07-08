import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchBojTsBatch, type EstatPoint } from '../lib/estat'
import {
  type NV,
  fmtAxisDate, TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan Bank Lending dashboard — BoJ loans & discounts outstanding and
// deposits (major + regional + shinkin banks, monthly) via the BoJ
// Time-Series Data Search API (MD13). Values arrive in ¥100 MILLION units
// (6,761,385 = ¥676.1T) — formatted as ¥T by dividing by 10,000. Lending
// growth uses the PUBLISHED BoJ YoY series (JP_LOANS_YOY, back to 1992), not
// a terminal computation. Every panel is a PROXY of the US H.8 bank-credit
// view (aggregate stock only, no borrower-category split) and carries
// JP_PROXY_CAVEATS.boj_lending.

type AllData = Record<string, EstatPoint[]>

const ALL_CODES = ['JP_LOANS', 'JP_LOANS_YOY', 'JP_DEPOSITS'] as const

// ── Series helpers ───────────────────────────────────────────────────────────

/** a ÷ b × 100 on matching dates (loan-to-deposit ratio, %). */
function ratioOf(num: readonly EstatPoint[], den: readonly EstatPoint[]): NV[] {
  const d = new Map(den.map(p => [p.date, p.value]))
  return num.map(p => {
    const dv = d.get(p.date)
    return { date: p.date, value: dv != null && dv !== 0 ? (p.value / dv) * 100 : null }
  })
}

// ── Local panel kit (multi-line panel with brush) ────────────────────────────

type PanelRow = { date: string; [key: string]: number | null | string }

interface PanelSeriesDef {
  key: string
  label: string
  color: string
  dash?: string
  width?: number
}

function mergeByDate(
  inputs: ReadonlyArray<{ key: string; data: ReadonlyArray<NV> }>,
): PanelRow[] {
  const dates = new Set<string>()
  for (const s of inputs) for (const p of s.data) dates.add(p.date)
  const maps = inputs.map(s => ({ key: s.key, map: new Map(s.data.map(p => [p.date, p.value])) }))
  return [...dates].sort().map(date => {
    const row: PanelRow = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

const fmtDefault = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

function TSPanel({
  title, subtitle, badge, data, series,
  fmtLeft, zeroRef = false, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: PanelRow[]
  series: readonly PanelSeriesDef[]
  fmtLeft?: (v: number) => string
  zeroRef?: boolean
  defaultCount?: number
}) {
  const fmtL = fmtLeft ?? fmtDefault

  const [vis, setVis] = useState<Set<string>>(() => new Set(series.map(s => s.key)))
  const toggle = (k: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!data.length) return
    setBrush({ start: Math.max(0, data.length - defaultCount), end: data.length - 1 })
  }, [data.length, defaultCount])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {series.map(s => (
            <button key={s.key} type="button"
              className={`${kit.legendItem} ${vis.has(s.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(s.key)}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div className={kit.statusBlock}>No data</div>
      ) : (
        <div className={kit.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                tickFormatter={fmtAxisDate} minTickGap={60} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
                domain={['auto', 'auto']} tickFormatter={fmtL} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  const s = series.find(x => x.key === name)
                  const label = s?.label ?? String(name)
                  if (typeof v !== 'number') return ['-', label] as [string, string]
                  return [fmtL(v), label] as [string, string]
                }} />
              {zeroRef && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
              {series.filter(s => vis.has(s.key)).map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                  stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash}
                  dot={false} isAnimationActive={false} connectNulls legendType="none" />
              ))}
              <Brush dataKey="date" startIndex={brush.start} endIndex={brush.end}
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

// ── Panel series definitions ─────────────────────────────────────────────────

const S_LOANS: readonly PanelSeriesDef[] = [
  { key: 'loans', label: 'Loans & discounts outstanding', color: '#60a5fa', width: 2 },
]
const S_LOANS_YOY: readonly PanelSeriesDef[] = [
  { key: 'yoy', label: 'Lending YoY % (BoJ published)', color: '#ec4899', width: 2 },
]
const S_DEPOSITS: readonly PanelSeriesDef[] = [
  { key: 'deps', label: 'Deposits outstanding', color: '#4ade80', width: 2 },
]
const S_LOANS_VS_DEPS: readonly PanelSeriesDef[] = [
  { key: 'loans', label: 'Loans & discounts', color: '#60a5fa', width: 2 },
  { key: 'deps', label: 'Deposits', color: '#4ade80' },
]
const S_LDR: readonly PanelSeriesDef[] = [
  { key: 'ldr', label: 'Loan-to-deposit ratio %', color: '#f59e0b', width: 2 },
]

// ── Formatters ───────────────────────────────────────────────────────────────

// BoJ values arrive in ¥100 MILLION units: 6,761,385 = ¥676.1T → divide by 10,000.
const fmtYenT = (v: number) => `¥${(v / 10000).toLocaleString('en-US', { maximumFractionDigits: 1 })}T`
const fmtPct = (v: number) => `${v.toFixed(1)}%`

const GRID2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }
const SRC_NOTE: CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
  fontFamily: 'var(--font-mono)', padding: '0 2px',
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPBankLendingContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBojTsBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load BoJ lending data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const loans = useMemo(() => allData['JP_LOANS'] ?? [], [allData])
  const deposits = useMemo(() => allData['JP_DEPOSITS'] ?? [], [allData])

  const loanRows = useMemo(() => mergeByDate([
    { key: 'loans', data: loans },
  ]), [loans])

  const yoyRows = useMemo(() => mergeByDate([
    { key: 'yoy', data: allData['JP_LOANS_YOY'] ?? [] },
  ]), [allData])

  const depositRows = useMemo(() => mergeByDate([
    { key: 'deps', data: deposits },
  ]), [deposits])

  const loansVsDepsRows = useMemo(() => mergeByDate([
    { key: 'loans', data: loans },
    { key: 'deps', data: deposits },
  ]), [loans, deposits])

  const ldrRows = useMemo(() => mergeByDate([
    { key: 'ldr', data: ratioOf(loans, deposits) },
  ]), [loans, deposits])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} BoJ lending series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const badge = <ProxyBadge caveat={JP_PROXY_CAVEATS.boj_lending} />

  return (
    <>
      <div style={SRC_NOTE}>
        Source: Bank of Japan Time-Series Data Search API (MD13) &mdash; content not guaranteed by the Bank of Japan.
        Loans &amp; discounts and deposits outstanding, major + regional + shinkin banks, monthly averages, ¥100M units.
      </div>

      <div style={GRID2}>
        <TSPanel key="bl-loans"
          title="Loans & Discounts Outstanding"
          subtitle="Major + regional + shinkin banks, monthly (¥100M units, shown as ¥T)"
          badge={badge}
          data={loanRows} series={S_LOANS} fmtLeft={fmtYenT} />
        <TSPanel key="bl-yoy"
          title="Bank Lending — YoY Growth"
          subtitle="BoJ PUBLISHED year-over-year rate (not terminal-computed) — history to 1992"
          badge={badge}
          data={yoyRows} series={S_LOANS_YOY} fmtLeft={fmtPct} zeroRef />
      </div>

      <div style={GRID2}>
        <TSPanel key="bl-deps"
          title="Deposits Outstanding"
          subtitle="Major + regional + shinkin banks, monthly (¥100M units, shown as ¥T)"
          badge={badge}
          data={depositRows} series={S_DEPOSITS} fmtLeft={fmtYenT} />
        <TSPanel key="bl-loansdeps"
          title="Loans vs Deposits"
          subtitle="The persistent deposit overhang is the structural excess-savings picture of Japanese banking"
          badge={badge}
          data={loansVsDepsRows} series={S_LOANS_VS_DEPS} fmtLeft={fmtYenT} />
      </div>

      <TSPanel key="bl-ldr"
        title="Loan-to-Deposit Ratio"
        subtitle="Terminal-computed: loans ÷ deposits × 100 — not a BoJ-published series"
        badge={badge}
        data={ldrRows} series={S_LDR} fmtLeft={fmtPct} />
    </>
  )
}
