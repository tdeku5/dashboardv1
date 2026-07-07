import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchStatcanBatch, type StatcanPoint } from '../lib/statcan'
import {
  type NV, computeChangePct, computeMA,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_M,
} from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { QuickSelectRow } from '../components/charts/QuickSelectRow'
import { ProxyBadge } from '../components/ProxyBadge'
import { CA_PROXY_CAVEATS } from '../data/caProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Canada Payrolls dashboard — decision (d): Canada has TWO payroll measures
// and this page shows BOTH side by side, making visually explicit that they
// are DIFFERENT measures. LEFT: SEPH payroll employment (administrative
// payroll count — the NFP concept, ~1-month extra lag, 2001→). RIGHT: LFS
// employment (household survey — the market-moving monthly print, 1976→).
// Both carry their own proxy caveat; neither is the US establishment survey.

type AllData = Record<string, StatcanPoint[]>

const ALL_CODES = [
  'CA_SEPH_EMP',     // SEPH payroll employment, industrial aggregate, thousands
  'CA_EMPLOYMENT',   // LFS employment, thousands, SA
  'CA_SEPH_AWE',     // SEPH average weekly earnings, $
  'CA_SEPH_GOODS',   // SEPH goods-producing industries
  'CA_SEPH_CONSTR',  // SEPH construction
  'CA_SEPH_MFG',     // SEPH manufacturing
] as const

const SEPH_EXPLORER_ITEMS: ExplorerItem[] = [
  { id: 'CA_SEPH_EMP', label: 'Industrial aggregate' },
  { id: 'CA_SEPH_GOODS', label: 'Goods-producing' },
  { id: 'CA_SEPH_CONSTR', label: 'Construction' },
  { id: 'CA_SEPH_MFG', label: 'Manufacturing' },
]

// ── Formatters (levels are thousands of employees) ───────────────────────────

const fmtEmpTick = (v: number): string => `${(v / 1000).toFixed(1)}M`
const fmtEmpTip = (v: number): string => `${v.toLocaleString('en-CA', { maximumFractionDigits: 1 })}k`
const fmtKTick = (v: number): string => `${v.toFixed(0)}k`
const fmtKTip = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}k`
const fmtCad = (v: number): string => `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

// ── Date-union alignment ─────────────────────────────────────────────────────

type Row = { date: string; [key: string]: number | string | null }

function alignByDate(series: ReadonlyArray<{ key: string; data: ReadonlyArray<{ date: string; value: number | null }> }>): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({
    key: s.key,
    map: new Map(s.data.map(p => [p.date, p.value])),
  }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const m of maps) row[m.key] = m.map.get(date) ?? null
    return row
  })
}

// ── Local panels (ChartKit classes, exemplar-pattern) ────────────────────────

type LineSpec = { key: string; label: string; color: string; width?: number; dash?: string }

function LinesPanel({
  title, subtitle, badge, lines, rows,
  zeroLine = false, autoDomain = false,
  yTickFmt, valueFmt, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineSpec[]
  rows: Row[]
  zeroLine?: boolean
  autoDomain?: boolean
  yTickFmt: (v: number) => string
  valueFmt: (v: number) => string
  defaultCount?: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '10Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: '10Y' })
  }, [rows.length, defaultCount])

  const yDomain = useMemo((): [number, number] | undefined => {
    if (!autoDomain || !rows.length || brush.end < brush.start) return undefined
    const visible = rows.slice(Math.max(0, brush.start), Math.min(rows.length, brush.end + 1))
    const vals: number[] = []
    for (const r of visible) {
      for (const l of lines) {
        const v = r[l.key]
        if (typeof v === 'number') vals.push(v)
      }
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.02 || 1
    return [min - pad, max + pad]
  }, [autoDomain, rows, brush, lines])

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
          {lines.map(l => (
            <span key={l.key} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
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
            <YAxis domain={yDomain} tick={TICK} tickLine={false} axisLine={false} width={58}
              tickFormatter={yTickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const spec = lines.find(l => l.key === name)
                return [typeof v === 'number' ? valueFmt(v) : '-', spec?.label ?? String(name)] as [string, string]
              }} />
            {zeroLine && <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.label}
                stroke={l.color} strokeWidth={l.width ?? 1.8} strokeDasharray={l.dash}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
            ))}
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = rows.length - 1
          setBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
        }}
        periods={QUICK_PERIODS_M}
      />
    </div>
  )
}

