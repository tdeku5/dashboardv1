import { useMemo, useState } from 'react'
import styles from '../pages/STIRDashboardPage.module.css'
import { fmtSignedFixed } from './acm'
import { FUNDAMENTAL_MODEL_COLORS as FMC, LABOR_COLORS } from '../constants/identityColors'
import { FvmLineChart, FvmMessage, FvmNote, FvmOverlayToggle, FvmPanel, FvmStats, FvmToggleGroup, type FvmLine } from './fundamentalPanelParts'
import { useCAFundamental, type CAFundamentalTab } from '../hooks/useCAFundamental'

// Canadian sibling of EUFundamentalModelPanel. Two tabs: CPI + LABOR (no GROWTH —
// no Canadian GDP series ingested yet). HEADLINE/CORE toggle on the CPI tab maps:
//   HEADLINE → 'cpi'       (CPI_HEADLINE NSA index → YoY + MoM + projections)
//   CORE     → 'core_cpi'  (the BoC core trio — CPI-trim/median/common YoY plus
//                           their average; YoY-only, no momentum projections)
// The CORE asymmetry is intentional: the BoC core measures are published and
// quoted as YoY % only, so CORE shows them as lines against the 2% target with
// no MoM panel and no projection paths (see caFundamental route for rationale).
type VisibleTab = 'cpi' | 'labor'
type HeadlineCore = 'HEADLINE' | 'CORE'

const TABS: Array<{ key: VisibleTab; label: string }> = [
  { key: 'cpi', label: 'CPI' },
  { key: 'labor', label: 'LABOR' },
]

function mapTabToApiKey(tab: VisibleTab, headlineCore: HeadlineCore): CAFundamentalTab {
  if (tab === 'cpi') return headlineCore === 'CORE' ? 'core_cpi' : 'cpi'
  return tab
}

const RANGES = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
  { key: 'all', label: 'ALL' },
] as const

type RangeKey = typeof RANGES[number]['key']

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtShortMonthYear(d: string): string {
  const [y, m] = d.split('-')
  return `${SHORT_MONTHS[parseInt(m, 10) - 1]} ${y}`
}

/** Signed MoM / QoQ in the stats line; a value that rounds to zero prints as 0.00 (near-zero rule). */
function fmtSignedPct(v: number | null, digits = 2): string {
  if (v == null) return '—'
  return fmtSignedFixed(v, digits)
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  return v == null ? '—' : `${v.toFixed(digits)}%`
}

function addMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number)
  let ty = y
  let tm = m + n
  while (tm < 1) { ty -= 1; tm += 12 }
  while (tm > 12) { ty += 1; tm -= 12 }
  return `${ty}-${String(tm).padStart(2, '0')}-01`
}

function getRangeCutoff(range: RangeKey, currentDate: string): string | null {
  if (!currentDate) return null
  switch (range) {
    case '1m': return addMonths(currentDate, -1)
    case '3m': return addMonths(currentDate, -3)
    case '6m': return addMonths(currentDate, -6)
    case 'ytd': { const [y] = currentDate.split('-'); return `${y}-01-01` }
    case '1y': return addMonths(currentDate, -12)
    case '2y': return addMonths(currentDate, -24)
    case '5y': return addMonths(currentDate, -60)
    case 'all':
    default: return null
  }
}

interface YoYRow {
  date: string
  yoy: number | null
  pace1m: number | null
  pace3m: number | null
  pace6m: number | null
  target?: number | null
}

interface CoreRow {
  date: string
  trim: number | null
  median: number | null
  common: number | null
  average: number | null
  target?: number | null
}

interface MoMRow { date: string; mom: number | null }

const PACE_LINES: FvmLine[] = [
  { key: 'pace1m', label: '1M MoM', color: FMC.pace1, dash: '5 4' },
  { key: 'pace3m', label: '3M MoM avg', color: FMC.pace3, dash: '5 4' },
  { key: 'pace6m', label: '6M MoM avg', color: FMC.pace6, dash: '5 4' },
]
// BoC core measures: CPI-trim takes the headline line's identity (registry note), the rest their own.
const CORE_LINES: FvmLine[] = [
  { key: 'trim', label: 'CPI-trim', color: FMC.headline },
  { key: 'median', label: 'CPI-median', color: FMC.caMedian, width: 1.6 },
  { key: 'common', label: 'CPI-common', color: FMC.caCommon, width: 1.6 },
  { key: 'average', label: 'Average', color: FMC.caAverage, dash: '6 3', width: 2 },
]
const HC_OPTIONS = [{ key: 'HEADLINE', label: 'HEADLINE' }, { key: 'CORE', label: 'CORE' }] as const

