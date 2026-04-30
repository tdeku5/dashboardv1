import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposedChart, LineChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { COUNTRIES, CATEGORIES } from './modelNav'
import { fetchFredSeries } from '../lib/fred'
import styles from './ModelsPage.module.css'

// ── Constants ────────────────────────────────────────────────────────────────

const HOUSING_SECTIONS = [
  { key: 'supply', label: 'SUPPLY' },
  { key: 'demand', label: 'DEMAND' },
  { key: 'prices', label: 'PRICES' },
  { key: 'credit', label: 'CREDIT' },
] as const

const HOUSING_SERIES = [
  'HOUST', 'HOUST1F', 'HOUST2F', 'HOUST5F',
  'PERMIT', 'PERMIT1', 'PERMIT24', 'PERMIT5',
  'COMPUTSA', 'COMPU1USA', 'COMPU24USA', 'COMPU5MUSA',
  'UNDCONTSA', 'UNDCON1USA', 'UNDCON24USA', 'UNDCON5MUSA',
  'MSACSR', 'HOSSUPUSM673N',
  'CES2023610001', 'TLRESCONS', 'PRFI', 'A011RA3Q086SBEA',
  'A011RE1Q156NBEA',
  'USSTHPI', 'CSUSHPISA', 'MSPNHSUS', 'CUSR0000SEHC',
  'HSN1F', 'EXHOSLUSM495S', 'RPI', 'MDSP',
  'MORTGAGE30US', 'DGS30', 'DGS10', 'DFF',
  'RREACBW027SBOG', 'RHEACBW027SBOG', 'CRLACBW027SBOG',
  'DRSFRMACBS',
] as const

const SUPPLY_GROUPS = [
  { title: 'HOUSING STARTS', total: 'HOUST', components: [
    { key: 'HOUST1F', label: 'Single Family', color: '#7ba3cc' },
    { key: 'HOUST2F', label: '2-4 Units', color: '#e88e8e' },
    { key: 'HOUST5F', label: '5+ Units', color: '#8cc28c' },
  ]},
  { title: 'BUILDING PERMITS', total: 'PERMIT', components: [
    { key: 'PERMIT1', label: 'Single Family', color: '#7ba3cc' },
    { key: 'PERMIT24', label: '2-4 Units', color: '#e88e8e' },
    { key: 'PERMIT5', label: '5+ Units', color: '#8cc28c' },
  ]},
  { title: 'HOUSING COMPLETIONS', total: 'COMPUTSA', components: [
    { key: 'COMPU1USA', label: 'Single Family', color: '#7ba3cc' },
    { key: 'COMPU24USA', label: '2-4 Units', color: '#e88e8e' },
    { key: 'COMPU5MUSA', label: '5+ Units', color: '#8cc28c' },
  ]},
  { title: 'UNDER CONSTRUCTION', total: 'UNDCONTSA', components: [
    { key: 'UNDCON1USA', label: 'Single Family', color: '#7ba3cc' },
    { key: 'UNDCON24USA', label: '2-4 Units', color: '#e88e8e' },
    { key: 'UNDCON5MUSA', label: '5+ Units', color: '#8cc28c' },
  ]},
] as const

const TK = { fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }
const TT = { background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }
const BX: React.CSSProperties = { border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '3px', background: 'rgba(0, 0, 0, 0.15)', padding: '16px' }
const TI: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: '4px' }
const SUB: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#728197', paddingBottom: '4px' }

type D = { date: string; value: number }

function getDateCutoff(range: string): string | null {
  if (range === 'all') return null
  const now = new Date()
  const mm: Record<string, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24, '5y': 60, '10y': 120 }
  const months = mm[range]; if (!months) return null
  now.setMonth(now.getMonth() - months)
  return now.toISOString().slice(0, 10)
}

function fmtD(date: string) {
  const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
}
function lblFmt(d: unknown) { return typeof d === 'string' ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '' }

function computeMA(s: D[], w: number): Array<{ date: string; value: number | null }> {
  return s.map((p, i) => {
    if (i < w - 1) return { date: p.date, value: null }
    let sum = 0; for (let j = i - w + 1; j <= i; j++) sum += s[j].value
    return { date: p.date, value: sum / w }
  })
}
function computeYoYPctByDate(s: D[]): D[] {
  const map = new Map(s.map(p => [p.date, p.value]))
  return s.map(p => {
    const d = new Date(p.date); d.setFullYear(d.getFullYear() - 1)
    const priorKey = `${d.toISOString().slice(0, 7)}-01`
    const priorVal = map.get(priorKey) ?? map.get(d.toISOString().slice(0, 10))
    if (priorVal == null || priorVal === 0) return null
    return { date: p.date, value: ((p.value / priorVal) - 1) * 100 }
  }).filter((p): p is D => p != null)
}
function computeYoYPct(s: D[]): D[] { return s.slice(12).map((p, i) => ({ date: p.date, value: ((p.value / s[i].value) - 1) * 100 })) }
function computeMoMPct(s: D[]): D[] { return s.slice(1).map((p, i) => ({ date: p.date, value: ((p.value / s[i].value) - 1) * 100 })) }
function computeWeeklyYoY(s: D[]): D[] { return s.slice(52).map((p, i) => ({ date: p.date, value: ((p.value / s[i].value) - 1) * 100 })) }
function computeWeeklyMoM(s: D[]): D[] { return s.slice(4).map((p, i) => ({ date: p.date, value: ((p.value / s[i].value) - 1) * 100 })) }
function computeQoQAnnPct(s: D[]): D[] { return s.slice(1).map((p, i) => ({ date: p.date, value: (Math.pow(p.value / s[i].value, 4) - 1) * 100 })) }
function computeQtrYoYPct(s: D[]): D[] { return s.slice(4).map((p, i) => ({ date: p.date, value: ((p.value / s[i].value) - 1) * 100 })) }
function addMA12<T extends { value: number | null }>(s: T[]): (T & { ma12: number | null })[] {
  return s.map((p, i) => {
    if (i < 11 || p.value == null) return { ...p, ma12: null }
    let sum = 0; for (let j = i - 11; j <= i; j++) { const v = s[j].value; if (v == null) return { ...p, ma12: null }; sum += v }
    return { ...p, ma12: sum / 12 }
  })
}