type BarMaRow = { date: string; bar: number | null; ma: number | null }

function BarMaPanel({
  title, subtitle, badge, rows, barLabel, maLabel, yTickFmt, valueFmt, defaultCount = 120,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  rows: BarMaRow[]
  barLabel: string
  maLabel: string
  yTickFmt: (v: number) => string
  valueFmt: (v: number) => string
  defaultCount?: number
}) {
  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '10Y' })

  useEffect(() => {
    if (!rows.length) return
    const end = rows.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: '10Y' })
  }, [rows.length, defaultCount])

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
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(74,222,128,0.75)' }} />
            {barLabel} (+)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(239,68,68,0.75)' }} />
            {barLabel} (&minus;)
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#60a5fa' }} />
            {maLabel}
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={yTickFmt} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                return [valueFmt(v), name === 'ma' ? maLabel : barLabel] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <Bar dataKey="bar" name={barLabel} isAnimationActive={false} legendType="none" maxBarSize={16}>
              {rows.map((entry, idx) => (
                <Cell key={`b-${idx}`}
                  fill={(entry.bar ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(239,68,68,0.75)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="ma" name={maLabel}
              stroke="#60a5fa" strokeWidth={1.5}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = rows.length - 1
          setBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
        }}
        periods={QUICK_PERIODS_M}
      />
    </div>
  )
}

// ── Column header for the two-measure comparison ─────────────────────────────

function ColHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#94A3B8',
      textTransform: 'uppercase', padding: '0 2px',
    }}>
      {children}
    </div>
  )
}

// ── Level + monthly-change row builders ──────────────────────────────────────

function toLevelRows(data: StatcanPoint[]): Row[] {
  return data.map(d => ({ date: d.date, value: d.value }))
}

function toChangeRows(data: StatcanPoint[]): BarMaRow[] {
  const diffs: NV[] = data.map((d, i) =>
    i === 0 ? { date: d.date, value: null } : { date: d.date, value: d.value - data[i - 1].value })
  const ma = computeMA(diffs, 3)
  return diffs.map((d, i) => ({ date: d.date, bar: d.value, ma: ma[i]?.value ?? null }))
}

// ══════════════════════════════════════════════════════════════════════════════

