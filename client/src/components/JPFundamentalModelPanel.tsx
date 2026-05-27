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

      {isInflation && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: '#5b6b7d', marginTop: '-2px', marginBottom: '4px' }}>
          Core = ex fresh food (Japan convention)
        </div>
      )}

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
              BOJ POLICY RATE
            </button>

            {activeTab === 'labor' ? (
              <>
                <div className={styles.fvmLegend}>
                  <span style={{ color: '#e2e8f0' }}>― Unemployment Rate (NSA)</span>
                  {showPolicy && <span style={{ color: '#a78bfa' }}>― BoJ Policy Rate</span>}
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
                    {showPolicy && (
                      <Line type="monotone" dataKey="policy" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="BoJ Policy Rate" />
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
                  {showPolicy && <span style={{ color: '#a78bfa' }}>― BoJ Policy Rate</span>}
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
                    {showPolicy && (
                      <Line type="monotone" dataKey="policy" stroke="#a78bfa" strokeWidth={1.5} dot={false} connectNulls name="BoJ Policy Rate" />
                    )}
                  </LineChart>
                </ResponsiveContainer>

                <div className={styles.fvmSectionLabel}>MoM % — Historical month-over-month changes (NSA)</div>

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