function filterByRange<T extends { date: string }>(data: T[], range: string): T[] {
  const c = getDateCutoff(range); return c ? data.filter(p => p.date >= c) : data
}

// ── Inline range buttons helper ──────────────────────────────────────────────

function RangeBar({ chartKey, ranges, rangeMap, setRangeMap, children }: {
  chartKey: string; ranges: string[]; rangeMap: Record<string, string>; setRangeMap: React.Dispatch<React.SetStateAction<Record<string, string>>>; children?: ReactNode
}) {
  const cur = rangeMap[chartKey] || '5y'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
      <div style={{ display: 'flex', gap: 0 }}>
        {ranges.map((r, i) => (
          <button key={r} onClick={() => setRangeMap(prev => ({ ...prev, [chartKey]: r }))} style={{
            background: cur === r ? 'rgba(248, 113, 113, 0.08)' : 'transparent',
            border: `1px solid ${cur === r ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`,
            ...(i > 0 ? { borderLeft: 'none' } : {}),
            color: cur === r ? '#f87171' : '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 600, padding: '3px 8px', cursor: 'pointer',
            borderRadius: i === 0 ? '2px 0 0 2px' : i === ranges.length - 1 ? '0 2px 2px 0' : '0',
          }}>{r.toUpperCase()}</button>
        ))}
      </div>
      {children}
    </div>
  )
}

