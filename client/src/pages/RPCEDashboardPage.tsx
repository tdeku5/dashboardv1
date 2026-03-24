import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Line,
  Bar,
  Cell,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchBEARPCESeries } from '../lib/bea'
import type { FredObservation } from '../lib/fred'
import { RPCE_SERIES } from '../data/rPCESeriesConfig'
import styles from './RPCEDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }

// ── Chart key types ──────────────────────────────────────────────────────────

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xMom' | 'xAnnMom'
type GvsChartKey = 'gvsRatio' | 'gvsLevel' | 'gvsYoy' | 'gvsMom'
type ChartKey = ExplorerChartKey | GvsChartKey

const EXPLORER_KEYS: ExplorerChartKey[] = ['xLevel', 'xRegime', 'xYoyDelta', 'xMom', 'xAnnMom']

// ── Chart constants ──────────────────────────────────────────────────────────

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:  '#090e15',
    border:      '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:  'var(--font-mono)',
    fontSize:    11,
    padding:     '6px 10px',
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
  { label: '1Y',  count: 12  },
  { label: '3Y',  count: 36  },
  { label: '5Y',  count: 60  },
  { label: '10Y', count: 120 },
  { label: 'Max', count: Infinity },
] as const

const QUICK_PERIODS_GVS = [
  { label: '5Y',  count: 60  },
  { label: '10Y', count: 120 },
  { label: '20Y', count: 240 },
  { label: 'Max', count: Infinity },
] as const

// ── Formatters ───────────────────────────────────────────────────────────────

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

function fmtIndex(v: number): string {
  return v.toFixed(1)
}

function fmtPctTick(v: number): string {
  return `${v.toFixed(1)}%`
}

function fmtPctTooltip(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

// ── Compute helpers ──────────────────────────────────────────────────────────

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
}

function computeYoY(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 12) return { date: d.date, value: null }
    const prev = data[i - 12].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeMoM(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

function computeAnnualizedMoM(data: WD[]): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < 1) return { date: d.date, value: null }
    const prev = data[i - 1].value
    if (prev === 0 || prev < 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, 12) - 1) * 100 }
  })
}

function computeMA(data: { date: string; value: number | null }[], period: number): { date: string; value: number | null }[] {
  return data.map((d, i) => {
    if (i < period - 1) return { date: d.date, value: null }
    let sum = 0
    let count = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (data[j].value != null) { sum += data[j].value!; count++ }
    }
    return { date: d.date, value: count === period ? sum / count : null }
  })
}

function computeYoYDelta(yoy: { date: string; value: number | null }[], lag = 1): { date: string; value: number | null }[] {
  return yoy.map((d, i) => {
    if (i < lag || d.value == null || yoy[i - lag].value == null) return { date: d.date, value: null }
    return { date: d.date, value: d.value - yoy[i - lag].value! }
  })
}

function computeRegimes(
  yoy: { date: string; value: number | null }[],
  maWindow: number,
): { date: string; yoy: number | null; regime: '+' | '-' | '|' }[] {
  const ma = computeMA(yoy, maWindow)
  return yoy.map((d, i) => {
    const maVal = ma[i]?.value
    if (d.value == null || maVal == null) return { date: d.date, yoy: d.value, regime: '|' as const }
    const regime = d.value > maVal ? '+' as const
      : d.value < maVal ? '-' as const
      : '|' as const
    return { date: d.date, yoy: d.value, regime }
  })
}

