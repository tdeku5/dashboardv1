// Two cross-country overlay charts for the Rates → GLOBAL tab, sitting between
// the GLOBAL BOND YIELDS - 1 DAY CHANGE matrix and the GLOBAL POLICY RATE &
// TERM STRUCTURE small-multiples grid.
//
//   LEFT  — GLOBAL POLICY RATES & IMPLIED PATHS: each country's realized
//           overnight policy rate (solid) extended forward by its STIR-derived
//           FedWatch implied path (dashed). Historical and forward share one
//           colour per country; the join point is the latest realized rate.
//   RIGHT — GLOBAL REAL POLICY RATES: each country's policy rate minus its
//           central bank's preferred core inflation YoY, monthly (quarterly for
//           AUS). A faint zero line separates restrictive vs accommodative.
//
// Both charts auto-scale their y-axis to the visible window, carry their own
// independent range buttons (default 2Y) + brush slider, and a click-to-toggle
// country legend. Data is read straight from the same backends the per-country
// Policy Rate / Forward Pricing / Fundamental tabs use — no re-computation of
// the FedWatch path or the inflation YoY transforms.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './STIRDashboardPage.module.css'

// ── Countries (colours match the existing Global Forward Curves grid) ────────

type CountryKey = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS'

interface CountryMeta {
  key: CountryKey
  label: string
  color: string
  cashCode: string | null    // overnight-rates series code; null = US (FRED EFFR)
  market: string             // FedWatch market key for the implied path
}

const COUNTRIES: CountryMeta[] = [
  { key: 'US',  label: 'US',  color: '#60a5fa', cashCode: null,     market: 'SR3'  },
  { key: 'UK',  label: 'UK',  color: '#a78bfa', cashCode: 'SONIA',  market: 'SO3'  },
  { key: 'EU',  label: 'EU',  color: '#facc15', cashCode: 'ECBDFR', market: 'EUR'  },
  { key: 'CAD', label: 'CAD', color: '#f87171', cashCode: 'CORRA',  market: 'CRA'  },
  { key: 'JPY', label: 'JPY', color: '#f472b6', cashCode: 'TONA',   market: 'TOA3' },
  { key: 'AUS', label: 'AUS', color: '#22d3ee', cashCode: 'AONIA',  market: 'AUS'  },
]

// ── Range buttons (shared visual with the Policy Rate grid below) ────────────

const RANGES = [
  { key: '1y',  label: '1Y',  years: 1 },
  { key: '2y',  label: '2Y',  years: 2 },
  { key: '5y',  label: '5Y',  years: 5 },
  { key: '10y', label: '10Y', years: 10 },
  { key: '20y', label: '20Y', years: 20 },
  { key: 'max', label: 'MAX', years: 100 },
] as const
type RangeKey = typeof RANGES[number]['key']

function cutoffMsForRange(range: RangeKey): number {
  if (range === 'max') return 0
  const years = RANGES.find(r => r.key === range)!.years
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.getTime()
}

