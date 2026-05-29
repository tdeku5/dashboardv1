// 2x3 grid of POLICY RATE VS TERM STRUCTURE small-multiples for the Rates →
// GLOBAL tab. Reuses the same backend endpoints the per-country Policy Rate
// tabs do: FRED for the US (EFFR / DGS2 / DGS5 / DGS10 / DGS30 / USREC) and
// `/api/tv/yield-curve/:key` + `/api/overnight-rates/history` for the other
// five countries.
//
// One set of range buttons + one brush slider drives all six charts. A single
// legend at the top controls series visibility across the grid (tenor colours
// are identical across countries by design, so toggling "30Y" hides it
// everywhere). NBER recession shading is rendered only on the US chart, in
// line with the rest of the dashboard's shading convention.
//
// The brush operates on a unified date axis (union of every country's dates
// within the active range cutoff). Each mini-chart filters its rows to the
// [brushStartDate, brushEndDate] window, so dragging the slider compresses
// the visible window in all six charts simultaneously. Range changes remount
// the brush via `key={range}` so it returns to the new full range.
//
// US-only inflation panel and spread sub-charts from the per-country tabs are
// intentionally omitted — the spec calls for a clean 2x3 grid of yield-only
// charts on the Global view.

import { useEffect, useMemo, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchFredSeries, type FredObservation } from '../lib/fred'
import styles from './STIRDashboardPage.module.css'

// ── Visual constants (kept in sync with PolicyRatePage / CountryTermStructure) ──

const COLOR_CASH = '#e2e8f0'
const COLOR_2Y   = '#60a5fa'
const COLOR_5Y   = '#a78bfa'
const COLOR_10Y  = '#34d399'
const COLOR_30Y  = '#f87171'
const COLOR_RECESSION = 'rgba(148, 163, 184, 0.15)'

const TENOR_ORDER = ['2Y', '5Y', '10Y', '30Y'] as const
type TenorLabel = typeof TENOR_ORDER[number]
const TENOR_COLORS: Record<TenorLabel, string> = {
  '2Y': COLOR_2Y, '5Y': COLOR_5Y, '10Y': COLOR_10Y, '30Y': COLOR_30Y,
}

const RANGES = [
  { key: '1y',  label: '1Y',  years: 1 },
  { key: '2y',  label: '2Y',  years: 2 },
  { key: '5y',  label: '5Y',  years: 5 },
  { key: '10y', label: '10Y', years: 10 },
  { key: '20y', label: '20Y', years: 20 },
  { key: 'max', label: 'MAX', years: 100 },
] as const
type RangeKey = typeof RANGES[number]['key']