function makeMap(data: WD[] | undefined): Map<string, number> {
  return new Map((data ?? []).map(d => [d.date, d.value]))
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

// ── Addenda divider index ────────────────────────────────────────────────────

const ADDENDA_START_INDEX = RPCE_SERIES.findIndex(s => s.lineNumber === 25)

// ══════════════════════════════════════════════════════════════════════════════
// ██  Main Page Component
// ══════════════════════════════════════════════════════════════════════════════

export function RPCEDashboardContent() {
  // ── BEA data fetch ────────────────────────────────────────────────────────
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const entries = await Promise.all(
          RPCE_SERIES.map(async (item) => {
            const obs = await fetchBEARPCESeries(item.lineNumber)
            return [String(item.lineNumber), parseObs(obs)] as [string, WD[]]
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

  // ── Explorer state ────────────────────────────────────────────────────────

  const [selectedLine, setSelectedLine] = useState(1)

  const selectedItem = useMemo(
    () => RPCE_SERIES.find(n => n.lineNumber === selectedLine),
    [selectedLine]
  )

  const selectedLabel = selectedItem?.label ?? 'Personal Consumption Expenditures (PCE)'
  const selectedData  = useMemo(() => allData[String(selectedLine)] ?? [], [allData, selectedLine])

  // Explorer user-controlled parameters
  const [regimeMa, setRegimeMa]       = useState(12)
  const [deltaWindow, setDeltaWindow] = useState(1)
  const [deltaMa, setDeltaMa]         = useState(12)
  const [momMa1, setMomMa1]           = useState(3)
  const [momMa2, setMomMa2]           = useState(6)

  // Explorer computed data — quantity index (no unit conversion needed)
  const exYoY          = useMemo(() => computeYoY(selectedData), [selectedData])
  const exMoM          = useMemo(() => computeMoM(selectedData), [selectedData])
  const exAnnMoM       = useMemo(() => computeAnnualizedMoM(selectedData), [selectedData])
  const exYoYDelta     = useMemo(() => computeYoYDelta(exYoY, deltaWindow), [exYoY, deltaWindow])
  const exYoYDeltaMa   = useMemo(() => computeMA(exYoYDelta, deltaMa), [exYoYDelta, deltaMa])
  const exMoMMa1       = useMemo(() => computeMA(exMoM, momMa1), [exMoM, momMa1])
  const exMoMMa2       = useMemo(() => computeMA(exMoM, momMa2), [exMoM, momMa2])

  const exLevelData = useMemo(
    () => selectedData.map(d => ({ date: d.date, value: d.value })),
    [selectedData]
  )

  const exRegimeData = useMemo(
    () => computeRegimes(exYoY, regimeMa),
    [exYoY, regimeMa]
  )

  const exYoYDeltaData = useMemo(() =>
    exYoYDelta.map((d, i) => ({ date: d.date, delta: d.value, ma: exYoYDeltaMa[i]?.value ?? null })),
    [exYoYDelta, exYoYDeltaMa]
  )

  const exMoMData = useMemo(() =>
    exMoM.map((d, i) => ({ date: d.date, mom: d.value, ma1: exMoMMa1[i]?.value ?? null, ma2: exMoMMa2[i]?.value ?? null })),
    [exMoM, exMoMMa1, exMoMMa2]
  )

  const exAnnMoMData = useMemo(() =>
    exAnnMoM.map(d => ({ date: d.date, value: d.value })),
    [exAnnMoM]
  )

  // ── Brush states ────────────────────────────────────────────────────────

  const CB: BrushState = { start: 0, end: 1, period: 'Max' }
  const [brushes, setBrushes] = useState<Record<ChartKey, BrushState>>({
    xLevel:    { start: 0, end: 0, period: '10Y' },
    xRegime:   { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xMom:      { start: 0, end: 0, period: '10Y' },
    xAnnMom:   { start: 0, end: 0, period: '10Y' },
    gvsRatio: { ...CB }, gvsLevel: { ...CB }, gvsYoy: { ...CB }, gvsMom: { ...CB },
  })

  // Initialize explorer brushes when data arrives or component changes
  useEffect(() => {
    if (!selectedData.length) return
    const endM = selectedData.length - 1
    const start = Math.max(0, endM - 119)
    const newBrush: BrushState = { start, end: endM, period: '10Y' }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [selectedLine, selectedData.length])

  // Initialize GVS brushes when data arrives
  useEffect(() => {
    const pceData = allData['1']
    if (!pceData?.length) return
    const endIdx = pceData.length - 1
    const gvsMax: BrushState = { start: 0, end: endIdx, period: 'Max' }
    const gvsKeys: GvsChartKey[] = ['gvsRatio', 'gvsLevel', 'gvsYoy', 'gvsMom']
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of gvsKeys) next[k] = { ...gvsMax }
      return next
    })
  }, [allData])

  // ── Level chart Y-domain (auto-scaled to visible range) ─────────────────

  const yDomainLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.xLevel
    if (!exLevelData.length || end < start) return undefined
    const visible = exLevelData.slice(
      Math.max(0, start),
      Math.min(exLevelData.length, end + 1)
    )
    if (!visible.length) return undefined
    const vals = visible.map(d => d.value).filter(v => v != null) as number[]
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [exLevelData, brushes.xLevel.start, brushes.xLevel.end])

  // Synchronized explorer brush
  const handleExplorerBrush = useCallback(
    (_key: ChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => {
        const newBrush = {
          period: '',
          start:  startIndex ?? prev[_key].start,
          end:    endIndex   ?? prev[_key].end,
        }
        const next = { ...prev }
        for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
        return next
      })
    },
    []
  )

  const handleExplorerQuickSelect = useCallback(
    (_key: ChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      const newBrush = {
        start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
        end,
        period: label,
      }
      const next = {} as Record<string, BrushState>
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      setBrushes(prev => ({ ...prev, ...next }))
    },
    []
  )

  // ── Goods vs Services data memos ──────────────────────────────────────────

  const gvsRatioData = useMemo(() => {
    const svc = allData['13'] ?? []
    const goodsMap = makeMap(allData['2'])
    return svc
      .map(d => ({ date: d.date, ratio: goodsMap.has(d.date) ? d.value / goodsMap.get(d.date)! : null }))
      .filter(d => d.ratio != null && isFinite(d.ratio!)) as { date: string; ratio: number }[]
  }, [allData])

  const gvsLevelData = useMemo(() => {
    const svc = allData['13'] ?? []
    const goodsMap = makeMap(allData['2'])
    return svc.map(d => ({
      date:     d.date,
      services: d.value,
      goods:    goodsMap.has(d.date) ? goodsMap.get(d.date)! : null,
    }))
  }, [allData])

  const gvsYoyData = useMemo(() => {
    const svcYoY   = computeYoY(allData['13'] ?? [])
    const goodsYoY = computeYoY(allData['2'] ?? [])
    const gMap = new Map(goodsYoY.map(d => [d.date, d.value]))
    return svcYoY.map(d => ({
      date:     d.date,
      services: d.value,
      goods:    gMap.get(d.date) ?? null,
    }))
  }, [allData])

  const gvsMomData = useMemo(() => {
    const svcMoM   = computeMoM(allData['13'] ?? [])
    const goodsMoM = computeMoM(allData['2'] ?? [])
    const gMap = new Map(goodsMoM.map(d => [d.date, d.value]))
    return svcMoM.map(d => ({
      date:     d.date,
      services: d.value,
      goods:    gMap.get(d.date) ?? null,
    }))
  }, [allData])

  // ── GVS Y-domains ────────────────────────────────────────────────────────

  const yDomainGvsRatio = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.gvsRatio
    if (!gvsRatioData.length || end < start) return undefined
    const visible = gvsRatioData.slice(Math.max(0, start), Math.min(gvsRatioData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.map(d => d.ratio)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [gvsRatioData, brushes.gvsRatio.start, brushes.gvsRatio.end])

  const yDomainGvsLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.gvsLevel
    if (!gvsLevelData.length || end < start) return undefined
    const visible = gvsLevelData.slice(Math.max(0, start), Math.min(gvsLevelData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.flatMap(d => [d.services, d.goods]).filter(v => v != null) as number[]
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [gvsLevelData, brushes.gvsLevel.start, brushes.gvsLevel.end])

  // ── GVS visibility states ──────────────────────────────────────────────

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const [visGvsLevel, setVisGvsLevel] = useState<Set<string>>(() => new Set(['services', 'goods']))
  const [visGvsYoy,   setVisGvsYoy]   = useState<Set<string>>(() => new Set(['services', 'goods']))
  const [visGvsMom,   setVisGvsMom]   = useState<Set<string>>(() => new Set(['services', 'goods']))

  const toggleGvsLevel = mkToggle(setVisGvsLevel)
  const toggleGvsYoy   = mkToggle(setVisGvsYoy)
  const toggleGvsMom   = mkToggle(setVisGvsMom)

  // ── GVS brush handlers ─────────────────────────────────────────────────

  const handleGvsBrush = useCallback(
    (key: GvsChartKey, startIndex?: number, endIndex?: number) => {
      setBrushes(prev => ({
        ...prev,
        [key]: { period: '', start: startIndex ?? prev[key].start, end: endIndex ?? prev[key].end },
      }))
    },
    []
  )

  const handleGvsQuickSelect = useCallback(
    (key: GvsChartKey, label: string, count: number, dataLen: number) => {
      const end = dataLen - 1
      setBrushes(prev => ({
        ...prev,
        [key]: { start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label },
      }))
    },
    []
  )

  // ════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <>
        <div className={styles.majorHeader}>Real PCE Dashboard</div>
        <div className={styles.sectionSubtitle} style={{ padding: '0 2px', marginTop: -8 }}>
          Bureau of Economic Analysis &mdash; BEA Table 2.8.3 &mdash; monthly, quantity indexes, 2017=100
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className={styles.statusBlock}>Loading {RPCE_SERIES.length} rPCE series...</div>
        )}
        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && Object.keys(allData).length > 0 && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                PCE Component Explorer
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.explorerHeader}>
              <div className={styles.sectionTitle}>PCE Component Explorer</div>
              <div className={styles.sectorSelectWrap}>
                <span className={styles.lookbackLabel}>Component</span>
                <select
                  className={styles.sectorSelect}
                  value={selectedLine}
                  onChange={e => setSelectedLine(parseInt(e.target.value))}
                >
                  {RPCE_SERIES.map((item, idx) => {
                    const indent = item.depth * 16
                    const prefix = '\u00A0'.repeat(item.depth * 3)
                    const els: React.ReactNode[] = []

                    if (idx === ADDENDA_START_INDEX) {
                      els.push(
                        <option key="addenda-divider" disabled value="">
                          ── Addenda ──
                        </option>
                      )
                    }

                    els.push(
                      <option
                        key={item.lineNumber}
                        value={item.lineNumber}
                        style={{ paddingLeft: indent }}
                      >
                        {prefix}{item.label}
                      </option>
                    )

                    return els
                  })}
                </select>
                <span className={styles.fredId}>Line {selectedLine}</span>
              </div>
            </div>

            {selectedData.length === 0 ? (
              <div className={styles.statusBlock}>No data for Line {selectedLine}</div>
            ) : (
              <>
                {/* E1: Level */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; Level</div>
                      <div className={styles.sectionSubtitle}>Quantity index, 2017=100</div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#60a5fa' }} />
                        Level
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exLevelData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis domain={yDomainLevel} tick={TICK} tickLine={false} axisLine={false} width={58}
                          tickFormatter={fmtIndex} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtIndex(v) : '-', ''] as [string, string]} />
                        <Line type="monotone" dataKey="value" name="Level"
                          stroke="#60a5fa" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xLevel.start}
                          endIndex={brushes.xLevel.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xLevel', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xLevel.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xLevel', l, c, exLevelData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E2: YoY % Change with Regime Shading */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; YoY % Change</div>
                      <div className={styles.sectionSubtitle}>Regime Shading</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>Regime MA</span>
                        <input type="number" min={1} max={60} value={regimeMa}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 60) setRegimeMa(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(74,222,128,0.4)' }} />
                        + (above MA)
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(239,68,68,0.4)' }} />
                        &minus; (below MA)
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#e2e8f0' }} />
                        YoY
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exRegimeData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (name === 'regime') return [null, null]
                            if (typeof v !== 'number') return ['-', '']
                            return [fmtPctTooltip(v), 'YoY'] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="yoy" isAnimationActive={false} legendType="none" maxBarSize={8000} barSize={4}>
                          {exRegimeData.map((entry, idx) => (
                            <Cell key={`regime-${idx}`}
                              fill={
                                entry.regime === '+' ? 'rgba(74,222,128,0.30)'
                                : entry.regime === '-' ? 'rgba(239,68,68,0.30)'
                                : 'rgba(148,163,184,0.08)'
                              } />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="yoy" name="YoY"
                          stroke="#e2e8f0" strokeWidth={2}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xRegime.start}
                          endIndex={brushes.xRegime.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xRegime', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xRegime.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xRegime', l, c, exRegimeData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E3: YoY Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; YoY &Delta;</div>
                      <div className={styles.sectionSubtitle}>Change in Year-over-Year %</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>&Delta; Window</span>
                        <input type="number" min={1} max={12} value={deltaWindow}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 12) setDeltaWindow(n) }}
                          className={styles.lookbackInput} />
                      </div>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA</span>
                        <input type="number" min={1} max={32} value={deltaMa}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 32) setDeltaMa(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: '#4ade80' }} />
                        YoY &Delta;({deltaWindow})
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#60a5fa' }} />
                        {deltaMa}-pd MA
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exYoYDeltaData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (typeof v !== 'number') return ['-', '']
                            const lbl = name === 'ma' ? `${deltaMa}-pd MA` : `YoY \u0394(${deltaWindow})`
                            return [fmtPctTooltip(v), lbl] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="delta" isAnimationActive={false} legendType="none" maxBarSize={16}>
                          {exYoYDeltaData.map((entry, idx) => (
                            <Cell key={`d-${idx}`}
                              fill={(entry.delta ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(74,222,128,0.40)'} />
                          ))}
                        </Bar>
                        <Line type="monotone" dataKey="ma" name={`${deltaMa}-pd MA`}
                          stroke="#60a5fa" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xYoyDelta.start}
                          endIndex={brushes.xYoyDelta.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xYoyDelta', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xYoyDelta.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xYoyDelta', l, c, exYoYDeltaData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E4: MoM %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; MoM %&Delta;</div>
                      <div className={styles.sectionSubtitle}>Month-over-Month</div>
                    </div>
                    <div className={styles.controls}>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA1</span>
                        <input type="number" min={1} max={24} value={momMa1}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMomMa1(n) }}
                          className={styles.lookbackInput} />
                      </div>
                      <div className={styles.lookbackWrap}>
                        <span className={styles.lookbackLabel}>MA2</span>
                        <input type="number" min={1} max={24} value={momMa2}
                          onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMomMa2(n) }}
                          className={styles.lookbackInput} />
                      </div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendSwatch} style={{ background: 'rgba(147,197,253,0.75)' }} />
                        MoM %
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#4ade80' }} />
                        {momMa1}-pd MA
                      </span>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#f97316' }} />
                        {momMa2}-pd MA
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exMoMData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown, name: unknown) => {
                            if (typeof v !== 'number') return ['-', '']
                            const lbl = name === 'ma1' ? `${momMa1}-pd MA` : name === 'ma2' ? `${momMa2}-pd MA` : 'MoM'
                            return [fmtPctTooltip(v), lbl] as [string, string]
                          }} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Bar dataKey="mom" name="MoM" isAnimationActive={false} legendType="none" maxBarSize={16}
                          fill="rgba(147,197,253,0.75)" />
                        <Line type="monotone" dataKey="ma1" name={`${momMa1}-pd MA`}
                          stroke="#4ade80" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Line type="monotone" dataKey="ma2" name={`${momMa2}-pd MA`}
                          stroke="#f97316" strokeWidth={1.5}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xMom.start}
                          endIndex={brushes.xMom.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xMom', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xMom.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xMom', l, c, exMoMData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>

                {/* E5: Annualized MoM %Delta */}
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <div className={styles.sectionTitle}>{selectedLabel} &mdash; Annualized MoM %&Delta;</div>
                      <div className={styles.sectionSubtitle}>(M/M)^12 &minus; 1</div>
                    </div>
                  </div>
                  <div className={styles.legendRow}>
                    <div className={styles.legend}>
                      <span className={styles.legendItem} style={{ cursor: 'default' }}>
                        <span className={styles.legendLine} style={{ background: '#fdba74' }} />
                        Annualized MoM %
                      </span>
                    </div>
                  </div>
                  <div className={styles.chartWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={exAnnMoMData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                          tickFormatter={fmtAxisDate} minTickGap={60} />
                        <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                        <Tooltip {...TOOLTIP_STYLE}
                          formatter={(v: unknown) => [typeof v === 'number' ? fmtPctTooltip(v) : '-', ''] as [string, string]} />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                        <Line type="monotone" dataKey="value" name="Ann. MoM"
                          stroke="#fdba74" strokeWidth={1.8}
                          dot={false} isAnimationActive={false} connectNulls legendType="none" />
                        <Brush dataKey="date"
                          startIndex={brushes.xAnnMom.start}
                          endIndex={brushes.xAnnMom.end}
                          onChange={({ startIndex, endIndex }) => handleExplorerBrush('xAnnMom', startIndex, endIndex)}
                          {...BRUSH_STYLE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <QuickSelectRow
                    period={brushes.xAnnMom.period}
                    onSelect={(l, c) => handleExplorerQuickSelect('xAnnMom', l, c, exAnnMoMData.length)}
                    periods={QUICK_PERIODS_M}
                  />
                </div>
              </>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                Goods vs Services
            ═══════════════════════════════════════════════════════════════ */}

            <div className={styles.majorHeader}>Goods vs Services</div>

            {/* GVS1: Ratio — full width */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Services / Goods Ratio</div>
                  <div className={styles.sectionSubtitle}>Services rPCE &divide; Goods rPCE</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  <span className={styles.legendItem} style={{ cursor: 'default' }}>
                    <span className={styles.legendLine} style={{ background: '#f472b6' }} />
                    Services / Goods
                  </span>
                </div>
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={gvsRatioData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis domain={yDomainGvsRatio} tick={TICK} tickLine={false} axisLine={false} width={58}
                      tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [typeof v === 'number' ? v.toFixed(3) : '-', 'Ratio'] as [string, string]} />
                    <Line type="monotone" dataKey="ratio" name="Ratio"
                      stroke="#f472b6" strokeWidth={1.8}
                      dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    <Brush dataKey="date"
                      startIndex={brushes.gvsRatio.start}
                      endIndex={brushes.gvsRatio.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsRatio', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsRatio.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsRatio', l, c, gvsRatioData.length)}
                periods={QUICK_PERIODS_GVS}
              />
            </div>

            {/* GVS2: Level */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>LEVEL (Index, 2017=100)</div></div>
              </div>
              <div className={styles.legendRow}><div className={styles.legend}>
                <button type="button" className={`${styles.legendItem} ${visGvsLevel.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsLevel('services')}>
                  <span className={styles.legendLine} style={{ background: '#60a5fa' }} /> Services
                </button>
                <button type="button" className={`${styles.legendItem} ${visGvsLevel.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsLevel('goods')}>
                  <span className={styles.legendLine} style={{ background: '#4ade80' }} /> Goods
                </button>
              </div></div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={gvsLevelData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis domain={yDomainGvsLevel} tick={TICK} tickLine={false} axisLine={false} width={58}
                      tickFormatter={fmtIndex} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        if (typeof v !== 'number') return ['-', '']
                        return [fmtIndex(v), name === 'services' ? 'Services' : 'Goods'] as [string, string]
                      }} />
                    {visGvsLevel.has('services') && (
                      <Line type="monotone" dataKey="services" name="services"
                        stroke="#60a5fa" strokeWidth={1.8}
                        dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    )}
                    {visGvsLevel.has('goods') && (
                      <Line type="monotone" dataKey="goods" name="goods"
                        stroke="#4ade80" strokeWidth={1.8}
                        dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    )}
                    <Brush dataKey="date"
                      startIndex={brushes.gvsLevel.start}
                      endIndex={brushes.gvsLevel.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsLevel', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsLevel.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsLevel', l, c, gvsLevelData.length)}
                periods={QUICK_PERIODS_GVS}
              />
            </div>

            {/* GVS3: YoY */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>YOY % CHANGE</div></div>
              </div>
              <div className={styles.legendRow}><div className={styles.legend}>
                <button type="button" className={`${styles.legendItem} ${visGvsYoy.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsYoy('services')}>
                  <span className={styles.legendLine} style={{ background: '#60a5fa' }} /> Services
                </button>
                <button type="button" className={`${styles.legendItem} ${visGvsYoy.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsYoy('goods')}>
                  <span className={styles.legendLine} style={{ background: '#4ade80' }} /> Goods
                </button>
              </div></div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={gvsYoyData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        if (typeof v !== 'number') return ['-', '']
                        return [fmtPctTooltip(v), name === 'services' ? 'Services' : 'Goods'] as [string, string]
                      }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    {visGvsYoy.has('services') && (
                      <Line type="monotone" dataKey="services" name="services"
                        stroke="#60a5fa" strokeWidth={1.8}
                        dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    )}
                    {visGvsYoy.has('goods') && (
                      <Line type="monotone" dataKey="goods" name="goods"
                        stroke="#4ade80" strokeWidth={1.8}
                        dot={false} isAnimationActive={false} connectNulls legendType="none" />
                    )}
                    <Brush dataKey="date"
                      startIndex={brushes.gvsYoy.start}
                      endIndex={brushes.gvsYoy.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsYoy', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsYoy.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsYoy', l, c, gvsYoyData.length)}
                periods={QUICK_PERIODS_GVS}
              />
            </div>

            {/* GVS4: MoM (side-by-side bars) */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div><div className={styles.sectionTitle}>MOM %&Delta;</div></div>
              </div>
              <div className={styles.legendRow}><div className={styles.legend}>
                <button type="button" className={`${styles.legendItem} ${visGvsMom.has('services') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsMom('services')}>
                  <span className={styles.legendSwatch} style={{ background: '#60a5fa' }} /> Services
                </button>
                <button type="button" className={`${styles.legendItem} ${visGvsMom.has('goods') ? '' : styles.legendItemOff}`} onClick={() => toggleGvsMom('goods')}>
                  <span className={styles.legendSwatch} style={{ background: '#4ade80' }} /> Goods
                </button>
              </div></div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gvsMomData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                    barCategoryGap="20%" barGap={2}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60} />
                    <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
                    <Tooltip {...TOOLTIP_STYLE}
                      formatter={(v: unknown, name: unknown) => {
                        if (typeof v !== 'number') return ['-', '']
                        return [fmtPctTooltip(v), name === 'services' ? 'Services' : 'Goods'] as [string, string]
                      }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    {visGvsMom.has('services') && (
                      <Bar dataKey="services" name="services" fill="#60a5fa" fillOpacity={0.75}
                        isAnimationActive={false} legendType="none" />
                    )}
                    {visGvsMom.has('goods') && (
                      <Bar dataKey="goods" name="goods" fill="#4ade80" fillOpacity={0.75}
                        isAnimationActive={false} legendType="none" />
                    )}
                    <Brush dataKey="date"
                      startIndex={brushes.gvsMom.start}
                      endIndex={brushes.gvsMom.end}
                      onChange={({ startIndex, endIndex }) => handleGvsBrush('gvsMom', startIndex, endIndex)}
                      {...BRUSH_STYLE} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={brushes.gvsMom.period}
                onSelect={(l, c) => handleGvsQuickSelect('gvsMom', l, c, gvsMomData.length)}
                periods={QUICK_PERIODS_GVS}
              />
            </div>
          </>
        )}
    </>
  )
}

export function RPCEDashboardPage() {
  return (
    <div className={styles.shell}>
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
        <span className={styles.breadcrumbCurrent}>Real PCE</span>
      </nav>
      <div className={styles.body}>
        <RPCEDashboardContent />
      </div>
    </div>
  )
}
