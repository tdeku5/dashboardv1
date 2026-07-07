import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchOnsSeries } from '../lib/ons'
import {
  type WD, fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { UK_PROXY_CAVEATS } from '../data/ukProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// UK unemployment-rate scenario projection — port of the US payroll-based
// mechanical model to LFS aggregates. Forward lines are scenario arithmetic
// (user-set employment change + labour-force growth), NOT fabricated data and
// NOT a forecast; they are labeled as such on the panel.

const SERIES = [
  { cdid: 'MGSX', dataset: 'lms' },   // unemployment rate, %, SA (rolling 3m)
  { cdid: 'MGRZ', dataset: 'lms' },   // employment level, thousands, SA (rolling 3m)
  { cdid: 'MGSF', dataset: 'lms' },   // economically active level, thousands, SA (rolling 3m)
] as const

const SCENARIO_COLORS = ['#ef4444', '#f59e0b', '#4ade80', '#60a5fa'] as const
const SCENARIO_KEYS = ['s0', 's1', 's2', 's3'] as const
const DEFAULT_SCENARIOS = ['-25', '0', '25', '50'] as const

const HIST_MONTHS = 36
const PROJ_MONTHS = 12

type ProjRow = {
  date: string
  hist: number | null
  s0: number | null
  s1: number | null
  s2: number | null
  s3: number | null
}

function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

function fmtScenario(s: number): string {
  return `${s >= 0 ? '+' : '−'}${Math.abs(s)}k/mo`
}

/** Green (low u-rate) → amber → red (high u-rate) cell background. */
function heatColor(v: number, min: number, max: number): string {
  if (!isFinite(min) || !isFinite(max) || max <= min) return 'hsl(140, 45%, 16%)'
  const t = Math.min(1, Math.max(0, (v - min) / (max - min)))
  const hue = Math.round(140 * (1 - t))
  return `hsl(${hue}, 50%, 20%)`
}

function parseNum(s: string, fallback: number): number {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

const fmtMillions = (thousands: number): string => `${(thousands / 1000).toFixed(2)}M`

// ══════════════════════════════════════════════════════════════════════════════

export function UKLaborProjectionContent() {
  const [allData, setAllData] = useState<Record<string, WD[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [growthStr, setGrowthStr] = useState('0.05')
  const [scenStrs, setScenStrs] = useState<string[]>([...DEFAULT_SCENARIOS])

  useEffect(() => {
    let cancelled = false
    Promise.all(SERIES.map(s =>
      fetchOnsSeries(s.cdid, s.dataset)
        .then(d => [s.cdid, d] as [string, WD[]])
        .catch(() => [s.cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ONS LFS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const uRate = useMemo(() => allData['MGSX'] ?? [], [allData])
  const latestEmp = useMemo(() => {
    const d = allData['MGRZ'] ?? []
    return d.length ? d[d.length - 1] : null
  }, [allData])
  const latestActive = useMemo(() => {
    const d = allData['MGSF'] ?? []
    return d.length ? d[d.length - 1] : null
  }, [allData])
  const latestU = useMemo(() => uRate.length ? uRate[uRate.length - 1] : null, [uRate])

  const growth = parseNum(growthStr, 0)
  const scenarios = useMemo(() => scenStrs.map(s => parseNum(s, 0)), [scenStrs])

  // u_n per scenario for n = 0..12 (levels in thousands).
  const projections = useMemo((): number[][] | null => {
    if (!latestEmp || !latestActive) return null
    const emp = latestEmp.value
    const active = latestActive.value
    return scenarios.map(s => {
      const path: number[] = []
      for (let n = 0; n <= PROJ_MONTHS; n++) {
        const empN = emp + s * n
        const activeN = active * Math.pow(1 + growth / 100, n)
        path.push(activeN > 0 ? ((activeN - empN) / activeN) * 100 : 0)
      }
      return path
    })
  }, [latestEmp, latestActive, scenarios, growth])

  const chartRows = useMemo((): ProjRow[] => {
    if (!uRate.length || !projections) return []
    const anchor = uRate[uRate.length - 1].date
    const rows: ProjRow[] = uRate.slice(-HIST_MONTHS).map(d => ({
      date: d.date, hist: d.value, s0: null, s1: null, s2: null, s3: null,
    }))
    for (let n = 0; n <= PROJ_MONTHS; n++) {
      if (n === 0) {
        // anchor the scenario lines at the latest observation
        const last = rows[rows.length - 1]
        last.s0 = projections[0][0]
        last.s1 = projections[1][0]
        last.s2 = projections[2][0]
        last.s3 = projections[3][0]
      } else {
        rows.push({
          date: addMonths(anchor, n),
          hist: null,
          s0: projections[0][n],
          s1: projections[1][n],
          s2: projections[2][n],
          s3: projections[3][n],
        })
      }
    }
    return rows
  }, [uRate, projections])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!chartRows.length) return
    setBrush({ start: 0, end: chartRows.length - 1 })
  }, [chartRows.length])

  const yDomain = useMemo((): [number, number] | undefined => {
    const vals: number[] = []
    for (const r of chartRows) {
      for (const k of ['hist', ...SCENARIO_KEYS] as const) {
        const v = r[k]
        if (typeof v === 'number') vals.push(v)
      }
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.2
    return [min - pad, max + pad]
  }, [chartRows])

  // Table heat-scale bounds over months 1..12 across all scenarios.
  const heatBounds = useMemo((): { min: number; max: number } => {
    if (!projections) return { min: 0, max: 0 }
    const vals = projections.flatMap(p => p.slice(1))
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [projections])

  const anchorDate = uRate.length ? uRate[uRate.length - 1].date : null

  if (loading) return <div className={kit.statusBlock}>Loading ONS LFS series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  const thStyle: CSSProperties = {
    textAlign: 'right', padding: '6px 12px', fontWeight: 700,
    letterSpacing: '0.08em', color: '#94A3B8',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  }
  const tdStyle: CSSProperties = {
    textAlign: 'right', padding: '5px 12px', color: '#e2e8f0',
    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  }

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics LFS (LMS) &mdash; monthly, SA, rolling 3-month averages
      </div>

      {/* ── Inputs ───────────────────────────────────────────────────────── */}
      <div className={kit.section}>
        <div className={kit.sectionHeader}>
          <div>
            <div className={kit.sectionTitle}>Scenario Inputs</div>
            <div className={kit.sectionSubtitle}>
              Latest LFS levels + user assumptions &mdash; employment change per scenario (thousands/month) and labour-force growth
            </div>
          </div>
        </div>
        <div className={kit.statsRow}>
          <div className={kit.stat}>
            <span className={kit.statLabel}>Employment (MGRZ)</span>
            <span className={kit.statValue}>{latestEmp ? fmtMillions(latestEmp.value) : '—'}</span>
          </div>
          <div className={kit.stat}>
            <span className={kit.statLabel}>Economically Active (MGSF)</span>
            <span className={kit.statValue}>{latestActive ? fmtMillions(latestActive.value) : '—'}</span>
          </div>
          <div className={kit.stat}>
            <span className={kit.statLabel}>U-Rate (MGSX)</span>
            <span className={kit.statValue}>{latestU ? `${latestU.value.toFixed(1)}%` : '—'}</span>
          </div>
          <div className={kit.stat}>
            <span className={kit.statLabel}>Labour force growth %/month</span>
            <input type="number" step={0.01} value={growthStr}
              onChange={e => setGrowthStr(e.target.value)}
              className={kit.lookbackInput} style={{ width: 68 }} />
          </div>
        </div>
        <div className={kit.statsRow}>
          {scenStrs.map((s, i) => (
            <div key={SCENARIO_KEYS[i]} className={kit.stat}>
              <span className={kit.statLabel} style={{ color: SCENARIO_COLORS[i] }}>
                Scenario {i + 1} &mdash; &Delta;employment k/mo
              </span>
              <input type="number" step={5} value={s}
                onChange={e => setScenStrs(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                className={kit.lookbackInput} style={{ width: 68 }} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Chart ────────────────────────────────────────────────────────── */}
      <div className={kit.section}>
        <div className={kit.sectionHeader}>
          <div>
            <div className={kit.sectionTitle}>
              U-Rate &mdash; History &amp; 12-Month Scenarios
              <ProxyBadge caveat={UK_PROXY_CAVEATS.lfs_rolling} />
            </div>
            <div className={kit.sectionSubtitle}>
              Mechanical scenario arithmetic, not a forecast. LFS levels are rolling 3-month averages.
            </div>
          </div>
        </div>
        <div className={kit.legendRow}>
          <div className={kit.legend}>
            <span className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
              U-rate (MGSX)
            </span>
            {scenarios.map((s, i) => (
              <span key={SCENARIO_KEYS[i]} className={kit.legendItem} style={{ cursor: 'default' }}>
                <span className={kit.legendLine} style={{ background: SCENARIO_COLORS[i] }} />
                {fmtScenario(s)}
              </span>
            ))}
          </div>
        </div>
        <div className={kit.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
                tickFormatter={fmtAxisDate} minTickGap={60} />
              <YAxis domain={yDomain} tick={TICK} tickLine={false} axisLine={false} width={58}
                tickFormatter={fmtPctTick} />
              <Tooltip {...TOOLTIP_STYLE}
                formatter={(v: unknown, name: unknown) => {
                  if (typeof v !== 'number') return ['-', ''] as [string, string]
                  const si = SCENARIO_KEYS.findIndex(k => k === name)
                  const lbl = si >= 0 ? fmtScenario(scenarios[si]) : 'U-rate'
                  return [`${v.toFixed(2)}%`, lbl] as [string, string]
                }} />
              <Line type="monotone" dataKey="hist" name="U-rate"
                stroke="#e2e8f0" strokeWidth={2}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
              {SCENARIO_KEYS.map((k, i) => (
                <Line key={k} type="monotone" dataKey={k} name={fmtScenario(scenarios[i])}
                  stroke={SCENARIO_COLORS[i]} strokeWidth={1.6} strokeDasharray="5 3"
                  dot={false} isAnimationActive={false} legendType="none" />
              ))}
              <Brush dataKey="date"
                startIndex={brush.start}
                endIndex={brush.end}
                onChange={({ startIndex, endIndex }) =>
                  setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                {...BRUSH_STYLE} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Projection table ─────────────────────────────────────────────── */}
      <div className={kit.section}>
        <div className={kit.sectionHeader}>
          <div>
            <div className={kit.sectionTitle}>Projected U-Rate by Scenario</div>
            <div className={kit.sectionSubtitle}>
              Months 1&ndash;12 forward &mdash; u&#8345; = (active&#8345; &minus; emp&#8345;) / active&#8345; &times; 100
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto', padding: '12px 16px' }}>
          <table style={{
            borderCollapse: 'collapse', width: '100%',
            fontFamily: 'var(--font-mono)', fontSize: 11,
          }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>Month</th>
                {scenarios.map((s, i) => (
                  <th key={SCENARIO_KEYS[i]} style={{ ...thStyle, color: SCENARIO_COLORS[i] }}>
                    {fmtScenario(s)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projections && anchorDate && Array.from({ length: PROJ_MONTHS }, (_, r) => r + 1).map(n => (
                <tr key={n}>
                  <td style={{ ...tdStyle, textAlign: 'left', color: '#94A3B8' }}>
                    {fmtAxisDate(addMonths(anchorDate, n))}
                  </td>
                  {projections.map((path, i) => (
                    <td key={SCENARIO_KEYS[i]}
                      style={{ ...tdStyle, background: heatColor(path[n], heatBounds.min, heatBounds.max) }}>
                      {path[n].toFixed(2)}%
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
