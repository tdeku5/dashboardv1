import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LineChart, BarChart, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import styles from './UKGrowthCharts.module.css'

// ── types & helpers ──────────────────────────────────────────────────────────

type WD = { date: string; value: number }
type Mode = 'real' | 'nominal'

function getDateCutoff(range: string): string | null {
  if (range === 'max') return null
  const now = new Date()
  const map: Record<string, number> = { '1y': 12, '5y': 60, '10y': 120, '20y': 240 }
  const m = map[range]; if (!m) return null
  now.setMonth(now.getMonth() - m); return now.toISOString().slice(0, 10)
}

function filterByRange<T extends { date: string }>(data: T[], range: string): T[] {
  const c = getDateCutoff(range); return c ? data.filter(p => p.date >= c) : data
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

// ── series config ────────────────────────────────────────────────────────────

interface RetailLineItem {
  label: string
  indent: number
  realCdid: string
  nominalCdid: string
  dataset: string
  isHeader?: boolean
}

const RETAIL_HIERARCHY: RetailLineItem[] = [
  { label: '── HEADLINE ──', indent: 0, realCdid: '', nominalCdid: '', dataset: '', isHeader: true },
  { label: 'All Retailing incl. Fuel', indent: 0, realCdid: 'J5EK', nominalCdid: 'J5C4', dataset: 'drsi' },
  { label: 'All Retailing excl. Fuel', indent: 0, realCdid: 'J467', nominalCdid: 'J468', dataset: 'drsi' },
  { label: '── BY STORE TYPE ──', indent: 0, realCdid: '', nominalCdid: '', dataset: '', isHeader: true },
  { label: 'Predominantly Food Stores', indent: 1, realCdid: 'EAPT', nominalCdid: 'EAQW', dataset: 'drsi' },
  { label: 'Predominantly Non-Food Stores', indent: 1, realCdid: 'EAPV', nominalCdid: 'EAQY', dataset: 'drsi' },
  { label: 'Non-Specialised Stores', indent: 2, realCdid: 'J5DV', nominalCdid: 'J45F', dataset: 'drsi' },
  { label: 'Textile, Clothing & Footwear', indent: 2, realCdid: 'J5DX', nominalCdid: 'J45H', dataset: 'drsi' },
  { label: 'Household Goods Stores', indent: 2, realCdid: 'J5E2', nominalCdid: 'J45L', dataset: 'drsi' },
  { label: 'Other Non-Food Stores', indent: 2, realCdid: 'J5E6', nominalCdid: 'J45P', dataset: 'drsi' },
  { label: 'Non-Store Retailing', indent: 1, realCdid: 'J5DZ', nominalCdid: 'JO2Y', dataset: 'drsi' },
  { label: 'Automotive Fuel', indent: 1, realCdid: 'JO5A', nominalCdid: 'JO2G', dataset: 'drsi' },
]

const FIRST_SELECTABLE = RETAIL_HIERARCHY.findIndex(h => !h.isHeader)

// Eager fetch: both real + nominal headline + summary CDIDs
const EAGER_CDIDS = [
  'J5EK', 'J467', 'EAPT', 'EAPV', 'J5DZ', 'JO5A',
  'J5C4', 'J468', 'EAQW', 'EAQY', 'JO2Y', 'JO2G',
  'J4MC', 'J5HW', 'J5HQ', 'J5HR',
]

type Regime = 'expansion' | 'contraction' | 'neutral'
const REGIME_FILL: Record<Regime, string> = { expansion: 'rgba(74,222,128,0.15)', contraction: 'rgba(248,113,113,0.15)', neutral: 'rgba(250,204,21,0.15)' }

// ── toggle button style ─────────────────────────────────────────────────────

const toggleBtnBase: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#728197',
  fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 600,
  padding: '3px 10px', cursor: 'pointer', borderRadius: '2px', transition: 'all 0.15s',
}
const toggleBtnActive: React.CSSProperties = {
  ...toggleBtnBase, color: '#f87171', background: 'rgba(248,113,113,0.08)', borderColor: '#f87171',
}

// ── component ────────────────────────────────────────────────────────────────

