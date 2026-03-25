import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ComposedChart, LineChart, BarChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './BankCreditDashboardPage.module.css'

// ── Series config ────────────────────────────────────────────────────────────

const LOAN_SERIES = [
  'TOTBKCR', 'TOTLL', 'TOTCI',
  'RREACBW027SBOG', 'CREACBW027SBOG', 'CLSACBW027SBOG',
  'AOLACBW027SBOG', 'GDP',
] as const

type WD = { date: string; value: number }

const NGDP_LINES = [
  { key: 'ci', label: 'C&I', color: '#a3e635' },
  { key: 'rre', label: 'Residential RE', color: '#93c5fd' },
  { key: 'cre', label: 'CRE', color: '#fb923c' },
  { key: 'consumer', label: 'Consumer', color: '#f87171' },
  { key: 'other', label: 'Other', color: '#c084fc' },
] as const

const CHANGE_AREAS = [
  { key: 'ci', label: 'Commercial & Industrial', color: '#1e3a5f' },
  { key: 'rre', label: 'Residential Real Estate', color: '#93c5fd' },
  { key: 'cre', label: 'Commercial Real Estate', color: '#4a7c59' },
  { key: 'consumer', label: 'Consumer', color: '#b8860b' },
  { key: 'other', label: 'All Other', color: '#c8a951' },
] as const

interface H8LineItem { label: string; indent: number; allCB: string; large: string; small: string }