const toMs = (iso: string): number => new Date(iso).getTime()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtAxisDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`
}
function fmtFullDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ── Data transforms (mirrors PolicyRatePage helpers) ─────────────────────────

function parseObs(obs: FredObservation[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of obs) {
    if (!o.value || o.value === '.') continue
    const v = parseFloat(o.value)
    if (Number.isFinite(v)) m.set(o.date, v)
  }
  return m
}

// YoY % on a monthly index level, aligned by calendar month (handles missing
// months without shifting the t-12 denominator). Mirrors computeYoyFromIndex
// in PolicyRatePage.tsx.
function computeYoyFromIndex(idx: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [date, v] of idx) {
    const [yStr, mStr] = date.split('-')
    const y = Number(yStr)
    if (!Number.isFinite(y)) continue
    const priorKey = `${y - 1}-${mStr}-01`
    const p = idx.get(priorKey)
    if (p == null || p === 0) continue
    out.set(date, (v / p - 1) * 100)
  }
  return out
}

// Simple calendar-month average of a daily series, keyed YYYY-MM.
function monthlyAvg(daily: Map<string, number>): Map<string, number> {
  const buckets = new Map<string, { sum: number; n: number }>()
  for (const [d, v] of daily) {
    const ym = d.slice(0, 7)
    const b = buckets.get(ym) ?? { sum: 0, n: 0 }
    b.sum += v
    b.n += 1
    buckets.set(ym, b)
  }
  const out = new Map<string, number>()
  for (const [ym, { sum, n }] of buckets) if (n > 0) out.set(ym, sum / n)
  return out
}

// real_rate(date) = policy_rate_avg(period) − core_inflation_yoy(date).
// Monthly countries align month-on-month; AUS aligns the quarterly Trimmed mean
// (keyed at quarter start) against the quarter's average cash rate.
function realRateSeries(
  policyDaily: Map<string, number>,
  inflYoy: Map<string, number>,
  quarterly: boolean,
): Map<string, number> {
  const mAvg = monthlyAvg(policyDaily)
  const out = new Map<string, number>()
  for (const [date, yoy] of inflYoy) {
    if (!Number.isFinite(yoy)) continue
    if (!quarterly) {
      const p = mAvg.get(date.slice(0, 7))
      if (p != null) out.set(date, +(p - yoy).toFixed(2))
    } else {
      const y = Number(date.slice(0, 4))
      const m = Number(date.slice(5, 7))
      const months = [0, 1, 2].map(i => `${y}-${String(m + i).padStart(2, '0')}`)
      const vals = months.map(k => mAvg.get(k)).filter((v): v is number => v != null)
      if (vals.length > 0) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length
        out.set(date, +(avg - yoy).toFixed(2))
      }
    }
  }
  return out
}

// ── Backend fetch ────────────────────────────────────────────────────────────

// `impliedAvgRate` (the contract-period implied average policy rate) is used
// for the path rather than `effrEnd` (the post-meeting instantaneous rate the
// Summary Table column shows): effrEnd is a per-meeting decomposition that is
// numerically unstable for the quarterly-contract markets (EUR/JPY/AUS), where
// it oscillates wildly. impliedAvgRate is smooth, well-defined for all six, and
// is the standard market-implied forward path. Both come from the same
// FedWatch backend — no re-computation here.
interface FedWatchMeetingLite { meetingDate: string; impliedAvgRate: number }

async function safeJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

interface RawBundle {
  cashByCountry: Record<CountryKey, Map<string, number>>
  fwdByCountry: Record<CountryKey, FedWatchMeetingLite[]>
  inflByCountry: Record<CountryKey, Map<string, number>>
}

async function fetchAll(): Promise<RawBundle> {
  const nonUsCodes = COUNTRIES.map(c => c.cashCode).filter((c): c is string => c != null)

  const [
    effr, pce, cashHist,
    sr3Fw, so3Fw, eurFw, craFw, toaFw, ausFw,
    ukInf, euInf, caInf, jpInf, auInf,
  ] = await Promise.all([
    fetchFredSeries('EFFR', { observationStart: '1990-01-01' }).catch(() => [] as FredObservation[]),
    fetchFredSeries('PCEPILFE', { observationStart: '1990-01-01' }).catch(() => [] as FredObservation[]),
    safeJson<Record<string, Array<{ date: string; value: number }>>>(
      `/api/overnight-rates/history?series=${nonUsCodes.join(',')}&start=1990-01-01`, {}),
    // US implied path: 3M SOFR (SR3) — matches the per-country 3M STIR
    // convention (UK SO3, EU EUR, CAD CRA, JPY TOA3, AUS bank bill) and carries
    // the SOFR→policy spread adjustment already applied in the SR3 Summary
    // Table. Historical (solid) US segment stays EFFR (fetched above).
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=SR3', {}),
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=SO3', {}),
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=EUR', {}),
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=CRA', {}),
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=TOA3', {}),
    safeJson<{ meetings?: FedWatchMeetingLite[] }>('/api/futures/fedwatch?market=AUS', {}),
    safeJson<{ yoyHistorical?: Array<{ date: string; value: number }> }>('/api/uk/fundamental/core_cpi', {}),
    safeJson<{ yoyHistorical?: Array<{ date: string; value: number }> }>('/api/eu/fundamental/core_hicp', {}),
    safeJson<{ coreLines?: { trim?: Array<{ date: string; value: number }> } }>('/api/ca/fundamental/core_cpi', {}),
    safeJson<{ yoyHistorical?: Array<{ date: string; value: number }> }>('/api/jp/fundamental/core_cpi', {}),
    safeJson<{ yoyHistorical?: Array<{ date: string; value: number }> }>('/api/au/fundamental/q_trimmed', {}),
  ])

  const toMap = (pts?: Array<{ date: string; value: number }>): Map<string, number> => {
    const m = new Map<string, number>()
    for (const p of pts ?? []) if (p.value != null && Number.isFinite(p.value)) m.set(p.date, p.value)
    return m
  }

  const cashByCountry = {} as Record<CountryKey, Map<string, number>>
  cashByCountry.US = parseObs(effr)
  cashByCountry.UK = toMap(cashHist['SONIA'])
  cashByCountry.EU = toMap(cashHist['ECBDFR'])
  cashByCountry.CAD = toMap(cashHist['CORRA'])
  cashByCountry.JPY = toMap(cashHist['TONA'])
  cashByCountry.AUS = toMap(cashHist['AONIA'])

  const fwdByCountry = {} as Record<CountryKey, FedWatchMeetingLite[]>
  fwdByCountry.US = sr3Fw.meetings ?? []
  fwdByCountry.UK = so3Fw.meetings ?? []
  fwdByCountry.EU = eurFw.meetings ?? []
  fwdByCountry.CAD = craFw.meetings ?? []
  fwdByCountry.JPY = toaFw.meetings ?? []
  fwdByCountry.AUS = ausFw.meetings ?? []

  const inflByCountry = {} as Record<CountryKey, Map<string, number>>
  inflByCountry.US = computeYoyFromIndex(parseObs(pce))
  inflByCountry.UK = toMap(ukInf.yoyHistorical)
  inflByCountry.EU = toMap(euInf.yoyHistorical)
  inflByCountry.CAD = toMap(caInf.coreLines?.trim)
  inflByCountry.JPY = toMap(jpInf.yoyHistorical)
  inflByCountry.AUS = toMap(auInf.yoyHistorical)

  return { cashByCountry, fwdByCountry, inflByCountry }
}

// ── Shared UI: range buttons + country legend ────────────────────────────────

function RangeButtons({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map(r => {
        const active = value === r.key
        return (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            style={{
              padding: '3px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              color: active ? '#0f172a' : '#94a3b8',
              background: active ? '#60a5fa' : 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 2,
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

function CountryLegend({
  toggle, onToggle,
}: { toggle: Record<CountryKey, boolean>; onToggle: (k: CountryKey) => void }) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 14px',
        padding: '6px 10px', marginBottom: 8,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(255, 255, 255, 0.02)', borderRadius: 2,
      }}
    >
      {COUNTRIES.map(c => {
        const off = !toggle[c.key]
        return (
          <button
            key={c.key}
            onClick={() => onToggle(c.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
              color: off ? '#475569' : '#cbd5e1', opacity: off ? 0.55 : 1,
            }}
            title={off ? 'Show country' : 'Hide country'}
          >
            <span style={{
              width: 14, height: 3, borderRadius: 1, display: 'inline-block',
              background: off ? '#475569' : c.color,
            }} />
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

// Compact tooltip showing only the series that actually have a value at the
// hovered date (each country carries up to two keys on Chart 1, most null on
// any given day — the default tooltip would list a wall of "—").
function ChartTooltip({ active, payload, label }: {
  active?: boolean
  label?: string | number
  payload?: Array<{ name?: string; value?: number; color?: string }>
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(p => typeof p.value === 'number' && Number.isFinite(p.value))
  if (rows.length === 0) return null
  return (
    <div style={{
      background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)',
      padding: '6px 9px', fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>
      <div style={{ color: '#cbd5e1', marginBottom: 4 }}>{fmtFullDate(Number(label))}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, color: r.color }}>
          <span>{r.name}</span>
          <span>{(r.value as number).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Generic overlay chart with range buttons + brush + auto-y-scale ──────────

interface OverlayRow { t: number; [k: string]: number | null }

interface OverlayRangeChartProps {
  title: string
  subtitle: string
  allRows: OverlayRow[]                                    // full history, sorted by t
  valueKeysForCountry: (c: CountryKey) => string[]
  renderLines: (visible: Record<CountryKey, boolean>) => ReactNode
  zeroLine?: boolean
}

function computeYDomain(rows: OverlayRow[], keys: string[]): [number, number] | ['auto', 'auto'] {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k]
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ['auto', 'auto']
  const pad = max === min ? Math.max(Math.abs(max) * 0.05, 0.1) : (max - min) * 0.05
  return [min - pad, max + pad]
}

function OverlayRangeChart({
  title, subtitle, allRows, valueKeysForCountry, renderLines, zeroLine,
}: OverlayRangeChartProps) {
  const [range, setRange] = useState<RangeKey>('2y')
  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null)
  const [toggle, setToggle] = useState<Record<CountryKey, boolean>>(
    () => Object.fromEntries(COUNTRIES.map(c => [c.key, true])) as Record<CountryKey, boolean>,
  )

  // Reset the brush whenever the range button changes (brush remounts via key).
  useEffect(() => { setBrushIdx(null) }, [range])

  const axisRows = useMemo(() => {
    const cutoff = cutoffMsForRange(range)
    return allRows.filter(r => r.t >= cutoff)
  }, [allRows, range])

  const visibleRows = useMemo(() => {
    if (!brushIdx) return axisRows
    return axisRows.slice(brushIdx.start, brushIdx.end + 1)
  }, [axisRows, brushIdx])

  const yKeys = COUNTRIES.filter(c => toggle[c.key]).flatMap(c => valueKeysForCountry(c.key))
  const yDomain = computeYDomain(visibleRows, yKeys)

  const toggleKey = (k: CountryKey) => setToggle(prev => ({ ...prev, [k]: !prev[k] }))

  return (
    <div
      style={{
        background: 'var(--surface, #0b1220)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 2, display: 'flex', flexDirection: 'column', minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, padding: '8px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.06em', color: '#e2e8f0',
          }}>
            {title}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.02em',
            color: '#64748b', marginTop: 2,
          }}>
            {subtitle}
          </div>
        </div>
        <RangeButtons value={range} onChange={setRange} />
      </div>

      <div style={{ padding: '8px 12px 0' }}>
        <CountryLegend toggle={toggle} onToggle={toggleKey} />
      </div>

      <ResponsiveContainer width="100%" height={540}>
        <LineChart data={visibleRows} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            stroke="#728197"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickFormatter={fmtAxisDate}
            minTickGap={48}
          />
          <YAxis
            stroke="#728197"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={40}
            domain={yDomain}
            allowDataOverflow={false}
          />
          <Tooltip content={<ChartTooltip />} />
          {zeroLine && (
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 4" strokeOpacity={0.6} />
          )}
          {renderLines(toggle)}
        </LineChart>
      </ResponsiveContainer>

      {axisRows.length > 1 && (
        <div style={{ padding: '4px 12px 10px' }}>
          <ResponsiveContainer width="100%" height={42}>
            <LineChart data={axisRows} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
              <XAxis dataKey="t" hide type="number" domain={['dataMin', 'dataMax']} />
              <YAxis hide domain={[0, 1]} />
              <Brush
                key={range}
                dataKey="t"
                height={30}
                stroke="#728197"
                fill="#0d1520"
                travellerWidth={6}
                tickFormatter={(ms: number) => fmtAxisDate(ms)}
                onChange={(e: { startIndex?: number; endIndex?: number } | null) => {
                  if (e && typeof e.startIndex === 'number' && typeof e.endIndex === 'number') {
                    if (e.startIndex === 0 && e.endIndex === axisRows.length - 1) setBrushIdx(null)
                    else setBrushIdx({ start: e.startIndex, end: e.endIndex })
                  }
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────

export function GlobalPolicyPathRealRateSection() {
  const [bundle, setBundle] = useState<RawBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAll()
      .then(b => { if (!cancelled) { setBundle(b); setLoading(false) } })
      .catch(err => {
        if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [])

  // Chart 1 — policy rate (solid) + implied path (dashed), per country.
  const pathRows = useMemo<OverlayRow[]>(() => {
    if (!bundle) return []
    const histByCountry = bundle.cashByCountry
    const fwdByCountry = {} as Record<CountryKey, Map<string, number>>
    for (const c of COUNTRIES) {
      const hist = histByCountry[c.key]
      const dates = Array.from(hist.keys()).sort()
      const lastDate = dates[dates.length - 1]
      const fwd = new Map<string, number>()
      if (lastDate != null) {
        // Anchor the forward segment at the latest realized rate so the dashed
        // line joins the solid line cleanly at "today".
        fwd.set(lastDate, hist.get(lastDate)!)
        for (const m of bundle.fwdByCountry[c.key]) {
          if (m.meetingDate > lastDate && Number.isFinite(m.impliedAvgRate)) {
            fwd.set(m.meetingDate, m.impliedAvgRate)
          }
        }
      }
      fwdByCountry[c.key] = fwd
    }

    const dateSet = new Set<string>()
    for (const c of COUNTRIES) {
      for (const d of histByCountry[c.key].keys()) dateSet.add(d)
      for (const d of fwdByCountry[c.key].keys()) dateSet.add(d)
    }
    return Array.from(dateSet).sort().map(d => {
      const row: OverlayRow = { t: toMs(d) }
      for (const c of COUNTRIES) {
        row[`${c.key}_hist`] = histByCountry[c.key].get(d) ?? null
        row[`${c.key}_fwd`] = fwdByCountry[c.key].get(d) ?? null
      }
      return row
    })
  }, [bundle])

  // Chart 2 — real policy rate per country (monthly; AUS quarterly).
  const realRows = useMemo<OverlayRow[]>(() => {
    if (!bundle) return []
    const realByCountry = {} as Record<CountryKey, Map<string, number>>
    for (const c of COUNTRIES) {
      realByCountry[c.key] = realRateSeries(
        bundle.cashByCountry[c.key],
        bundle.inflByCountry[c.key],
        c.key === 'AUS',
      )
    }
    const dateSet = new Set<string>()
    for (const c of COUNTRIES) for (const d of realByCountry[c.key].keys()) dateSet.add(d)
    return Array.from(dateSet).sort().map(d => {
      const row: OverlayRow = { t: toMs(d) }
      for (const c of COUNTRIES) row[`${c.key}_real`] = realByCountry[c.key].get(d) ?? null
      return row
    })
  }, [bundle])

  const renderPathLines = (visible: Record<CountryKey, boolean>): ReactNode =>
    COUNTRIES.flatMap(c => {
      const hide = !visible[c.key]
      return [
        <Line
          key={`${c.key}_hist`} type="monotone" dataKey={`${c.key}_hist`} name={c.label}
          stroke={c.color} strokeWidth={1.5} dot={false} connectNulls
          isAnimationActive={false} hide={hide}
        />,
        <Line
          key={`${c.key}_fwd`} type="monotone" dataKey={`${c.key}_fwd`} name={`${c.label} implied`}
          stroke={c.color} strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls
          isAnimationActive={false} hide={hide}
        />,
      ]
    })

  const renderRealLines = (visible: Record<CountryKey, boolean>): ReactNode =>
    COUNTRIES.map(c => (
      <Line
        key={c.key} type="monotone" dataKey={`${c.key}_real`} name={c.label}
        stroke={c.color} strokeWidth={1.5} dot={false} connectNulls
        isAnimationActive={false} hide={!visible[c.key]}
      />
    ))

  return (
    <div className={styles.yieldChangesSection}>
      <div className={styles.yieldChangesHeader}>
        <div className={styles.yieldChangesTitle}>GLOBAL POLICY PATHS &amp; REAL RATES</div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading global policy paths &amp; real rates…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <OverlayRangeChart
            title="GLOBAL POLICY RATES & IMPLIED PATHS"
            subtitle="Solid = realized overnight rate · Dashed = STIR-implied forward path"
            allRows={pathRows}
            valueKeysForCountry={c => [`${c}_hist`, `${c}_fwd`]}
            renderLines={renderPathLines}
          />
          <OverlayRangeChart
            title="GLOBAL REAL POLICY RATES"
            subtitle="Policy rate − central-bank core inflation YoY · zero = neutral"
            allRows={realRows}
            valueKeysForCountry={c => [`${c}_real`]}
            renderLines={renderRealLines}
            zeroLine
          />
        </div>
      )}
    </div>
  )
}