export function CAFundamentalModelPanel() {
  const [activeTab, setActiveTab] = useState<VisibleTab>('cpi')
  const [headlineCore, setHeadlineCore] = useState<HeadlineCore>('HEADLINE')
  const [range, setRange] = useState<RangeKey>('1y')
  const [showTarget, setShowTarget] = useState(false)

  const apiTab = mapTabToApiKey(activeTab, headlineCore)
  const { data, loading, error } = useCAFundamental(apiTab)

  const isInflation = activeTab === 'cpi'
  const isCore = isInflation && headlineCore === 'CORE'

  // Daily BoC target → monthly: last observation in each calendar month at YYYY-MM-01.
  const targetMonthly = useMemo(() => {
    const map = new Map<string, number>()
    if (!data?.bocTarget) return map
    for (const p of data.bocTarget) map.set(`${p.date.slice(0, 7)}-01`, p.value)
    return map
  }, [data?.bocTarget])

  const currentDate = data?.latestReading.date ?? ''
  const cutoff = useMemo(() => getRangeCutoff(range, currentDate), [range, currentDate])

  const yoyChartData = useMemo<YoYRow[]>(() => {
    if (!data || data.kind !== 'index') return []
    const rows: YoYRow[] = data.yoyHistorical.map((p) => ({
      date: p.date, yoy: p.value, pace1m: null, pace3m: null, pace6m: null,
    }))

    if (data.projections && rows.length > 0) {
      const lastYoY = rows[rows.length - 1].yoy
      if (lastYoY != null) {
        rows[rows.length - 1].pace1m = lastYoY
        rows[rows.length - 1].pace3m = lastYoY
        rows[rows.length - 1].pace6m = lastYoY
      }
      const byDate = new Map<string, YoYRow>()
      for (const r of rows) byDate.set(r.date, r)
      const ensure = (date: string): YoYRow => {
        let row = byDate.get(date)
        if (!row) {
          row = { date, yoy: null, pace1m: null, pace3m: null, pace6m: null }
          byDate.set(date, row)
          rows.push(row)
        }
        return row
      }
      for (const p of data.projections.mom1) ensure(p.date).pace1m = p.yoy
      for (const p of data.projections.mom3avg) ensure(p.date).pace3m = p.yoy
      for (const p of data.projections.mom6avg) ensure(p.date).pace6m = p.yoy
      rows.sort((a, b) => a.date.localeCompare(b.date))
    }

    if (showTarget) {
      for (const r of rows) r.target = targetMonthly.get(r.date) ?? null
    }

    return rows.filter((r) => !cutoff || r.date >= cutoff || r.date > currentDate)
  }, [data, cutoff, currentDate, showTarget, targetMonthly])

  const coreChartData = useMemo<CoreRow[]>(() => {
    if (!data?.coreLines) return []
    const byDate = new Map<string, CoreRow>()
    const ensure = (d: string): CoreRow => {
      let r = byDate.get(d)
      if (!r) { r = { date: d, trim: null, median: null, common: null, average: null }; byDate.set(d, r) }
      return r
    }
    for (const p of data.coreLines.trim) ensure(p.date).trim = p.value
    for (const p of data.coreLines.median) ensure(p.date).median = p.value
    for (const p of data.coreLines.common) ensure(p.date).common = p.value
    for (const p of data.coreLines.average) ensure(p.date).average = p.value
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    if (showTarget) for (const r of rows) r.target = targetMonthly.get(r.date) ?? null
    return rows.filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff, showTarget, targetMonthly])

  const momChartData = useMemo<MoMRow[]>(() => {
    if (!data || data.kind !== 'index') return []
    return data.momHistorical
      .map((p) => ({ date: p.date, mom: p.value }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff])

  const laborChartData = useMemo(() => {
    if (!data || data.kind !== 'rate') return [] as Array<{ date: string; rate: number; target?: number | null }>
    return data.series
      .map((p) => ({
        date: p.date,
        rate: p.value,
        target: showTarget ? targetMonthly.get(p.date) ?? null : undefined,
      }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff, showTarget, targetMonthly])

  const yoyDomain = useMemo<[number | string, number | string]>(() => {
    const values = yoyChartData
      .flatMap((d) => [d.yoy, d.pace1m, d.pace3m, d.pace6m, ...(showTarget ? [d.target ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values, 2)
    const max = Math.max(...values, 2)
    const pad = Math.max(0.5, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [yoyChartData, showTarget])

  const coreDomain = useMemo<[number | string, number | string]>(() => {
    const values = coreChartData
      .flatMap((d) => [d.trim, d.median, d.common, d.average, ...(showTarget ? [d.target ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values, 2)
    const max = Math.max(...values, 2)
    const pad = Math.max(0.4, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [coreChartData, showTarget])

  const momDomain = useMemo<[number | string, number | string]>(() => {
    const values = momChartData.map((d) => d.mom).filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.1, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [momChartData])

  const laborDomain = useMemo<[number | string, number | string]>(() => {
    const values = laborChartData
      .flatMap((d) => [d.rate, ...(showTarget ? [d.target ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.3, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [laborChartData, showTarget])

  const latest = data?.latestReading

  const statsLine = (() => {
    if (!latest) return ''
    if (activeTab === 'labor') {
      return `LATEST: ${fmtShortMonthYear(latest.date)} | Unemployment: ${latest.indexLevel != null ? `${latest.indexLevel.toFixed(1)}%` : '—'}`
    }
    if (isCore) {
      return `LATEST: ${fmtShortMonthYear(latest.date)} | Trim: ${fmtPct(latest.trim)} | Median: ${fmtPct(latest.median)} | Common: ${fmtPct(latest.common)} | Avg: ${fmtPct(latest.average)}`
    }
    return `LATEST: ${fmtShortMonthYear(latest.date)} | Index: ${latest.indexLevel != null ? latest.indexLevel.toFixed(1) : '—'} | MoM: ${latest.mom != null ? `${fmtSignedPct(latest.mom)}%` : '—'} | YoY: ${fmtPct(latest.yoy)}`
  })()

  const policyLines: FvmLine[] = showTarget ? [{ key: 'target', label: 'BoC Target', color: FMC.policyRate, width: 1.5 }] : []
  const overlay = <FvmOverlayToggle label="BOC TARGET" on={showTarget} onToggle={() => setShowTarget((v) => !v)} />

  return (
    <FvmPanel
      actions={isInflation && <FvmToggleGroup options={HC_OPTIONS} value={headlineCore} onChange={setHeadlineCore} />}
      tabs={TABS}
      activeTab={activeTab}
      onTab={setActiveTab}
    >
      {error ? (
        <FvmMessage>{error}</FvmMessage>
      ) : loading || !data || !latest ? (
        <FvmMessage>Loading {TABS.find((t) => t.key === activeTab)?.label} model…</FvmMessage>
      ) : (
        <>
          <FvmStats>{statsLine}</FvmStats>
          <FvmToggleGroup options={RANGES} value={range} onChange={setRange} className={styles.fvmRangeBar} />

          {activeTab === 'labor' ? (
            <FvmLineChart
              title="Unemployment rate"
              data={laborChartData}
              lines={[{ key: 'rate', label: 'Unemployment Rate', color: LABOR_COLORS.u3 }, ...policyLines]}
              height={350}
              range={laborDomain}
              tickFormatter={fmtShortMonthYear}
              actions={overlay}
              namedTooltip
            />
          ) : isCore ? (
            <>
              <FvmLineChart
                title="BoC core measures — YoY %"
                data={coreChartData}
                lines={[...CORE_LINES, ...policyLines]}
                target={2}
                height={350}
                range={coreDomain}
                tickFormatter={fmtShortMonthYear}
                actions={overlay}
                namedTooltip
              />
              <FvmNote>
                BoC core measures (CPI-trim, CPI-median, CPI-common) are published as YoY % only — no
                momentum projections or MoM panel. Average is the simple mean of the three.
              </FvmNote>
            </>
          ) : (
            <>
              <FvmLineChart
                title="CPI Headline — YoY %"
                data={yoyChartData}
                lines={[{ key: 'yoy', label: 'YoY actual', color: FMC.headline }, ...PACE_LINES, ...policyLines]}
                target={2}
                height={300}
                range={yoyDomain}
                tickFormatter={fmtShortMonthYear}
                actions={overlay}
              />
              <FvmLineChart
                title="MoM % — Historical month-over-month changes (NSA)"
                data={momChartData}
                lines={[{ key: 'mom', label: 'MoM %', color: FMC.mom, width: 1.5 }]}
                zeroLine
                height={250}
                range={momDomain}
                tickFormatter={fmtShortMonthYear}
              />
            </>
          )}
        </>
      )}
    </FvmPanel>
  )
}