const H8_HIERARCHY: H8LineItem[] = [
  { label: 'Bank Credit', indent: 0, allCB: 'TOTBKCR', large: 'BC0LCBW027SBOG', small: 'BC0SCBW027SBOG' },
  { label: 'Securities in bank credit', indent: 1, allCB: 'SBCACBW027SBOG', large: 'SBCLCBW027SBOG', small: 'SBCSCBW027SBOG' },
  { label: 'Treasury and agency securities', indent: 2, allCB: 'TASACBW027SBOG', large: 'TASLCBW027SBOG', small: 'TASSCBW027SBOG' },
  { label: 'Mortgage-backed securities (MBS)', indent: 3, allCB: 'TMBACBW027SBOG', large: 'TMBLCBW027SBOG', small: 'TMBSCBW027SBOG' },
  { label: 'Non-MBS', indent: 3, allCB: 'TNMACBW027SBOG', large: 'TNMLCBW027SBOG', small: 'TNMSCBW027SBOG' },
  { label: 'Other securities', indent: 2, allCB: 'OSEACBW027SBOG', large: 'OSELCBW027SBOG', small: 'OSESCBW027SBOG' },
  { label: 'Mortgage-backed securities (MBS)', indent: 3, allCB: 'OMBACBW027SBOG', large: 'OMBLCBW027SBOG', small: 'OMBSCBW027SBOG' },
  { label: 'Non-MBS', indent: 3, allCB: 'ONMACBW027SBOG', large: 'ONMLCBW027SBOG', small: 'ONMSCBW027SBOG' },
  { label: 'Loans and leases in bank credit', indent: 1, allCB: 'TOTLL', large: 'LLBLCBW027SBOG', small: 'LLBSCBW027SBOG' },
  { label: 'Commercial and industrial loans', indent: 2, allCB: 'TOTCI', large: 'CIBOARD', small: 'CILSCBW027SBOG' },
  { label: 'Real estate loans', indent: 2, allCB: 'RELACBW027SBOG', large: 'RELLCBW027SBOG', small: 'RELSCBW027SBOG' },
  { label: 'Residential real estate loans', indent: 3, allCB: 'RREACBW027SBOG', large: 'RRELCBW027SBOG', small: 'RRESCBW027SBOG' },
  { label: 'Revolving home equity loans', indent: 4, allCB: 'RHEACBW027SBOG', large: 'RHELCBW027SBOG', small: 'RHESCBW027SBOG' },
  { label: 'Closed-end residential loans', indent: 4, allCB: 'CRLACBW027SBOG', large: 'CRLLCBW027SBOG', small: 'CRLSCBW027SBOG' },
  { label: 'Commercial real estate loans', indent: 3, allCB: 'CREACBW027SBOG', large: 'CRELCBW027SBOG', small: 'CRESCBW027SBOG' },
  { label: 'Construction and land development', indent: 4, allCB: 'CLDACBW027SBOG', large: 'CLDLCBW027SBOG', small: 'CLDSCBW027SBOG' },
  { label: 'Secured by farmland', indent: 4, allCB: 'SBFACBW027SBOG', large: 'SBFLCBW027SBOG', small: 'SBFSCBW027SBOG' },
  { label: 'Secured by multifamily properties', indent: 4, allCB: 'SMPACBW027SBOG', large: 'SMPLCBW027SBOG', small: 'SMPSCBW027SBOG' },
  { label: 'Secured by nonfarm nonresidential', indent: 4, allCB: 'SNFACBW027SBOG', large: 'SNFLCBW027SBOG', small: 'SNFSCBW027SBOG' },
  { label: 'Consumer loans', indent: 2, allCB: 'CLSACBW027SBOG', large: 'CLSLCBW027SBOG', small: 'CLSSCBW027SBOG' },
  { label: 'Credit cards and other revolving plans', indent: 3, allCB: 'CCLACBW027SBOG', large: 'CCLLCBW027SBOG', small: 'CCLSCBW027SBOG' },
  { label: 'Other consumer loans', indent: 3, allCB: 'OCLACBW027SBOG', large: 'OCLLCBW027SBOG', small: 'OCLSCBW027SBOG' },
  { label: 'Automobile loans', indent: 4, allCB: 'CARACBW027SBOG', large: 'CARLCBW027SBOG', small: 'CARSCBW027SBOG' },
  { label: 'All other consumer loans', indent: 4, allCB: 'AOCACBW027SBOG', large: 'AOCLCBW027SBOG', small: 'AOCSCBW027SBOG' },
  { label: 'All other loans and leases', indent: 2, allCB: 'AOLACBW027SBOG', large: 'AOLLCBW027SBOG', small: 'AOLSCBW027SBOG' },
  { label: 'Loans to nondepository financial institutions', indent: 3, allCB: 'LNFACBW027SBOG', large: 'LNFLCBW027SBOG', small: 'LNFSCBW027SBOG' },
  { label: 'All loans not elsewhere classified', indent: 3, allCB: 'OLNACBW027SBOG', large: 'OLNLCBW027SBOG', small: 'OLNSCBW027SBOG' },
  { label: 'LESS: Allowance for loan and lease losses', indent: 1, allCB: 'ALLACBW027SBOG', large: 'ALLLCBW027SBOG', small: 'ALLSCBW027SBOG' },
  { label: 'Cash assets', indent: 0, allCB: 'CASACBW027SBOG', large: 'CASLCBW027SBOG', small: 'CASSCBW027SBOG' },
  { label: 'Total federal funds sold and reverse RPs', indent: 0, allCB: 'H8B3092NCBA', large: 'H8B3092NLGA', small: 'H8B3092NSMA' },
  { label: 'Loans to commercial banks', indent: 0, allCB: 'LCBACBW027SBOG', large: 'LCBLCBW027SBOG', small: 'LCBSCBW027SBOG' },
  { label: 'Other assets including trading assets', indent: 0, allCB: 'H8B3053NCBA', large: 'H8B3053NLGA', small: 'H8B3053NSMA' },
  { label: 'Total assets', indent: 0, allCB: 'TLAACBW027SBOG', large: 'TLALCBW027SBOG', small: 'TLASCBW027SBOG' },
  { label: 'Deposits', indent: 0, allCB: 'DPSACBW027SBOG', large: 'DPSLCBW027SBOG', small: 'DPSSCBW027SBOG' },
  { label: 'Large time deposits', indent: 1, allCB: 'LTDACBW027SBOG', large: 'LTDLCBW027SBOG', small: 'LTDSCBW027SBOG' },
  { label: 'Other deposits', indent: 1, allCB: 'ODSACBW027SBOG', large: 'ODSLCBW027SBOG', small: 'ODSSCBW027SBOG' },
  { label: 'Borrowings', indent: 0, allCB: 'H8B3094NCBA', large: 'H8B3094NLGA', small: 'H8B3094NSMA' },
  { label: 'Net due to related foreign offices', indent: 0, allCB: 'NDFACBW027SBOG', large: 'NDFLCBW027SBOG', small: 'NDFSCBW027SBOG' },
  { label: 'Other liabilities including trading liabilities', indent: 0, allCB: 'H8B3095NCBA', large: 'H8B3095NLGA', small: 'H8B3095NSMA' },
  { label: 'Total liabilities', indent: 0, allCB: 'TLBACBW027SBOG', large: 'TLBLCBW027SBOG', small: 'TLBSCBW027SBOG' },
]