function cutoffForRange(range: RangeKey): string {
  if (range === 'max') return '1900-01-01'
  const years = RANGES.find(r => r.key === range)!.years
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

// ── Country configs ────────────────────────────────────────────────────────

type CountryKey = 'US' | 'UK' | 'EU' | 'CAD' | 'JPY' | 'AUS'

interface CountryConfig {
  key: CountryKey
  label: string
  cashLabel: string
  isUS?: boolean
  cashSeriesCode?: string
  yieldCurvePageKey?: string
  tenorSymbols?: Record<TenorLabel, string>
}

const COUNTRIES: CountryConfig[] = [
  { key: 'US',  label: 'US',  cashLabel: 'EFFR',     isUS: true },
  { key: 'UK',  label: 'UK',  cashLabel: 'SONIA',    cashSeriesCode: 'SONIA',
    yieldCurvePageKey: 'gilt', tenorSymbols: { '2Y': 'GB02Y', '5Y': 'GB05Y', '10Y': 'GB10Y', '30Y': 'GB30Y' } },
  { key: 'EU',  label: 'EU',  cashLabel: 'ECB DFR',  cashSeriesCode: 'ECBDFR',
    yieldCurvePageKey: 'egb',  tenorSymbols: { '2Y': 'EU02Y', '5Y': 'EU05Y', '10Y': 'EU10Y', '30Y': 'EU30Y' } },
  { key: 'CAD', label: 'CAD', cashLabel: 'CORRA',    cashSeriesCode: 'CORRA',
    yieldCurvePageKey: 'cad',  tenorSymbols: { '2Y': 'CA02Y', '5Y': 'CA05Y', '10Y': 'CA10Y', '30Y': 'CA30Y' } },
  { key: 'JPY', label: 'JPY', cashLabel: 'TONA',     cashSeriesCode: 'TONA',
    yieldCurvePageKey: 'jgb',  tenorSymbols: { '2Y': 'JP02Y', '5Y': 'JP05Y', '10Y': 'JP10Y', '30Y': 'JP30Y' } },
  { key: 'AUS', label: 'AUS', cashLabel: 'AONIA',    cashSeriesCode: 'AONIA',
    yieldCurvePageKey: 'agb',  tenorSymbols: { '2Y': 'AU02Y', '5Y': 'AU05Y', '10Y': 'AU10Y', '30Y': 'AU30Y' } },
]

// ── Data shapes ────────────────────────────────────────────────────────────

interface CountryBundle {
  cash: Map<string, number>
  tenors: Record<TenorLabel, Map<string, number>>
  recession?: Map<string, number>
}

interface YieldCurveApiResp {
  tenors: Array<{ key: string; data: Array<{ date: string; value: number }> }>
}
interface OvernightHistoryResp {
  [seriesCode: string]: Array<{ date: string; value: number }>
}

function parseObs(obs: FredObservation[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of obs) {
    if (!o.value || o.value === '.') continue
    const v = parseFloat(o.value)
    if (Number.isFinite(v)) m.set(o.date, v)
  }
  return m
}

async function fetchUS(): Promise<CountryBundle> {
  const [effr, dgs2, dgs5, dgs10, dgs30, usrec] = await Promise.all([
    fetchFredSeries('EFFR',  { observationStart: '1954-01-01' }),
    fetchFredSeries('DGS2',  { observationStart: '1976-01-01' }),
    fetchFredSeries('DGS5',  { observationStart: '1962-01-01' }),
    fetchFredSeries('DGS10', { observationStart: '1962-01-01' }),
    fetchFredSeries('DGS30', { observationStart: '1977-01-01' }),
    fetchFredSeries('USREC', { observationStart: '1900-01-01' }),
  ])
  return {
    cash: parseObs(effr),
    tenors: {
      '2Y':  parseObs(dgs2),
      '5Y':  parseObs(dgs5),
      '10Y': parseObs(dgs10),
      '30Y': parseObs(dgs30),
    },
    recession: parseObs(usrec),
  }
}

async function fetchNonUS(cfg: CountryConfig): Promise<CountryBundle> {
  const [curveRes, cashRes] = await Promise.all([
    fetch(`/api/tv/yield-curve/${cfg.yieldCurvePageKey}`).then(r => r.json() as Promise<YieldCurveApiResp>),
    fetch(`/api/overnight-rates/history?series=${encodeURIComponent(cfg.cashSeriesCode!)}`)
      .then(r => r.json() as Promise<OvernightHistoryResp>),
  ])
  const cash = new Map<string, number>()
  for (const r of cashRes[cfg.cashSeriesCode!] ?? []) if (r.value != null) cash.set(r.date, r.value)

  const tenors: Record<TenorLabel, Map<string, number>> = {
    '2Y': new Map(), '5Y': new Map(), '10Y': new Map(), '30Y': new Map(),
  }
  for (const label of TENOR_ORDER) {
    const sym = cfg.tenorSymbols![label]
    const t = curveRes.tenors.find(x => x.key === sym)
    if (t) for (const r of t.data) if (r.value != null) tenors[label].set(r.date, r.value)
  }
  return { cash, tenors }
}

async function fetchCountry(cfg: CountryConfig): Promise<CountryBundle> {
  return cfg.isUS ? fetchUS() : fetchNonUS(cfg)
}

// ── Recession bands (US) ───────────────────────────────────────────────────

function buildRecessionBands(usrec: Map<string, number>): Array<{ x1: string; x2: string }> {
  const sorted = Array.from(usrec.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const bands: Array<{ x1: string; x2: string }> = []
  let activeStart: string | null = null
  let prevDate: string | null = null
  for (const [date, v] of sorted) {
    if (v >= 0.5 && activeStart == null) activeStart = date
    else if (v < 0.5 && activeStart != null && prevDate != null) {
      bands.push({ x1: activeStart, x2: prevDate })
      activeStart = null
    }
    prevDate = date
  }
  if (activeStart != null && prevDate != null) bands.push({ x1: activeStart, x2: prevDate })
  return bands
}

function clipBands(
  bands: Array<{ x1: string; x2: string }>,
  cutoff: string,
  lastDate: string,
): Array<{ x1: string; x2: string }> {
  return bands
    .filter(b => b.x2 >= cutoff && b.x1 <= lastDate)
    .map(b => ({
      x1: b.x1 < cutoff   ? cutoff   : b.x1,
      x2: b.x2 > lastDate ? lastDate : b.x2,
    }))
}

// ── Shared UI: range buttons + legend bar ──────────────────────────────────

type Tone = 'on' | 'off'

interface RangeButtonsProps {
  value: RangeKey
  onChange: (r: RangeKey) => void
}
function RangeButtons({ value, onChange }: RangeButtonsProps) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map(r => {
        const active = value === r.key
        return (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            style={{
              padding: '4px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
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

interface LegendEntry { key: string; label: string; color: string }
interface SharedLegendProps {
  entries: LegendEntry[]
  state: Record<string, Tone>
  onToggle: (key: string) => void
}
function SharedLegend({ entries, state, onToggle }: SharedLegendProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 18px',
        padding: '8px 12px',
        marginBottom: 8,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 2,
      }}
    >
      {entries.map(e => {
        const off = state[e.key] === 'off'
        return (
          <button
            key={e.key}
            onClick={() => onToggle(e.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              color: off ? '#475569' : '#cbd5e1',
              opacity: off ? 0.55 : 1,
            }}
            title={off ? 'Show series' : 'Hide series'}
          >
            <span style={{
              width: 14, height: 3, borderRadius: 1, display: 'inline-block',
              background: off ? '#475569' : e.color,
            }} />
            {e.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Mini chart (one country) ───────────────────────────────────────────────

interface MiniChartProps {
  cfg: CountryConfig
  rows: Array<Record<string, number | null | string>>
  bands: Array<{ x1: string; x2: string }>
  toggle: Record<string, Tone>
}

function MiniChart({ cfg, rows, bands, toggle }: MiniChartProps) {
  // Auto-scale the y-axis to the data visible in the current window. `rows` is
  // already clipped to [visibleStart, visibleEnd] upstream, so this recomputes
  // on every range-button click and brush drag. Only legend-visible series
  // count toward the min/max, and each chart computes its own domain — no
  // shared scale across countries. A 5% pad keeps extremes off the edges.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const keys = (['cash', ...TENOR_ORDER] as const).filter(k => toggle[k] !== 'off')
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
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
    const pad = max === min ? Math.max(Math.abs(max) * 0.05, 0.1) : (max - min) * 0.05
    return [min - pad, max + pad]
  }, [rows, toggle])

  return (
    <div
      style={{
        background: 'var(--surface, #0b1220)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#e2e8f0',
        }}>
          {cfg.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.04em',
          color: '#64748b',
        }}>
          {cfg.cashLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="#728197"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            minTickGap={50}
          />
          <YAxis
            stroke="#728197"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={36}
            domain={yDomain ?? ['auto', 'auto']}
            allowDataOverflow={false}
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', fontSize: 11 }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v: unknown) => `${Number(v).toFixed(2)}%`}
          />
          {bands.map((b, i) => (
            <ReferenceArea
              key={`r-${cfg.key}-${i}`}
              x1={b.x1}
              x2={b.x2}
              fill={COLOR_RECESSION}
              fillOpacity={1}
              ifOverflow="visible"
            />
          ))}
          <Line
            type="monotone"
            dataKey="cash"
            name={cfg.cashLabel}
            stroke={COLOR_CASH}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
            hide={toggle.cash === 'off'}
          />
          {TENOR_ORDER.map(t => (
            <Line
              key={t}
              type="monotone"
              dataKey={t}
              name={t}
              stroke={TENOR_COLORS[t]}
              strokeWidth={1.25}
              dot={false}
              connectNulls
              isAnimationActive={false}
              hide={toggle[t] === 'off'}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────

export function GlobalPolicyTermStructureSection() {
  const [bundles, setBundles] = useState<Record<CountryKey, CountryBundle> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('2y')
  const [toggle, setToggle] = useState<Record<string, Tone>>({
    cash: 'on', '2Y': 'on', '5Y': 'on', '10Y': 'on', '30Y': 'on',
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all(COUNTRIES.map(c => fetchCountry(c).then(b => [c.key, b] as const)))
      .then(pairs => {
        if (cancelled) return
        const out = {} as Record<CountryKey, CountryBundle>
        for (const [k, b] of pairs) out[k] = b
        setBundles(out)
        setLoading(false)
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  // Unified date grid across all six countries, filtered to the active range.
  // Drives the brush AND the per-country row grids (so all charts share an
  // X-axis index that the brush can slice into uniformly).
  const unifiedDates = useMemo<string[]>(() => {
    if (!bundles) return []
    const cutoff = cutoffForRange(range)
    const set = new Set<string>()
    for (const cfg of COUNTRIES) {
      const b = bundles[cfg.key]
      for (const d of b.cash.keys()) if (d >= cutoff) set.add(d)
      for (const t of TENOR_ORDER) for (const d of b.tenors[t].keys()) if (d >= cutoff) set.add(d)
    }
    return Array.from(set).sort()
  }, [bundles, range])

  // Brush window — start/end indices into `unifiedDates`. Reset to null on
  // range change (the brush remounts via key={range}, defaulting to full
  // range automatically).
  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null)
  useEffect(() => { setBrushIdx(null) }, [range])

  const visibleStart = brushIdx ? unifiedDates[brushIdx.start] ?? unifiedDates[0] : unifiedDates[0]
  const visibleEnd   = brushIdx ? unifiedDates[brushIdx.end]   ?? unifiedDates[unifiedDates.length - 1] : unifiedDates[unifiedDates.length - 1]

  // Per-country row arrays. Each row carries the date plus every tenor + cash
  // value for that country, nullable where data is missing for the day.
  const perCountryRows = useMemo(() => {
    const out = {} as Record<CountryKey, Array<Record<string, number | null | string>>>
    if (!bundles || unifiedDates.length === 0) {
      for (const c of COUNTRIES) out[c.key] = []
      return out
    }
    const lo = visibleStart ?? unifiedDates[0]
    const hi = visibleEnd ?? unifiedDates[unifiedDates.length - 1]
    for (const cfg of COUNTRIES) {
      const b = bundles[cfg.key]
      const rows: Array<Record<string, number | null | string>> = []
      for (const d of unifiedDates) {
        if (d < lo || d > hi) continue
        const row: Record<string, number | null | string> = { date: d }
        row.cash = b.cash.get(d) ?? null
        for (const t of TENOR_ORDER) row[t] = b.tenors[t].get(d) ?? null
        rows.push(row)
      }
      out[cfg.key] = rows
    }
    return out
  }, [bundles, unifiedDates, visibleStart, visibleEnd])

  // US recession bands — built once per range/window so MiniChart can stay
  // pure. Other countries get an empty array.
  const perCountryBands = useMemo(() => {
    const out = {} as Record<CountryKey, Array<{ x1: string; x2: string }>>
    for (const cfg of COUNTRIES) out[cfg.key] = []
    if (!bundles) return out
    const us = bundles.US
    if (!us.recession || unifiedDates.length === 0) return out
    const cutoff = cutoffForRange(range)
    const lo = visibleStart ?? cutoff
    const hi = visibleEnd ?? unifiedDates[unifiedDates.length - 1]
    out.US = clipBands(buildRecessionBands(us.recession), lo > cutoff ? lo : cutoff, hi)
    return out
  }, [bundles, range, unifiedDates, visibleStart, visibleEnd])

  const legendEntries: LegendEntry[] = [
    { key: 'cash', label: 'Cash Rate (Overnight)', color: COLOR_CASH },
    { key: '2Y',   label: '2Y',                    color: COLOR_2Y },
    { key: '5Y',   label: '5Y',                    color: COLOR_5Y },
    { key: '10Y',  label: '10Y',                   color: COLOR_10Y },
    { key: '30Y',  label: '30Y',                   color: COLOR_30Y },
  ]

  const toggleKey = (key: string) =>
    setToggle(prev => ({ ...prev, [key]: prev[key] === 'off' ? 'on' : 'off' }))

  return (
    <div className={styles.yieldChangesSection}>
      <div className={styles.yieldChangesHeader}>
        <div className={styles.yieldChangesTitle}>GLOBAL POLICY RATE &amp; TERM STRUCTURE</div>
        <RangeButtons value={range} onChange={setRange} />
      </div>

      <SharedLegend entries={legendEntries} state={toggle} onToggle={toggleKey} />

      {loading ? (
        <div className={styles.loading}>Loading global policy rate &amp; term structure…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            {COUNTRIES.map(cfg => (
              <MiniChart
                key={cfg.key}
                cfg={cfg}
                rows={perCountryRows[cfg.key]}
                bands={perCountryBands[cfg.key]}
                toggle={toggle}
              />
            ))}
          </div>

          {/* Shared brush — operates on the unified date grid. Re-mounts on
              range change so the slider resets to the new full window. */}
          {unifiedDates.length > 1 && (
            <div style={{ marginTop: 8 }}>
              <ResponsiveContainer width="100%" height={50}>
                <LineChart
                  data={unifiedDates.map(d => ({ date: d }))}
                  margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                >
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={[0, 1]} />
                  <Brush
                    key={range}
                    dataKey="date"
                    height={36}
                    stroke="#728197"
                    fill="#0d1520"
                    travellerWidth={6}
                    onChange={(e: { startIndex?: number; endIndex?: number } | null) => {
                      if (
                        e &&
                        typeof e.startIndex === 'number' &&
                        typeof e.endIndex === 'number'
                      ) {
                        // Treat "full range" as null so visibleStart/End stay
                        // anchored to unifiedDates[0]/last when nothing is dragged.
                        if (e.startIndex === 0 && e.endIndex === unifiedDates.length - 1) {
                          setBrushIdx(null)
                        } else {
                          setBrushIdx({ start: e.startIndex, end: e.endIndex })
                        }
                      }
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
