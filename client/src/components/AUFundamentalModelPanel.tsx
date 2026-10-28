import { useMemo, useState } from 'react'
import styles from '../pages/STIRDashboardPage.module.css'
import { fmtSignedFixed } from './acm'
import { FUNDAMENTAL_MODEL_COLORS as FMC, LABOR_COLORS } from '../constants/identityColors'
import { FvmLineChart, FvmMessage, FvmOverlayToggle, FvmPanel, FvmStats, FvmToggleGroup, type FvmLine } from './fundamentalPanelParts'
import { useAUFundamental, type AUFundamentalTab } from '../hooks/useAUFundamental'

// Australian sibling of the EU/CA/JP fundamental panels, adapted to Australia's
// 2025-27 mixed-frequency CPI transition. Two tabs: CPI + LABOR.
//
// On CPI, two toggles compose the API tab key:
//   FREQUENCY: MONTHLY | QUARTERLY
//   MEASURE:   HEADLINE | TRIM | WGT MED
// MONTHLY → the new complete Monthly CPI (RBA's official headline target, from
// 2024-04; headline is NSA, trimmed/median are SA). QUARTERLY → the continuing
// quarterly series (RBA's preferred underlying gauge during the transition; the
// quarterly trimmed mean has history back to 1982). Projection pace windows adapt
// to frequency ([1,3,6] months vs [1,2,4] quarters). LABOR shows the unemployment
// rate with both the SA and the ABS-recommended trend line.
type VisibleTab = 'cpi' | 'labor'
type Freq = 'MONTHLY' | 'QUARTERLY'
type Measure = 'HEADLINE' | 'TRIM' | 'WGT MED'

const TABS: Array<{ key: VisibleTab; label: string }> = [
  { key: 'cpi', label: 'CPI' },
  { key: 'labor', label: 'LABOR' },
]

const MEASURES: Measure[] = ['HEADLINE', 'TRIM', 'WGT MED']

function mapToApiKey(freq: Freq, measure: Measure): AUFundamentalTab {
  const prefix = freq === 'MONTHLY' ? 'm' : 'q'
  const m = measure === 'HEADLINE' ? 'headline' : measure === 'TRIM' ? 'trimmed' : 'wgtmed'
  return `${prefix}_${m}` as AUFundamentalTab
}

function subtitleFor(freq: Freq, measure: Measure): string {
  if (measure === 'HEADLINE') {
    return freq === 'MONTHLY'
      ? 'Monthly all-groups CPI (from Apr 2024)'
      : 'Quarterly all-groups CPI'
  }
  if (measure === 'TRIM') {
    return freq === 'MONTHLY'
      ? 'Monthly Trimmed mean (from Apr 2024)'
      : "Quarterly Trimmed mean — RBA's preferred underlying measure"
  }
  return freq === 'MONTHLY'
    ? 'Monthly Weighted median (from Apr 2024)'
    : 'Quarterly Weighted median'
}

const RANGES = [
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: 'all', label: 'ALL' },
] as const

type RangeKey = typeof RANGES[number]['key']

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtPeriod(d: string, freq: 'M' | 'Q'): string {
  const [y, m] = d.split('-')
  if (freq === 'Q') {
    const q = Math.floor((parseInt(m, 10) - 1) / 3) + 1
    return `Q${q} ${y}`
  }
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
    case '1y': return addMonths(currentDate, -12)
    case '2y': return addMonths(currentDate, -24)
    case '5y': return addMonths(currentDate, -60)
    case '10y': return addMonths(currentDate, -120)
    case 'all':
    default: return null
  }
}

