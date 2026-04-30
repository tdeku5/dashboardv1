import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, BarChart, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Brush, ReferenceLine, ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './IPExplorerDashboardPage.module.css'

// ── Hierarchy ────────────────────────────────────────────────────────────────

interface IPLineItem {
  label: string
  indent: number
  seriesId: string
  weightSeriesId: string
}

const IP_HIERARCHY: IPLineItem[] = [
  { label: 'Total Index', indent: 0, seriesId: 'INDPRO', weightSeriesId: 'RIWB50030S' },
  { label: 'Final Products & Nonindustrial Supplies', indent: 1, seriesId: 'IPFPNSS', weightSeriesId: 'RIWB51000S' },
  { label: 'Consumer Goods', indent: 2, seriesId: 'IPCONGD', weightSeriesId: 'RIWB51100S' },
  { label: 'Durable Consumer Goods', indent: 3, seriesId: 'IPDCONGD', weightSeriesId: 'RIWB51110S' },
  { label: 'Automotive products', indent: 4, seriesId: 'IPB51110S', weightSeriesId: 'RIWB51110S' },
  { label: 'Computers, video & audio equipment', indent: 4, seriesId: 'IPB51121S', weightSeriesId: 'RIWB51121S' },
  { label: 'Appliances, furniture & carpeting', indent: 4, seriesId: 'IPB51122S', weightSeriesId: 'RIWB51122S' },
  { label: 'Miscellaneous durable consumer goods', indent: 4, seriesId: 'IPB51123S', weightSeriesId: 'RIWB51123S' },
  { label: 'Nondurable Consumer Goods', indent: 3, seriesId: 'IPNCONGD', weightSeriesId: 'RIWB51200S' },
  { label: 'Foods & tobacco', indent: 4, seriesId: 'IPB51210S', weightSeriesId: 'RIWB51210S' },
  { label: 'Clothing', indent: 4, seriesId: 'IPB51211S', weightSeriesId: 'RIWB51211S' },
  { label: 'Chemical products', indent: 4, seriesId: 'IPB51212S', weightSeriesId: 'RIWB51212S' },
  { label: 'Paper products', indent: 4, seriesId: 'IPB51213S', weightSeriesId: 'RIWB51213S' },
  { label: 'Energy products', indent: 4, seriesId: 'IPB51214S', weightSeriesId: 'RIWB51214S' },
  { label: 'Other nondurable consumer goods', indent: 4, seriesId: 'IPB51220S', weightSeriesId: 'RIWB51220S' },
  { label: 'Business Equipment', indent: 2, seriesId: 'IPBUSEQ', weightSeriesId: 'RIWB52100S' },
  { label: 'Transit equipment', indent: 3, seriesId: 'IPB52110S', weightSeriesId: 'RIWB52110S' },
  { label: 'Information processing equipment', indent: 3, seriesId: 'IPB52120S', weightSeriesId: 'RIWB52120S' },
  { label: 'Industrial & other equipment', indent: 3, seriesId: 'IPB52130S', weightSeriesId: 'RIWB52130S' },
  { label: 'Defense & space equipment', indent: 3, seriesId: 'IPB52300S', weightSeriesId: 'RIWB52300S' },
  { label: 'Construction Supplies', indent: 2, seriesId: 'IPB54100S', weightSeriesId: 'RIWB54100S' },
  { label: 'Business Supplies', indent: 2, seriesId: 'IPB54200S', weightSeriesId: 'RIWB54200S' },
  { label: 'Materials', indent: 1, seriesId: 'IPMAT', weightSeriesId: 'RIWB53000S' },
  { label: 'Non-energy Materials', indent: 2, seriesId: 'IPZ53010S', weightSeriesId: 'RIWZ53010S' },
  { label: 'Durable goods materials', indent: 3, seriesId: 'IPDMAT', weightSeriesId: 'RIWB53100S' },
  { label: 'Consumer parts', indent: 4, seriesId: 'IPB53110S', weightSeriesId: 'RIWB53110S' },
  { label: 'Equipment parts', indent: 4, seriesId: 'IPB53120S', weightSeriesId: 'RIWB53120S' },
  { label: 'Other durable materials', indent: 4, seriesId: 'IPB53130S', weightSeriesId: 'RIWB53130S' },
  { label: 'Nondurable goods materials', indent: 3, seriesId: 'IPNMAT', weightSeriesId: 'RIWB53200S' },
  { label: 'Textile materials', indent: 4, seriesId: 'IPB53210S', weightSeriesId: 'RIWB53210S' },
  { label: 'Paper materials', indent: 4, seriesId: 'IPB53220S', weightSeriesId: 'RIWB53220S' },
  { label: 'Chemical materials', indent: 4, seriesId: 'IPB53230S', weightSeriesId: 'RIWB53230S' },
  { label: 'Energy materials', indent: 2, seriesId: 'IPB53300S', weightSeriesId: 'RIWB53300S' },
]

