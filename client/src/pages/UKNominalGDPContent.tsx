import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LineChart, BarChart, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import styles from './UKGrowthCharts.module.css'

// ── types & helpers ──────────────────────────────────────────────────────────

type WD = { date: string; value: number }

function getDateCutoff(range: string): string | null {
  if (range === 'max') return null
  const now = new Date()
  const map: Record<string, number> = { '1y': 12, '5y': 60, '10y': 120, '20y': 240 }
  const m = map[range]; if (!m) return null
  now.setMonth(now.getMonth() - m); return now.toISOString().slice(0, 10)
}

function filterByRange<T extends { date: string }>(data: T[], range: string): T[]
function filterByRange(data: Array<Record<string, string | number>>, range: string): Array<Record<string, string | number>>
function filterByRange(data: Array<{ date: string } | Record<string, string | number>>, range: string) {
  const c = getDateCutoff(range); return c ? data.filter(p => (p as { date: string }).date >= c) : data
}

function sma(data: number[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += data[j]
    return sum / window
  })
}

const fmtD = (d: string) => { const dt = new Date(d); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]} '${String(dt.getFullYear()).slice(2)}` }
const lblFmt = (l: unknown) => typeof l === 'string' ? new Date(l).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const TK = { fontSize: 10, fontWeight: 600 as const, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }
const TT_STYLE = { background: '#0d1117', border: '1px solid #1e2a3a', borderRadius: '6px', padding: '10px 14px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', lineHeight: '1.6' }
const NO_DATA = <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>No data available</div>
const QS_ALL = ['1y', '5y', '10y', '20y', 'max']

function QS({ active, onChange, extra }: { active: string; onChange: (r: string) => void; extra?: React.ReactNode }) {
  return (
    <div className={styles.controlRow}>
      {QS_ALL.map(r => <button key={r} className={`${styles.qsBtn} ${active === r ? styles.qsBtnActive : ''}`} onClick={() => onChange(r)}>{r.toUpperCase()}</button>)}
      {extra}
    </div>
  )
}

