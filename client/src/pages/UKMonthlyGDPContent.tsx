import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LineChart, BarChart, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import { fetchOnsSeries, fetchGDPContributions, type GDPContribution } from '../lib/ons'
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

const fmtLevel = (v: unknown) => [typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—', 'Index']
const fmtPct = (v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', name ?? '']
const fmtPp = (v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}pp` : '—', name ?? '']

// ── series config ────────────────────────────────────────────────────────────

const EAGER_SERIES = [
  { cdid: 'ECY2', dataset: 'mgdp' },  // Total GDP index
  { cdid: 'ECY6', dataset: 'mgdp' },  // Services
  { cdid: 'ECY7', dataset: 'mgdp' },  // Production
  { cdid: 'ECY8', dataset: 'mgdp' },  // Construction
]

interface HierarchyItem { label: string; indent: number; cdid: string; dataset: string; isHeader?: boolean }

const HIERARCHY: HierarchyItem[] = [
  { label: '── OUTPUT APPROACH (GVA by Industry) ──', indent: 0, cdid: '', dataset: '', isHeader: true },
  { label: 'GDP (all sectors)', indent: 0, cdid: 'ECY2', dataset: 'mgdp' },
  { label: 'Services', indent: 1, cdid: 'ECY6', dataset: 'mgdp' },
  { label: 'Wholesale & Retail Trade', indent: 2, cdid: 'ECYT', dataset: 'mgdp' },
  { label: 'Transport & Storage', indent: 2, cdid: 'ECYU', dataset: 'mgdp' },
  { label: 'Accommodation & Food', indent: 2, cdid: 'ECYV', dataset: 'mgdp' },
  { label: 'Financial & Insurance', indent: 2, cdid: 'ECYX', dataset: 'mgdp' },
  { label: 'Real Estate', indent: 2, cdid: 'ECYY', dataset: 'mgdp' },
  { label: 'Professional & Scientific', indent: 2, cdid: 'ECYZ', dataset: 'mgdp' },
  { label: 'Admin & Support', indent: 2, cdid: 'ECZ2', dataset: 'mgdp' },
  { label: 'Production', indent: 1, cdid: 'ECY7', dataset: 'mgdp' },
  { label: 'Construction', indent: 1, cdid: 'ECY8', dataset: 'mgdp' },
]

const FIRST_SELECTABLE = HIERARCHY.findIndex(h => !h.isHeader)
const OUTPUT_COLORS: Record<string, string> = { services: '#60a5fa', production: '#f59e0b', construction: '#4ade80', agriculture: '#94a3b8' }

type Regime = 'expansion' | 'contraction' | 'neutral'
const REGIME_FILL: Record<Regime, string> = { expansion: 'rgba(74,222,128,0.15)', contraction: 'rgba(248,113,113,0.15)', neutral: 'rgba(250,204,21,0.15)' }

// ── component ────────────────────────────────────────────────────────────────

export function UKMonthlyGDPContent() {
  const [data, setData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Official ONS contribution data
  const [momContribs, setMomContribs] = useState<GDPContribution[]>([])
  const [yoyContribs, setYoyContribs] = useState<GDPContribution[]>([])

  const [rngContribM, setRngContribM] = useState('5y')
  const [rngContribY, setRngContribY] = useState('5y')
  const [rngSvcM, setRngSvcM] = useState('5y')
  const [rngSvcY, setRngSvcY] = useState('5y')
  const [rngProdM, setRngProdM] = useState('5y')
  const [rngProdY, setRngProdY] = useState('5y')

  const [explorerIdx, setExplorerIdx] = useState(FIRST_SELECTABLE)
  const [explorerData, setExplorerData] = useState<WD[]>([])
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [rngLevel, setRngLevel] = useState('10y')
  const [rngYoy, setRngYoy] = useState('10y')
  const [rngAccel, setRngAccel] = useState('10y')
  const [rngMom, setRngMom] = useState('5y')
  const [rngAnnMom, setRngAnnMom] = useState('10y')
  const [regimeMA, setRegimeMA] = useState(6)
  const [accelLookback, setAccelLookback] = useState(1)
  const [momMa1, setMomMa1] = useState(3)
  const [momMa2, setMomMa2] = useState(6)

  const selectedItem = HIERARCHY[explorerIdx]

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

  // Fetch official ONS contribution data
  useEffect(() => {
    fetchGDPContributions('mom').then(setMomContribs)
    fetchGDPContributions('yoy').then(setYoyContribs)
  }, [])

  const fetchExplorer = useCallback(async (idx: number) => {
    const item = HIERARCHY[idx]
    if (!item || item.isHeader) return
    if (data[item.cdid]?.length) { setExplorerData(data[item.cdid]); return }
    setExplorerLoading(true)
    try { setExplorerData(await fetchOnsSeries(item.cdid, item.dataset)) } catch { setExplorerData([]) }
    setExplorerLoading(false)
  }, [data])

  useEffect(() => { fetchExplorer(explorerIdx) }, [explorerIdx, fetchExplorer])

  // ── ALL useMemo BEFORE early returns ──

  // Helper to filter and map contribution data
  const filterContribs = (contribs: GDPContribution[], range: string) => {
    const c = getDateCutoff(range)
    return (c ? contribs.filter(d => d.date >= c) : contribs) as Array<Record<string, string | number>>
  }

  // GDP-level contributions
  const outputContribM = useMemo(() => filterContribs(momContribs, rngContribM), [momContribs, rngContribM])
  const outputContribY = useMemo(() => filterContribs(yoyContribs, rngContribY), [yoyContribs, rngContribY])

  // Services sub-sector contributions
  const svcContribM = useMemo(() => filterContribs(momContribs, rngSvcM), [momContribs, rngSvcM])
  const svcContribY = useMemo(() => filterContribs(yoyContribs, rngSvcY), [yoyContribs, rngSvcY])

  // Production sub-sector contributions
  const prodContribM = useMemo(() => filterContribs(momContribs, rngProdM), [momContribs, rngProdM])
  const prodContribY = useMemo(() => filterContribs(yoyContribs, rngProdY), [yoyContribs, rngProdY])

  // Check if sub-sector data exists
  const hasServicesBreakdown = useMemo(() => momContribs.some(r => r.wholesale_retail !== undefined && r.wholesale_retail !== 0), [momContribs])
  const hasProductionBreakdown = useMemo(() => momContribs.some(r => r.manufacturing !== undefined && r.manufacturing !== 0), [momContribs])

  // Explorer derived data
  const expSorted = useMemo(() => explorerData.slice().sort((a, b) => a.date.localeCompare(b.date)), [explorerData])
  const expLevel = useMemo(() => filterByRange(expSorted, rngLevel), [expSorted, rngLevel])

  // YoY: 12-month lookback
  const expYoyFull = useMemo(() => {
    if (expSorted.length <= 12) return []
    return expSorted.slice(12).map((p, i) => ({ date: p.date, yoy: expSorted[i].value !== 0 ? ((p.value / expSorted[i].value) - 1) * 100 : 0 }))
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

  // Acceleration
  const expAccelFull = useMemo(() => expYoyFull.length <= accelLookback ? [] : expYoyFull.slice(accelLookback).map((p, i) => ({ date: p.date, value: p.yoy - expYoyFull[i].yoy })), [expYoyFull, accelLookback])
  const expAccelFiltered = useMemo(() => filterByRange(expAccelFull, rngAccel), [expAccelFull, rngAccel])

  // MoM with MAs: 1-month lookback
  const expMomFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, mom: expSorted[i].value !== 0 ? ((p.value / expSorted[i].value) - 1) * 100 : 0 })), [expSorted])
  const expMomWithMAs = useMemo(() => {
    const vals = expMomFull.map(p => p.mom), m1 = sma(vals, momMa1), m2 = sma(vals, momMa2)
    return expMomFull.map((p, i) => ({ ...p, ma1: m1[i], ma2: m2[i] }))
  }, [expMomFull, momMa1, momMa2])
  const expMomFiltered = useMemo(() => filterByRange(expMomWithMAs, rngMom), [expMomWithMAs, rngMom])

  // Annualized MoM: ^12
  const expAnnMomFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, value: expSorted[i].value !== 0 ? (Math.pow(p.value / expSorted[i].value, 12) - 1) * 100 : 0 })), [expSorted])
  const expAnnMomFiltered = useMemo(() => filterByRange(expAnnMomFull, rngAnnMom), [expAnnMomFull, rngAnnMom])

  // ── early returns ──
  if (error) return <div style={{ color: '#f87171', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{error}</div>
  if (loading) return <div style={{ color: '#728197', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading UK Monthly GDP data...</div>

  function ContribChart({ title, subtitle, data: chartData, components, colors, active, onChange, totalKey = 'gdp' }: {
    title: string; subtitle: string; data: Array<Record<string, string | number>>
    components: Array<{ key: string; label: string }>; colors: Record<string, string>
    active: string; onChange: (v: string) => void; totalKey?: string
  }) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartLabel}>{title}</div>
        <div className={styles.chartSub}>{subtitle}</div>
        <QS active={active} onChange={onChange} />
        <div className={styles.legend}>
          {components.map(c => <span key={c.key} className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: colors[c.key] }} />{c.label}</span>)}
          <span className={styles.legendItem}><span className={styles.legendLine} style={{ background: '#fff' }} />Total {totalKey === 'gdp' ? 'GDP' : totalKey === 'services' ? 'Services' : totalKey === 'production' ? 'Production' : ''}</span>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={['auto', 'auto']} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtPp} />
              <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
              {components.map(c => <Bar key={c.key} dataKey={c.key} stackId="a" fill={colors[c.key]} name={c.label} />)}
              <Line type="monotone" dataKey={totalKey} stroke="#ffffff" strokeWidth={2} dot={false} name="Total" />
              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : NO_DATA}
      </div>
    )
  }

  const outputComponents = [
    { key: 'services', label: 'Services' }, { key: 'production', label: 'Production' },
    { key: 'construction', label: 'Construction' }, { key: 'agriculture', label: 'Agriculture' },
  ]

  const servicesComponents = [
    { key: 'wholesale_retail', label: 'Wholesale & Retail' }, { key: 'transport_storage', label: 'Transport' },
    { key: 'accommodation_food', label: 'Accommodation' }, { key: 'info_communication', label: 'Info & Comms' },
    { key: 'financial_insurance', label: 'Financial' }, { key: 'real_estate', label: 'Real Estate' },
    { key: 'professional_scientific', label: 'Professional' }, { key: 'admin_support', label: 'Admin' },
    { key: 'public_admin', label: 'Public Admin' }, { key: 'education', label: 'Education' },
    { key: 'health_social', label: 'Health' }, { key: 'arts_recreation', label: 'Arts' },
    { key: 'other_services', label: 'Other' },
  ]
  const SVC_COLORS: Record<string, string> = {
    wholesale_retail: '#60a5fa', transport_storage: '#f59e0b', accommodation_food: '#4ade80',
    info_communication: '#a78bfa', financial_insurance: '#f87171', real_estate: '#fb923c',
    professional_scientific: '#93c5fd', admin_support: '#fbbf24', public_admin: '#2dd4bf',
    education: '#fb7185', health_social: '#c084fc', arts_recreation: '#94a3b8', other_services: '#6ee7b7',
  }

  const productionComponents = [
    { key: 'manufacturing', label: 'Manufacturing' }, { key: 'mining', label: 'Mining' },
    { key: 'electricity_gas', label: 'Electricity & Gas' }, { key: 'water_waste', label: 'Water & Waste' },
  ]
  const PROD_COLORS: Record<string, string> = {
    manufacturing: '#60a5fa', mining: '#f59e0b', electricity_gas: '#4ade80', water_waste: '#a78bfa',
  }

  const SectionHeader = ({ label }: { label: string }) => (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa', textTransform: 'uppercase' as const, letterSpacing: '0.08em', padding: '24px 0 12px', borderBottom: '1px solid #1e2a3a', marginBottom: '16px' }}>{label}</div>
  )

  return (
    <>
      <p className={styles.chartSubtitle}>Office for National Statistics &middot; Monthly &middot; Chained Volume Measures SA &middot; Index</p>

      {/* ═══ Series Explorer ═══ */}
      <div className={styles.explorerSection}>
        <div className={styles.chartLabel} style={{ marginBottom: 8 }}>Series Explorer</div>
        <select className={styles.seriesSelect} value={explorerIdx} onChange={e => { const idx = Number(e.target.value); if (!HIERARCHY[idx]?.isHeader) setExplorerIdx(idx) }}>
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
                <div className={styles.chartSub}>{selectedItem.cdid} &middot; CVM SA, Index</div>
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
                  <div className={styles.inputWrap}>Regime MA:<input className={styles.numInput} type="number" min={1} value={regimeMA} onChange={e => setRegimeMA(Math.max(1, parseInt(e.target.value) || 6))} />mo</div>
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
                      <Line type="monotone" dataKey="ma" stroke="#728197" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls={false} name={`${regimeMA}mo MA`} />
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

            {/* Row 2: Acceleration + MoM with MAs */}
            <div className={styles.twoColGrid}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Acceleration</div>
                <div className={styles.chartSub}>{accelLookback}mo change in YoY %</div>
                <QS active={rngAccel} onChange={setRngAccel} extra={
                  <div className={styles.inputWrap}>{'\u0394'}:<input className={styles.numInput} type="number" min={1} value={accelLookback} onChange={e => setAccelLookback(Math.max(1, parseInt(e.target.value) || 1))} />mo</div>
                } />
                {expAccelFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart data={expAccelFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Acceleration']} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Bar dataKey="value" radius={[2, 2, 0, 0]} barSize={2}>
                        {expAccelFiltered.map((d, i) => <Cell key={i} fill={d.value >= 0 ? '#4ade80' : '#f87171'} />)}
                      </Bar>
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — MoM %Chg</div>
                <div className={styles.chartSub}>Month-on-month change</div>
                <QS active={rngMom} onChange={setRngMom} extra={
                  <>
                    <div className={styles.inputWrap}>MA1:<input className={styles.numInput} type="number" min={1} value={momMa1} onChange={e => setMomMa1(Math.max(1, parseInt(e.target.value) || 3))} />mo</div>
                    <div className={styles.inputWrap}>MA2:<input className={styles.numInput} type="number" min={1} value={momMa2} onChange={e => setMomMa2(Math.max(1, parseInt(e.target.value) || 6))} />mo</div>
                  </>
                } />
                <div className={styles.legend}>
                  <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#60a5fa' }} />MoM %</span>
                  <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#4ade80' }} />{momMa1}mo MA</span>
                  <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#f59e0b' }} />{momMa2}mo MA</span>
                </div>
                {expMomFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart data={expMomFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={fmtPct} />
                      <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                      <Bar dataKey="mom" fill="#60a5fa" barSize={2} radius={[2, 2, 0, 0]} name="MoM %" />
                      <Line type="monotone" dataKey="ma1" stroke="#4ade80" strokeWidth={1.5} dot={false} connectNulls={false} name={`${momMa1}mo MA`} />
                      <Line type="monotone" dataKey="ma2" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} name={`${momMa2}mo MA`} />
                      <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : NO_DATA}
              </div>
            </div>

            {/* Row 3: Annualized MoM */}
            <div className={styles.twoColGrid}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Ann. MoM %Chg</div>
                <div className={styles.chartSub}>Annualized month-on-month change</div>
                <QS active={rngAnnMom} onChange={setRngAnnMom} />
                {expAnnMomFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={expAnnMomFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Ann. MoM']} />
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

      {/* ═══ OUTPUT APPROACH ═══ */}
      <SectionHeader label="Output Approach" />

      <div className={styles.twoColGrid}>
        <ContribChart title="Contributions to MoM GDP (Output)" subtitle="pp contributions, month-on-month (ONS official, from Jan 2024)" data={outputContribM} components={outputComponents} colors={OUTPUT_COLORS} active={rngContribM} onChange={setRngContribM} />
        <ContribChart title="Contributions to YoY GDP (Output)" subtitle="pp contributions, year-on-year (ONS official, from Jan 2024)" data={outputContribY} components={outputComponents} colors={OUTPUT_COLORS} active={rngContribY} onChange={setRngContribY} />
      </div>

      {/* ═══ SERVICES BREAKDOWN ═══ */}
      {hasServicesBreakdown && (
        <>
          <SectionHeader label="Services Breakdown" />
          <div className={styles.twoColGrid}>
            <ContribChart title="Contributions to MoM Services" subtitle="pp contributions by SIC section (ONS official)" data={svcContribM} components={servicesComponents} colors={SVC_COLORS} active={rngSvcM} onChange={setRngSvcM} totalKey="services" />
            <ContribChart title="Contributions to YoY Services" subtitle="pp contributions by SIC section (ONS official)" data={svcContribY} components={servicesComponents} colors={SVC_COLORS} active={rngSvcY} onChange={setRngSvcY} totalKey="services" />
          </div>
        </>
      )}

      {/* ═══ PRODUCTION BREAKDOWN ═══ */}
      {hasProductionBreakdown && (
        <>
          <SectionHeader label="Production Breakdown" />
          <div className={styles.twoColGrid}>
            <ContribChart title="Contributions to MoM Production" subtitle="pp contributions by SIC section (ONS official)" data={prodContribM} components={productionComponents} colors={PROD_COLORS} active={rngProdM} onChange={setRngProdM} totalKey="production" />
            <ContribChart title="Contributions to YoY Production" subtitle="pp contributions by SIC section (ONS official)" data={prodContribY} components={productionComponents} colors={PROD_COLORS} active={rngProdY} onChange={setRngProdY} totalKey="production" />
          </div>
        </>
      )}
    </>
  )
}
