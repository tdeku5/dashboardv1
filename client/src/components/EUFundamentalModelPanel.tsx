import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styles from '../pages/STIRDashboardPage.module.css'
import { useEUFundamental, type EUFundamentalTab } from '../hooks/useEUFundamental'

// Euro-area sibling of UKFundamentalModelPanel. Two tabs for now: HICP + LABOR
// (no GROWTH — no EU GDP series ingested yet).
//
// HEADLINE/CORE toggle on the HICP tab maps to:
//   HEADLINE → 'hicp'       (HICP_HEADLINE, overall index)
//   CORE     → 'core_hicp'  (HICP_SUPERCORE — excl. energy & food, i.e. the
//                            market-standard euro area "core")
// The middle measure HICP_CORE (excl. energy & unprocessed food) is ingested in
// the DB but intentionally NOT surfaced in this toggle yet — a third toggle
// state would clutter the model. Add it here later if needed.
type VisibleTab = 'hicp' | 'labor'
type HeadlineCore = 'HEADLINE' | 'CORE'

const TABS: Array<{ key: VisibleTab; label: string }> = [
  { key: 'hicp', label: 'HICP' },
  { key: 'labor', label: 'LABOR' },
]

function mapTabToApiKey(tab: VisibleTab, headlineCore: HeadlineCore): EUFundamentalTab {
  if (tab === 'hicp') return headlineCore === 'CORE' ? 'core_hicp' : 'hicp'
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

const FVM_TICK = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#94A3B8' }
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtShortMonthYear(d: string): string {
  const [y, m] = d.split('-')
  return `${SHORT_MONTHS[parseInt(m, 10) - 1]} ${y}`
}

function fmtSignedPct(v: number | null, digits = 2): string {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}`
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
  dfr?: number | null
}

interface MoMRow { date: string; mom: number | null }

export function EUFundamentalModelPanel() {
  const [activeTab, setActiveTab] = useState<VisibleTab>('hicp')
  const [headlineCore, setHeadlineCore] = useState<HeadlineCore>('HEADLINE')
  const [range, setRange] = useState<RangeKey>('1y')
  const [showDfr, setShowDfr] = useState(false)

  const apiTab = mapTabToApiKey(activeTab, headlineCore)
  const { data, loading, error } = useEUFundamental(apiTab)

  const isInflation = activeTab === 'hicp'

  // Daily DFR → monthly: last observation in each calendar month at YYYY-MM-01.
  const dfrMonthly = useMemo(() => {
    const map = new Map<string, number>()
    if (!data?.dfr) return map
    for (const p of data.dfr) map.set(`${p.date.slice(0, 7)}-01`, p.value)
    return map
  }, [data?.dfr])

  const currentDate = data?.latestReading.date ?? ''
  const cutoff = useMemo(() => getRangeCutoff(range, currentDate), [range, currentDate])

  const yoyChartData = useMemo<YoYRow[]>(() => {
    if (!data) return []
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

    if (showDfr) {
      for (const r of rows) r.dfr = dfrMonthly.get(r.date) ?? null
    }

    return rows.filter((r) => !cutoff || r.date >= cutoff || r.date > currentDate)
  }, [data, cutoff, currentDate, showDfr, dfrMonthly])

  const momChartData = useMemo<MoMRow[]>(() => {
    if (!data) return []
    return data.momHistorical
      .map((p) => ({ date: p.date, mom: p.value }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff])

  const laborChartData = useMemo(() => {
    if (!data) return [] as Array<{ date: string; rate: number; dfr?: number | null }>
    return data.series
      .map((p) => ({
        date: p.date,
        rate: p.value,
        dfr: showDfr ? dfrMonthly.get(p.date) ?? null : undefined,
      }))
      .filter((r) => !cutoff || r.date >= cutoff)
  }, [data, cutoff, showDfr, dfrMonthly])

  const yoyDomain = useMemo<[number | string, number | string]>(() => {
    const values = yoyChartData
      .flatMap((d) => [d.yoy, d.pace1m, d.pace3m, d.pace6m, ...(showDfr ? [d.dfr ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values, isInflation ? 2 : Infinity)
    const max = Math.max(...values, isInflation ? 2 : -Infinity)
    const pad = Math.max(0.5, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [yoyChartData, showDfr, isInflation])

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
      .flatMap((d) => [d.rate, ...(showDfr ? [d.dfr ?? null] : [])])
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (values.length === 0) return ['auto', 'auto']
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max(0.3, (max - min) * 0.08)
    return [min - pad, max + pad]
  }, [laborChartData, showDfr])

  const latest = data?.latestReading

  return (
    <div className={styles.fvmPanel}>
      <div className={styles.fvmHeader}>
        <h2 className={styles.fvmTitle}>FUNDAMENTAL MODEL</h2>
        {isInflation && (
          <div className={styles.fvmMeasureToggle}>
            <button
              className={`${styles.fvmMeasureBtn} ${headlineCore === 'HEADLINE' ? styles.fvmMeasureBtnActive : ''}`}
              onClick={() => setHeadlineCore('HEADLINE')}
              style={{ border: `1px solid ${headlineCore === 'HEADLINE' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}` }}
            >
              HEADLINE
            </button>
            <button
              className={`${styles.fvmMeasureBtn} ${headlineCore === 'CORE' ? styles.fvmMeasureBtnActive : ''}`}
              onClick={() => setHeadlineCore('CORE')}
              style={{
                border: `1px solid ${headlineCore === 'CORE' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.12)'}`,
                borderLeft: 'none',
              }}
            >
              CORE
            </button>
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
            <div className={styles.fvmStatsLine}>
              {activeTab === 'labor'
                ? `LATEST: ${fmtShortMonthYear(latest.date)} | Unemployment: ${latest.indexLevel.toFixed(1)}%`
                : `LATEST: ${fmtShortMonthYear(latest.date)} | Index: ${latest.indexLevel.toFixed(3)} | MoM: ${latest.mom != null ? `${fmtSignedPct(latest.mom)}%` : '—'} | YoY: ${latest.yoy != null ? `${latest.yoy.toFixed(2)}%` : '—'}`}
            </div>

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
              onClick={() => setShowDfr((v) => !v)}
              style={{
                background: showDfr ? 'rgba(167, 139, 250, 0.08)' : 'transparent',
                border: `1px solid ${showDfr ? '#a78bfa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: showDfr ? '#a78bfa' : '#728197',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                fontWeight: 600,
                padding: '3px 10px',
                cursor: 'pointer',
                borderRadius: '2px',
                marginBottom: '6px',
              }}
            >
              ECB DFR
            </button>

            {activeTab === 'labor' ? (
              <>
                <div className={styles.fvmLegend}>
                  <span style={{ color: '#e2e8f0' }}>― Unemployment Rate</span>
                  {showDfr && <span style={{ color: '#a78bfa' }}>― ECB DFR</span>}
                </div>

                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={laborChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={fmtShortMonthYear} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={laborDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                    />
                    <Line type="monotone" dataKey="rate" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls name="Unemployment Rate" />
                    {showDfr && (
                      <Line type="monotone" dataKey="dfr" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="ECB DFR" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <>
                <div className={styles.fvmLegend}>
                  <span style={{ color: '#e2e8f0' }}>― YoY actual</span>
                  <span style={{ color: '#4ade80' }}>-- 1M MoM</span>
                  <span style={{ color: '#22d3ee' }}>-- 3M MoM avg</span>
                  <span style={{ color: '#fbbf24' }}>-- 6M MoM avg</span>
                  <span style={{ color: '#EF5350' }}>-- 2% Target</span>
                  {showDfr && <span style={{ color: '#a78bfa' }}>― ECB DFR</span>}
                </div>

                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={yoyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={fmtShortMonthYear} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={yoyDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                    />
                    <ReferenceLine y={2} stroke="#EF5350" strokeDasharray="8 4" />
                    <Line type="monotone" dataKey="yoy" stroke="#e2e8f0" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="pace1m" stroke="#4ade80" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="pace3m" stroke="#22d3ee" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="pace6m" stroke="#fbbf24" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                    {showDfr && (
                      <Line type="monotone" dataKey="dfr" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="ECB DFR" />
                    )}
                  </LineChart>
                </ResponsiveContainer>

                <div className={styles.fvmSectionLabel}>MoM % — Historical month-over-month changes</div>

                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={momChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="#728197" tick={FVM_TICK} tickFormatter={fmtShortMonthYear} minTickGap={24} />
                    <YAxis stroke="#728197" tick={FVM_TICK} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={42} domain={momDomain} allowDataOverflow />
                    <Tooltip
                      contentStyle={{ background: '#090e15', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10 }}
                      labelStyle={{ color: '#94A3B8' }}
                      formatter={(value: unknown) => (typeof value === 'number' ? `${value.toFixed(2)}%` : '—')}
                      labelFormatter={(value: unknown) => (typeof value === 'string' ? fmtShortMonthYear(value) : '')}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                    <Line type="monotone" dataKey="mom" stroke="#4EC9B0" strokeWidth={1.5} dot={false} connectNulls />
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
