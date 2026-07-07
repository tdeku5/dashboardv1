import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import {
  type WD, type Frequency, periodsPerYear,
  computeChangePct, computeAnnualized, computeMA, computeYoYDelta, computeRegimes,
  fmtAxisDate, fmtPctTick, fmtPctTooltip,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE, QUICK_PERIODS_M, QUICK_PERIODS_Q,
} from '../../lib/seriesTransforms'
import { QuickSelectRow } from './QuickSelectRow'
import styles from './ChartKit.module.css'

// Standard five-chart series explorer (E1 Level / E2 YoY+regime / E3 YoYΔ+MA /
// E4 MoM+2MA / E5 annualized MoM), extracted from RetailSalesDashboardPage.tsx.
// Chart behavior, styling and math are identical to the original inline block;
// the series list, units and frequency are parameterized.

export interface ExplorerItem {
  id: string
  label: string
  depth?: number
}

type ExplorerChartKey = 'xLevel' | 'xRegime' | 'xYoyDelta' | 'xMom' | 'xAnnMom'
const EXPLORER_KEYS: ExplorerChartKey[] = ['xLevel', 'xRegime', 'xYoyDelta', 'xMom', 'xAnnMom']

type BrushState = { start: number; end: number; period: string }

export function SeriesExplorer({
  title,
  selectorLabel = 'Series',
  items,
  data,
  defaultId,
  frequency = 'monthly',
  unitLabel,
  levelFormatter,
  badge,
}: {
  title: string
  selectorLabel?: string
  items: readonly ExplorerItem[]
  data: Record<string, WD[]>
  defaultId?: string
  frequency?: Frequency
  unitLabel?: string
  levelFormatter?: (v: number) => string
  badge?: ReactNode
}) {
  const ppy = periodsPerYear(frequency)
  const periodWord = frequency === 'quarterly' ? 'QoQ' : 'MoM'
  const quickPeriods = frequency === 'quarterly' ? QUICK_PERIODS_Q : QUICK_PERIODS_M
  const defaultCount = frequency === 'quarterly' ? 40 : 120
  const fmtLevel = levelFormatter ?? ((v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1 }))

  const [selectedId, setSelectedId] = useState(defaultId ?? items[0]?.id ?? '')
  const selectedItem = useMemo(() => items.find(n => n.id === selectedId), [items, selectedId])
  const selectedLabel = selectedItem?.label ?? selectedId
  const selectedData = useMemo(() => data[selectedId] ?? [], [data, selectedId])

  const [regimeMa, setRegimeMa] = useState(ppy)
  const [deltaWindow, setDeltaWindow] = useState(1)
  const [deltaMa, setDeltaMa] = useState(ppy)
  const [momMa1, setMomMa1] = useState(3)
  const [momMa2, setMomMa2] = useState(6)

  const exYoY = useMemo(() => computeChangePct(selectedData, ppy), [selectedData, ppy])
  const exMoM = useMemo(() => computeChangePct(selectedData, 1), [selectedData])
  const exAnnMoM = useMemo(() => computeAnnualized(selectedData, 1, ppy), [selectedData, ppy])
  const exYoYDelta = useMemo(() => computeYoYDelta(exYoY, deltaWindow), [exYoY, deltaWindow])
  const exYoYDeltaMa = useMemo(() => computeMA(exYoYDelta, deltaMa), [exYoYDelta, deltaMa])
  const exMoMMa1 = useMemo(() => computeMA(exMoM, momMa1), [exMoM, momMa1])
  const exMoMMa2 = useMemo(() => computeMA(exMoM, momMa2), [exMoM, momMa2])

  const exLevelData = useMemo(() => selectedData.map(d => ({ date: d.date, value: d.value })), [selectedData])
  const exRegimeData = useMemo(() => computeRegimes(exYoY, regimeMa), [exYoY, regimeMa])
  const exYoYDeltaData = useMemo(() =>
    exYoYDelta.map((d, i) => ({ date: d.date, delta: d.value, ma: exYoYDeltaMa[i]?.value ?? null })),
    [exYoYDelta, exYoYDeltaMa])
  const exMoMData = useMemo(() =>
    exMoM.map((d, i) => ({ date: d.date, mom: d.value, ma1: exMoMMa1[i]?.value ?? null, ma2: exMoMMa2[i]?.value ?? null })),
    [exMoM, exMoMMa1, exMoMMa2])
  const exAnnMoMData = useMemo(() => exAnnMoM.map(d => ({ date: d.date, value: d.value })), [exAnnMoM])

  const [brushes, setBrushes] = useState<Record<ExplorerChartKey, BrushState>>({
    xLevel: { start: 0, end: 0, period: '10Y' },
    xRegime: { start: 0, end: 0, period: '10Y' },
    xYoyDelta: { start: 0, end: 0, period: '10Y' },
    xMom: { start: 0, end: 0, period: '10Y' },
    xAnnMom: { start: 0, end: 0, period: '10Y' },
  })

  useEffect(() => {
    if (!selectedData.length) return
    const end = selectedData.length - 1
    const start = Math.max(0, end - (defaultCount - 1))
    const newBrush: BrushState = { start, end, period: '10Y' }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [selectedId, selectedData.length, defaultCount])

  const yDomainLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = brushes.xLevel
    if (!exLevelData.length || end < start) return undefined
    const visible = exLevelData.slice(Math.max(0, start), Math.min(exLevelData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.map(d => d.value).filter((v): v is number => v != null)
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.06 || Math.abs(max) * 0.02
    return [min - pad, max + pad]
  }, [exLevelData, brushes.xLevel])

  const handleBrush = useCallback((startIndex?: number, endIndex?: number) => {
    setBrushes(prev => {
      const newBrush = {
        period: '',
        start: startIndex ?? prev.xLevel.start,
        end: endIndex ?? prev.xLevel.end,
      }
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [])

  const handleQuickSelect = useCallback((label: string, count: number, dataLen: number) => {
    const end = dataLen - 1
    const newBrush = {
      start: isFinite(count) ? Math.max(0, end - count + 1) : 0,
      end,
      period: label,
    }
    setBrushes(prev => {
      const next = { ...prev }
      for (const k of EXPLORER_KEYS) next[k] = { ...newBrush }
      return next
    })
  }, [])

  const numInput = (
    label: string,
    value: number,
    setter: (n: number) => void,
    min: number,
    max: number,
  ) => (
    <div className={styles.lookbackWrap}>
      <span className={styles.lookbackLabel}>{label}</span>
      <input type="number" min={min} max={max} value={value}
        onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= min && n <= max) setter(n) }}
        className={styles.lookbackInput} />
    </div>
  )

  return (
    <>
      <div className={styles.explorerHeader}>
        <div className={styles.sectionTitle}>{title}{badge}</div>
        <div className={styles.sectorSelectWrap}>
          <span className={styles.lookbackLabel}>{selectorLabel}</span>
          <select className={styles.sectorSelect} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {items.map(item => (
              <option key={item.id} value={item.id}>
                {' '.repeat((item.depth ?? 0) * 3)}{item.label}
              </option>
            ))}
          </select>
          <span className={styles.seriesCode}>{selectedId}</span>
        </div>
      </div>

      {selectedData.length === 0 ? (
        <div className={styles.statusBlock}>No data for {selectedId}</div>
      ) : (
        <>
          {/* E1: Level */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{selectedLabel} &mdash; Level</div>
                {unitLabel && <div className={styles.sectionSubtitle}>{unitLabel}</div>}
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
                    tickFormatter={fmtLevel} />
                  <Tooltip {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [typeof v === 'number' ? fmtLevel(v) : '-', ''] as [string, string]} />
                  <Line type="monotone" dataKey="value" name="Level"
                    stroke="#60a5fa" strokeWidth={1.8}
                    dot={false} isAnimationActive={false} connectNulls legendType="none" />
                  <Brush dataKey="date"
                    startIndex={brushes.xLevel.start}
                    endIndex={brushes.xLevel.end}
                    onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={brushes.xLevel.period}
              onSelect={(l, c) => handleQuickSelect(l, c, exLevelData.length)}
              periods={quickPeriods}
            />
          </div>

          {/* E2: YoY % with regime shading */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{selectedLabel} &mdash; YoY % Change</div>
                <div className={styles.sectionSubtitle}>Regime Shading</div>
              </div>
              <div className={styles.controls}>
                {numInput('Regime MA', regimeMa, setRegimeMa, 1, 60)}
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
                    onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={brushes.xRegime.period}
              onSelect={(l, c) => handleQuickSelect(l, c, exRegimeData.length)}
              periods={quickPeriods}
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
                {numInput('Δ Window', deltaWindow, setDeltaWindow, 1, 12)}
                {numInput('MA', deltaMa, setDeltaMa, 1, 32)}
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
                      const lbl = name === 'ma' ? `${deltaMa}-pd MA` : `YoY Δ(${deltaWindow})`
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
                    onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={brushes.xYoyDelta.period}
              onSelect={(l, c) => handleQuickSelect(l, c, exYoYDeltaData.length)}
              periods={quickPeriods}
            />
          </div>

          {/* E4: MoM/QoQ % */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{selectedLabel} &mdash; {periodWord} %&Delta;</div>
                <div className={styles.sectionSubtitle}>
                  {frequency === 'quarterly' ? 'Quarter-over-Quarter' : 'Month-over-Month'}
                </div>
              </div>
              <div className={styles.controls}>
                {numInput('MA1', momMa1, setMomMa1, 1, 24)}
                {numInput('MA2', momMa2, setMomMa2, 1, 24)}
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <span className={styles.legendItem} style={{ cursor: 'default' }}>
                  <span className={styles.legendSwatch} style={{ background: 'rgba(147,197,253,0.75)' }} />
                  {periodWord} %
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
                      const lbl = name === 'ma1' ? `${momMa1}-pd MA` : name === 'ma2' ? `${momMa2}-pd MA` : periodWord
                      return [fmtPctTooltip(v), lbl] as [string, string]
                    }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                  <Bar dataKey="mom" name={periodWord} isAnimationActive={false} legendType="none" maxBarSize={16}
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
                    onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={brushes.xMom.period}
              onSelect={(l, c) => handleQuickSelect(l, c, exMoMData.length)}
              periods={quickPeriods}
            />
          </div>

          {/* E5: Annualized MoM/QoQ % */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{selectedLabel} &mdash; Annualized {periodWord} %&Delta;</div>
                <div className={styles.sectionSubtitle}>
                  {frequency === 'quarterly' ? '(Q/Q)^4 − 1' : '(M/M)^12 − 1'}
                </div>
              </div>
            </div>
            <div className={styles.legendRow}>
              <div className={styles.legend}>
                <span className={styles.legendItem} style={{ cursor: 'default' }}>
                  <span className={styles.legendLine} style={{ background: '#fdba74' }} />
                  Annualized {periodWord} %
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
                  <Line type="monotone" dataKey="value" name={`Ann. ${periodWord}`}
                    stroke="#fdba74" strokeWidth={1.8}
                    dot={false} isAnimationActive={false} connectNulls legendType="none" />
                  <Brush dataKey="date"
                    startIndex={brushes.xAnnMom.start}
                    endIndex={brushes.xAnnMom.end}
                    onChange={({ startIndex, endIndex }) => handleBrush(startIndex, endIndex)}
                    {...BRUSH_STYLE} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={brushes.xAnnMom.period}
              onSelect={(l, c) => handleQuickSelect(l, c, exAnnMoMData.length)}
              periods={quickPeriods}
            />
          </div>
        </>
      )}
    </>
  )
}
