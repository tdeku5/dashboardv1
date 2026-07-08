import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  fmtAxisDate, fmtPctTick,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Japan unemployment-rate scenario projection — port of the UK/US/CA
// mechanical model to LFS aggregates. Forward lines are scenario arithmetic
// (user-set employment change + labour-force growth), NOT fabricated data and
// NOT a forecast; they are labeled as such on the panel.
//
// TWO Japan-specific twists vs the CA template:
// 1. INPUTS ARE NSA (the LFS API series carry seasonality) — per the UK/CA
//    NSA precedent, read each projected month against the SAME CALENDAR MONTH
//    a year earlier, not against the adjacent months.
// 2. No labour-force level is API-available, so LF is DERIVED from the two
//    published series: lf = employed / (1 − u/100), both at the latest common
//    month. Employed persons publish in TEN-THOUSANDS (6890 = 68.90M).

const ALL_CODES = [
  'UNRATE_JP',   // unemployment rate, %, NSA, LFS
  'JP_EMPLOYED', // employed persons, ten-thousands, NSA, LFS
] as const

const SCENARIO_COLORS = ['#ef4444', '#f59e0b', '#4ade80', '#60a5fa'] as const
const SCENARIO_KEYS = ['s0', 's1', 's2', 's3'] as const
// Δemployment per scenario in TEN-THOUSANDS of persons per month (−10 = −100k/mo).
const DEFAULT_SCENARIOS = ['-10', '0', '10', '20'] as const

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