export function UKRetailContent() {
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<Mode>('real')

  // Explorer state
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

  // Contribution chart ranges
  const [rngContribMom, setRngContribMom] = useState('5y')
  const [rngContribYoy, setRngContribYoy] = useState('5y')

  const selectedItem = RETAIL_HIERARCHY[explorerIdx]

  // Eager fetch on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const results = await Promise.all(
          EAGER_CDIDS.map(cdid =>
            fetchOnsSeries(cdid, 'drsi').then(d => [cdid.toUpperCase(), d] as const).catch(() => [cdid.toUpperCase(), [] as WD[]] as const)
          )
        )
        if (cancelled) return
        const map: Record<string, WD[]> = {}
        results.forEach(([k, d]) => { map[k] = d })
        setAllData(map)
      } catch (e: unknown) { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data') }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Get active CDID for explorer selection based on mode
  const getActiveCdid = useCallback((item: RetailLineItem) => {
    return mode === 'real' ? item.realCdid : item.nominalCdid
  }, [mode])

  // Fetch explorer data when selection or mode changes
  const fetchExplorer = useCallback(async (idx: number, m: Mode) => {
    const item = RETAIL_HIERARCHY[idx]
    if (!item || item.isHeader) return
    const cdid = (m === 'real' ? item.realCdid : item.nominalCdid).toUpperCase()
    if (allData[cdid]?.length) { setExplorerData(allData[cdid]); return }
    setExplorerLoading(true)
    try {
      const d = await fetchOnsSeries(cdid, item.dataset)
      setAllData(prev => ({ ...prev, [cdid]: d }))
      setExplorerData(d)
    } catch { setExplorerData([]) }
    setExplorerLoading(false)
  }, [allData])

  useEffect(() => { fetchExplorer(explorerIdx, mode) }, [explorerIdx, mode, fetchExplorer])

  // ── ALL useMemo BEFORE early returns ──

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

  // MoM with MAs
  const expMomFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, mom: expSorted[i].value !== 0 ? ((p.value / expSorted[i].value) - 1) * 100 : 0 })), [expSorted])
  const expMomWithMAs = useMemo(() => {
    const vals = expMomFull.map(p => p.mom), m1 = sma(vals, momMa1), m2 = sma(vals, momMa2)
    return expMomFull.map((p, i) => ({ ...p, ma1: m1[i], ma2: m2[i] }))
  }, [expMomFull, momMa1, momMa2])
  const expMomFiltered = useMemo(() => filterByRange(expMomWithMAs, rngMom), [expMomWithMAs, rngMom])

  // Annualized MoM
  const expAnnMomFull = useMemo(() => expSorted.length <= 1 ? [] : expSorted.slice(1).map((p, i) => ({ date: p.date, value: expSorted[i].value !== 0 ? (Math.pow(p.value / expSorted[i].value, 12) - 1) * 100 : 0 })), [expSorted])
  const expAnnMomFiltered = useMemo(() => filterByRange(expAnnMomFull, rngAnnMom), [expAnnMomFull, rngAnnMom])

  // ── Contribution charts data ──

  const RETAIL_WEIGHTS = useMemo(() => ({ food: 0.40, nonFood: 0.38, nonStore: 0.08, fuel: 0.14 }), [])

  const activeCdids = useMemo(() => mode === 'real'
    ? { total: 'J5EK', food: 'EAPT', nonFood: 'EAPV', nonStore: 'J5DZ', fuel: 'JO5A' }
    : { total: 'J5C4', food: 'EAQW', nonFood: 'EAQY', nonStore: 'JO2Y', fuel: 'JO2G' },
  [mode])

  const computeContributions = useCallback((lookback: number) => {
    const totalData = allData[activeCdids.total] || []
    const foodData = allData[activeCdids.food] || []
    const nonFoodData = allData[activeCdids.nonFood] || []
    const nonStoreData = allData[activeCdids.nonStore] || []
    const fuelData = allData[activeCdids.fuel] || []

    const totalMap = new Map(totalData.map(d => [d.date, d.value]))
    const foodMap = new Map(foodData.map(d => [d.date, d.value]))
    const nonFoodMap = new Map(nonFoodData.map(d => [d.date, d.value]))
    const nonStoreMap = new Map(nonStoreData.map(d => [d.date, d.value]))
    const fuelMap = new Map(fuelData.map(d => [d.date, d.value]))

    const dates = totalData.map(d => d.date).sort()
    const result: Array<{ date: string; food: number; nonFood: number; nonStore: number; fuel: number; total: number }> = []

    for (let i = lookback; i < dates.length; i++) {
      const curr = dates[i]
      const prev = dates[i - lookback]
      const totalCurr = totalMap.get(curr)
      const totalPrev = totalMap.get(prev)
      if (!totalCurr || !totalPrev || totalPrev === 0) continue

      const totalGrowth = ((totalCurr / totalPrev) - 1) * 100
      const gr = (map: Map<string, number>) => {
        const c = map.get(curr), p = map.get(prev)
        return (c && p && p !== 0) ? ((c / p) - 1) * 100 : 0
      }

      result.push({
        date: curr,
        food: gr(foodMap) * RETAIL_WEIGHTS.food,
        nonFood: gr(nonFoodMap) * RETAIL_WEIGHTS.nonFood,
        nonStore: gr(nonStoreMap) * RETAIL_WEIGHTS.nonStore,
        fuel: gr(fuelMap) * RETAIL_WEIGHTS.fuel,
        total: totalGrowth,
      })
    }
    return result
  }, [allData, activeCdids, RETAIL_WEIGHTS])

  const contribMomFull = useMemo(() => computeContributions(1), [computeContributions])
  const contribYoyFull = useMemo(() => computeContributions(12), [computeContributions])
  const contribMom = useMemo(() => filterByRange(contribMomFull, rngContribMom), [contribMomFull, rngContribMom])
  const contribYoy = useMemo(() => filterByRange(contribYoyFull, rngContribYoy), [contribYoyFull, rngContribYoy])

  // ── early returns ──
  if (error) return <div style={{ color: '#f87171', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{error}</div>
  if (loading) return <div style={{ color: '#728197', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading UK Retail data...</div>

  const subtitleText = mode === 'real'
    ? 'Office for National Statistics \u00b7 Monthly \u00b7 Volume SA \u00b7 Index 2019=100'
    : 'Office for National Statistics \u00b7 Monthly \u00b7 Value SA \u00b7 Index 2019=100'

  const levelSubText = mode === 'real' ? 'Volume SA, Index 2019=100' : 'Value SA, Index 2019=100'

  return (
    <>
      {/* Header row with subtitle + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 8 }}>
        <div className={styles.chartSubtitle} style={{ paddingBottom: 0 }}>{subtitleText}</div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button style={mode === 'real' ? toggleBtnActive : toggleBtnBase} onClick={() => setMode('real')}>REAL</button>
          <button style={mode === 'nominal' ? toggleBtnActive : toggleBtnBase} onClick={() => setMode('nominal')}>NOMINAL</button>
        </div>
      </div>

      {/* ═══ Series Explorer ═══ */}
      <div className={styles.explorerSection}>
        <div className={styles.chartLabel} style={{ marginBottom: 8 }}>Series Explorer</div>
        <select
          className={styles.seriesSelect}
          value={explorerIdx}
          onChange={e => { const idx = Number(e.target.value); if (!RETAIL_HIERARCHY[idx]?.isHeader) setExplorerIdx(idx) }}
        >
          {RETAIL_HIERARCHY.map((h, idx) =>
            h.isHeader ? (
              <option key={idx} disabled style={{ fontWeight: 700, color: '#60a5fa' }}>{h.label}</option>
            ) : (
              <option key={idx} value={idx}>{'\u00A0\u00A0'.repeat(h.indent)}{h.label}</option>
            )
          )}
        </select>

        {explorerLoading ? (
          <div style={{ color: '#728197', padding: 24, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>Loading {getActiveCdid(selectedItem)}...</div>
        ) : (
          <>
            {/* Row 1: Level + YoY Regime */}
            <div className={styles.twoColGrid} style={{ marginTop: 12 }}>
              <div className={styles.chartCard}>
                <div className={styles.chartLabel}>{selectedItem.label} — Level</div>
                <div className={styles.chartSub}>{levelSubText}</div>
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

      {/* ═══ Sector Contributions ═══ */}
      <div style={{ marginTop: 24, padding: '8px 0', borderBottom: '1px solid var(--border-accent, #60a5fa)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#60a5fa', textTransform: 'uppercase' as const }}>SECTOR CONTRIBUTIONS</div>

      <div className={styles.twoColGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartLabel}>CONTRIBUTIONS TO MOM RETAIL SALES</div>
          <div className={styles.chartSub}>pp contributions, month-on-month (weighted approx.)</div>
          <QS active={rngContribMom} onChange={setRngContribMom} />
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#60a5fa' }} />Food Stores</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#f59e0b' }} />Non-Food Stores</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#4ade80' }} />Non-Store</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#f87171' }} />Fuel</span>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#ffffff' }} />Total</span>
          </div>
          {contribMom.length > 0 ? (
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={contribMom} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}pp` : '—', name ?? '']} />
                <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                <Bar dataKey="food" stackId="a" fill="#60a5fa" barSize={4} name="Food Stores" />
                <Bar dataKey="nonFood" stackId="a" fill="#f59e0b" barSize={4} name="Non-Food Stores" />
                <Bar dataKey="nonStore" stackId="a" fill="#4ade80" barSize={4} name="Non-Store" />
                <Bar dataKey="fuel" stackId="a" fill="#f87171" barSize={4} name="Fuel" />
                <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={1.5} dot={false} name="Total" />
                <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : NO_DATA}
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartLabel}>CONTRIBUTIONS TO YOY RETAIL SALES</div>
          <div className={styles.chartSub}>pp contributions, year-on-year (weighted approx.)</div>
          <QS active={rngContribYoy} onChange={setRngContribYoy} />
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#60a5fa' }} />Food Stores</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#f59e0b' }} />Non-Food Stores</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#4ade80' }} />Non-Store</span>
            <span className={styles.legendItem}><span className={styles.legendSwatchSquare} style={{ background: '#f87171' }} />Fuel</span>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#ffffff' }} />Total</span>
          </div>
          {contribYoy.length > 0 ? (
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={contribYoy} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT_STYLE} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `${v.toFixed(2)}pp` : '—', name ?? '']} />
                <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                <Bar dataKey="food" stackId="a" fill="#60a5fa" barSize={4} name="Food Stores" />
                <Bar dataKey="nonFood" stackId="a" fill="#f59e0b" barSize={4} name="Non-Food Stores" />
                <Bar dataKey="nonStore" stackId="a" fill="#4ade80" barSize={4} name="Non-Store" />
                <Bar dataKey="fuel" stackId="a" fill="#f87171" barSize={4} name="Fuel" />
                <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={1.5} dot={false} name="Total" />
                <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : NO_DATA}
        </div>
      </div>
    </>
  )
}
