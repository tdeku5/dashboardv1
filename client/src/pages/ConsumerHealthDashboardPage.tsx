import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries } from '../lib/fred'
import type { FredObservation } from '../lib/fred'
import styles from './ConsumerHealthDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type BrushState = { start: number; end: number; period: string }
type ChartKey   = 'sent' | 'delinq' | 'ccDelinq' | 'debtSvc' | 'ccBal' | 'hhNw' | 'gasPrice'

// ── Constants ─────────────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:   '#090e15',
    border:       '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:   'var(--font-mono)',
    fontSize:     11,
    padding:      '6px 10px',
  },
  labelStyle:    { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle:     { color: '#CBD5E1', padding: '1px 0' },
  cursor:        { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
  labelFormatter: (v: unknown) => typeof v === 'string' ? fmtFullDate(v) : '',
}

const BRUSH_STYLE = {
  height:         34,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  tickFormatter:  (d: string) => {
    const [y, m] = d.split('-')
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
  },
  gap: 3,
} as const

const QUICK_PERIODS_M = [
  { label: '5Y',  count: 60   },
  { label: '10Y', count: 120  },
  { label: '20Y', count: 240  },
  { label: 'Max', count: Infinity },
] as const

const QUICK_PERIODS_Q = [
  { label: '5Y',  count: 20  },
  { label: '10Y', count: 40  },
  { label: '20Y', count: 80  },
  { label: 'Max', count: Infinity },
] as const

// ── All series ────────────────────────────────────────────────────────────────

const ALL_IDS = [
  'UMCSENT',
  'DRCLACBS', 'DRBLACBS', 'DRSFRMACBS', 'DRCRELEXFACBS',
  'DRCCLACBS', 'DRCCLT100S', 'DRCCLOBS',
  'TDSP', 'MDSP', 'CDSP',
  'RCCCBBALTOT',
  'BOGZ1FL192090005Q',
  'GASREGW',
] as const

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
}

// ── Compute helpers ───────────────────────────────────────────────────────────

function computeYoY(data: WD[], lag = 12): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < lag) return { date: d.date, value: null }
    const prev = data[i - lag].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeQoQ(data: WD[], lag = 1): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < lag) return { date: d.date, value: null }
    const prev = data[i - lag].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

// ── QuickSelectRow ────────────────────────────────────────────────────────────