// Scenario inputs are ten-thousands/mo; display in thousands for readability.
function fmtScenario(s: number): string {
  return `${s >= 0 ? '+' : '−'}${Math.abs(s * 10)}k/mo`
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

// Levels are in ten-thousands of persons: 6890 → 68.90M.
const fmtMillions = (tenThousands: number): string => `${(tenThousands / 100).toFixed(2)}M`

// ══════════════════════════════════════════════════════════════════════════════

export function JPLaborProjectionContent() {
  const [allData, setAllData] = useState<Record<string, EstatPoint[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Japan's labour force is roughly flat (shrinking working-age population
  // offset by rising participation) — default growth 0.00%/month, unlike the
  // CA model's 0.15.
  const [growthStr, setGrowthStr] = useState('0.00')
  const [scenStrs, setScenStrs] = useState<string[]>([...DEFAULT_SCENARIOS])

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat LFS data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const uRate = useMemo(() => allData['UNRATE_JP'] ?? [], [allData])

  // Latest month where BOTH employed persons and the u-rate exist; the
  // labour-force level is derived there: lf = employed / (1 − u/100).
  const anchor = useMemo((): { date: string; emp: number; u: number; lf: number } | null => {
    const emp = allData['JP_EMPLOYED'] ?? []
    const uMap = new Map(uRate.map(p => [p.date, p.value]))
    for (let i = emp.length - 1; i >= 0; i--) {
      const u = uMap.get(emp[i].date)
      if (u != null && u < 100) {
        return { date: emp[i].date, emp: emp[i].value, u, lf: emp[i].value / (1 - u / 100) }
      }
    }
    return null
  }, [allData, uRate])

  const growth = parseNum(growthStr, 0)
  const scenarios = useMemo(() => scenStrs.map(s => parseNum(s, 0)), [scenStrs])

  // u_n per scenario for n = 0..12 (levels in ten-thousands):
  // emp_n = emp + s·n; lf_n = lf·(1+g/100)^n; u_n = (lf_n − emp_n)/lf_n × 100.
  const projections = useMemo((): number[][] | null => {
    if (!anchor) return null
    return scenarios.map(s => {
      const path: number[] = []
      for (let n = 0; n <= PROJ_MONTHS; n++) {
        const empN = anchor.emp + s * n
        const lfN = anchor.lf * Math.pow(1 + growth / 100, n)
        path.push(lfN > 0 ? ((lfN - empN) / lfN) * 100 : 0)
      }
      return path
    })
  }, [anchor, scenarios, growth])

  const chartRows = useMemo((): ProjRow[] => {
    if (!anchor || !projections) return []
    const hist = uRate.filter(d => d.date <= anchor.date)
    if (!hist.length) return []
    const rows: ProjRow[] = hist.slice(-HIST_MONTHS).map(d => ({
      date: d.date, hist: d.value, s0: null, s1: null, s2: null, s3: null,
    }))
    for (let n = 0; n <= PROJ_MONTHS; n++) {
      if (n === 0) {
        // anchor the scenario lines at the latest common observation
        const last = rows[rows.length - 1]
        last.s0 = projections[0][0]
        last.s1 = projections[1][0]
        last.s2 = projections[2][0]
        last.s3 = projections[3][0]
      } else {
        rows.push({
          date: addMonths(anchor.date, n),
          hist: null,
          s0: projections[0][n],
          s1: projections[1][n],
          s2: projections[2][n],
          s3: projections[3][n],
        })
      }
    }
    return rows
  }, [uRate, anchor, projections])

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

  if (loading) return <div className={kit.statusBlock}>Loading e-Stat LFS series...</div>
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
        Statistics Bureau of Japan, Labour Force Survey (e-Stat 0002060001) &mdash; monthly, NSA.
        METHODOLOGY: inputs are NOT seasonally adjusted &mdash; per the UK/CA NSA precedent, read each
        projected month against the SAME CALENDAR MONTH a year earlier, not against adjacent months.
        Levels publish in ten-thousands of persons.
      </div>

      {/* ── Inputs ───────────────────────────────────────────────────────── */}
      <div className={kit.section}>
        <div className={kit.sectionHeader}>
          <div>
            <div className={kit.sectionTitle}>Scenario Inputs</div>
            <div className={kit.sectionSubtitle}>
              Latest LFS levels + user assumptions &mdash; employment change per scenario (ten-thousands/month)
              and labour-force growth. The labour force is derived from employed persons and the unemployment
              rate (lf = emp / (1 &minus; u/100)) &mdash; no LF level is API-available.
            </div>
          </div>
        </div>
        <div className={kit.statsRow}>
          <div className={kit.stat}>
            <span className={kit.statLabel}>Employed (JP_EMPLOYED)</span>
            <span className={kit.statValue}>{anchor ? fmtMillions(anchor.emp) : '—'}</span>
          </div>
          <div className={kit.stat}>
            <span className={kit.statLabel}>Labour Force (derived)</span>
            <span className={kit.statValue}>{anchor ? fmtMillions(anchor.lf) : '—'}</span>
          </div>
          <div className={kit.stat}>
            <span className={kit.statLabel}>U-Rate (UNRATE_JP, NSA)</span>
            <span className={kit.statValue}>{anchor ? `${anchor.u.toFixed(1)}%` : '—'}</span>
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
                Scenario {i + 1} &mdash; &Delta;employment 10k/mo
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
              <ProxyBadge caveat={JP_PROXY_CAVEATS.unemployment_nsa} />
            </div>
            <div className={kit.sectionSubtitle}>
              Mechanical scenario arithmetic, not a forecast. NSA inputs &mdash; compare projected months with
              the same calendar month a year earlier. Labour force derived from employed persons and the
              unemployment rate.
            </div>
          </div>
        </div>
        <div className={kit.legendRow}>
          <div className={kit.legend}>
            <span className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
              U-rate (UNRATE_JP, NSA)
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
            <div className={kit.sectionTitle}>
              Projected U-Rate by Scenario
              <ProxyBadge caveat={JP_PROXY_CAVEATS.unemployment_nsa} />
            </div>
            <div className={kit.sectionSubtitle}>
              Months 1&ndash;12 forward &mdash; u&#8345; = (lf&#8345; &minus; emp&#8345;) / lf&#8345; &times; 100.
              NSA: read each row against the same calendar month a year earlier.
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
              {projections && anchor && Array.from({ length: PROJ_MONTHS }, (_, r) => r + 1).map(n => (
                <tr key={n}>
                  <td style={{ ...tdStyle, textAlign: 'left', color: '#94A3B8' }}>
                    {fmtAxisDate(addMonths(anchor.date, n))}
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