// ── Contribution components ──────────────────────────────────────────────────

const CONTRIB_COMPONENTS = [
  { key: 'consumer',      label: 'Consumer Goods',      levelId: 'IPCONGD',   weightId: 'RIWB51100S', color: '#60a5fa' },
  { key: 'busEquip',      label: 'Business Equipment',  levelId: 'IPBUSEQ',   weightId: 'RIWB52100S', color: '#4ade80' },
  { key: 'defense',       label: 'Defense & Space',     levelId: 'IPB52300S', weightId: 'RIWB52300S', color: '#a78bfa' },
  { key: 'construction',  label: 'Construction Supplies', levelId: 'IPB54100S', weightId: 'RIWB54100S', color: '#fb923c' },
  { key: 'busSup',        label: 'Business Supplies',   levelId: 'IPB54200S', weightId: 'RIWB54200S', color: '#f87171' },
  { key: 'nonEnergy',     label: 'Non-Energy Materials', levelId: 'IPZ53010S', weightId: 'RIWZ53010S', color: '#93c5fd' },
  { key: 'energy',        label: 'Energy Materials',    levelId: 'IPB53300S', weightId: 'RIWB53300S', color: '#fbbf24' },
] as const

const CONTRIB_SERIES_IDS = [
  'INDPRO',
  ...CONTRIB_COMPONENTS.flatMap(c => [c.levelId, c.weightId]),
]

// ── Helpers ──────────────────────────────────────────────────────────────────

type WD = { date: string; value: number }

function parseObs(obs: FredObservation[]): WD[] {
  return obs.map(o => ({ date: o.date, value: Number(o.value) })).filter(o => !isNaN(o.value))
}

function getDateCutoff(range: string): string | null {
  if (range === 'max') return null
  const now = new Date()
  const map: Record<string, number> = { '5y': 60, '10y': 120, '20y': 240 }
  const m = map[range]; if (!m) return null
  now.setMonth(now.getMonth() - m); return now.toISOString().slice(0, 10)
}

function sma(data: number[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += data[j]
    return sum / window
  })
}