function QuickSelectRow({
  period,
  onSelect,
  periods,
}: {
  period:   string
  onSelect: (label: string, count: number) => void
  periods:  readonly { label: string; count: number }[]
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {periods.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${period === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.count)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function ConsumerHealthDashboardPage() {
  // ── Data fetch ───────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          ALL_IDS.map(async (id) => {
            const obs = await fetchFredSeries(id)
            return [id, parseObs(obs)] as [string, WD[]]
          })
        )
        if (cancelled) return
        setAllData(Object.fromEntries(entries))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to fetch data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Sentiment chart data ────────────────────────────────────────────────
  const sentChartData = useMemo(
    () => (allData['UMCSENT'] ?? []).map(d => ({ date: d.date, value: d.value })),
    [allData]
  )

  // ── Chart 1: Delinquency Rates ──────────────────────────────────────────
  const delinqData = useMemo(() => {
    const consumer  = new Map((allData['DRCLACBS']      ?? []).map(d => [d.date, d.value]))
    const business  = new Map((allData['DRBLACBS']      ?? []).map(d => [d.date, d.value]))
    const mortgage  = new Map((allData['DRSFRMACBS']    ?? []).map(d => [d.date, d.value]))
    const cre       = new Map((allData['DRCRELEXFACBS'] ?? []).map(d => [d.date, d.value]))
    const dates = new Set([
      ...(allData['DRCLACBS']      ?? []).map(d => d.date),
      ...(allData['DRBLACBS']      ?? []).map(d => d.date),
      ...(allData['DRSFRMACBS']    ?? []).map(d => d.date),
      ...(allData['DRCRELEXFACBS'] ?? []).map(d => d.date),
    ])
    return Array.from(dates).sort().map(date => ({
      date,
      consumer:  consumer.get(date)  ?? null,
      business:  business.get(date)  ?? null,
      mortgage:  mortgage.get(date)  ?? null,
      cre:       cre.get(date)       ?? null,
    }))
  }, [allData])

  // ── Chart 2: Credit Card Delinquencies ──────────────────────────────────
  const ccDelinqData = useMemo(() => {
    const total     = new Map((allData['DRCCLACBS']  ?? []).map(d => [d.date, d.value]))
    const top100    = new Map((allData['DRCCLT100S'] ?? []).map(d => [d.date, d.value]))
    const notTop100 = new Map((allData['DRCCLOBS']   ?? []).map(d => [d.date, d.value]))
    const dates = new Set([
      ...(allData['DRCCLACBS']  ?? []).map(d => d.date),
      ...(allData['DRCCLT100S'] ?? []).map(d => d.date),
      ...(allData['DRCCLOBS']   ?? []).map(d => d.date),
    ])
    return Array.from(dates).sort().map(date => ({
      date,
      total:     total.get(date)     ?? null,
      top100:    top100.get(date)    ?? null,
      notTop100: notTop100.get(date) ?? null,
    }))
  }, [allData])

  // ── Chart 3: Debt Service Payments ──────────────────────────────────────
  const debtSvcData = useMemo(() => {
    const household = new Map((allData['TDSP'] ?? []).map(d => [d.date, d.value]))
    const mortgage  = new Map((allData['MDSP'] ?? []).map(d => [d.date, d.value]))
    const consumer  = new Map((allData['CDSP'] ?? []).map(d => [d.date, d.value]))
    const dates = new Set([
      ...(allData['TDSP'] ?? []).map(d => d.date),
      ...(allData['MDSP'] ?? []).map(d => d.date),
      ...(allData['CDSP'] ?? []).map(d => d.date),
    ])
    return Array.from(dates).sort().map(date => ({
      date,
      household: household.get(date) ?? null,
      mortgage:  mortgage.get(date)  ?? null,
      consumer:  consumer.get(date)  ?? null,
    }))
  }, [allData])

  // ── Chart 4: Credit Card Balances ───────────────────────────────────────
  const ccBalYoy = useMemo(() => computeYoY(allData['RCCCBBALTOT'] ?? [], 4), [allData])
  const ccBalQoq = useMemo(() => computeQoQ(allData['RCCCBBALTOT'] ?? [], 1), [allData])
  const ccBalData = useMemo(() => (allData['RCCCBBALTOT'] ?? []).map((d, i) => ({
    date:  d.date,
    level: d.value,
    yoy:   ccBalYoy[i]?.value ?? null,
    qoq:   ccBalQoq[i]?.value ?? null,
  })), [allData, ccBalYoy, ccBalQoq])

  // ── Chart 5: HH Net Worth ──────────────────────────────────────────────
  const hhNwYoy = useMemo(() => computeYoY(allData['BOGZ1FL192090005Q'] ?? [], 4), [allData])
  const hhNwQoq = useMemo(() => computeQoQ(allData['BOGZ1FL192090005Q'] ?? [], 1), [allData])
  const hhNwData = useMemo(() => (allData['BOGZ1FL192090005Q'] ?? []).map((d, i) => ({
    date:  d.date,
    level: d.value,
    yoy:   hhNwYoy[i]?.value ?? null,
    qoq:   hhNwQoq[i]?.value ?? null,
  })), [allData, hhNwYoy, hhNwQoq])

  // ── Chart 6: Gasoline Prices ────────────────────────────────────────────
  const gasData = useMemo(
    () => (allData['GASREGW'] ?? []).map(d => ({ date: d.date, value: d.value })),
    [allData]
  )

  // ── Visibility states ──────────────────────────────────────────────────

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const [visDelinq,   setVisDelinq]   = useState(() => new Set(['consumer', 'business', 'mortgage', 'cre']))
  const [visCcDelinq, setVisCcDelinq] = useState(() => new Set(['total', 'top100', 'notTop100']))
  const [visDebtSvc,  setVisDebtSvc]  = useState(() => new Set(['household', 'mortgage', 'consumer']))
  const [visCcBal,    setVisCcBal]    = useState(() => new Set(['yoy', 'qoq', 'level']))
  const [visHhNw,     setVisHhNw]     = useState(() => new Set(['yoy', 'qoq', 'level']))

  const toggleDelinq   = mkToggle(setVisDelinq)
  const toggleCcDelinq = mkToggle(setVisCcDelinq)
  const toggleDebtSvc  = mkToggle(setVisDebtSvc)
  const toggleCcBal    = mkToggle(setVisCcBal)
  const toggleHhNw     = mkToggle(setVisHhNw)

  // ── Brush states ──────────────────────────────────────────────────────

  const MAX: BrushState = { start: 0, end: 0, period: 'Max' }
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    sent:     { ...MAX },
    delinq:   { ...MAX },
    ccDelinq: { ...MAX },
    debtSvc:  { ...MAX },
    ccBal:    { ...MAX },
    hhNw:     { ...MAX },
    gasPrice: { ...MAX },
  })

  // Initialize brushes when data arrives
  useEffect(() => {
    if (!Object.keys(allData).length) return
    setBrushes({
      sent:     { start: 0, end: Math.max(0, sentChartData.length - 1), period: 'Max' },
      delinq:   { start: 0, end: Math.max(0, delinqData.length    - 1), period: 'Max' },
      ccDelinq: { start: 0, end: Math.max(0, ccDelinqData.length  - 1), period: 'Max' },
      debtSvc:  { start: 0, end: Math.max(0, (allData['TDSP'] ?? []).length - 1), period: 'Max' },
      ccBal:    { start: 0, end: Math.max(0, ccBalData.length      - 1), period: 'Max' },
      hhNw:     { start: 0, end: Math.max(0, hhNwData.length       - 1), period: 'Max' },
      gasPrice: { start: 0, end: Math.max(0, gasData.length        - 1), period: 'Max' },
    })
  }, [allData, sentChartData.length, delinqData.length, ccDelinqData.length, ccBalData.length, hhNwData.length, gasData.length])

  const handleBrush = useCallback(
    (key: ChartKey, startIndex?: number, endIndex?: number) => {
      if (startIndex == null || endIndex == null) return
      setBrushes(prev => ({
        ...prev,
        [key]: { start: startIndex, end: endIndex, period: '' },
      }))
    },
    []
  )

  const handleQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      setBrushes(prev => ({
        ...prev,
        [key]: { start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label },
      }))
    },
    []
  )

  // ── Y-domain helpers ───────────────────────────────────────────────────

  function autoDomain(
    data: Record<string, unknown>[],
    keys: string[],
    brush: BrushState,
  ): [number, number] | undefined {
    if (!data.length || brush.end < brush.start) return undefined
    const visible = data.slice(Math.max(0, brush.start), Math.min(data.length, brush.end + 1))
    if (!visible.length) return undefined
    const vals: number[] = []
    for (const d of visible) {
      for (const k of keys) {
        const v = d[k]
        if (typeof v === 'number' && isFinite(v)) vals.push(v)
      }
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.02
    return [min - pad, max + pad]
  }

  const yDomainSent     = useMemo(() => autoDomain(sentChartData, ['value'], brushes.sent),         [sentChartData, brushes.sent])
  const yDomainDelinq   = useMemo(() => autoDomain(delinqData,    ['consumer','business','mortgage','cre'], brushes.delinq), [delinqData, brushes.delinq])
  const yDomainCcDelinq = useMemo(() => autoDomain(ccDelinqData,  ['total','top100','notTop100'], brushes.ccDelinq), [ccDelinqData, brushes.ccDelinq])
  const yDomainDebtSvc  = useMemo(() => autoDomain(debtSvcData,   ['household','mortgage','consumer'], brushes.debtSvc), [debtSvcData, brushes.debtSvc])
  const yDomainCcBalL   = useMemo(() => autoDomain(ccBalData,     ['yoy','qoq'], brushes.ccBal),    [ccBalData, brushes.ccBal])
  const yDomainCcBalR   = useMemo(() => autoDomain(ccBalData,     ['level'], brushes.ccBal),        [ccBalData, brushes.ccBal])
  const yDomainHhNwL    = useMemo(() => autoDomain(hhNwData,      ['yoy','qoq'], brushes.hhNw),     [hhNwData, brushes.hhNw])
  const yDomainHhNwR    = useMemo(() => autoDomain(hhNwData,      ['level'], brushes.hhNw),         [hhNwData, brushes.hhNw])
  const yDomainGas      = useMemo(() => autoDomain(gasData,       ['value'], brushes.gasPrice),     [gasData, brushes.gasPrice])

  // ════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className={styles.shell}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/growth" className={styles.breadcrumbLink}>Growth</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Consumer Health</span>
      </nav>

      <main className={styles.body}>
        <h1 className={styles.majorHeader}>Consumer Health</h1>

        {loading && (
          <div className={styles.statusBlock}>Loading consumer health data&hellip;</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && (<>
          {/* ── UMich Consumer Sentiment ─────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  University of Michigan Consumer Sentiment
                </div>
                <div className={styles.sectionSubtitle}>
                  University of Michigan Surveys of Consumers &middot; Monthly &middot; NSA
                </div>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={sentChartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainSent} tick={TICK} tickLine={false} axisLine={false}
                    width={40} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      return [v.toFixed(1), 'Sentiment'] as [string, string]
                    }} />
                  <Line type="monotone" dataKey="value" name="Consumer Sentiment"
                    stroke="#f87171" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Brush dataKey="date" startIndex={brushes.sent.start} endIndex={brushes.sent.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('sent', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.sent.period} periods={QUICK_PERIODS_M}
              onSelect={(l, c) => handleQuickSelect('sent', l, c, sentChartData.length)} />
          </div>

          {/* ── Credit & Balance Sheet header ───────────────────────── */}
          <div className={styles.majorHeader}>Credit &amp; Balance Sheet</div>

          {/* ── Chart 1: Delinquency Rates ──────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Delinquency Rates</div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {([
                  { key: 'consumer', label: 'Consumer Loans',          color: '#93c5fd' },
                  { key: 'business', label: 'Business Loans',          color: '#86efac' },
                  { key: 'mortgage', label: 'Single-Family Mortgages', color: '#f87171' },
                  { key: 'cre',      label: 'Commercial Real Estate',  color: '#fdba74' },
                ] as const).map(item => (
                  <button key={item.key} type="button"
                    className={`${styles.legendItem} ${!visDelinq.has(item.key) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleDelinq(item.key)}>
                    <span className={styles.legendLine} style={{ background: item.color }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={delinqData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainDelinq} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => v + '%'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label =
                        name === 'consumer' ? 'Consumer' :
                        name === 'business' ? 'Business' :
                        name === 'mortgage' ? 'Mortgage' :
                        name === 'cre'      ? 'CRE'      : ''
                      return [`${v.toFixed(2)}%`, label] as [string, string]
                    }} />
                  {visDelinq.has('consumer') && <Line type="monotone" dataKey="consumer" name="consumer"
                    stroke="#93c5fd" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visDelinq.has('business') && <Line type="monotone" dataKey="business" name="business"
                    stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visDelinq.has('mortgage') && <Line type="monotone" dataKey="mortgage" name="mortgage"
                    stroke="#f87171" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visDelinq.has('cre') && <Line type="monotone" dataKey="cre" name="cre"
                    stroke="#fdba74" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  <Brush dataKey="date" startIndex={brushes.delinq.start} endIndex={brushes.delinq.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('delinq', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.delinq.period} periods={QUICK_PERIODS_Q}
              onSelect={(l, c) => handleQuickSelect('delinq', l, c, delinqData.length)} />
          </div>

          {/* ── Chart 2: Credit Card Delinquencies ──────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Credit Card Delinquencies</div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {([
                  { key: 'total',     label: 'Total',                     color: '#93c5fd' },
                  { key: 'top100',    label: '1st–100th Largest Banks',   color: '#86efac' },
                  { key: 'notTop100', label: 'Banks Not Among Largest 100', color: '#c4b5fd' },
                ] as const).map(item => (
                  <button key={item.key} type="button"
                    className={`${styles.legendItem} ${!visCcDelinq.has(item.key) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleCcDelinq(item.key)}>
                    <span className={styles.legendLine} style={{ background: item.color }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ccDelinqData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainCcDelinq} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => v + '%'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label =
                        name === 'total'     ? 'Total' :
                        name === 'top100'    ? 'Top 100' :
                        name === 'notTop100' ? 'Not Top 100' : ''
                      return [`${v.toFixed(2)}%`, label] as [string, string]
                    }} />
                  {visCcDelinq.has('total') && <Line type="monotone" dataKey="total" name="total"
                    stroke="#93c5fd" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visCcDelinq.has('top100') && <Line type="monotone" dataKey="top100" name="top100"
                    stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visCcDelinq.has('notTop100') && <Line type="monotone" dataKey="notTop100" name="notTop100"
                    stroke="#c4b5fd" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  <Brush dataKey="date" startIndex={brushes.ccDelinq.start} endIndex={brushes.ccDelinq.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('ccDelinq', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.ccDelinq.period} periods={QUICK_PERIODS_Q}
              onSelect={(l, c) => handleQuickSelect('ccDelinq', l, c, ccDelinqData.length)} />
          </div>

          {/* ── Chart 3: Debt Service Payments ──────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Debt Service Payments</div>
                <div className={styles.sectionSubtitle}>% of Disposable Income</div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {([
                  { key: 'household', label: 'Household', color: '#fcd34d' },
                  { key: 'mortgage',  label: 'Mortgage',  color: '#86efac' },
                  { key: 'consumer',  label: 'Consumer',  color: '#c4b5fd' },
                ] as const).map(item => (
                  <button key={item.key} type="button"
                    className={`${styles.legendItem} ${!visDebtSvc.has(item.key) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleDebtSvc(item.key)}>
                    <span className={styles.legendLine} style={{ background: item.color }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={debtSvcData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainDebtSvc} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => v + '%'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      const label =
                        name === 'household' ? 'Household' :
                        name === 'mortgage'  ? 'Mortgage'  :
                        name === 'consumer'  ? 'Consumer'  : ''
                      return [`${v.toFixed(2)}%`, label] as [string, string]
                    }} />
                  {visDebtSvc.has('household') && <Line type="monotone" dataKey="household" name="household"
                    stroke="#fcd34d" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visDebtSvc.has('mortgage') && <Line type="monotone" dataKey="mortgage" name="mortgage"
                    stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  {visDebtSvc.has('consumer') && <Line type="monotone" dataKey="consumer" name="consumer"
                    stroke="#c4b5fd" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  <Brush dataKey="date" startIndex={brushes.debtSvc.start} endIndex={brushes.debtSvc.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('debtSvc', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.debtSvc.period} periods={QUICK_PERIODS_Q}
              onSelect={(l, c) => handleQuickSelect('debtSvc', l, c, (allData['TDSP'] ?? []).length)} />
          </div>

          {/* ── Chart 4: Credit Card Balances ───────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Credit Card Balances</div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {([
                  { key: 'yoy',   label: 'YoY',                       color: '#93c5fd', swatch: true },
                  { key: 'qoq',   label: 'QoQ',                       color: '#fdba74', swatch: true },
                  { key: 'level', label: 'Large Bank CC Balances',     color: '#86efac', swatch: false },
                ] as const).map(item => (
                  <button key={item.key} type="button"
                    className={`${styles.legendItem} ${!visCcBal.has(item.key) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleCcBal(item.key)}>
                    {item.swatch
                      ? <span className={styles.legendSwatch} style={{ background: item.color }} />
                      : <span className={styles.legendLine} style={{ background: item.color }} />}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ccBalData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis yAxisId="left" domain={yDomainCcBalL} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => v.toFixed(0) + '%'} />
                  <YAxis yAxisId="right" orientation="right" domain={yDomainCcBalR} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => '$' + v.toFixed(0) + 'B'} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      if (name === 'level') return ['$' + v.toFixed(0) + 'B', 'CC Bal'] as [string, string]
                      const label = name === 'yoy' ? 'YoY' : 'QoQ'
                      return [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} yAxisId="left" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                  {visCcBal.has('yoy') && <Bar dataKey="yoy" yAxisId="left" name="yoy"
                    fill="#93c5fd" fillOpacity={0.8} isAnimationActive={false} />}
                  {visCcBal.has('qoq') && <Bar dataKey="qoq" yAxisId="left" name="qoq"
                    fill="#fdba74" fillOpacity={0.8} isAnimationActive={false} />}
                  {visCcBal.has('level') && <Line type="monotone" dataKey="level" yAxisId="right" name="level"
                    stroke="#86efac" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  <Brush dataKey="date" startIndex={brushes.ccBal.start} endIndex={brushes.ccBal.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('ccBal', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.ccBal.period} periods={QUICK_PERIODS_Q}
              onSelect={(l, c) => handleQuickSelect('ccBal', l, c, ccBalData.length)} />
          </div>

          {/* ── Chart 5: HH Net Worth ───────────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>HH Net Worth</div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {([
                  { key: 'yoy',   label: 'YoY',          color: '#93c5fd', swatch: true },
                  { key: 'qoq',   label: 'QoQ',          color: '#86efac', swatch: true },
                  { key: 'level', label: 'HH Net Worth', color: '#c4b5fd', swatch: false },
                ] as const).map(item => (
                  <button key={item.key} type="button"
                    className={`${styles.legendItem} ${!visHhNw.has(item.key) ? styles.legendItemOff : ''}`}
                    onClick={() => toggleHhNw(item.key)}>
                    {item.swatch
                      ? <span className={styles.legendSwatch} style={{ background: item.color }} />
                      : <span className={styles.legendLine} style={{ background: item.color }} />}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hhNwData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis yAxisId="left" domain={yDomainHhNwL} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => v.toFixed(0) + '%'} />
                  <YAxis yAxisId="right" orientation="right" domain={yDomainHhNwR} tick={TICK} tickLine={false} axisLine={false}
                    width={58} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}T` : `${v.toFixed(0)}B`} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      if (name === 'level') {
                        const fmt = v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(0)}B`
                        return [fmt, 'Net Worth'] as [string, string]
                      }
                      const label = name === 'yoy' ? 'YoY' : 'QoQ'
                      return [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, label] as [string, string]
                    }} />
                  <ReferenceLine y={0} yAxisId="left" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                  {visHhNw.has('yoy') && <Bar dataKey="yoy" yAxisId="left" name="yoy"
                    fill="#93c5fd" fillOpacity={0.8} isAnimationActive={false} />}
                  {visHhNw.has('qoq') && <Bar dataKey="qoq" yAxisId="left" name="qoq"
                    fill="#86efac" fillOpacity={0.8} isAnimationActive={false} />}
                  {visHhNw.has('level') && <Line type="monotone" dataKey="level" yAxisId="right" name="level"
                    stroke="#c4b5fd" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                  <Brush dataKey="date" startIndex={brushes.hhNw.start} endIndex={brushes.hhNw.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('hhNw', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.hhNw.period} periods={QUICK_PERIODS_Q}
              onSelect={(l, c) => handleQuickSelect('hhNw', l, c, hhNwData.length)} />
          </div>

          {/* ── Chart 6: US Gasoline Prices ─────────────────────────── */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>US Gasoline Prices</div>
                <div className={styles.sectionSubtitle}>$/gallon</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gasData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                    tickFormatter={fmtAxisDate} minTickGap={60} />
                  <YAxis domain={yDomainGas} tick={TICK} tickLine={false} axisLine={false}
                    width={48} tickFormatter={(v: number) => '$' + v.toFixed(2)} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => {
                      if (typeof v !== 'number') return ['-', '']
                      return ['$' + v.toFixed(2), 'Price'] as [string, string]
                    }} />
                  <Line type="monotone" dataKey="value" name="Gasoline Price"
                    stroke="#d97706" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Brush dataKey="date" startIndex={brushes.gasPrice.start} endIndex={brushes.gasPrice.end}
                    onChange={({ startIndex, endIndex }) => handleBrush('gasPrice', startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow period={brushes.gasPrice.period} periods={QUICK_PERIODS_M}
              onSelect={(l, c) => handleQuickSelect('gasPrice', l, c, gasData.length)} />
          </div>
        </>)}
      </main>
    </div>
  )
}