export function CAPayrollsContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatcanBatch(ALL_CODES).then(map => {
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

  const seph = useMemo(() => allData['CA_SEPH_EMP'] ?? [], [allData])
  const lfs = useMemo(() => allData['CA_EMPLOYMENT'] ?? [], [allData])
  const awe = useMemo(() => allData['CA_SEPH_AWE'] ?? [], [allData])

  const sephLevelRows = useMemo((): Row[] => toLevelRows(seph), [seph])
  const sephChangeRows = useMemo((): BarMaRow[] => toChangeRows(seph), [seph])
  const lfsLevelRows = useMemo((): Row[] => toLevelRows(lfs), [lfs])
  const lfsChangeRows = useMemo((): BarMaRow[] => toChangeRows(lfs), [lfs])

  const yoyCompareRows = useMemo((): Row[] => alignByDate([
    { key: 'seph', data: computeChangePct(seph, 12) },
    { key: 'lfs', data: computeChangePct(lfs, 12) },
  ]), [seph, lfs])

  const aweLevelRows = useMemo((): Row[] => toLevelRows(awe), [awe])
  const aweYoyRows = useMemo((): Row[] =>
    computeChangePct(awe, 12).map(d => ({ date: d.date, value: d.value })), [awe])

  if (loading) return <div className={kit.statusBlock}>Loading StatCan SEPH + LFS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Canada SEPH (14-10-0223) + LFS (14-10-0287) &mdash; monthly; two DIFFERENT payroll measures, not one survey
      </div>

      {/* ── TWO PAYROLL MEASURES — side-by-side comparison ─────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: '#e2e8f0',
        textTransform: 'uppercase', padding: '4px 2px 0',
      }}>
        Two Payroll Measures
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <ColHeader>SEPH Payroll Employment (NFP concept)</ColHeader>
          <LinesPanel
            title="SEPH Payroll Employment — Level"
            subtitle="administrative payroll count · excludes self-employed · released ~1 month after LFS"
            badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.seph_payrolls} />}
            lines={[{ key: 'value', label: 'SEPH employment (industrial aggregate)', color: '#60a5fa', width: 1.8 }]}
            rows={sephLevelRows}
            autoDomain
            yTickFmt={fmtEmpTick}
            valueFmt={fmtEmpTip}
          />
          <BarMaPanel
            title="SEPH Payroll Employment — Monthly Change"
            subtitle="administrative payroll count · excludes self-employed · released ~1 month after LFS"
            badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.seph_payrolls} />}
            rows={sephChangeRows}
            barLabel="MoM change"
            maLabel="3-mo MA"
            yTickFmt={fmtKTick}
            valueFmt={fmtKTip}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <ColHeader>LFS Employment (household survey)</ColHeader>
          <LinesPanel
            title="LFS Employment — Level"
            subtitle="household survey · includes self-employed · the market-moving monthly print"
            badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.lfs_payrolls} />}
            lines={[{ key: 'value', label: 'LFS employment (SA)', color: '#4ade80', width: 1.8 }]}
            rows={lfsLevelRows}
            autoDomain
            yTickFmt={fmtEmpTick}
            valueFmt={fmtEmpTip}
          />
          <BarMaPanel
            title="LFS Employment — Monthly Change"
            subtitle="household survey · includes self-employed · the market-moving monthly print"
            badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.lfs_payrolls} />}
            rows={lfsChangeRows}
            barLabel="MoM change"
            maLabel="3-mo MA"
            yTickFmt={fmtKTick}
            valueFmt={fmtKTip}
          />
        </div>
      </div>

      {/* ── SEPH vs LFS overlay ────────────────────────────────────────────── */}
      <LinesPanel
        title="SEPH vs LFS — YoY %"
        subtitle="Year-over-year % of both employment measures — divergence = payroll count vs household survey, not noise"
        badge={<>
          <ProxyBadge caveat={CA_PROXY_CAVEATS.seph_payrolls} />
          <ProxyBadge caveat={CA_PROXY_CAVEATS.lfs_payrolls} />
        </>}
        lines={[
          { key: 'seph', label: 'SEPH payroll employment YoY', color: '#60a5fa', width: 1.8 },
          { key: 'lfs', label: 'LFS employment YoY', color: '#4ade80', width: 1.8 },
        ]}
        rows={yoyCompareRows}
        zeroLine
        yTickFmt={fmtPctTick}
        valueFmt={fmtPctTooltip}
      />

      {/* ── Average Weekly Earnings ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Average Weekly Earnings — Level"
          subtitle="SEPH average weekly earnings including overtime, industrial aggregate, $/week"
          badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.seph_earnings} />}
          lines={[{ key: 'value', label: 'AWE ($/week)', color: '#a78bfa', width: 1.8 }]}
          rows={aweLevelRows}
          autoDomain
          yTickFmt={fmtCad}
          valueFmt={fmtCad}
        />
        <LinesPanel
          title="Average Weekly Earnings — YoY %"
          subtitle="Year-over-year %, computed from SEPH AWE level"
          badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.seph_earnings} />}
          lines={[{ key: 'value', label: 'AWE YoY %', color: '#f59e0b', width: 1.8 }]}
          rows={aweYoyRows}
          zeroLine
          yTickFmt={fmtPctTick}
          valueFmt={fmtPctTooltip}
        />
      </div>

      {/* ── SEPH sector explorer ───────────────────────────────────────────── */}
      <SeriesExplorer
        title="SEPH Sector Explorer"
        selectorLabel="Sector"
        items={SEPH_EXPLORER_ITEMS}
        data={allData}
        defaultId="CA_SEPH_EMP"
        unitLabel="Employees, thousands"
        badge={<ProxyBadge caveat={CA_PROXY_CAVEATS.seph_payrolls} />}
      />
    </>
  )
}
