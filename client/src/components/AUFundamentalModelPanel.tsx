import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styles from '../pages/STIRDashboardPage.module.css'
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

const FVM_TICK = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#94A3B8' }
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtPeriod(d: string, freq: 'M' | 'Q'): string {
  const [y, m] = d.split('-')
  if (freq === 'Q') {
    const q = Math.floor((parseInt(m, 10) - 1) / 3) + 1
    return `Q${q} ${y}`
  }
  return `${SHORT_MONTHS[parseInt(m, 10) - 1]} ${y}`
}

function fmtSignedPct(v: number | null, digits = 2): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}`
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

  return (
    <div className={styles.fvmPanel}>
      <div className={styles.fvmHeader} style={isInflation ? { alignItems: 'flex-start' } : undefined}>
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.fvmTitle}>FUNDAMENTAL MODEL</h2>
          {isInflation && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#5b6b7d', marginTop: '3px' }}>
              {subtitleFor(freq, measure)}
            </div>
          )}
        </div>
        {isInflation && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: '10px', rowGap: '4px' }}>
            <div className={styles.fvmMeasureToggle}>
              {(['MONTHLY', 'QUARTERLY'] as Freq[]).map((f, idx) => (
                <button
                  key={f}
                  className={`${styles.fvmMeasureBtn} ${freq === f ? styles.fvmMeasureBtnActive : ''}`}
                  onClick={() => setFreq(f)}
                  style={{
                    border: `1px solid ${freq === f ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                    ...(idx > 0 ? { borderLeft: 'none' } : {}),
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className={styles.fvmMeasureToggle}>
              {MEASURES.map((m, idx) => (
                <button
                  key={m}
                  className={`${styles.fvmMeasureBtn} ${measure === m ? styles.fvmMeasureBtnActive : ''}`}
                  onClick={() => setMeasure(m)}
                  style={{
                    border: `1px solid ${measure === m ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                    ...(idx > 0 ? { borderLeft: 'none' } : {}),
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.fvmTabs}>
        {TABS.map((tab, idx) => (
          <button
            key={tab.key}
            className={`${styles.fvmTab} ${activeTab === tab.key ? styles.fvmTabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: `1px solid ${activeTab === tab.key ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
              ...(idx > 0 ? { borderLeft: 'none' } : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.fvmBody}>
        {error ? (
          <div className={styles.comingSoon}>{error}</div>
        ) : loading || !data || !latest ? (
          <div className={styles.comingSoon}>Loading {TABS.find((t) => t.key === activeTab)?.label} model…</div>
        ) : (
          <>
            <div className={styles.fvmStatsLine}>{statsLine}</div>

            <div className={styles.fvmRangeBar}>
              {RANGES.map((r, idx) => (
                <button
                  key={r.key}
                  className={`${styles.fvmRangeBtn} ${range === r.key ? styles.fvmRangeBtnActive : ''}`}
                  onClick={() => setRange(r.key)}
                  style={{
                    border: `1px solid ${range === r.key ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                    ...(idx > 0 ? { borderLeft: 'none' } : {}),
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowPolicy((v) => !v)}
              style={{
                background: showPolicy ? 'rgba(167, 139, 250, 0.08)' : 'transparent',
                border: `1px solid ${showPolicy ? '#a78bfa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: showPolicy ? '#a78bfa' : '#728197',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                fontWeight: 600,
                padding: '3px 10px',
                cursor: 'pointer',
                borderRadius: '2px',
                marginBottom: '6px',
              }}
            >
              RBA CASH RATE
            </button>

            {activeTab === 'labor' ? (
              <>
                <div className={styles.fvmLegend}>
                  <span style={{ color: '#e2e8f0' }}>― Unemployment (SA)</span>
                  <span style={{ color: '#fbbf24' }}>― Trend</span>
                  {showPolicy && <span style={{ color: '#a78bfa' }}>― RBA Cash Rate</span>}
                </div>

                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={laborChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={tickFmt} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={laborDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtPeriod(value, 'M') : '')}
                    />
                    <Line type="monotone" dataKey="rate" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls name="Unemployment (SA)" />
                    <Line type="monotone" dataKey="trend" stroke="#fbbf24" strokeWidth={1.8} dot={false} connectNulls name="Trend" />
                    {showPolicy && (
                      <Line type="monotone" dataKey="policy" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="RBA Cash Rate" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <>
                <div className={styles.fvmLegend}>
                  <span style={{ color: '#e2e8f0' }}>― YoY actual</span>
                  <span style={{ color: '#4ade80' }}>-- {paceLabel(paceWindows[0], chartFreq)}</span>
                  <span style={{ color: '#22d3ee' }}>-- {paceLabel(paceWindows[1], chartFreq)}</span>
                  <span style={{ color: '#fbbf24' }}>-- {paceLabel(paceWindows[2], chartFreq)}</span>
                  <span style={{ color: '#34d399' }}>▮ 2–3% Target</span>
                  {showPolicy && <span style={{ color: '#a78bfa' }}>― RBA Cash Rate</span>}
                </div>

                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={yoyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={tickFmt} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={yoyDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtPeriod(value, chartFreq) : '')}
                    />
                    <ReferenceArea y1={2} y2={3} fill="#34d399" fillOpacity={0.07} />
                    <ReferenceLine y={2.5} stroke="#34d399" strokeDasharray="8 4" strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="yoy" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="p1" stroke="#4ade80" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="p2" stroke="#22d3ee" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="p3" stroke="#fbbf24" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    {showPolicy && (
                      <Line type="monotone" dataKey="policy" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="RBA Cash Rate" />
                    )}
                  </LineChart>
                </ResponsiveContainer>

                <div className={styles.fvmSectionLabel}>
                  {seqName} % — Historical {chartFreq === 'Q' ? 'quarter-over-quarter' : 'month-over-month'} changes
                </div>

                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={seqChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={tickFmt} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={seqDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtPeriod(value, chartFreq) : '')}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                    <Line type="monotone" dataKey="seq" stroke="#4EC9B0" strokeWidth={1.5} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