// Tooltip formatters
const fmtLevel = (v: unknown) => [typeof v === 'number' ? `£${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}m` : '—', 'Level']
const fmtPct = (v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', name ?? '']
const fmtPp = (v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}pp` : '—', name ?? '']

// ── series config ────────────────────────────────────────────────────────────

// Eagerly fetched on mount (headline + contribution components)
const EAGER_SERIES = [
  // Expenditure contrib (6 components)
  { cdid: 'YBHA', dataset: 'ukea' }, { cdid: 'ABJQ', dataset: 'ukea' },
  { cdid: 'ABNU', dataset: 'ukea' }, { cdid: 'NMRP', dataset: 'ukea' },
  { cdid: 'NPQS', dataset: 'ukea' }, { cdid: 'ABMP', dataset: 'ukea' },
  { cdid: 'IKBH', dataset: 'ukea' }, { cdid: 'IKBI', dataset: 'ukea' },
  // Income contrib
  { cdid: 'DTWM', dataset: 'ukea' }, { cdid: 'CGBX', dataset: 'ukea' },
  { cdid: 'ROYH', dataset: 'ukea' }, { cdid: 'CMVL', dataset: 'ukea' },
]

interface HierarchyItem { label: string; indent: number; cdid: string; dataset: string; isHeader?: boolean }

const HIERARCHY: HierarchyItem[] = [
  { label: '── EXPENDITURE APPROACH ──', indent: 0, cdid: '', dataset: '', isHeader: true },
  { label: 'Gross Domestic Product', indent: 0, cdid: 'YBHA', dataset: 'ukea' },
  { label: 'Household Consumption', indent: 1, cdid: 'ABJQ', dataset: 'ukea' },
  { label: '01 Food & non-alcoholic beverages', indent: 2, cdid: 'ADIO', dataset: 'ukea' },
  { label: '02 Alcohol, tobacco & narcotics', indent: 2, cdid: 'ADIQ', dataset: 'ukea' },
  { label: '03 Clothing & footwear', indent: 2, cdid: 'ADIV', dataset: 'ukea' },
  { label: '04 Housing, water, energy & fuels', indent: 2, cdid: 'ADIY', dataset: 'ukea' },
  { label: '05 Furnishings & HH equipment', indent: 2, cdid: 'ADJE', dataset: 'ukea' },
  { label: '06 Health', indent: 2, cdid: 'ADJG', dataset: 'ukea' },
  { label: '07 Transport', indent: 2, cdid: 'ADJI', dataset: 'ukea' },
  { label: '08 Communication', indent: 2, cdid: 'ADJK', dataset: 'ukea' },
  { label: '09 Recreation & culture', indent: 2, cdid: 'ADJM', dataset: 'ukea' },
  { label: '10 Education', indent: 2, cdid: 'ADJO', dataset: 'ukea' },
  { label: '11 Restaurants & hotels', indent: 2, cdid: 'ADJQ', dataset: 'ukea' },
  { label: '12 Miscellaneous goods & services', indent: 2, cdid: 'ADJS', dataset: 'ukea' },
  { label: 'NPISH Consumption', indent: 1, cdid: 'ABNU', dataset: 'ukea' },
  { label: 'Government Consumption', indent: 1, cdid: 'NMRP', dataset: 'ukea' },
  { label: 'Gross Fixed Capital Formation', indent: 1, cdid: 'NPQS', dataset: 'ukea' },
  { label: 'Business Investment', indent: 2, cdid: 'NPEK', dataset: 'ukea' },
  { label: 'Dwellings', indent: 2, cdid: 'DFEE', dataset: 'ukea' },
  { label: 'Other buildings & structures', indent: 2, cdid: 'DLWC', dataset: 'ukea' },
  { label: 'Transport equipment', indent: 2, cdid: 'DLWK', dataset: 'ukea' },
  { label: 'ICT & other machinery', indent: 2, cdid: 'DLWO', dataset: 'ukea' },
  { label: 'Intellectual property products', indent: 2, cdid: 'DLWR', dataset: 'ukea' },
  { label: 'Costs of ownership transfer', indent: 2, cdid: 'DFDI', dataset: 'ukea' },
  { label: 'Changes in inventories', indent: 1, cdid: 'ABMP', dataset: 'ukea' },
  { label: 'Exports of goods & services', indent: 1, cdid: 'IKBH', dataset: 'ukea' },
  { label: 'Imports of goods & services', indent: 1, cdid: 'IKBI', dataset: 'ukea' },
  { label: '── INCOME APPROACH ──', indent: 0, cdid: '', dataset: '', isHeader: true },
  { label: 'Compensation of Employees', indent: 1, cdid: 'DTWM', dataset: 'ukea' },
  { label: 'Wages & Salaries', indent: 2, cdid: 'ROYJ', dataset: 'ukea' },
  { label: "Employers' Social Contributions", indent: 2, cdid: 'ROYK', dataset: 'ukea' },
  { label: 'Gross Operating Surplus', indent: 1, cdid: 'CGBX', dataset: 'ukea' },
  { label: 'Mixed Income', indent: 1, cdid: 'ROYH', dataset: 'ukea' },
  { label: 'Taxes less Subsidies on Production', indent: 1, cdid: 'CMVL', dataset: 'ukea' },
]

// Find the first selectable index
const FIRST_SELECTABLE = HIERARCHY.findIndex(h => !h.isHeader)

const EXP_COLORS: Record<string, string> = { hh: '#60a5fa', npish: '#93c5fd', govt: '#f87171', gfcf: '#f59e0b', inv: '#a78bfa', nx: '#4ade80' }
const INC_COLORS: Record<string, string> = { coe: '#60a5fa', gos: '#f59e0b', mixed: '#a78bfa', taxes: '#4ade80' }

type Regime = 'expansion' | 'contraction' | 'neutral'
const REGIME_FILL: Record<Regime, string> = { expansion: 'rgba(74,222,128,0.15)', contraction: 'rgba(248,113,113,0.15)', neutral: 'rgba(250,204,21,0.15)' }

// ── generic contribution computation ─────────────────────────────────────────

function computeContrib(
  denomSeries: WD[],
  components: Array<{ key: string; data: WD[] }>,
  lag: number
): Array<Record<string, string | number>> {
  const validComps = components.filter(c => c.data.length > 0)
  const denomM = new Map(denomSeries.map(d => [d.date, d.value]))
  const compMaps = validComps.map(c => ({ key: c.key, map: new Map(c.data.map(d => [d.date, d.value])) }))
  const dates = denomSeries.map(d => d.date).sort()
  const out: Array<Record<string, string | number>> = []
  for (let i = lag; i < dates.length; i++) {
    const t = dates[i], tL = dates[i - lag]
    const denominator = denomM.get(tL)
    if (!denominator || denominator === 0) continue
    const row: Record<string, string | number> = { date: t }
    let barSum = 0
    for (const { key, map } of compMaps) {
      const vt = map.get(t), vtL = map.get(tL)
      const contrib = vt != null && vtL != null ? ((vt - vtL) / denominator) * 100 : 0
      row[key] = contrib
      barSum += contrib
    }
    // Total = sum of all component bars (ensures visual consistency)
    row.total = barSum
    out.push(row)
  }
  return out
}

// ── component ────────────────────────────────────────────────────────────────

export function UKNominalGDPContent() {
  const [data, setData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Contribution ranges
  const [rngExpQ, setRngExpQ] = useState('10y')
  const [rngExpY, setRngExpY] = useState('10y')
  const [rngIncQ, setRngIncQ] = useState('10y')
  const [rngIncY, setRngIncY] = useState('10y')

  // Explorer state
  const [explorerIdx, setExplorerIdx] = useState(FIRST_SELECTABLE)
  const [explorerData, setExplorerData] = useState<WD[]>([])
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [rngLevel, setRngLevel] = useState('10y')
  const [rngYoy, setRngYoy] = useState('10y')
  const [rngAccel, setRngAccel] = useState('10y')
  const [rngQoq, setRngQoq] = useState('10y')
  const [rngAnnQoq, setRngAnnQoq] = useState('10y')
  const [regimeMA, setRegimeMA] = useState(4)
  const [accelLookback, setAccelLookback] = useState(1)
  const [qoqMa1, setQoqMa1] = useState(4)
  const [qoqMa2, setQoqMa2] = useState(8)

  const selectedItem = HIERARCHY[explorerIdx]

  // Fetch eager series on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const results = await Promise.all(EAGER_SERIES.map(s => fetchOnsSeries(s.cdid, s.dataset).then(d => [s.cdid, d] as const)))
        if (cancelled) return
        const map: Record<string, WD[]> = {}
        results.forEach(([cdid, pts]) => { map[cdid] = pts })
        setData(map)
      } catch (e: unknown) { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Fetch explorer series on demand
  const fetchExplorer = useCallback(async (idx: number) => {
    const item = HIERARCHY[idx]
    if (!item || item.isHeader) return
    if (data[item.cdid]?.length) { setExplorerData(data[item.cdid]); return }
    setExplorerLoading(true)
    try {
      const pts = await fetchOnsSeries(item.cdid, item.dataset)
      setExplorerData(pts)
    } catch { setExplorerData([]) }
    setExplorerLoading(false)
  }, [data])

  useEffect(() => { fetchExplorer(explorerIdx) }, [explorerIdx, fetchExplorer])

  // ── ALL useMemo BEFORE early returns ──

  const sortSeries = (cdid: string) => (data[cdid] || []).slice().sort((a, b) => a.date.localeCompare(b.date))
  const gdpRaw = useMemo(() => sortSeries('YBHA'), [data])

  // Expenditure contributions (6 components)
  const buildExpComps = () => {
    const exp = sortSeries('IKBH'), imp = sortSeries('IKBI')
    const impM = new Map(imp.map(d => [d.date, d.value]))
    return [
      { key: 'hh', data: sortSeries('ABJQ') },
      { key: 'npish', data: sortSeries('ABNU') },
      { key: 'govt', data: sortSeries('NMRP') },
      { key: 'gfcf', data: sortSeries('NPQS') },
      { key: 'inv', data: sortSeries('ABMP') },
      { key: 'nx', data: exp.map(d => ({ date: d.date, value: d.value - (impM.get(d.date) ?? 0) })) },
    ]
  }
  const expContribQ = useMemo(() => filterByRange(computeContrib(gdpRaw, buildExpComps(), 1), rngExpQ), [data, gdpRaw, rngExpQ])
  const expContribY = useMemo(() => filterByRange(computeContrib(gdpRaw, buildExpComps(), 4), rngExpY), [data, gdpRaw, rngExpY])

  // Income contributions
  const incContribQ = useMemo(() => {
    const comps = [
      { key: 'coe', data: sortSeries('DTWM') }, { key: 'gos', data: sortSeries('CGBX') },
      { key: 'mixed', data: sortSeries('ROYH') }, { key: 'taxes', data: sortSeries('CMVL') },
    ]
    return filterByRange(computeContrib(gdpRaw, comps, 1), rngIncQ)
  }, [data, gdpRaw, rngIncQ])

  const incContribY = useMemo(() => {
    const comps = [
      { key: 'coe', data: sortSeries('DTWM') }, { key: 'gos', data: sortSeries('CGBX') },
      { key: 'mixed', data: sortSeries('ROYH') }, { key: 'taxes', data: sortSeries('CMVL') },
    ]
    return filterByRange(computeContrib(gdpRaw, comps, 4), rngIncY)
  }, [data, gdpRaw, rngIncY])

  // Explorer derived data
  const expSorted = useMemo(() => explorerData.slice().sort((a, b) => a.date.localeCompare(b.date)), [explorerData])
  const expLevel = useMemo(() => filterByRange(expSorted, rngLevel), [expSorted, rngLevel])

  const expYoyFull = useMemo(() => {
    if (expSorted.length <= 4) return []
    return expSorted.slice(4).map((p, i) => ({ date: p.date, yoy: expSorted[i].value !== 0 ? ((p.value / expSorted[i].value) - 1) * 100 : 0 }))
  }, [expSorted])

  const expYoyWithRegime = useMemo(() => {
    const yoyVals = expYoyFull.map(p => p.yoy)
    const maVals = sma(yoyVals, regimeMA)
    return expYoyFull.map((p, i) => {
      const ma = maVals[i]
      let regime: Regime = 'neutral'
      if (ma != null) { if (p.yoy > ma + 0.01) regime = 'expansion'; else if (p.yoy < ma - 0.01) regime = 'contraction' }
      return { ...p, ma, regime }
    })
  }, [expYoyFull, regimeMA])

  const expYoyFiltered = useMemo(() => filterByRange(expYoyWithRegime, rngYoy), [expYoyWithRegime, rngYoy])

  const expRegimeAreas = useMemo(() => {
    const areas: { x1: string; x2: string; regime: Regime }[] = []
    if (expYoyFiltered.length === 0) return areas
    let cur = expYoyFiltered[0].regime, start = expYoyFiltered[0].date
    for (let i = 1; i < expYoyFiltered.length; i++) {
      if (expYoyFiltered[i].regime !== cur) { areas.push({ x1: start, x2: expYoyFiltered[i - 1].date, regime: cur }); cur = expYoyFiltered[i].regime; start = expYoyFiltered[i].date }
    }
    areas.push({ x1: start, x2: expYoyFiltered[expYoyFiltered.length - 1].date, regime: cur })
    return areas
  }, [expYoyFiltered])

  const expAccelFull = useMemo(() => expYoyFull.length <= accelLookback ? [] : expYoyFull.slice(accelLookback).map((p, i) => ({ date: p.date, value: p.yoy - expYoyFull[i].yoy })), [expYoyFull, accelLookback])
  const expAccelFiltered = useMemo(() => filterByRange(expAccelFull, rngAccel), [expAccelFull, rngAccel])

  const expQoqFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, qoq: expSorted[i].value !== 0 ? ((p.value / expSorted[i].value) - 1) * 100 : 0 })), [expSorted])
  const expQoqWithMAs = useMemo(() => {
    const vals = expQoqFull.map(p => p.qoq), m1 = sma(vals, qoqMa1), m2 = sma(vals, qoqMa2)
    return expQoqFull.map((p, i) => ({ ...p, ma1: m1[i], ma2: m2[i] }))
  }, [expQoqFull, qoqMa1, qoqMa2])
  const expQoqFiltered = useMemo(() => filterByRange(expQoqWithMAs, rngQoq), [expQoqWithMAs, rngQoq])

  const expAnnQoqFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, value: expSorted[i].value !== 0 ? (Math.pow(p.value / expSorted[i].value, 4) - 1) * 100 : 0 })), [expSorted])
  const expAnnQoqFiltered = useMemo(() => filterByRange(expAnnQoqFull, rngAnnQoq), [expAnnQoqFull, rngAnnQoq])

  // ── early returns ──
  if (error) return <div style={{ color: '#f87171', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{error}</div>
  if (loading) return <div style={{ color: '#728197', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading UK Nominal GDP data...</div>

  // ── helpers for contribution chart rendering ──
  function ContribChart({ title, subtitle, data: chartData, components, colors, active, onChange }: {
    title: string; subtitle: string; data: Array<Record<string, string | number>>
    components: Array<{ key: string; label: string }>; colors: Record<string, string>
    active: string; onChange: (v: string) => void
  }) {
    // Filter to only components that have non-zero data in at least one row
    const activeComps = components.filter(c =>
      chartData.some(row => { const v = row[c.key]; return typeof v === 'number' && v !== 0 })
    )
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartLabel}>{title}</div>
        <div className={styles.chartSub}>{subtitle}</div>
        <QS active={active} onChange={onChange} />
        <div className={styles.legend}>
          {activeComps.map(c => <span key={c.key} className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: colors[c.key] }} />{c.label}</span>)}
          <span className={styles.legendItem}><span className={styles.legendLine} style={{ background: '#fff' }} />Total</span>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtPp} />
              <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
              {activeComps.map(c => <Bar key={c.key} dataKey={c.key} stackId="a" fill={colors[c.key]} name={c.label} />)}
              <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} dot={false} name="Total" />
              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : NO_DATA}
      </div>
    )
  }

  const expComponents = [
    { key: 'hh', label: 'HH Consumption' }, { key: 'npish', label: 'NPISH' },
    { key: 'govt', label: 'Govt' }, { key: 'gfcf', label: 'GFCF' },
    { key: 'inv', label: 'Inventories' }, { key: 'nx', label: 'Net Exports' },
  ]
  const incComponents = [{ key: 'coe', label: 'Compensation' }, { key: 'gos', label: 'Operating Surplus' }, { key: 'mixed', label: 'Mixed Income' }, { key: 'taxes', label: 'Taxes - Subsidies' }]

  const SectionHeader = ({ label }: { label: string }) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa', textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '24px 0 12px', borderBottom: '1px solid #1e2a3a', marginBottom: '16px' }}>{label}</div>
  )

  return (
    <>
      <p className={styles.chartSubtitle}>Office for National Statistics &middot; Quarterly &middot; Current Prices SA &middot; &pound;m</p>

      {/* ═══ Series Explorer ═══ */}
      <div className={styles.explorerSection}>
        <div className={styles.chartLabel} style={{ marginBottom: 8 }}>Series Explorer</div>
        <select
          className={styles.seriesSelect}
          value={explorerIdx}
          onChange={e => {
            const idx = Number(e.target.value)
            if (!HIERARCHY[idx]?.isHeader) setExplorerIdx(idx)
          }}
        >
          {HIERARCHY.map((h, idx) =>
            h.isHeader ? (
              <option key={idx} disabled style={{ fontWeight: 700, color: '#60a5fa' }}>{h.label}</option>
            ) : (
              <option key={idx} value={idx}>{'\u00A0\u00A0'.repeat(h.indent)}{h.label}</option>
            )
          )}
        </select>

        {explorerLoading ? (
          <div style={{ color: '#728197', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>Loading {selectedItem?.cdid}...</div>
        ) : (
          <>
            {/* Row 1: Level + YoY Regime */}
            <div className={styles.twoColGrid} style={{ marginTop: 12 }}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Level</div>
                <div className={styles.chartSub}>{selectedItem.cdid} &middot; &pound;m SA</div>
                <QS active={rngLevel} onChange={setRngLevel} />
                {expLevel.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={expLevel} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtLevel} />
                      <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — YoY %Chg</div>
                <div className={styles.chartSub}>With regime shading</div>
                <QS active={rngYoy} onChange={setRngYoy} extra={
                  <div className={styles.inputWrap}>Regime MA:<input className={styles.numInput} type="number" min={1} value={regimeMA} onChange={e => setRegimeMA(Math.max(1, parseInt(e.target.value) || 4))} />Q</div>
                } />
                {expYoyFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={expYoyFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      {expRegimeAreas.map((a, i) => <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill={REGIME_FILL[a.regime]} fillOpacity={1} />)}
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtPct} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="yoy" stroke="#e2e8f0" strokeWidth={2} dot={false} name="YoY" />
                      <Line type="monotone" dataKey="ma" stroke="#728197" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls={false} name={`${regimeMA}Q MA`} />
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
                <div className={styles.regimeLegend}>
                  <span className={styles.regimeLegendItem}><span className={styles.regimeSwatch} style={{ background: 'rgba(74,222,128,0.4)' }} />+</span>
                  <span className={styles.regimeLegendItem}><span className={styles.regimeSwatch} style={{ background: 'rgba(248,113,113,0.4)' }} />-</span>
                  <span className={styles.regimeLegendItem}><span className={styles.regimeSwatch} style={{ background: 'rgba(250,204,21,0.4)' }} />|</span>
                </div>
              </div>
            </div>

            {/* Row 2: Acceleration + QoQ with MAs */}
            <div className={styles.twoColGrid}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Acceleration</div>
                <div className={styles.chartSub}>{accelLookback}Q change in YoY %</div>
                <QS active={rngAccel} onChange={setRngAccel} extra={
                  <div className={styles.inputWrap}>{'\u0394'}:<input className={styles.numInput} type="number" min={1} value={accelLookback} onChange={e => setAccelLookback(Math.max(1, parseInt(e.target.value) || 1))} />Q</div>
                } />
                {expAccelFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart data={expAccelFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Acceleration']} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Bar dataKey="value" radius={[2, 2, 0, 0]} barSize={4}>
                        {expAccelFiltered.map((d, i) => <Cell key={i} fill={d.value >= 0 ? '#4ade80' : '#f87171'} />)}
                      </Bar>
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — QoQ %Chg</div>
                <div className={styles.chartSub}>Quarter-on-quarter change</div>
                <QS active={rngQoq} onChange={setRngQoq} extra={
                  <>
                    <div className={styles.inputWrap}>MA1:<input className={styles.numInput} type="number" min={1} value={qoqMa1} onChange={e => setQoqMa1(Math.max(1, parseInt(e.target.value) || 4))} />Q</div>
                    <div className={styles.inputWrap}>MA2:<input className={styles.numInput} type="number" min={1} value={qoqMa2} onChange={e => setQoqMa2(Math.max(1, parseInt(e.target.value) || 8))} />Q</div>
                  </>
                } />
                <div className={styles.legend}>
                  <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#60a5fa' }} />QoQ %</span>
                  <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#4ade80' }} />{qoqMa1}Q MA</span>
                  <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#f59e0b' }} />{qoqMa2}Q MA</span>
                </div>
                {expQoqFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={expQoqFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtPct} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Bar dataKey="qoq" fill="#60a5fa" barSize={4} radius={[2, 2, 0, 0]} name="QoQ %" />
                      <Line type="monotone" dataKey="ma1" stroke="#4ade80" strokeWidth={1.5} dot={false} connectNulls={false} name={`${qoqMa1}Q MA`} />
                      <Line type="monotone" dataKey="ma2" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} name={`${qoqMa2}Q MA`} />
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>
            </div>

            {/* Row 3: Annualized QoQ */}
            <div className={styles.twoColGrid}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Ann. QoQ %Chg</div>
                <div className={styles.chartSub}>Annualized quarter-on-quarter change</div>
                <QS active={rngAnnQoq} onChange={setRngAnnQoq} />
                {expAnnQoqFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={expAnnQoqFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Ann. QoQ']} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="value" stroke="#fb923c" strokeWidth={2} dot={false} />
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ EXPENDITURE APPROACH ═══ */}
      <SectionHeader label="Expenditure Approach" />

      <div className={styles.twoColGrid}>
        <ContribChart title="Contributions to QoQ Nominal GDP" subtitle="pp contributions, quarter-on-quarter" data={expContribQ} components={expComponents} colors={EXP_COLORS} active={rngExpQ} onChange={setRngExpQ} />
        <ContribChart title="Contributions to YoY Nominal GDP" subtitle="pp contributions, year-on-year" data={expContribY} components={expComponents} colors={EXP_COLORS} active={rngExpY} onChange={setRngExpY} />
      </div>

      {/* ═══ INCOME APPROACH ═══ */}
      <SectionHeader label="Income Approach" />

      <div className={styles.twoColGrid}>
        <ContribChart title="Contributions to QoQ Nominal GDP" subtitle="pp contributions, quarter-on-quarter" data={incContribQ} components={incComponents} colors={INC_COLORS} active={rngIncQ} onChange={setRngIncQ} />
        <ContribChart title="Contributions to YoY Nominal GDP" subtitle="pp contributions, year-on-year" data={incContribY} components={incComponents} colors={INC_COLORS} active={rngIncY} onChange={setRngIncY} />
      </div>
    </>
  )
}