// Collapse the daily RBA cash-rate series to the chart's cadence: key each chart
// period (first-of-period date) to the last daily value falling within it.
function periodStart(dailyDate: string, freq: 'M' | 'Q'): string {
  const [y, m] = dailyDate.split('-')
  if (freq === 'M') return `${y}-${m}-01`
  const q = Math.floor((parseInt(m, 10) - 1) / 3)
  return `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
}

function paceLabel(w: number, freq: 'M' | 'Q'): string {
  const suffix = freq === 'Q' ? 'Q' : 'M'
  return w === 1 ? `1${suffix}` : `${w}${suffix} avg`
}

interface YoYRow {
  date: string
  yoy: number | null
  p1: number | null
  p2: number | null
  p3: number | null
  policy?: number | null
}

interface SeqRow { date: string; seq: number | null }

const FREQ_OPTIONS = [{ key: 'MONTHLY', label: 'MONTHLY' }, { key: 'QUARTERLY', label: 'QUARTERLY' }] as const

export function AUFundamentalModelPanel() {
  const [activeTab, setActiveTab] = useState<VisibleTab>('cpi')
  const [freq, setFreq] = useState<Freq>('MONTHLY')
  const [measure, setMeasure] = useState<Measure>('HEADLINE')
  const [range, setRange] = useState<RangeKey>('2y')
  const [showPolicy, setShowPolicy] = useState(false)

  const apiTab: AUFundamentalTab = activeTab === 'labor' ? 'labor' : mapToApiKey(freq, measure)
  const { data, loading, error } = useAUFundamental(apiTab)

  const isInflation = activeTab === 'cpi'
  const chartFreq: 'M' | 'Q' = data?.freq ?? (freq === 'QUARTERLY' ? 'Q' : 'M')
  const paceWindows = data?.paceWindows ?? (chartFreq === 'Q' ? [1, 2, 4] : [1, 3, 6])
  const seqName = chartFreq === 'Q' ? 'QoQ' : 'MoM'

  // Daily RBA cash rate (AU_CASH_RATE_TARGET) → per-period: last obs in each period.
  const policyByPeriod = useMemo(() => {
    const map = new Map<string, number>()
    if (!data?.rbaRate) return map
    for (const p of data.rbaRate) map.set(periodStart(p.date, chartFreq), p.value)
    return map
  }, [data?.rbaRate, chartFreq])

  const currentDate = data?.latestReading.date ?? ''
  const cutoff = useMemo(() => getRangeCutoff(range, currentDate), [range, currentDate])

  const yoyChartData = useMemo<YoYRow[]>(() => {
    if (!data || data.kind !== 'index') return []
    const rows: YoYRow[] = data.yoyHistorical.map((p) => ({
      date: p.date, yoy: p.value, p1: null, p2: null, p3: null,
    }))

    if (data.projections && rows.length > 0) {
      const lastYoY = rows[rows.length - 1].yoy
      if (lastYoY != null) {
        rows[rows.length - 1].p1 = lastYoY
        rows[rows.length - 1].p2 = lastYoY
        rows[rows.length - 1].p3 = lastYoY
      }
      const byDate = new Map<string, YoYRow>()
      for (const r of rows) byDate.set(r.date, r)
      const ensure = (date: string): YoYRow => {
        let row = byDate.get(date)
        if (!row) {
          row = { date, yoy: null, p1: null, p2: null, p3: null }
          byDate.set(date, row)
          rows.push(row)
        }
        return row
      }
      for (const p of data.projections.p1) ensure(p.date).p1 = p.yoy
      for (const p of data.projections.p2) ensure(p.date).p2 = p.yoy
      for (const p of data.projections.p3) ensure(p.date).p3 = p.yoy
      rows.sort((a, b) => a.date.localeCompare(b.date))
    }

    if (showPolicy) {
      for (const r of rows) r.policy = policyByPeriod.get(r.date) ?? null
    }

    return rows.filter((r) => !cutoff || r.date >= cutoff || r.date > currentDate)
  }, [data, cutoff, currentDate, showPolicy, policyByPeriod])

  const seqChartData = useMemo<SeqRow[]>(() => {
    if (!data || data.kind !== 'index') return []
    return data.seqHistorical
      .map((p) => ({ date: p.date, seq: p.value }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff])

  const laborChartData = useMemo(() => {
    if (!data || data.kind !== 'rate') return [] as Array<{ date: string; rate: number; trend?: number | null; policy?: number | null }>
    const trendByDate = new Map<string, number>((data.seriesTrend ?? []).map((p) => [p.date, p.value]))
    return data.series
      .map((p) => ({
        date: p.date,
        rate: p.value,
        trend: trendByDate.get(p.date) ?? null,
        policy: showPolicy ? policyByPeriod.get(p.date) ?? null : undefined,
      }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff, showPolicy, policyByPeriod])

  const yoyDomain = useMemo<[number | string, number | string]>(() => {
    const values = yoyChartData
      .flatMap((d) => [d.yoy, d.p1, d.p2, d.p3, ...(showPolicy ? [d.policy ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values, 2)
    const max = Math.max(...values, 3)
    const pad = Math.max(0.5, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [yoyChartData, showPolicy])

  const seqDomain = useMemo<[number | string, number | string]>(() => {
    const values = seqChartData.map((d) => d.seq).filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.1, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [seqChartData])

  const laborDomain = useMemo<[number | string, number | string]>(() => {
    const values = laborChartData
      .flatMap((d) => [d.rate, d.trend ?? null, ...(showPolicy ? [d.policy ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.2, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [laborChartData, showPolicy])

  const latest = data?.latestReading
  const trendLatest = data?.seriesTrend?.[data.seriesTrend.length - 1]?.value ?? null

  const statsLine = (() => {
    if (!latest) return ''
    if (activeTab === 'labor') {
      return `LATEST: ${fmtPeriod(latest.date, 'M')} | Unemployment (SA): ${latest.indexLevel != null ? `${latest.indexLevel.toFixed(1)}%` : '—'} | Trend: ${trendLatest != null ? `${trendLatest.toFixed(1)}%` : '—'}`
    }
    return `LATEST: ${fmtPeriod(latest.date, chartFreq)} | Index: ${latest.indexLevel != null ? latest.indexLevel.toFixed(1) : '—'} | ${seqName}: ${latest.seq != null ? `${fmtSignedPct(latest.seq)}%` : '—'} | YoY: ${fmtPct(latest.yoy)}`
  })()

  const tickFmt = (v: string) => fmtPeriod(v, chartFreq)

  const policyLines: FvmLine[] = showPolicy ? [{ key: 'policy', label: 'RBA Cash Rate', color: FMC.policyRate, width: 1.5 }] : []
  const overlay = <FvmOverlayToggle label="RBA CASH RATE" on={showPolicy} onToggle={() => setShowPolicy((v) => !v)} />
  const paceLines: FvmLine[] = [
    { key: 'p1', label: paceLabel(paceWindows[0], chartFreq), color: FMC.pace1, dash: '5 4' },
    { key: 'p2', label: paceLabel(paceWindows[1], chartFreq), color: FMC.pace3, dash: '5 4' },
    { key: 'p3', label: paceLabel(paceWindows[2], chartFreq), color: FMC.pace6, dash: '5 4' },
  ]

  return (
    <FvmPanel
      actions={isInflation && (
        <>
          <FvmToggleGroup options={FREQ_OPTIONS} value={freq} onChange={setFreq} />
          <FvmToggleGroup options={MEASURES.map((m) => ({ key: m, label: m }))} value={measure} onChange={setMeasure} />
        </>
      )}
      note={isInflation ? subtitleFor(freq, measure) : undefined}
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
              lines={[
                { key: 'rate', label: 'Unemployment (SA)', color: LABOR_COLORS.u3 },
                { key: 'trend', label: 'Trend', color: FMC.auTrend, width: 1.8 },
                ...policyLines,
              ]}
              height={350}
              range={laborDomain}
              tickFormatter={(v) => fmtPeriod(v, 'M')}
              actions={overlay}
              namedTooltip
            />
          ) : (
            <>
              <FvmLineChart
                title={`CPI ${measure === 'HEADLINE' ? 'Headline' : measure === 'TRIM' ? 'Trimmed mean' : 'Weighted median'} — YoY %`}
                data={yoyChartData}
                lines={[{ key: 'yoy', label: 'YoY actual', color: FMC.headline }, ...paceLines, ...policyLines]}
                targetBand={{ from: 2, to: 3, mid: 2.5, color: FMC.auTargetBand }}
                referenceLegend={[{ label: '2–3% Target', color: FMC.auTargetBand }]}
                height={300}
                range={yoyDomain}
                tickFormatter={tickFmt}
                actions={overlay}
              />
              <FvmLineChart
                title={`${seqName} % — Historical ${chartFreq === 'Q' ? 'quarter-over-quarter' : 'month-over-month'} changes`}
                data={seqChartData}
                lines={[{ key: 'seq', label: `${seqName} %`, color: FMC.mom, width: 1.5 }]}
                zeroLine
                height={250}
                range={seqDomain}
                tickFormatter={tickFmt}
              />
            </>
          )}
        </>
      )}
    </FvmPanel>
  )
}
