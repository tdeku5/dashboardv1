import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { fetchFredSeries, type FredObservation } from '../../lib/fred'
import styles from '../MiscChartsPage.module.css'

/*
 * Headline vs Core CPI (YoY).
 *
 * Reuses the exact series + YoY convention of the US Inflation model
 * (CPIDashboardPage): headline = CPIAUCSL (All Items, SA), core =
 * CPILFESL (ex food & energy, SA). YoY is the 12-month % change computed
 * off a date-keyed map (prior-year same month), identical to that page's
 * computeYoY — so this chart matches the dedicated model exactly.
 *
 * Data is served by the /api/fred proxy, which reads from the SQLite cache
 * (and only hits FRED on a miss), so cached observations are reused.
 */

const HEADLINE_ID = 'CPIAUCSL'
const CORE_ID     = 'CPILFESL'

const HEADLINE_COLOR = '#e2e8f0'  // neutral / near-white
const CORE_COLOR     = '#f59e0b'  // contrasting amber

const RANGES = [
  { label: '1Y',  months: 12       },
  { label: '2Y',  months: 24       },
  { label: '5Y',  months: 60       },
  { label: '10Y', months: 120      },
  { label: 'MAX', months: Infinity },
] as const

const DEFAULT_RANGE = '10Y'

type WD       = { date: string; value: number }
type ChartRow = { date: string; headline: number | null; core: number | null }

// ── Pure helpers (mirrors CPIDashboardPage) ─────────────────────────────────

function parseObs(obs: FredObservation[]): WD[] {
  return obs
    .filter(o => o.value !== '.' && o.value.trim() !== '')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => !isNaN(o.value))
}

function yoyMap(data: WD[]): Map<string, number> {
  const idx = new Map(data.map(d => [d.date, d.value]))
  const out = new Map<string, number>()
  for (const d of data) {
    const [y, m] = d.date.split('-').map(Number)
    const prior  = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const pv     = idx.get(prior)
    if (pv != null && pv !== 0) out.set(d.date, (d.value / pv - 1) * 100)
  }
  return out
}

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January','February','March','April','May','June',
              'July','August','September','October','November','December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const BRUSH_STYLE = {
  height:         30,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  tickFormatter:  fmtAxisDate,
  gap:            3,
} as const

// ── Tooltip ─────────────────────────────────────────────────────────────────

function CpiTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { dataKey: string; value: number | null; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length || typeof label !== 'string') return null
  const find = (k: string) => payload.find(p => p.dataKey === k)?.value
  const rows = [
    { key: 'headline', name: 'Headline CPI', color: HEADLINE_COLOR, value: find('headline') },
    { key: 'core',     name: 'Core CPI',     color: CORE_COLOR,     value: find('core') },
  ]
  return (
    <div style={{
      background:  '#090e15',
      border:      '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      padding:     '6px 10px',
      fontFamily:  'var(--font-mono)',
      fontSize:    '0.8rem',
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>
        {fmtFullDate(label)}
      </div>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{ width: 14, height: 2, background: r.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#64748B', flex: 1, marginRight: 10 }}>{r.name}</span>
          <span style={{ color: '#CBD5E1' }}>
            {r.value == null ? '—' : `${r.value.toFixed(2)}%`}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function HeadlineCoreCpiChart() {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<ChartRow[]>([])

  const [range, setRange]   = useState<string>(DEFAULT_RANGE)
  const [brush, setBrush]   = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [vis, setVis]       = useState<Set<string>>(() => new Set(['headline', 'core']))

  // ── Fetch (cache-backed via /api/fred proxy) ──────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([fetchFredSeries(HEADLINE_ID), fetchFredSeries(CORE_ID)])
      .then(([rawH, rawC]) => {
        if (cancelled) return
        const hYoY = yoyMap(parseObs(rawH))
        const cYoY = yoyMap(parseObs(rawC))
        const dates = [...new Set([...hYoY.keys(), ...cYoY.keys()])].sort()
        const merged: ChartRow[] = dates.map(date => ({
          date,
          headline: hYoY.get(date) ?? null,
          core:     cYoY.get(date) ?? null,
        }))
        setData(merged)

        const end   = Math.max(0, merged.length - 1)
        const months = RANGES.find(r => r.label === DEFAULT_RANGE)!.months
        setBrush({ start: isFinite(months) ? Math.max(0, end - months + 1) : 0, end })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load CPI data')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  // ── Range buttons ─────────────────────────────────────────────────────────
  const selectRange = useCallback((label: string, months: number) => {
    setRange(label)
    const end = data.length - 1
    setBrush({ start: isFinite(months) ? Math.max(0, end - months + 1) : 0, end })
  }, [data.length])

  const onBrush = useCallback((r: { startIndex?: number; endIndex?: number }) => {
    setRange('')
    setBrush(prev => ({ start: r.startIndex ?? prev.start, end: r.endIndex ?? prev.end }))
  }, [])

  // ── Auto-scaling Y domain over the visible window ─────────────────────────
  const yDomain = useMemo((): [number, number] | undefined => {
    if (!data.length) return undefined
    const slice = data.slice(Math.max(0, brush.start), Math.min(data.length, brush.end + 1))
    const vals: number[] = []
    for (const r of slice) {
      if (vis.has('headline') && r.headline != null) vals.push(r.headline)
      if (vis.has('core')     && r.core     != null) vals.push(r.core)
    }
    if (!vals.length) return undefined
    const min = Math.min(...vals, 0)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.08 || 0.5
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [data, brush.start, brush.end, vis])

  const toggle = (key: string) => setVis(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>Headline vs Core CPI (YoY)</div>
          <div className={styles.sectionSubtitle}>
            US CPI · year-over-year % · headline vs ex-food &amp; energy
          </div>
        </div>
      </div>

      {loading && <div className={styles.statusBlock}>Loading CPI data…</div>}
      {error && <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>}

      {!loading && !error && data.length > 0 && (
        <>
          <div className={styles.legendRow}>
            <div className={styles.legend}>
              <button
                type="button"
                className={`${styles.legendItem} ${vis.has('headline') ? '' : styles.legendItemOff}`}
                onClick={() => toggle('headline')}
              >
                <span className={styles.legendLine} style={{ background: HEADLINE_COLOR }} />Headline CPI YoY
              </button>
              <button
                type="button"
                className={`${styles.legendItem} ${vis.has('core') ? '' : styles.legendItemOff}`}
                onClick={() => toggle('core')}
              >
                <span className={styles.legendLine} style={{ background: CORE_COLOR }} />Core CPI YoY
              </button>
            </div>
          </div>

          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={TICK}
                  tickFormatter={fmtAxisDate}
                  minTickGap={48}
                  axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={TICK}
                  domain={yDomain ?? ['auto', 'auto']}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  allowDataOverflow
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                {/* Faint 2% anchor (Fed target is on PCE, but 2% is a useful visual reference) */}
                <ReferenceLine y={2} stroke="rgba(245,158,11,0.22)" strokeDasharray="4 4" strokeWidth={1} />
                <Tooltip content={<CpiTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                {vis.has('headline') && (
                  <Line type="monotone" dataKey="headline" stroke={HEADLINE_COLOR} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                )}
                {vis.has('core') && (
                  <Line type="monotone" dataKey="core" stroke={CORE_COLOR} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                )}
                <Brush
                  dataKey="date"
                  startIndex={brush.start}
                  endIndex={brush.end}
                  onChange={onBrush}
                  {...BRUSH_STYLE}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.quickSelectRow}>
            <span className={styles.quickSelectLabel}>Range</span>
            {RANGES.map(r => (
              <button
                key={r.label}
                type="button"
                className={`${styles.qsBtn} ${range === r.label ? styles.qsBtnActive : ''}`}
                onClick={() => selectRange(r.label, r.months)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