function LookbackInput({ chartKey, lookbackMap, setLookbackMap }: { chartKey: string; lookbackMap: Record<string, number>; setLookbackMap: React.Dispatch<React.SetStateAction<Record<string, number>>> }) {
  const val = lookbackMap[chartKey] || 1
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197' }}>
      <input type="number" min="1" value={val} onChange={(e) => setLookbackMap(prev => ({ ...prev, [chartKey]: Math.max(1, parseInt(e.target.value) || 1) }))}
        style={{ width: '35px', background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', padding: '2px 4px', borderRadius: '2px', textAlign: 'center' }} />
      <span>mo</span>
    </label>
  )
}

const RANGES = ['1y', '2y', '5y', '10y', 'all']

// ── Component ────────────────────────────────────────────────────────────────

export function HousingPage() {
  const [country, setCountry] = useState('us')
  const [section, setSection] = useState<string>('supply')
  const navigate = useNavigate()

  const [housingData, setHousingData] = useState<Record<string, D[]>>({})
  const [housingLoading, setHousingLoading] = useState(true)
  const [rangeMap, setRangeMap] = useState<Record<string, string>>({})
  const [lookbackMap, setLookbackMap] = useState<Record<string, number>>({})
  const [payrollMAWindow, setPayrollMAWindow] = useState(12)

  useEffect(() => {
    Promise.all(
      HOUSING_SERIES.map((s) =>
        fetchFredSeries(s)
          .then((data) => ({ key: s, data: data.map((d) => ({ date: d.date, value: Number(d.value) })).filter((d) => !isNaN(d.value)) }))
          .catch(() => ({ key: s, data: [] as D[] }))
      )
    ).then((results) => {
      const map: Record<string, D[]> = {}
      results.forEach((r) => { map[r.key] = r.data })
      setHousingData(map)
      setHousingLoading(false)
    })
  }, [])

  function gr(k: string) { return rangeMap[k] || '5y' }
  function gl(k: string) { return lookbackMap[k] || 1 }

  // ── Supply group chart data ──────────────────────────────────────────────
  const supplyCharts = useMemo(() => {
    return SUPPLY_GROUPS.map((group) => {
      const rng = gr(group.title)
      const lbk = gl(group.title + '-chg')
      const cutoff = getDateCutoff(rng)
      const totalSeries = housingData[group.total] || []
      const compMaps = group.components.map((c) => ({ key: c.key, map: new Map((housingData[c.key] || []).map((p) => [p.date, p.value])) }))
      const totalMap = new Map(totalSeries.map((p) => [p.date, p.value]))

      const levelData = totalSeries.filter((p) => !cutoff || p.date >= cutoff).map((p) => {
        const pt: Record<string, string | number | null> = { date: p.date, total: p.value }
        compMaps.forEach((c) => { pt[c.key] = c.map.get(p.date) ?? null }); return pt
      })

      const changeData = totalSeries.filter((p) => !cutoff || p.date >= cutoff).map((p) => {
        const fi = totalSeries.findIndex((t) => t.date === p.date); const li = fi - lbk
        if (li < 0) return null; const pd = totalSeries[li].date
        const pt: Record<string, string | number | null> = { date: p.date, totalChg: (totalMap.get(p.date) ?? 0) - (totalMap.get(pd) ?? 0) }
        compMaps.forEach((c) => { pt[c.key] = (c.map.get(p.date) ?? 0) - (c.map.get(pd) ?? 0) }); return pt
      }).filter((p): p is Record<string, string | number | null> => p != null)

      return { group, levelData, changeData }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [housingData, rangeMap, lookbackMap])

  // ── Pipeline spreads ───────────────────────────────────────────────────────
  const permitsVsStarts = useMemo(() => {
    const permits = housingData['PERMIT'] || []; const starts = housingData['HOUST'] || []
    const sm = new Map(starts.map(p => [p.date, p.value]))
    const raw = permits.filter(p => sm.has(p.date)).map(p => ({ date: p.date, value: p.value - sm.get(p.date)! })).sort((a, b) => a.date.localeCompare(b.date))
    return addMA12(raw)
  }, [housingData])

  const completionsVsStarts = useMemo(() => {
    const comps = housingData['COMPUTSA'] || []; const starts = housingData['HOUST'] || []
    const sm = new Map(starts.map(p => [p.date, p.value]))
    const raw = comps.filter(p => sm.has(p.date)).map(p => ({ date: p.date, value: p.value - sm.get(p.date)! })).sort((a, b) => a.date.localeCompare(b.date))
    return addMA12(raw)
  }, [housingData])

  // ── Month's supply ─────────────────────────────────────────────────────────
  const monthsSupply = useMemo(() => {
    const newH = housingData['MSACSR'] || []; const existH = housingData['HOSSUPUSM673N'] || []
    const eMap = new Map(existH.map(p => [p.date, p.value]))
    const dates = new Set([...newH.map(p => p.date), ...existH.map(p => p.date)])
    const nMap = new Map(newH.map(p => [p.date, p.value]))
    return [...dates].sort().map(d => ({ date: d, newHomes: nMap.get(d) ?? null, existingHomes: eMap.get(d) ?? null }))
  }, [housingData])

  // ── Payrolls ───────────────────────────────────────────────────────────────
  const payrollLevel = useMemo(() => housingData['CES2023610001'] || [], [housingData])
  const payrollMoM = useMemo(() => {
    const s = payrollLevel; if (s.length < 2) return []
    const raw = s.slice(1).map((p, i) => ({ date: p.date, value: p.value - s[i].value }))
    return raw.map((p, i) => {
      if (i < payrollMAWindow - 1) return { ...p, ma12: null as number | null }
      let sum = 0; for (let j = i - payrollMAWindow + 1; j <= i; j++) sum += raw[j].value
      return { ...p, ma12: sum / payrollMAWindow }
    })
  }, [payrollLevel, payrollMAWindow])
  const payrollYoY = useMemo(() => computeYoYPct(payrollLevel), [payrollLevel])

  // ── Spending ───────────────────────────────────────────────────────────────
  const spendLevel = useMemo(() => housingData['TLRESCONS'] || [], [housingData])
  const spendYoY = useMemo(() => computeYoYPct(spendLevel), [spendLevel])
  const spendMoM = useMemo(() => computeMoMPct(spendLevel), [spendLevel])

  // ── Residential Investment ─────────────────────────────────────────────────
  const nomInvest = useMemo(() => housingData['PRFI'] || [], [housingData])
  const realInvest = useMemo(() => housingData['A011RE1Q156NBEA'] || [], [housingData])
  const investLevel = useMemo(() => {
    const rm = new Map(realInvest.map(p => [p.date, p.value]))
    return nomInvest.filter(p => rm.has(p.date)).map(p => ({ date: p.date, nominal: p.value, real: rm.get(p.date)! }))
  }, [nomInvest, realInvest])
  const investQoQ = useMemo(() => {
    const nq = computeQoQAnnPct(nomInvest); const rq = computeQoQAnnPct(realInvest)
    const rm = new Map(rq.map(p => [p.date, p.value]))
    return nq.filter(p => rm.has(p.date)).map(p => ({ date: p.date, nominal: p.value, real: rm.get(p.date)! }))
  }, [nomInvest, realInvest])
  const investYoY = useMemo(() => {
    const ny = computeQtrYoYPct(nomInvest); const ry = computeQtrYoYPct(realInvest)
    const rm = new Map(ry.map(p => [p.date, p.value]))
    return ny.filter(p => rm.has(p.date)).map(p => ({ date: p.date, nominal: p.value, real: rm.get(p.date)! }))
  }, [nomInvest, realInvest])

  // ── Demand memos ────────────────────────────────────────────────────────────
  const newHomeSales = useMemo(() => housingData['HSN1F'] || [], [housingData])
  const newHomeSalesMA3 = useMemo(() => computeMA(newHomeSales, 3), [newHomeSales])
  const newHomeSalesLevel = useMemo(() => {
    const ma = newHomeSalesMA3
    return newHomeSales.map((p, i) => ({ date: p.date, raw: p.value, ma3: ma[i]?.value ?? null }))
  }, [newHomeSales, newHomeSalesMA3])
  const newHomeSalesYoY = useMemo(() => computeYoYPctByDate(newHomeSales), [newHomeSales])
  const newHomeSalesMoM = useMemo(() => {
    const mom = computeMoMPct(newHomeSales)
    const ma6 = computeMA(mom, 6)
    return mom.map((p, i) => ({ date: p.date, mom: p.value, ma6: ma6[i]?.value ?? null }))
  }, [newHomeSales])

  const priceIncomeSpread = useMemo(() => {
    const priceYoY = computeYoYPctByDate(housingData['MSPNHSUS'] || [])
    const incomeYoY = computeYoYPctByDate(housingData['RPI'] || [])
    const incomeMap = new Map(incomeYoY.map(p => [p.date, p.value]))
    return priceYoY.filter(p => incomeMap.has(p.date)).map(p => ({ date: p.date, value: p.value - incomeMap.get(p.date)! }))
  }, [housingData])

  const priceIncomeComponents = useMemo(() => {
    const priceYoY = computeYoYPctByDate(housingData['MSPNHSUS'] || [])
    const incomeYoY = computeYoYPctByDate(housingData['RPI'] || [])
    const incomeMap = new Map(incomeYoY.map(p => [p.date, p.value]))
    return priceYoY.filter(p => incomeMap.has(p.date)).map(p => ({ date: p.date, price: p.value, income: incomeMap.get(p.date)! }))
  }, [housingData])

  const priceRentSpread = useMemo(() => {
    const priceYoY = computeYoYPctByDate(housingData['MSPNHSUS'] || [])
    const rentYoY = computeYoYPctByDate(housingData['CUSR0000SEHC'] || [])
    const rentMap = new Map(rentYoY.map(p => [p.date, p.value]))
    return priceYoY.filter(p => rentMap.has(p.date)).map(p => ({ date: p.date, value: p.value - rentMap.get(p.date)! }))
  }, [housingData])

  const priceRentComponents = useMemo(() => {
    const priceYoY = computeYoYPctByDate(housingData['MSPNHSUS'] || [])
    const rentYoY = computeYoYPctByDate(housingData['CUSR0000SEHC'] || [])
    const rentMap = new Map(rentYoY.map(p => [p.date, p.value]))
    return priceYoY.filter(p => rentMap.has(p.date)).map(p => ({ date: p.date, price: p.value, rent: rentMap.get(p.date)! }))
  }, [housingData])

  // ── Prices memos ────────────────────────────────────────────────────────────
  const priceMetricsLevel = useMemo(() => {
    const median = housingData['MSPNHSUS'] || []; const cs = housingData['CSUSHPISA'] || []; const oer = housingData['CUSR0000SEHC'] || []
    const medMap = new Map(median.map(p => [p.date, p.value])); const csMap = new Map(cs.map(p => [p.date, p.value])); const oerMap = new Map(oer.map(p => [p.date, p.value]))
    const dates = new Set<string>(); median.forEach(p => dates.add(p.date)); cs.forEach(p => dates.add(p.date)); oer.forEach(p => dates.add(p.date))
    return [...dates].sort().map(d => ({ date: d, median: medMap.get(d) ?? null, caseShiller: csMap.get(d) ?? null, oer: oerMap.get(d) ?? null }))
  }, [housingData])

  const priceMetricsYoY = useMemo(() => {
    const medYoY = computeYoYPctByDate(housingData['MSPNHSUS'] || []); const csYoY = computeYoYPctByDate(housingData['CSUSHPISA'] || []); const oerYoY = computeYoYPctByDate(housingData['CUSR0000SEHC'] || [])
    const medMap = new Map(medYoY.map(p => [p.date, p.value])); const csMap = new Map(csYoY.map(p => [p.date, p.value])); const oerMap = new Map(oerYoY.map(p => [p.date, p.value]))
    const dates = new Set<string>(); medYoY.forEach(p => dates.add(p.date)); csYoY.forEach(p => dates.add(p.date)); oerYoY.forEach(p => dates.add(p.date))
    return [...dates].sort().map(d => ({ date: d, median: medMap.get(d) ?? null, caseShiller: csMap.get(d) ?? null, oer: oerMap.get(d) ?? null }))
  }, [housingData])

  const priceMetricsMoM = useMemo(() => {
    const medMoM = computeMoMPct(housingData['MSPNHSUS'] || []); const csMoM = computeMoMPct(housingData['CSUSHPISA'] || []); const oerMoM = computeMoMPct(housingData['CUSR0000SEHC'] || [])
    const medMap = new Map(medMoM.map(p => [p.date, p.value])); const csMap = new Map(csMoM.map(p => [p.date, p.value])); const oerMap = new Map(oerMoM.map(p => [p.date, p.value]))
    const dates = new Set<string>(); medMoM.forEach(p => dates.add(p.date)); csMoM.forEach(p => dates.add(p.date)); oerMoM.forEach(p => dates.add(p.date))
    return [...dates].sort().map(d => ({ date: d, median: medMap.get(d) ?? null, caseShiller: csMap.get(d) ?? null, oer: oerMap.get(d) ?? null }))
  }, [housingData])

  // ── Credit memos ────────────────────────────────────────────────────────────
  const ratesData = useMemo(() => {
    const mtg = housingData['MORTGAGE30US'] || []; const t10 = housingData['DGS10'] || []; const ff = housingData['DFF'] || []
    const mtgM = new Map(mtg.map(p => [p.date, p.value])); const t10M = new Map(t10.map(p => [p.date, p.value])); const ffM = new Map(ff.map(p => [p.date, p.value]))
    const dates = new Set<string>(); mtg.forEach(p => dates.add(p.date)); t10.forEach(p => dates.add(p.date)); ff.forEach(p => dates.add(p.date))
    return [...dates].sort().map(d => ({ date: d, mortgage: mtgM.get(d) ?? null, treasury10: t10M.get(d) ?? null, fedFunds: ffM.get(d) ?? null }))
  }, [housingData])

  const mortgageSpread = useMemo(() => {
    const mtg = housingData['MORTGAGE30US'] || []; const t10 = housingData['DGS10'] || []
    const t10M = new Map(t10.map(p => [p.date, p.value]))
    return mtg.filter(p => t10M.has(p.date)).map(p => ({ date: p.date, spread: p.value - t10M.get(p.date)! })).sort((a, b) => a.date.localeCompare(b.date))
  }, [housingData])

  const mortgageSpreadAvg = useMemo(() => {
    if (mortgageSpread.length === 0) return 0
    return mortgageSpread.reduce((s, p) => s + p.spread, 0) / mortgageSpread.length
  }, [mortgageSpread])

  const bankLoansLevel = useMemo(() => {
    const total = housingData['RREACBW027SBOG'] || []; const heloc = housingData['RHEACBW027SBOG'] || []
    let closedEnd = housingData['CRLACBW027SBOG'] || []
    const helocMap = new Map(heloc.map(p => [p.date, p.value]))
    if (closedEnd.length === 0) {
      const totalMap = new Map(total.map(p => [p.date, p.value]))
      closedEnd = heloc.filter(p => totalMap.has(p.date)).map(p => ({ date: p.date, value: totalMap.get(p.date)! - p.value }))
    }
    const closedMap = new Map(closedEnd.map(p => [p.date, p.value]))
    return total.map(p => ({ date: p.date, total: p.value, heloc: helocMap.get(p.date) ?? null, closedEnd: closedMap.get(p.date) ?? null }))
  }, [housingData])

  const bankLoansYoY = useMemo(() => {
    const total = housingData['RREACBW027SBOG'] || []; const heloc = housingData['RHEACBW027SBOG'] || []
    let closedEnd = housingData['CRLACBW027SBOG'] || []
    if (closedEnd.length === 0) {
      const totalMap = new Map(total.map(p => [p.date, p.value]))
      closedEnd = heloc.filter(p => totalMap.has(p.date)).map(p => ({ date: p.date, value: totalMap.get(p.date)! - p.value }))
    }
    const tYoY = computeWeeklyYoY(total); const hYoY = computeWeeklyYoY(heloc); const cYoY = computeWeeklyYoY(closedEnd)
    const hM = new Map(hYoY.map(p => [p.date, p.value])); const cM = new Map(cYoY.map(p => [p.date, p.value]))
    return tYoY.map(p => ({ date: p.date, total: p.value, heloc: hM.get(p.date) ?? null, closedEnd: cM.get(p.date) ?? null }))
  }, [housingData])

  const bankLoansMoM = useMemo(() => {
    const total = housingData['RREACBW027SBOG'] || []; const heloc = housingData['RHEACBW027SBOG'] || []
    let closedEnd = housingData['CRLACBW027SBOG'] || []
    if (closedEnd.length === 0) {
      const totalMap = new Map(total.map(p => [p.date, p.value]))
      closedEnd = heloc.filter(p => totalMap.has(p.date)).map(p => ({ date: p.date, value: totalMap.get(p.date)! - p.value }))
    }
    const tMoM = computeWeeklyMoM(total); const hMoM = computeWeeklyMoM(heloc); const cMoM = computeWeeklyMoM(closedEnd)
    const hM = new Map(hMoM.map(p => [p.date, p.value])); const cM = new Map(cMoM.map(p => [p.date, p.value]))
    return tMoM.map(p => ({ date: p.date, total: p.value, heloc: hM.get(p.date) ?? null, closedEnd: cM.get(p.date) ?? null }))
  }, [housingData])

  // ── Legend helper ──────────────────────────────────────────────────────────
  function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#728197', padding: '4px 0' }}>
        {items.map(it => (
          <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: it.dashed ? '2px' : '10px', borderRadius: '1px', background: it.color, flexShrink: 0 }} />{it.label}
          </span>
        ))}
      </div>
    )
  }

  // ── Simple chart wrapper ───────────────────────────────────────────────────
  function ChartBox({ chartKey, title, subtitle, legend, children }: { chartKey: string; title: string; subtitle?: string; legend?: ReactNode; children: ReactNode }) {
    return (
      <div style={BX}>
        <div style={TI}>{title}</div>
        {subtitle && <div style={SUB}>{subtitle}</div>}
        <RangeBar chartKey={chartKey} ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap} />
        {legend}
        {children}
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}><NavDropdown /><span className={styles.logo}>TND RESEARCH TERMINAL</span></div>
        <div className={styles.barCenter} /><div className={styles.barRight}>{country === 'us' && <FredRefreshButton />}</div>
      </header>

      <main className={styles.body}>
        <div className={styles.countryBar}>
          {COUNTRIES.map((c, i) => (<button key={c.key} className={`${styles.countryBtn} ${country === c.key ? styles.countryBtnActive : ''}`} onClick={() => setCountry(c.key)} style={{ border: `1px solid ${country === c.key ? '#60a5fa' : 'rgba(255, 255, 255, 0.15)'}`, ...(i > 0 ? { borderLeft: 'none' } : {}) }}>{c.label}</button>))}
        </div>
        <div className={styles.categoryBar}>
          {CATEGORIES.map((cat, i) => (<button key={cat.key} className={`${styles.categoryBtn} ${cat.key === 'housing' ? styles.categoryBtnActive : ''}`} onClick={() => { if (cat.key !== 'housing') navigate(cat.path) }} style={{ border: `1px solid ${cat.key === 'housing' ? '#4EC9B0' : 'rgba(255, 255, 255, 0.15)'}`, ...(i > 0 ? { borderLeft: 'none' } : {}) }}>{cat.label}</button>))}
        </div>
        <div className={styles.sectionBar}>
          {HOUSING_SECTIONS.map((sec, i) => (<button key={sec.key} className={`${styles.sectionBtn} ${section === sec.key ? styles.sectionBtnActive : ''}`} onClick={() => setSection(sec.key)} style={{ border: `1px solid ${section === sec.key ? '#f87171' : 'rgba(255, 255, 255, 0.12)'}`, ...(i > 0 ? { borderLeft: 'none' } : {}) }}>{sec.label}</button>))}
        </div>

        {country === 'us' ? (
          <>
            {section === 'supply' && (
              <div>
                {housingLoading ? (
                  <div style={{ color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '40px 0', textAlign: 'center' }}>Loading housing data...</div>
                ) : (
                  <>
                    {/* ═══ Rows 1-4: Stacked area + change pairs ═══ */}
                    {supplyCharts.map(({ group, levelData, changeData }) => (
                      <div key={group.title} className={styles.housingGrid}>
                        <div style={BX}>
                          <div style={TI}>{group.title}</div>
                          <RangeBar chartKey={group.title} ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap} />
                          <Legend items={[...group.components.map(c => ({ label: c.label, color: c.color })), { label: 'Total', color: '#e2e8f0', dashed: true }]} />
                          <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={levelData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                              <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                              <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => v.toLocaleString()} domain={[0, 'auto']} />
                              <Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                              {group.components.map(c => (<Area key={c.key} type="monotone" dataKey={c.key} stackId="l" fill={c.color} fillOpacity={0.7} stroke={c.color} strokeWidth={0.5} dot={false} name={c.label} />))}
                              <Line type="monotone" dataKey="total" stroke="#e2e8f0" strokeWidth={2} dot={false} name="Total" />
                              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                        <div style={BX}>
                          <div style={TI}>{group.title}</div>
                          <RangeBar chartKey={group.title + '-chg'} ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap}>
                            <LookbackInput chartKey={group.title + '-chg'} lookbackMap={lookbackMap} setLookbackMap={setLookbackMap} />
                          </RangeBar>
                          <div style={SUB}>{gl(group.title + '-chg')}mo Δ</div>
                          <Legend items={[...group.components.map(c => ({ label: c.label, color: c.color })), { label: 'Total', color: '#e2e8f0', dashed: true }]} />
                          <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={changeData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
                              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                              <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                              <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} />
                              <Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                              {group.components.map(c => (<Bar key={c.key} dataKey={c.key} stackId="c" fill={c.color} fillOpacity={0.7} name={c.label} />))}
                              <Line type="monotone" dataKey="totalChg" stroke="#e2e8f0" strokeWidth={2} dot={false} name="Total" />
                              <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}

                    {/* ═══ Row 5: Pipeline spreads ═══ */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pvs" title="PERMITS VS STARTS" legend={<Legend items={[{ label: 'Spread', color: '#e8a87c', dashed: true }, { label: '12mo MA', color: '#7ba3cc' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(permitsVsStarts, gr('pvs'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#e8a87c" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Spread" />
                            <Line type="monotone" dataKey="ma12" stroke="#7ba3cc" strokeWidth={2} dot={false} name="12mo MA" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="cvs" title="COMPLETIONS VS STARTS" legend={<Legend items={[{ label: 'Spread', color: '#8cc28c', dashed: true }, { label: '12mo MA', color: '#7ba3cc' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(completionsVsStarts, gr('cvs'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#8cc28c" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Spread" />
                            <Line type="monotone" dataKey="ma12" stroke="#7ba3cc" strokeWidth={2} dot={false} name="12mo MA" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>

                    {/* ═══ Row 6: Month's Supply ═══ */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="msup" title="MONTH'S SUPPLY" legend={<Legend items={[{ label: 'New Homes', color: '#ef5350' }, { label: 'Existing Homes', color: '#c4b5fd' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(monthsSupply, gr('msup'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line type="monotone" dataKey="newHomes" stroke="#ef5350" strokeWidth={1.5} dot={false} connectNulls name="New Homes" />
                            <Line type="monotone" dataKey="existingHomes" stroke="#c4b5fd" strokeWidth={1.5} dot={false} connectNulls name="Existing Homes" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <div />
                    </div>

                    {/* ═══ Rows 7-8: Payrolls ═══ */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pay-l" title="RESIDENTIAL CONSTRUCTION PAYROLLS" subtitle="Thousands, SA" legend={<Legend items={[{ label: 'Level', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(payrollLevel, gr('pay-l'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line type="monotone" dataKey="value" stroke="#8cc28c" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="pay-m" title="RESIDENTIAL CONSTRUCTION PAYROLLS" subtitle="1mo Δ" legend={
                        <>
                          <Legend items={[{ label: 'm/m', color: '#7ba3cc' }, { label: `${payrollMAWindow}mo MA`, color: '#e8a87c' }]} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#728197', marginBottom: '4px' }}>
                            <span>MA:</span>
                            <input type="number" min="1" value={payrollMAWindow} onChange={(e) => setPayrollMAWindow(Math.max(1, parseInt(e.target.value) || 12))}
                              style={{ width: '35px', background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', padding: '2px 4px', borderRadius: '2px', textAlign: 'center' }} />
                            <span>mo</span>
                          </label>
                        </>
                      }>
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={filterByRange(payrollMoM, gr('pay-m'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Bar dataKey="value" fill="#7ba3cc" fillOpacity={0.5} name="m/m" />
                            <Line type="monotone" dataKey="ma12" stroke="#e8a87c" strokeWidth={2} dot={false} name="12mo MA" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pay-y" title="RESIDENTIAL CONSTRUCTION PAYROLLS" subtitle="y/y %Δ" legend={<Legend items={[{ label: 'YoY %', color: '#c4b5fd' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(payrollYoY, gr('pay-y'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#c4b5fd" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <div />
                    </div>

                    {/* ═══ Rows 9-10: Spending ═══ */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="sp-l" title="RESIDENTIAL CONSTRUCTION SPENDING" subtitle="Millions $, SAAR" legend={<Legend items={[{ label: 'Level', color: '#7ba3cc' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(spendLevel, gr('sp-l'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line type="monotone" dataKey="value" stroke="#7ba3cc" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="sp-y" title="RESIDENTIAL CONSTRUCTION SPENDING" subtitle="y/y %Δ" legend={<Legend items={[{ label: 'YoY %', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(spendYoY, gr('sp-y'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#8cc28c" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="sp-m" title="RESIDENTIAL CONSTRUCTION SPENDING" subtitle="m/m %Δ" legend={<Legend items={[{ label: 'MoM %', color: '#c4b5fd' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(spendMoM, gr('sp-m'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#c4b5fd" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <div />
                    </div>

                    {/* ═══ Rows 11-12: Residential Investment ═══ */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="ri-l" title="RESIDENTIAL INVESTMENT" subtitle="Billions $, SAAR" legend={<Legend items={[{ label: 'Nominal', color: '#7ba3cc' }, { label: 'Real (r)', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(investLevel, gr('ri-l'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis yAxisId="left" stroke="#7ba3cc" tick={{ ...TK, fill: '#7ba3cc' }} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} />
                            <YAxis yAxisId="right" orientation="right" stroke="#8cc28c" tick={{ ...TK, fill: '#8cc28c' }} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} />
                            <Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line yAxisId="left" type="monotone" dataKey="nominal" stroke="#7ba3cc" strokeWidth={1.5} dot={false} name="Nominal" />
                            <Line yAxisId="right" type="monotone" dataKey="real" stroke="#8cc28c" strokeWidth={1.5} dot={false} name="Real" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="ri-q" title="RESIDENTIAL INVESTMENT" subtitle="annualized q/q %Δ" legend={<Legend items={[{ label: 'Nominal', color: '#7ba3cc' }, { label: 'Real', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(investQoQ, gr('ri-q'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="nominal" stroke="#7ba3cc" strokeWidth={1.5} dot={false} name="Nominal" />
                            <Line type="monotone" dataKey="real" stroke="#8cc28c" strokeWidth={1.5} dot={false} name="Real" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="ri-y" title="RESIDENTIAL INVESTMENT" subtitle="y/y %Δ" legend={<Legend items={[{ label: 'Nominal', color: '#7ba3cc' }, { label: 'Real', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(investYoY, gr('ri-y'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="nominal" stroke="#7ba3cc" strokeWidth={1.5} dot={false} name="Nominal" />
                            <Line type="monotone" dataKey="real" stroke="#8cc28c" strokeWidth={1.5} dot={false} name="Real" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <div />
                    </div>
                  </>
                )}
              </div>
            )}
            {section === 'demand' && (
              <div>
                {housingLoading ? (
                  <div style={{ color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '40px 0', textAlign: 'center' }}>Loading housing data...</div>
                ) : (
                  <>
                    {/* Row 1: New Home Sales Level + YoY */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="nhs-l" title="NEW HOME SALES" subtitle="Thousands, SAAR" legend={<Legend items={[{ label: 'New Home Sales', color: '#c4b5fd', dashed: true }, { label: '3mo MA', color: '#e88e8e' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(newHomeSalesLevel, gr('nhs-l'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line type="monotone" dataKey="raw" stroke="#c4b5fd" strokeWidth={1} strokeDasharray="3 3" dot={false} name="New Home Sales" />
                            <Line type="monotone" dataKey="ma3" stroke="#e88e8e" strokeWidth={2} dot={false} connectNulls name="3mo MA" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="nhs-y" title="NEW HOME SALES" subtitle="y/y %Δ" legend={<Legend items={[{ label: 'YoY %', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(newHomeSalesYoY, gr('nhs-y'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#8cc28c" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>

                    {/* Row 2: New Home Sales MoM */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="nhs-m" title="NEW HOME SALES" subtitle="m/m %Δ" legend={<Legend items={[{ label: 'MoM %', color: '#c4b5fd', dashed: true }, { label: '6mo MA', color: '#e8a87c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(newHomeSalesMoM, gr('nhs-m'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="mom" stroke="#c4b5fd" strokeWidth={1} strokeDasharray="3 3" dot={false} name="MoM %" />
                            <Line type="monotone" dataKey="ma6" stroke="#e8a87c" strokeWidth={2} dot={false} connectNulls name="6mo MA" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <div />
                    </div>

                    {/* Row 3: Price/Income */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pi-s" title="PRICE / INCOME" subtitle="YoY % spread (price − income)" legend={<Legend items={[{ label: 'Spread', color: '#c4b5fd' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceIncomeSpread, gr('pi-s'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#c4b5fd" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="pi-c" title="PRICE / INCOME" subtitle="y/y %Δ components" legend={<Legend items={[{ label: 'Real Personal Income y/y', color: '#7ba3cc' }, { label: 'Median Price y/y', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceIncomeComponents, gr('pi-c'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="income" stroke="#7ba3cc" strokeWidth={1.5} dot={false} name="Real Personal Income y/y" />
                            <Line type="monotone" dataKey="price" stroke="#8cc28c" strokeWidth={1.5} dot={false} name="Median Price y/y" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>

                    {/* Row 4: Price/Rent */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pr-s" title="PRICE / RENT" subtitle="YoY % spread (price − rent)" legend={<Legend items={[{ label: 'Spread', color: '#e8a87c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceRentSpread, gr('pr-s'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="value" stroke="#e8a87c" strokeWidth={1.5} dot={false} />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="pr-c" title="PRICE / RENT" subtitle="y/y %Δ components" legend={<Legend items={[{ label: 'OER CPI y/y', color: '#e8a87c' }, { label: 'Median Price y/y', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceRentComponents, gr('pr-c'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="rent" stroke="#e8a87c" strokeWidth={1.5} dot={false} name="OER CPI y/y" />
                            <Line type="monotone" dataKey="price" stroke="#8cc28c" strokeWidth={1.5} dot={false} name="Median Price y/y" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                  </>
                )}
              </div>
            )}
            {section === 'prices' && (
              <div>
                {housingLoading ? (
                  <div style={{ color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '40px 0', textAlign: 'center' }}>Loading housing data...</div>
                ) : (
                  <>
                    {/* Level — full width, dual axis */}
                    <div style={{ ...BX, marginBottom: '16px' }}>
                      <div style={TI}>HOME PRICE METRICS</div>
                      <RangeBar chartKey="pm-l" ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap} />
                      <Legend items={[{ label: 'Median Price', color: '#7ba3cc' }, { label: 'Case-Shiller (r)', color: '#e88e8e' }, { label: 'OER CPI (r)', color: '#8cc28c' }]} />
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={filterByRange(priceMetricsLevel, gr('pm-l'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                          <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis yAxisId="left" stroke="#7ba3cc" tick={{ ...TK, fill: '#7ba3cc' }} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} />
                          <YAxis yAxisId="right" orientation="right" stroke="#94A3B8" tick={TK} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                          <Line yAxisId="left" type="monotone" dataKey="median" stroke="#7ba3cc" strokeWidth={1.5} dot={false} connectNulls name="Median Price" />
                          <Line yAxisId="right" type="monotone" dataKey="caseShiller" stroke="#e88e8e" strokeWidth={1.5} dot={false} connectNulls name="Case-Shiller (r)" />
                          <Line yAxisId="right" type="monotone" dataKey="oer" stroke="#8cc28c" strokeWidth={1.5} dot={false} connectNulls name="OER CPI (r)" />
                          <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* YoY + MoM side by side */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="pm-y" title="HOME PRICE METRICS" subtitle="y/y %Δ" legend={<Legend items={[{ label: 'Median Price', color: '#7ba3cc' }, { label: 'Case-Shiller', color: '#e88e8e' }, { label: 'OER CPI', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceMetricsYoY, gr('pm-y'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="median" stroke="#7ba3cc" strokeWidth={1.5} dot={false} connectNulls name="Median Price" />
                            <Line type="monotone" dataKey="caseShiller" stroke="#e88e8e" strokeWidth={1.5} dot={false} connectNulls name="Case-Shiller" />
                            <Line type="monotone" dataKey="oer" stroke="#8cc28c" strokeWidth={1.5} dot={false} connectNulls name="OER CPI" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="pm-m" title="HOME PRICE METRICS" subtitle="m/m %Δ" legend={<Legend items={[{ label: 'Median Price', color: '#7ba3cc' }, { label: 'Case-Shiller', color: '#e88e8e' }, { label: 'OER CPI', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(priceMetricsMoM, gr('pm-m'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Line type="monotone" dataKey="median" stroke="#7ba3cc" strokeWidth={1.5} dot={false} connectNulls name="Median Price" />
                            <Line type="monotone" dataKey="caseShiller" stroke="#e88e8e" strokeWidth={1.5} dot={false} connectNulls name="Case-Shiller" />
                            <Line type="monotone" dataKey="oer" stroke="#8cc28c" strokeWidth={1.5} dot={false} connectNulls name="OER CPI" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                  </>
                )}
              </div>
            )}
            {section === 'credit' && (
              <div>
                {housingLoading ? (
                  <div style={{ color: '#728197', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '40px 0', textAlign: 'center' }}>Loading housing data...</div>
                ) : (
                  <>
                    {/* Interest Rates — full width */}
                    <div style={{ ...BX, marginBottom: '16px' }}>
                      <div style={TI}>INTEREST RATES</div>
                      <RangeBar chartKey="cr-rates" ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap} />
                      <Legend items={[{ label: '30y Mortgage Rate', color: '#e88e8e' }, { label: '10y Treasury Yield', color: '#8cc28c' }, { label: 'Fed Funds Rate', color: '#7ba3cc' }]} />
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={filterByRange(ratesData, gr('cr-rates'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                          <Line type="monotone" dataKey="mortgage" stroke="#e88e8e" strokeWidth={1.5} dot={false} connectNulls name="30y Mortgage Rate" />
                          <Line type="monotone" dataKey="treasury10" stroke="#8cc28c" strokeWidth={1.5} dot={false} connectNulls name="10y Treasury Yield" />
                          <Line type="monotone" dataKey="fedFunds" stroke="#7ba3cc" strokeWidth={1.5} dot={false} connectNulls name="Fed Funds Rate" />
                          <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Mortgage Spread — full width */}
                    <div style={{ ...BX, marginBottom: '16px' }}>
                      <div style={TI}>MORTGAGE SPREADS</div>
                      <RangeBar chartKey="cr-mspread" ranges={RANGES} rangeMap={rangeMap} setRangeMap={setRangeMap} />
                      <Legend items={[{ label: '30y Mortgage − 10y Treasury', color: '#e8a87c' }, { label: 'Average', color: '#e8a87c', dashed: true }]} />
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={filterByRange(mortgageSpread, gr('cr-mspread'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                          <ReferenceLine y={mortgageSpreadAvg} stroke="#e8a87c" strokeDasharray="6 4" strokeWidth={1} label={{ value: `Avg: ${mortgageSpreadAvg.toFixed(2)}%`, position: 'insideTopRight', fill: '#e8a87c', fontSize: 10, fontWeight: 600 }} />
                          <Line type="monotone" dataKey="spread" stroke="#e8a87c" strokeWidth={1.5} dot={false} name="Spread" />
                          <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Bank Loans Level — grid */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="cr-bl-stack" title="BANK LOANS — RESIDENTIAL REAL ESTATE" subtitle="$ billions" legend={<Legend items={[{ label: 'HELOCs', color: '#8cc28c' }, { label: 'Closed-End Loans', color: '#7ba3cc' }, { label: 'Total', color: '#e2e8f0', dashed: true }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={filterByRange(bankLoansLevel, gr('cr-bl-stack'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => v.toLocaleString()} domain={[0, 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Area type="monotone" dataKey="heloc" stackId="loans" fill="#8cc28c" fillOpacity={0.7} stroke="#8cc28c" strokeWidth={0.5} dot={false} name="HELOCs" />
                            <Area type="monotone" dataKey="closedEnd" stackId="loans" fill="#7ba3cc" fillOpacity={0.7} stroke="#7ba3cc" strokeWidth={0.5} dot={false} name="Closed-End Loans" />
                            <Line type="monotone" dataKey="total" stroke="#e2e8f0" strokeWidth={2} dot={false} name="Total" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="cr-bl-line" title="BANK LOANS — RESIDENTIAL REAL ESTATE" subtitle="$ billions" legend={<Legend items={[{ label: 'Total', color: '#e2e8f0' }, { label: 'Closed-End Loans', color: '#7ba3cc' }, { label: 'HELOCs (r)', color: '#8cc28c' }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={filterByRange(bankLoansLevel, gr('cr-bl-line'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis yAxisId="left" stroke="#728197" tick={TK} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} />
                            <YAxis yAxisId="right" orientation="right" stroke="#8cc28c" tick={{ ...TK, fill: '#8cc28c' }} tickFormatter={(v: number) => v.toLocaleString()} domain={['auto', 'auto']} />
                            <Tooltip contentStyle={TT} labelFormatter={lblFmt} />
                            <Line yAxisId="left" type="monotone" dataKey="total" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls name="Total" />
                            <Line yAxisId="left" type="monotone" dataKey="closedEnd" stroke="#7ba3cc" strokeWidth={1.5} dot={false} connectNulls name="Closed-End Loans" />
                            <Line yAxisId="right" type="monotone" dataKey="heloc" stroke="#8cc28c" strokeWidth={1.5} dot={false} connectNulls name="HELOCs (r)" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>

                    {/* Bank Loans YoY + MoM — grid */}
                    <div className={styles.housingGrid}>
                      <ChartBox chartKey="cr-bl-yoy" title="BANK LOANS — RESIDENTIAL REAL ESTATE" subtitle="y/y %Δ (52wk)" legend={<Legend items={[{ label: 'HELOCs', color: '#8cc28c' }, { label: 'Closed-End', color: '#7ba3cc' }, { label: 'Total', color: '#e2e8f0', dashed: true }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={filterByRange(bankLoansYoY, gr('cr-bl-yoy'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Bar dataKey="heloc" stackId="yoy" fill="#8cc28c" fillOpacity={0.7} name="HELOCs" />
                            <Bar dataKey="closedEnd" stackId="yoy" fill="#7ba3cc" fillOpacity={0.7} name="Closed-End" />
                            <Line type="monotone" dataKey="total" stroke="#e2e8f0" strokeWidth={2} dot={false} name="Total" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartBox>
                      <ChartBox chartKey="cr-bl-mom" title="BANK LOANS — RESIDENTIAL REAL ESTATE" subtitle="m/m %Δ (4wk)" legend={<Legend items={[{ label: 'HELOCs', color: '#8cc28c' }, { label: 'Closed-End', color: '#7ba3cc' }, { label: 'Total', color: '#e2e8f0', dashed: true }]} />}>
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={filterByRange(bankLoansMoM, gr('cr-bl-mom'))} margin={{ top: 8, right: 16, left: 8, bottom: 4 }} stackOffset="sign">
                            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={50} />
                            <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} /><Tooltip contentStyle={TT} labelFormatter={lblFmt} /><ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                            <Bar dataKey="heloc" stackId="mom" fill="#8cc28c" fillOpacity={0.7} name="HELOCs" />
                            <Bar dataKey="closedEnd" stackId="mom" fill="#7ba3cc" fillOpacity={0.7} name="Closed-End" />
                            <Line type="monotone" dataKey="total" stroke="#e2e8f0" strokeWidth={2} dot={false} name="Total" />
                            <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </ChartBox>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className={styles.comingSoon}>{COUNTRIES.find((c) => c.key === country)?.label} housing models coming soon</div>
        )}
      </main>
    </div>
  )
}