type Cohort = 'allCB' | 'large' | 'small'
const COHORTS: Array<{ key: Cohort; label: string }> = [
  { key: 'allCB', label: 'All Commercial Banks' },
  { key: 'large', label: 'Large Banks' },
  { key: 'small', label: 'Small Banks' },
]

function parseObs(obs: FredObservation[]): WD[] {
  return obs.map(o => ({ date: o.date, value: Number(o.value) })).filter(o => !isNaN(o.value))
}

function getDateCutoff(range: string): string | null {
  if (range === 'max') return null
  const now = new Date()
  const map: Record<string, number> = { '1y': 12, '2y': 24, '3y': 36, '5y': 60, '10y': 120, '20y': 240, '50y': 600 }
  const m = map[range]; if (!m) return null
  now.setMonth(now.getMonth() - m); return now.toISOString().slice(0, 10)
}

const fmtD = (date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }
const lblFmt = (label: unknown) => typeof label === 'string' ? new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const TK = { fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }
const TT = { background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }

// ── Content component ────────────────────────────────────────────────────────

export function BankCreditDashboardContent() {
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ngdpRange, setNgdpRange] = useState('max')
  const [changeRange, setChangeRange] = useState('5y')
  const [changeWindow, setChangeWindow] = useState(13)

  // Explorer state
  const [cohort, setCohort] = useState<Cohort>('allCB')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [explorerData, setExplorerData] = useState<WD[]>([])
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [explorerRange, setExplorerRange] = useState('10y')
  const [explorerWowWindow, setExplorerWowWindow] = useState(13)

  useEffect(() => {
    let cancelled = false
    Promise.all(LOAN_SERIES.map(s =>
      fetchFredSeries(s).then(d => ({ key: s, data: parseObs(d) })).catch(() => ({ key: s, data: [] as WD[] }))
    )).then(results => {
      if (cancelled) return
      const map: Record<string, WD[]> = {}; results.forEach(r => { map[r.key] = r.data })
      setAllData(map); setLoading(false)
    }).catch(err => { if (cancelled) return; setError(err instanceof Error ? err.message : String(err)); setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Fetch explorer series when selection/cohort changes
  const explorerSeriesId = H8_HIERARCHY[selectedIdx]?.[cohort] ?? ''
  useEffect(() => {
    if (!explorerSeriesId) return
    // Check if already in allData
    if (allData[explorerSeriesId]?.length) { setExplorerData(allData[explorerSeriesId]); return }
    setExplorerLoading(true)
    fetchFredSeries(explorerSeriesId).then(d => { setExplorerData(parseObs(d)); setExplorerLoading(false) }).catch(() => { setExplorerData([]); setExplorerLoading(false) })
  }, [explorerSeriesId, allData])

  const gdpMap = useMemo(() => {
    const sorted = [...(allData['GDP'] || [])].sort((a, b) => a.date.localeCompare(b.date))
    return { sorted, getGDP: (date: string): number | null => { for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].date <= date) return sorted[i].value } return null } }
  }, [allData])

  const ngdpChartData = useMemo(() => {
    const ci = allData['TOTCI'] || []; const rre = allData['RREACBW027SBOG'] || []; const cre = allData['CREACBW027SBOG'] || []
    const consumer = allData['CLSACBW027SBOG'] || []; const other = allData['AOLACBW027SBOG'] || []
    if (ci.length === 0 || gdpMap.sorted.length === 0) return []
    const rreM = new Map(rre.map(p => [p.date, p.value])); const creM = new Map(cre.map(p => [p.date, p.value]))
    const conM = new Map(consumer.map(p => [p.date, p.value])); const othM = new Map(other.map(p => [p.date, p.value])); const ciM = new Map(ci.map(p => [p.date, p.value]))
    const cutoff = getDateCutoff(ngdpRange); const dates = [...new Set([...ci.map(p => p.date), ...rre.map(p => p.date)])].sort()
    return dates.filter(d => !cutoff || d >= cutoff).map(d => {
      const gdp = gdpMap.getGDP(d); if (!gdp || gdp === 0) return null
      const toP = (v: number | undefined): number | null => (!v ? null : (v / gdp) * 100)
      return { date: d, ci: toP(ciM.get(d)), rre: toP(rreM.get(d)), cre: toP(creM.get(d)), consumer: toP(conM.get(d)), other: toP(othM.get(d)) }
    }).filter((p): p is NonNullable<typeof p> => p != null)
  }, [allData, gdpMap, ngdpRange])

  const changeChartData = useMemo(() => {
    const ci = allData['TOTCI'] || []; const rre = allData['RREACBW027SBOG'] || []; const cre = allData['CREACBW027SBOG'] || []
    const consumer = allData['CLSACBW027SBOG'] || []; const other = allData['AOLACBW027SBOG'] || []; const totll = allData['TOTLL'] || []
    if (totll.length === 0) return []
    const rreM = new Map(rre.map(p => [p.date, p.value])); const creM = new Map(cre.map(p => [p.date, p.value]))
    const conM = new Map(consumer.map(p => [p.date, p.value])); const othM = new Map(other.map(p => [p.date, p.value])); const ciM = new Map(ci.map(p => [p.date, p.value]))
    const sorted = [...totll].sort((a, b) => a.date.localeCompare(b.date)); const cutoff = getDateCutoff(changeRange)
    return sorted.slice(changeWindow).map((p, idx) => {
      const prior = sorted[idx]; const d = p.date; const pd = prior.date; if (cutoff && d < cutoff) return null
      return { date: d, ci: (ciM.get(d) ?? 0) - (ciM.get(pd) ?? 0), rre: (rreM.get(d) ?? 0) - (rreM.get(pd) ?? 0), cre: (creM.get(d) ?? 0) - (creM.get(pd) ?? 0), consumer: (conM.get(d) ?? 0) - (conM.get(pd) ?? 0), other: (othM.get(d) ?? 0) - (othM.get(pd) ?? 0), total: p.value - prior.value }
    }).filter((p): p is NonNullable<typeof p> => p != null)
  }, [allData, changeWindow, changeRange])

  // Explorer computed data
  const explorerLevel = useMemo(() => {
    const cutoff = getDateCutoff(explorerRange); return cutoff ? explorerData.filter(p => p.date >= cutoff) : explorerData
  }, [explorerData, explorerRange])

  const explorerYoY = useMemo(() => {
    const sorted = [...explorerData].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.slice(52).map((p, i) => ({ date: p.date, value: sorted[i].value !== 0 ? ((p.value / sorted[i].value) - 1) * 100 : 0 }))
  }, [explorerData])

  const explorerYoYFiltered = useMemo(() => {
    const cutoff = getDateCutoff(explorerRange); return cutoff ? explorerYoY.filter(p => p.date >= cutoff) : explorerYoY
  }, [explorerYoY, explorerRange])

  const explorerXwk = useMemo(() => {
    const sorted = [...explorerData].sort((a, b) => a.date.localeCompare(b.date))
    if (sorted.length <= explorerWowWindow) return []
    return sorted.slice(explorerWowWindow).map((p, i) => ({
      date: p.date,
      value: sorted[i].value !== 0 ? ((p.value / sorted[i].value) - 1) * 100 : 0,
    }))
  }, [explorerData, explorerWowWindow])

  const explorerXwkFiltered = useMemo(() => {
    const cutoff = getDateCutoff(explorerRange); return cutoff ? explorerXwk.filter(p => p.date >= cutoff) : explorerXwk
  }, [explorerXwk, explorerRange])

  if (loading) return <div className={styles.statusBlock}>Loading H.8 data…</div>
  if (error) return <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>

  const selectedItem = H8_HIERARCHY[selectedIdx]

  return (
    <>
      <div className={styles.majorHeader}>Bank Credit Dashboard</div>
      <div className={styles.chartSubtitle}>Federal Reserve H.8 Release · Weekly · Seasonally Adjusted · All Commercial Banks</div>

      {/* ═══ Top two charts side by side ═══ */}
      <div className={styles.topChartsGrid}>
        {/* Chart 1: % of NGDP */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>Bank Loans & Leases</div><div className={styles.sectionSubtitle}>% of Nominal GDP</div></div></div>
          <div className={styles.legendRow}><div className={styles.legend}>{NGDP_LINES.map(s => (<span key={s.key} className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: s.color }} />{s.label}</span>))}</div></div>
          <div className={styles.controlRow}>{['5y', '10y', '20y', '50y', 'max'].map(r => (<button key={r} className={`${styles.qsBtn} ${ngdpRange === r ? styles.qsBtnActive : ''}`} onClick={() => setNgdpRange(r)}>{r.toUpperCase()}</button>))}</div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={ngdpChartData} margin={{ top: 10, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => { const cfg = NGDP_LINES.find(l => l.key === name); return [typeof v === 'number' ? `${v.toFixed(1)}%` : '—', cfg?.label ?? (name ?? '')] }} />
                {NGDP_LINES.map(s => (<Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} name={s.key} />))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.brushWrap}><ResponsiveContainer width="100%" height={40}><LineChart data={ngdpChartData}><Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} /></LineChart></ResponsiveContainer></div>
        </section>

        {/* Chart 2: N-week change */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}><div><div className={styles.sectionTitle}>{changeWindow}wk Change in Loans & Leases</div><div className={styles.sectionSubtitle}>$ Billions</div></div></div>
          <div className={styles.legendRow}><div className={styles.legend}>{CHANGE_AREAS.map(s => (<span key={s.key} className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: s.color }} />{s.label}</span>))}<span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#ffffff' }} />Total</span></div></div>
          <div className={styles.controlRow}>
            {['1y', '2y', '3y', '5y', 'max'].map(r => (<button key={r} className={`${styles.qsBtn} ${changeRange === r ? styles.qsBtnActive : ''}`} onClick={() => setChangeRange(r)}>{r.toUpperCase()}</button>))}
            <div className={styles.inputWrap}><span>Window:</span><input className={styles.numInput} type="number" min="1" value={changeWindow} onChange={(e) => setChangeWindow(Math.max(1, parseInt(e.target.value) || 13))} /><span>wk</span></div>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={changeChartData} margin={{ top: 10, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => v < 0 ? `(${Math.abs(v).toFixed(0)})` : v.toFixed(0)} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => { const cfg = CHANGE_AREAS.find(a => a.key === name); const label = name === 'total' ? 'Total' : (cfg?.label ?? (name ?? '')); return [typeof v === 'number' ? `$${v.toFixed(1)}B` : '—', label] }} />
                <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                {CHANGE_AREAS.map(s => (<Area key={s.key} type="monotone" dataKey={s.key} stackId="1" fill={s.color} fillOpacity={0.85} strokeWidth={0} name={s.key} />))}
                <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} dot={false} name="total" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className={styles.brushWrap}><ResponsiveContainer width="100%" height={40}><LineChart data={changeChartData}><Brush dataKey="date" height={30} stroke="#728197" fill="#0d1520" travellerWidth={8} /></LineChart></ResponsiveContainer></div>
        </section>
      </div>

      {/* ═══ H.8 Series Explorer ═══ */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>H.8 SERIES EXPLORER</div>
          <div className={styles.cohortToggle}>
            {COHORTS.map(c => (
              <button key={c.key} className={cohort === c.key ? styles.cohortBtnActive : styles.cohortBtn} onClick={() => setCohort(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <select className={styles.seriesSelect} value={selectedIdx} onChange={(e) => setSelectedIdx(Number(e.target.value))}>
            {H8_HIERARCHY.map((item, idx) => (
              <option key={idx} value={idx}>{'\u00A0\u00A0'.repeat(item.indent)}{item.label}</option>
            ))}
          </select>
        </div>

        {explorerLoading ? (
          <div className={styles.statusBlock}>Loading {selectedItem?.label}…</div>
        ) : explorerData.length === 0 ? (
          <div className={styles.statusBlock}>No data for {explorerSeriesId}</div>
        ) : (
          <>
            <div className={styles.controlRow}>
              {['5y', '10y', '20y', 'max'].map(r => (<button key={r} className={`${styles.qsBtn} ${explorerRange === r ? styles.qsBtnActive : ''}`} onClick={() => setExplorerRange(r)}>{r.toUpperCase()}</button>))}
            </div>
            <div className={styles.explorerChartsGrid}>
              {/* Level */}
              <div className={styles.chartWrap}>
                <div className={styles.sectionTitle} style={{ paddingBottom: '4px' }}>{selectedItem?.label} — Level</div>
                <div className={styles.chartSubtitle}>$ Billions, SA</div>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={explorerLevel} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                    <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* YoY */}
              <div className={styles.chartWrap}>
                <div className={styles.sectionTitle} style={{ paddingBottom: '4px' }}>{selectedItem?.label} — YoY %Chg</div>
                <div className={styles.chartSubtitle}>52-week change</div>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={explorerYoYFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                    <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={2} dot={false} />
                    <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Xwk %Chg */}
              <div className={styles.chartWrap}>
                <div className={styles.sectionTitle} style={{ paddingBottom: '4px' }}>{selectedItem?.label} — {explorerWowWindow}wk %Chg</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '6px' }}>
                  <div className={styles.chartSubtitle} style={{ paddingBottom: 0 }}>{explorerWowWindow}-week change</div>
                  <div className={styles.inputWrap}><span>Window:</span><input className={styles.numInput} type="number" min="1" value={explorerWowWindow} onChange={(e) => setExplorerWowWindow(Math.max(1, parseInt(e.target.value) || 13))} /><span>wk</span></div>
                </div>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={explorerXwkFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                    <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                    <Bar dataKey="value" fill="#a78bfa" radius={[2, 2, 0, 0]} barSize={2} />
                    <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  )
}

// ── Standalone page wrapper ──────────────────────────────────────────────────

export function BankCreditDashboardPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}><NavDropdown /><span className={styles.logo}>TND RESEARCH TERMINAL</span></div>
        <div className={styles.barCenter} /><div className={styles.barRight} />
      </header>
      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/credit" className={styles.breadcrumbLink}>Credit</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Bank Credit</span>
      </nav>
      <div className={styles.body}><BankCreditDashboardContent /></div>
    </div>
  )
}
