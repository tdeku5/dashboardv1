import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import styles from './UKGrowthCharts.module.css'

type WD = { date: string; value: number }

const UK_TRADE_SERIES = [
  { cdid: 'BOKI', dataset: 'mret' },
  { cdid: 'BOKG', dataset: 'mret' },
  { cdid: 'BOKH', dataset: 'mret' },
  { cdid: 'IKBK', dataset: 'ukea' },
  { cdid: 'IKBL', dataset: 'ukea' },
]

function getDateCutoff(range: string): string | null {
  if (range === 'max') return null
  const now = new Date()
  const map: Record<string, number> = { '5y': 60, '10y': 120, '20y': 240 }
  const m = map[range]; if (!m) return null
  now.setMonth(now.getMonth() - m); return now.toISOString().slice(0, 10)
}

function filterByRange(data: WD[], range: string): WD[] {
  const c = getDateCutoff(range); return c ? data.filter(p => p.date >= c) : data
}

const fmtD = (d: string) => { const dt = new Date(d); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]} '${String(dt.getFullYear()).slice(2)}` }
const lblFmt = (l: unknown) => typeof l === 'string' ? new Date(l).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const TK = { fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }
const TT = { background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }

function QS({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return <>{options.map(r => <button key={r} className={`${styles.qsBtn} ${value === r ? styles.qsBtnActive : ''}`} onClick={() => onChange(r)}>{r.toUpperCase()}</button>)}</>
}

export function UKTradeContent() {
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [balR, setBalR] = useState('10y')
  const [gR, setGR] = useState('10y')
  const [tR, setTR] = useState('10y')

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all(UK_TRADE_SERIES.map(s =>
      fetchOnsSeries(s.cdid, s.dataset).then(d => ({ key: s.cdid.toUpperCase(), data: d })).catch(() => ({ key: s.cdid.toUpperCase(), data: [] as WD[] }))
    )).then(results => {
      const map: Record<string, WD[]> = {}
      results.forEach(r => { map[r.key] = r.data })
      setAllData(map)
      setLoading(false)
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setLoading(false)
    })
  }, [])

  const goodsExpImp = useMemo(() => {
    const exp = filterByRange(allData['BOKG'] || [], gR)
    const imp = filterByRange(allData['BOKH'] || [], gR)
    const dates = new Set([...exp.map(p => p.date), ...imp.map(p => p.date)])
    const eMap = new Map(exp.map(p => [p.date, p.value]))
    const iMap = new Map(imp.map(p => [p.date, p.value]))
    return [...dates].sort().map(d => ({ date: d, exports: eMap.get(d) ?? null, imports: iMap.get(d) ?? null }))
  }, [allData, gR])

  const totalExpImp = useMemo(() => {
    const exp = filterByRange(allData['IKBK'] || [], tR)
    const imp = filterByRange(allData['IKBL'] || [], tR)
    const dates = new Set([...exp.map(p => p.date), ...imp.map(p => p.date)])
    const eMap = new Map(exp.map(p => [p.date, p.value]))
    const iMap = new Map(imp.map(p => [p.date, p.value]))
    return [...dates].sort().map(d => ({ date: d, exports: eMap.get(d) ?? null, imports: iMap.get(d) ?? null }))
  }, [allData, tR])

  const balance = useMemo(() => filterByRange(allData['BOKI'] || [], balR), [allData, balR])

  if (error) return <div style={{ padding: '40px', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}><div style={{ fontWeight: 600 }}>Error loading UK Trade data</div><div style={{ color: '#728197', marginTop: '8px' }}>{error}</div></div>
  if (loading) return <div style={{ padding: '40px', color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>Loading UK Trade data...</div>

  return (
    <>
      <div className={styles.chartSubtitle}>Office for National Statistics · Monthly & Quarterly · Seasonally Adjusted · £m</div>

      {/* Row 1 */}
      <div className={styles.twoColGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartLabel}>Goods Trade Balance</div>
          <div className={styles.chartSub}>SA, £m</div>
          <div className={styles.controlRow}><QS value={balR} onChange={setBalR} options={['5y','10y','20y','max']} /></div>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={balance} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${(v/1000).toFixed(1)}k`} domain={['auto','auto']} />
              <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `£${v.toLocaleString()}m` : '—', 'Balance']} />
              <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
              <Bar dataKey="value" radius={[2, 2, 0, 0]} barSize={3}>
                {balance.map((entry, i) => <Cell key={i} fill={entry.value >= 0 ? '#4ade80' : '#f87171'} />)}
              </Bar>
              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.chartCard}>
          <div className={styles.chartLabel}>Goods Exports & Imports</div>
          <div className={styles.chartSub}>SA, £m</div>
          <div className={styles.controlRow}><QS value={gR} onChange={setGR} options={['5y','10y','20y','max']} /></div>
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#4ade80' }} />Exports</span>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#f87171' }} />Imports</span>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={goodsExpImp} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${(v/1000).toFixed(0)}k`} domain={['auto','auto']} />
              <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `£${v.toLocaleString()}m` : '—', name === 'exports' ? 'Exports' : 'Imports']} />
              <Line type="monotone" dataKey="exports" stroke="#4ade80" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="imports" stroke="#f87171" strokeWidth={2} dot={false} connectNulls={false} />
              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2 */}
      <div className={styles.twoColGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartLabel}>Total Trade (Goods & Services)</div>
          <div className={styles.chartSub}>CVM SA, £m, quarterly</div>
          <div className={styles.controlRow}><QS value={tR} onChange={setTR} options={['5y','10y','20y','max']} /></div>
          <div className={styles.legend}>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#4ade80' }} />Exports</span>
            <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#f87171' }} />Imports</span>
          </div>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={totalExpImp} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${(v/1000).toFixed(0)}k`} domain={['auto','auto']} />
              <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => [typeof v === 'number' ? `£${v.toLocaleString()}m` : '—', name === 'exports' ? 'Exports' : 'Imports']} />
              <Line type="monotone" dataKey="exports" stroke="#4ade80" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="imports" stroke="#f87171" strokeWidth={2} dot={false} connectNulls={false} />
              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}