const fmtD = (date: string) => { const d = new Date(date); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` }
const lblFmt = (label: unknown) => typeof label === 'string' ? new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const TK = { fontSize: 10, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }
const TT = { background: '#0d1520', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }

type Regime = 'expansion' | 'contraction' | 'neutral'
const REGIME_FILL: Record<Regime, string> = {
  expansion: 'rgba(74, 222, 128, 0.15)',
  contraction: 'rgba(248, 113, 113, 0.15)',
  neutral: 'rgba(250, 204, 21, 0.15)',
}

const QS = ['5y', '10y', '20y', 'max'] as const

function QuickSelects({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      {QS.map(r => (
        <button key={r} className={`${styles.qsBtn} ${value === r ? styles.qsBtnActive : ''}`} onClick={() => onChange(r)}>{r.toUpperCase()}</button>
      ))}
    </>
  )
}

// ── Content component ────────────────────────────────────────────────────────

export function IPExplorerDashboardContent() {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [data, setData] = useState<WD[]>([])
  const [weightData, setWeightData] = useState<WD[]>([])
  const [loading, setLoading] = useState(false)

  // Per-chart range state
  const [levelRange, setLevelRange] = useState('10y')
  const [yoyRange, setYoyRange] = useState('10y')
  const [accelRange, setAccelRange] = useState('10y')
  const [momRange, setMomRange] = useState('10y')
  const [annMomRange, setAnnMomRange] = useState('10y')

  // Chart-specific inputs
  const [regimeMA, setRegimeMA] = useState(6)
  const [accelLookback, setAccelLookback] = useState(1)
  const [ma1, setMa1] = useState(3)
  const [ma2, setMa2] = useState(6)

  // Contribution chart state
  const [contribData, setContribData] = useState<Record<string, WD[]>>({})
  const [contribLoading, setContribLoading] = useState(true)
  const [contribYoyRange, setContribYoyRange] = useState('10y')
  const [contribMomRange, setContribMomRange] = useState('5y')

  const selectedItem = IP_HIERARCHY[selectedIdx]

  // Fetch all contribution series on mount
  useEffect(() => {
    setContribLoading(true)
    const unique = [...new Set(CONTRIB_SERIES_IDS)]
    Promise.all(unique.map(id =>
      fetchFredSeries(id).then(d => ({ id, data: parseObs(d) })).catch(() => ({ id, data: [] as WD[] }))
    )).then(results => {
      const map: Record<string, WD[]> = {}
      results.forEach(r => { map[r.id] = r.data })
      setContribData(map)
      setContribLoading(false)
    })
  }, [])

  // Fetch explorer series when selection changes
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchFredSeries(selectedItem.seriesId).then(parseObs).catch(() => [] as WD[]),
      fetchFredSeries(selectedItem.weightSeriesId).then(parseObs).catch(() => [] as WD[]),
    ]).then(([d, w]) => { setData(d); setWeightData(w); setLoading(false) })
  }, [selectedItem.seriesId, selectedItem.weightSeriesId])

  const latestWeight = useMemo(() => {
    if (weightData.length === 0) return null
    const s = [...weightData].sort((a, b) => a.date.localeCompare(b.date))
    return s[s.length - 1].value
  }, [weightData])

  // ── Contribution chart data ──
  const contribYoyData = useMemo(() => {
    const indpro = [...(contribData['INDPRO'] || [])].sort((a, b) => a.date.localeCompare(b.date))
    if (indpro.length <= 12) return []
    // Build date-indexed maps for each component
    const levelMaps = CONTRIB_COMPONENTS.map(c => {
      const sorted = [...(contribData[c.levelId] || [])].sort((a, b) => a.date.localeCompare(b.date))
      return new Map(sorted.map(p => [p.date, p.value]))
    })
    const weightMaps = CONTRIB_COMPONENTS.map(c => {
      const sorted = [...(contribData[c.weightId] || [])].sort((a, b) => a.date.localeCompare(b.date))
      return new Map(sorted.map(p => [p.date, p.value]))
    })
    // Use INDPRO dates as the date axis (12 month offset)
    const cutoff = getDateCutoff(contribYoyRange)
    return indpro.slice(12).map((p, idx) => {
      const d = p.date; const pd = indpro[idx].date
      if (cutoff && d < cutoff) return null
      const totalYoy = indpro[idx].value !== 0 ? ((p.value / indpro[idx].value) - 1) * 100 : 0
      const row: Record<string, number | string> = { date: d, total: totalYoy }
      CONTRIB_COMPONENTS.forEach((c, ci) => {
        const cur = levelMaps[ci].get(d); const prev = levelMaps[ci].get(pd)
        const w = weightMaps[ci].get(d)
        if (cur != null && prev != null && prev !== 0 && w != null) {
          row[c.key] = ((cur / prev) - 1) * 100 * (w / 100)
        } else {
          row[c.key] = 0
        }
      })
      return row
    }).filter((r): r is NonNullable<typeof r> => r != null)
  }, [contribData, contribYoyRange])

  const contribMomData = useMemo(() => {
    const indpro = [...(contribData['INDPRO'] || [])].sort((a, b) => a.date.localeCompare(b.date))
    if (indpro.length <= 1) return []
    const levelMaps = CONTRIB_COMPONENTS.map(c => {
      const sorted = [...(contribData[c.levelId] || [])].sort((a, b) => a.date.localeCompare(b.date))
      return new Map(sorted.map(p => [p.date, p.value]))
    })
    const weightMaps = CONTRIB_COMPONENTS.map(c => {
      const sorted = [...(contribData[c.weightId] || [])].sort((a, b) => a.date.localeCompare(b.date))
      return new Map(sorted.map(p => [p.date, p.value]))
    })
    const cutoff = getDateCutoff(contribMomRange)
    return indpro.slice(1).map((p, idx) => {
      const d = p.date; const pd = indpro[idx].date
      if (cutoff && d < cutoff) return null
      const totalMom = indpro[idx].value !== 0 ? ((p.value / indpro[idx].value) - 1) * 100 : 0
      const row: Record<string, number | string> = { date: d, total: totalMom }
      CONTRIB_COMPONENTS.forEach((c, ci) => {
        const cur = levelMaps[ci].get(d); const prev = levelMaps[ci].get(pd)
        const w = weightMaps[ci].get(d)
        if (cur != null && prev != null && prev !== 0 && w != null) {
          row[c.key] = ((cur / prev) - 1) * 100 * (w / 100)
        } else {
          row[c.key] = 0
        }
      })
      return row
    }).filter((r): r is NonNullable<typeof r> => r != null)
  }, [contribData, contribMomRange])

  // ── Derived data (unfiltered) ──
  const sorted = useMemo(() => [...data].sort((a, b) => a.date.localeCompare(b.date)), [data])

  // Level
  const levelCutoff = getDateCutoff(levelRange)
  const levelData = useMemo(() => levelCutoff ? sorted.filter(p => p.date >= levelCutoff) : sorted, [sorted, levelCutoff])

  // YoY
  const yoyFull = useMemo(() => {
    if (sorted.length <= 12) return []
    return sorted.slice(12).map((p, i) => ({
      date: p.date,
      yoy: sorted[i].value !== 0 ? ((p.value / sorted[i].value) - 1) * 100 : 0,
    }))
  }, [sorted])

  const yoyWithMA = useMemo(() => {
    const yoyVals = yoyFull.map(p => p.yoy)
    const maVals = sma(yoyVals, regimeMA)
    return yoyFull.map((p, i) => {
      const maVal = maVals[i]
      let regime: Regime = 'neutral'
      if (maVal != null) {
        if (p.yoy > maVal + 0.01) regime = 'expansion'
        else if (p.yoy < maVal - 0.01) regime = 'contraction'
        else regime = 'neutral'
      }
      return { ...p, ma: maVal, regime }
    })
  }, [yoyFull, regimeMA])

  const yoyCutoff = getDateCutoff(yoyRange)
  const yoyFiltered = useMemo(() => yoyCutoff ? yoyWithMA.filter(p => p.date >= yoyCutoff) : yoyWithMA, [yoyWithMA, yoyCutoff])

  const regimeAreas = useMemo(() => {
    const areas: { x1: string; x2: string; regime: Regime }[] = []
    if (yoyFiltered.length === 0) return areas
    let curRegime = yoyFiltered[0].regime
    let startDate = yoyFiltered[0].date
    for (let i = 1; i < yoyFiltered.length; i++) {
      if (yoyFiltered[i].regime !== curRegime) {
        areas.push({ x1: startDate, x2: yoyFiltered[i - 1].date, regime: curRegime })
        curRegime = yoyFiltered[i].regime
        startDate = yoyFiltered[i].date
      }
    }
    areas.push({ x1: startDate, x2: yoyFiltered[yoyFiltered.length - 1].date, regime: curRegime })
    return areas
  }, [yoyFiltered])

  // Acceleration
  const accelFull = useMemo(() => {
    if (yoyFull.length <= accelLookback) return []
    return yoyFull.slice(accelLookback).map((p, i) => ({
      date: p.date,
      value: p.yoy - yoyFull[i].yoy,
    }))
  }, [yoyFull, accelLookback])

  const accelCutoff = getDateCutoff(accelRange)
  const accelFiltered = useMemo(() => accelCutoff ? accelFull.filter(p => p.date >= accelCutoff) : accelFull, [accelFull, accelCutoff])

  // MoM
  const momFull = useMemo(() => {
    if (sorted.length <= 1) return []
    return sorted.slice(1).map((p, i) => ({
      date: p.date,
      mom: sorted[i].value !== 0 ? ((p.value / sorted[i].value) - 1) * 100 : 0,
    }))
  }, [sorted])

  const momWithMA = useMemo(() => {
    const momVals = momFull.map(p => p.mom)
    const ma1Vals = sma(momVals, ma1)
    const ma2Vals = sma(momVals, ma2)
    return momFull.map((p, i) => ({ ...p, ma1: ma1Vals[i], ma2: ma2Vals[i] }))
  }, [momFull, ma1, ma2])

  const momCutoff = getDateCutoff(momRange)
  const momFiltered = useMemo(() => momCutoff ? momWithMA.filter(p => p.date >= momCutoff) : momWithMA, [momWithMA, momCutoff])

  // Ann MoM
  const annMomFull = useMemo(() => {
    if (sorted.length <= 1) return []
    return sorted.slice(1).map((p, i) => {
      const ratio = sorted[i].value !== 0 ? p.value / sorted[i].value : 1
      return { date: p.date, value: (Math.pow(ratio, 12) - 1) * 100 }
    })
  }, [sorted])

  const annMomCutoff = getDateCutoff(annMomRange)
  const annMomFiltered = useMemo(() => annMomCutoff ? annMomFull.filter(p => p.date >= annMomCutoff) : annMomFull, [annMomFull, annMomCutoff])

  if (loading) return <div className={styles.statusBlock}>Loading {selectedItem.label}…</div>

  return (
    <>
      <div className={styles.majorHeader}>Industrial Production Explorer</div>
      <div className={styles.chartSubtitle}>Federal Reserve G.17 Release · Monthly · Seasonally Adjusted · Index 2017=100</div>

      {/* ═══ Contribution Charts ═══ */}
      {!contribLoading && contribYoyData.length > 0 && (
        <div className={styles.contributionGrid}>
          {/* YoY Contributions */}
          <div className={styles.explorerChartCard}>
            <div className={styles.explorerChartLabel}>Contributions to IP Growth — YoY</div>
            <div className={styles.explorerChartSub}>12-month % change, weighted by relative importance</div>
            <div className={styles.controlRow}>
              <QuickSelects value={contribYoyRange} onChange={setContribYoyRange} />
            </div>
            <div className={styles.contribLegend}>
              {CONTRIB_COMPONENTS.map(c => (
                <span key={c.key} className={styles.contribLegendItem}>
                  <span className={styles.contribLegendSwatch} style={{ background: c.color }} />
                  {c.label}
                </span>
              ))}
              <span className={styles.contribLegendItem}>
                <span className={styles.contribLegendLine} style={{ background: '#ffffff' }} />
                Total IP
              </span>
            </div>
            <ResponsiveContainer width="100%" height={420}>
              <ComposedChart data={contribYoyData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => {
                  if (name === 'total') return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Total IP']
                  const cfg = CONTRIB_COMPONENTS.find(c => c.key === name)
                  return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', cfg?.label ?? (name ?? '')]
                }} />
                <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                {CONTRIB_COMPONENTS.map(c => (
                  <Bar key={c.key} dataKey={c.key} stackId="1" fill={c.color} fillOpacity={0.85} />
                ))}
                <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} dot={false} />
                <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* MoM Contributions */}
          <div className={styles.explorerChartCard}>
            <div className={styles.explorerChartLabel}>Contributions to IP Growth — MoM</div>
            <div className={styles.explorerChartSub}>Month-over-month % change, weighted by relative importance</div>
            <div className={styles.controlRow}>
              <QuickSelects value={contribMomRange} onChange={setContribMomRange} />
            </div>
            <div className={styles.contribLegend}>
              {CONTRIB_COMPONENTS.map(c => (
                <span key={c.key} className={styles.contribLegendItem}>
                  <span className={styles.contribLegendSwatch} style={{ background: c.color }} />
                  {c.label}
                </span>
              ))}
              <span className={styles.contribLegendItem}>
                <span className={styles.contribLegendLine} style={{ background: '#ffffff' }} />
                Total IP
              </span>
            </div>
            <ResponsiveContainer width="100%" height={420}>
              <ComposedChart data={contribMomData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => {
                  if (name === 'total') return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Total IP']
                  const cfg = CONTRIB_COMPONENTS.find(c => c.key === name)
                  return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', cfg?.label ?? (name ?? '')]
                }} />
                <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                {CONTRIB_COMPONENTS.map(c => (
                  <Bar key={c.key} dataKey={c.key} stackId="1" fill={c.color} fillOpacity={0.85} />
                ))}
                <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={2} dot={false} />
                <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ═══ IP Series Explorer ═══ */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>IP SERIES EXPLORER</div>
        </div>

        {/* Dropdown + weight */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingBottom: '12px' }}>
          <select className={styles.seriesSelect} value={selectedIdx} onChange={(e) => setSelectedIdx(Number(e.target.value))}>
            {IP_HIERARCHY.map((item, idx) => (
              <option key={idx} value={idx}>{'\u00A0\u00A0'.repeat(item.indent)}{item.label}</option>
            ))}
          </select>
          {latestWeight != null && (
            <span className={styles.weightLabel}>Weight: {latestWeight.toFixed(2)}%</span>
          )}
        </div>

        {data.length === 0 ? (
          <div className={styles.statusBlock}>No data for {selectedItem.seriesId}</div>
        ) : (
          <div className={styles.explorerGrid}>
            {/* Chart 1 — Level */}
            <div className={styles.explorerChartCard}>
              <div className={styles.explorerChartLabel}>{selectedItem.label} — Level</div>
              <div className={styles.explorerChartSub}>Index, 2017=100, SA</div>
              <div className={styles.controlRow}>
                <QuickSelects value={levelRange} onChange={setLevelRange} />
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={levelData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#728197" tick={TK} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(1) : '—', 'Index']} />
                  <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 2 — YoY % Change w/ Regime */}
            <div className={styles.explorerChartCard}>
              <div className={styles.explorerChartLabel}>{selectedItem.label} — YoY %Chg</div>
              <div className={styles.explorerChartSub}>12-month % change w/ regime shading</div>
              <div className={styles.controlRow}>
                <QuickSelects value={yoyRange} onChange={setYoyRange} />
                <div className={styles.inputWrap}><span>Regime MA:</span><input className={styles.numInput} type="number" min="1" value={regimeMA} onChange={(e) => setRegimeMA(Math.max(1, parseInt(e.target.value) || 6))} /><span>mo</span></div>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={yoyFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  {regimeAreas.map((area, i) => (
                    <ReferenceArea key={i} x1={area.x1} x2={area.x2} fill={REGIME_FILL[area.regime]} fillOpacity={1} />
                  ))}
                  <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => {
                    const label = name === 'yoy' ? 'YoY' : name === 'ma' ? `${regimeMA}mo MA` : (name ?? '')
                    return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', label]
                  }} />
                  <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="yoy" stroke="#e2e8f0" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="ma" stroke="#728197" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls={false} />
                  <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                </LineChart>
              </ResponsiveContainer>
              <div className={styles.regimeLegend}>
                <span className={styles.regimeLegendItem}>
                  <span className={styles.regimeSwatch} style={{ background: 'rgba(74, 222, 128, 0.4)' }} />
                  Expansion (YoY {'>'} MA)
                </span>
                <span className={styles.regimeLegendItem}>
                  <span className={styles.regimeSwatch} style={{ background: 'rgba(248, 113, 113, 0.4)' }} />
                  Contraction (YoY {'<'} MA)
                </span>
                <span className={styles.regimeLegendItem}>
                  <span className={styles.regimeSwatch} style={{ background: 'rgba(250, 204, 21, 0.4)' }} />
                  Neutral
                </span>
              </div>
            </div>

            {/* Chart 3 — Acceleration */}
            <div className={styles.explorerChartCard}>
              <div className={styles.explorerChartLabel}>{selectedItem.label} — Acceleration</div>
              <div className={styles.explorerChartSub}>{accelLookback}mo change in YoY %</div>
              <div className={styles.controlRow}>
                <QuickSelects value={accelRange} onChange={setAccelRange} />
                <div className={styles.inputWrap}><span>{'\u0394'}:</span><input className={styles.numInput} type="number" min="1" value={accelLookback} onChange={(e) => setAccelLookback(Math.max(1, parseInt(e.target.value) || 1))} /><span>mo</span></div>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={accelFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Acceleration']} />
                  <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]} barSize={2}>
                    {accelFiltered.map((entry, i) => (
                      <Cell key={i} fill={entry.value >= 0 ? '#4ade80' : '#f87171'} />
                    ))}
                  </Bar>
                  <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 4 — MoM % Change */}
            <div className={styles.explorerChartCard}>
              <div className={styles.explorerChartLabel}>{selectedItem.label} — MoM %Chg</div>
              <div className={styles.explorerChartSub}>Month-over-month % change</div>
              <div className={styles.controlRow}>
                <QuickSelects value={momRange} onChange={setMomRange} />
                <div className={styles.inputWrap}><span>MA1:</span><input className={styles.numInput} type="number" min="1" value={ma1} onChange={(e) => setMa1(Math.max(1, parseInt(e.target.value) || 3))} /><span>mo</span></div>
                <div className={styles.inputWrap}><span>MA2:</span><input className={styles.numInput} type="number" min="1" value={ma2} onChange={(e) => setMa2(Math.max(1, parseInt(e.target.value) || 6))} /><span>mo</span></div>
              </div>
              <div className={styles.legend} style={{ paddingBottom: '6px' }}>
                <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#60a5fa' }} />MoM</span>
                <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#4ade80' }} />{ma1}mo MA</span>
                <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: '#f59e0b' }} />{ma2}mo MA</span>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={momFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown, name: string | undefined) => {
                    const label = name === 'mom' ? 'MoM' : name === 'ma1' ? `${ma1}mo MA` : name === 'ma2' ? `${ma2}mo MA` : (name ?? '')
                    return [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', label]
                  }} />
                  <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                  <Bar dataKey="mom" fill="#60a5fa" barSize={2} radius={[2, 2, 0, 0]} />
                  <Line type="monotone" dataKey="ma1" stroke="#4ade80" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="ma2" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 5 — Annualized MoM */}
            <div className={styles.explorerChartCard}>
              <div className={styles.explorerChartLabel}>{selectedItem.label} — MoM %Chg (Ann.)</div>
              <div className={styles.explorerChartSub}>Annualized month-over-month % change</div>
              <div className={styles.controlRow}>
                <QuickSelects value={annMomRange} onChange={setAnnMomRange} />
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={annMomFiltered} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#728197" tick={TK} tickFormatter={fmtD} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis stroke="#728197" tick={TK} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={TT} labelFormatter={lblFmt} formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '—', 'Ann. MoM']} />
                  <ReferenceLine y={0} stroke="#728197" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="value" stroke="#c084fc" strokeWidth={2} dot={false} />
                  <Brush dataKey="date" height={20} stroke="#728197" fill="#0d1520" travellerWidth={6} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
    </>
  )
}

// ── Standalone page wrapper ──────────────────────────────────────────────────

export function IPExplorerDashboardPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}><NavDropdown /><span className={styles.logo}>TND RESEARCH TERMINAL</span></div>
        <div className={styles.barCenter} /><div className={styles.barRight}><FredRefreshButton /></div>
      </header>
      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <Link to="/models/industrial" className={styles.breadcrumbLink}>Industrial Production</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>IP Explorer</span>
      </nav>
      <div className={styles.body}><IPExplorerDashboardContent /></div>
    </div>
  )
}
