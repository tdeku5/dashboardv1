import { useMemo, useState } from 'react'
import styles from '../pages/STIRDashboardPage.module.css'
import { fmtSignedFixed } from './acm'
import { FUNDAMENTAL_MODEL_COLORS as FMC, LABOR_COLORS } from '../constants/identityColors'
import { FvmLineChart, FvmMessage, FvmOverlayToggle, FvmPanel, FvmStats, FvmToggleGroup, type FvmLine } from './fundamentalPanelParts'
import { useJPFundamental, type JPFundamentalTab } from '../hooks/useJPFundamental'

// Japanese sibling of EU/CAD fundamental panels. Two tabs: CPI + LABOR.
// HEADLINE/CORE toggle on the CPI tab maps:
//   HEADLINE → 'cpi'       (CPI_HEADLINE_JP, all-items NSA index)
//   CORE     → 'core_cpi'  (CPI_CORE_JP — ex FRESH FOOD only, the BoJ's targeted
//                           measure; energy stays in)
// Japan's "core" ≠ US/EU "core": it strips fresh food only. The subtitle makes
// this explicit so users from a US/EU mental model don't misread it. Both CPI
// states are index series → both get YoY + MoM + projections (NSA-only).
// CPI_CORECORE_JP (ex fresh food AND energy) is ingested but not surfaced yet.
type VisibleTab = 'cpi' | 'labor'
type HeadlineCore = 'HEADLINE' | 'CORE'

const TABS: Array<{ key: VisibleTab; label: string }> = [
  { key: 'cpi', label: 'CPI' },
  { key: 'labor', label: 'LABOR' },
]

function mapTabToApiKey(tab: VisibleTab, headlineCore: HeadlineCore): JPFundamentalTab {
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

/** Signed MoM in the stats line; a value that rounds to zero prints as 0.00 (near-zero rule). */
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
  policy?: number | null
}

interface MoMRow { date: string; mom: number | null }

const PACE_LINES: FvmLine[] = [
  { key: 'pace1m', label: '1M MoM', color: FMC.pace1, dash: '5 4' },
  { key: 'pace3m', label: '3M MoM avg', color: FMC.pace3, dash: '5 4' },
  { key: 'pace6m', label: '6M MoM avg', color: FMC.pace6, dash: '5 4' },
]
const HC_OPTIONS = [{ key: 'HEADLINE', label: 'HEADLINE' }, { key: 'CORE', label: 'CORE' }] as const

export function JPFundamentalModelPanel() {
  const [activeTab, setActiveTab] = useState<VisibleTab>('cpi')
  const [headlineCore, setHeadlineCore] = useState<HeadlineCore>('HEADLINE')
  const [range, setRange] = useState<RangeKey>('1y')
  const [showPolicy, setShowPolicy] = useState(false)

  const apiTab = mapTabToApiKey(activeTab, headlineCore)
  const { data, loading, error } = useJPFundamental(apiTab)

  const isInflation = activeTab === 'cpi'

  // Daily BoJ policy rate (TONA) → monthly: last obs per calendar month.
  const policyMonthly = useMemo(() => {
    const map = new Map<string, number>()
    if (!data?.bojRate) return map
    for (const p of data.bojRate) map.set(`${p.date.slice(0, 7)}-01`, p.value)
    return map
  }, [data?.bojRate])

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

    if (showPolicy) {
      for (const r of rows) r.policy = policyMonthly.get(r.date) ?? null
    }

    return rows.filter((r) => !cutoff || r.date >= cutoff || r.date > currentDate)
  }, [data, cutoff, currentDate, showPolicy, policyMonthly])

  const momChartData = useMemo<MoMRow[]>(() => {
    if (!data || data.kind !== 'index') return []
    return data.momHistorical
      .map((p) => ({ date: p.date, mom: p.value }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff])

  const laborChartData = useMemo(() => {
    if (!data || data.kind !== 'rate') return [] as Array<{ date: string; rate: number; policy?: number | null }>
    return data.series
      .map((p) => ({
        date: p.date,
        rate: p.value,
        policy: showPolicy ? policyMonthly.get(p.date) ?? null : undefined,
      }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff, showPolicy, policyMonthly])

  const yoyDomain = useMemo<[number | string, number | string]>(() => {
    const values = yoyChartData
      .flatMap((d) => [d.yoy, d.pace1m, d.pace3m, d.pace6m, ...(showPolicy ? [d.policy ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values, 2)
    const max = Math.max(...values, 2)
    const pad = Math.max(0.5, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [yoyChartData, showPolicy])

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
      .flatMap((d) => [d.rate, ...(showPolicy ? [d.policy ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.2, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [laborChartData, showPolicy])

  const latest = data?.latestReading

  const statsLine = (() => {
    if (!latest) return ''
    if (activeTab === 'labor') {
      return `LATEST: ${fmtShortMonthYear(latest.date)} | Unemployment: ${latest.indexLevel != null ? `${latest.indexLevel.toFixed(1)}%` : '—'}`
    }
    return `LATEST: ${fmtShortMonthYear(latest.date)} | Index: ${latest.indexLevel != null ? latest.indexLevel.toFixed(1) : '—'} | MoM: ${latest.mom != null ? `${fmtSignedPct(latest.mom)}%` : '—'} | YoY: ${fmtPct(latest.yoy)}`
  })()

  const policyLines: FvmLine[] = showPolicy ? [{ key: 'policy', label: 'BoJ Policy Rate', color: FMC.policyRate, width: 1.5 }] : []
  const overlay = <FvmOverlayToggle label="BOJ POLICY RATE" on={showPolicy} onToggle={() => setShowPolicy((v) => !v)} />

  return (
    <FvmPanel
      actions={isInflation && <FvmToggleGroup options={HC_OPTIONS} value={headlineCore} onChange={setHeadlineCore} />}
      note={isInflation ? 'Core = ex fresh food (Japan convention)' : undefined}
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
              title="Unemployment rate (NSA)"
              data={laborChartData}
              lines={[{ key: 'rate', label: 'Unemployment Rate', color: LABOR_COLORS.u3 }, ...policyLines]}
              height={350}
              range={laborDomain}
              tickFormatter={fmtShortMonthYear}
              actions={overlay}
            />
          ) : (
            <>
              <FvmLineChart
                title={`CPI ${headlineCore === 'CORE' ? 'Core (ex fresh food)' : 'Headline'} — YoY %`}
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
