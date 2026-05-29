// DXY vs the US-minus-foreign 2Y spread. The spread is the dollar's rate
// advantage over a six-country foreign basket (CA, FR, DE, IT, GB, JP, equal-
// weighted) — i.e. the carry differential that actually drives FX, rather
// than the foreign level in isolation.
//
//   spread[t] = US_2Y[t] − mean(CA, FR, DE, IT, GB, JP at t)
//
// Dual axis so DXY (~100) and the spread (~−2 to +3 ppts, can go negative)
// don't squash each other. Zero on the spread axis is meaningful — it's the
// rate-advantage flip — so a ReferenceLine marks it.
//
// Data: foreign 2Ys come from tv_series (useTvSeries — same tickers the
// rates pages use). The US 2Y comes from FRED DGS2 (the source the rates
// pages' US term-structure chart uses); we fetch it once on mount via the
// same /api/fred proxy.

import { useEffect, useMemo, useState } from 'react'
import {
  Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTvSeries, type TvSeriesPoint } from '../hooks/useTvSeries'
import { fetchFredSeries } from '../lib/fred'
import styles from '../pages/VolPage.module.css'

// ── Range buttons (match the Vol tab convention) ─────────────────────────────
const RANGES = [
  { key: '1y',  label: '1Y',  days: 365 },
  { key: '2y',  label: '2Y',  days: 730 },
  { key: '5y',  label: '5Y',  days: 1825 },
  { key: 'max', label: 'MAX', days: -1 },
] as const
type RangeKey = typeof RANGES[number]['key']

const DXY_COLOR = '#e2e8f0'
const SPREAD_COLOR = '#22d3ee'

// ── helpers (mirror VolPage) ─────────────────────────────────────────────────
const tsToMs = (s: string): number => Number(s) * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtAxisDate = (ms: number): string => {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`
}
const fmtFullDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function tsMapByDay(points: TvSeriesPoint[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const p of points) {
    const d = new Date(tsToMs(p.time))
    const dayMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    m.set(dayMs, p.close)
  }
  return m
}

function applyRange<T extends { t: number }>(rows: T[], range: RangeKey): T[] {
  if (range === 'max') return rows
  const ms = RANGES.find(r => r.key === range)!.days * 24 * 3600 * 1000
  const cutoff = Date.now() - ms
  return rows.filter(r => r.t >= cutoff)
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: number | string
}) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  const rows = payload.filter(p => typeof p.value === 'number' && Number.isFinite(p.value))
  if (rows.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{fmtFullDate(label)}</div>
      {rows.map((p, i) => {
        const v = p.value as number
        // DXY is a level (~100); the spread is in percentage points and can be
        // negative — render with a sign and a "ppts" suffix to flag it.
        const text = p.name === 'DXY'
          ? v.toFixed(2)
          : `${v >= 0 ? '+' : ''}${v.toFixed(2)} ppts`
        return (
          <div key={i} className={styles.tooltipRow} style={{ color: p.color }}>
            <span>{p.name}</span>
            <span>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

// Fetch DGS2 once on mount. We use the same /api/fred proxy as the rates
// pages — keeping one US 2Y source of truth — and parse "YYYY-MM-DD" obs into
// a Map<dayMs, value> that aligns with tsMapByDay so per-date joins are cheap.
function useUs2yFred(): { map: Map<number, number>; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ map: Map<number, number>; loading: boolean; error: string | null }>(
    { map: new Map(), loading: true, error: null }
  )
  useEffect(() => {
    let cancelled = false
    fetchFredSeries('DGS2', { observationStart: '1976-01-01' })
      .then(obs => {
        if (cancelled) return
        const m = new Map<number, number>()
        for (const o of obs) {
          if (!o.value || o.value === '.') continue
          const v = parseFloat(o.value)
          if (!Number.isFinite(v)) continue
          // o.date is "YYYY-MM-DD" UTC midnight.
          const [y, mo, d] = o.date.split('-').map(Number)
          m.set(Date.UTC(y, mo - 1, d), v)
        }
        setState({ map: m, loading: false, error: null })
      })
      .catch(err => {
        if (cancelled) return
        setState({ map: new Map(), loading: false, error: String(err?.message ?? err) })
      })
    return () => { cancelled = true }
  }, [])
  return state
}

// ── Component ────────────────────────────────────────────────────────────────

export function DxyForeignYieldsChart() {
  const [range, setRange] = useState<RangeKey>('1y')

  const dxy = useTvSeries('DXY')
  // Six foreign 2Y series, fetched independently — useTvSeries memoizes the
  // promise per symbol; calling six hooks is the simple, idiomatic shape.
  const ca = useTvSeries('CA02Y')
  const fr = useTvSeries('FR02Y')
  const de = useTvSeries('DE02Y')
  const it = useTvSeries('IT02Y')
  const gb = useTvSeries('GB02Y')
  const jp = useTvSeries('JP02Y')
  const us = useUs2yFred()

  const loading = dxy.loading || ca.loading || fr.loading || de.loading || it.loading || gb.loading || jp.loading || us.loading
  const error = dxy.error ?? ca.error ?? fr.error ?? de.error ?? it.error ?? gb.error ?? jp.error ?? us.error

  const dataFull = useMemo(() => {
    const maps = {
      dxy: tsMapByDay(dxy.data),
      us:  us.map,
      ca:  tsMapByDay(ca.data),
      fr:  tsMapByDay(fr.data),
      de:  tsMapByDay(de.data),
      it:  tsMapByDay(it.data),
      gb:  tsMapByDay(gb.data),
      jp:  tsMapByDay(jp.data),
    }
    const days = new Set<number>()
    for (const m of Object.values(maps)) for (const k of m.keys()) days.add(k)
    return [...days].sort((a, b) => a - b).map(t => {
      const ys = [maps.ca.get(t), maps.fr.get(t), maps.de.get(t), maps.it.get(t), maps.gb.get(t), maps.jp.get(t)]
      // Require ALL six countries present — partial averages would distort the
      // series (e.g. a missing JP would silently lift the mean by ~50bp).
      const valid = ys.filter((y): y is number => y != null && Number.isFinite(y))
      const avgY2 = valid.length === 6 ? valid.reduce((a, b) => a + b, 0) / 6 : null
      const usY2 = maps.us.get(t) ?? null
      // Spread only exists where BOTH the US 2Y and the full six-country mean
      // exist on the same day. Otherwise leave it null and connectNulls bridges.
      const spread = (avgY2 != null && usY2 != null) ? usY2 - avgY2 : null
      return { t, dxy: maps.dxy.get(t) ?? null, spread }
    })
  }, [dxy.data, ca.data, fr.data, de.data, it.data, gb.data, jp.data, us.map])

  const data = useMemo(() => applyRange(dataFull, range), [dataFull, range])

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.panelTitle}>DXY vs US−FOREIGN 2Y SPREAD</div>
          <div className={styles.panelSubtitle}>US Dollar Index vs (US 2Y − avg foreign 2Y: CA, FR, DE, IT, GB, JP)</div>
        </div>
        <div className={styles.rangeRow}>
          {RANGES.map(r => (
            <button
              key={r.key}
              className={`${styles.rangeBtn} ${range === r.key ? styles.rangeBtnOn : ''}`}
              onClick={() => setRange(r.key)}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.legend}>
        <span><span className={styles.swatch} style={{ background: DXY_COLOR }} />DXY (left axis)</span>
        <span><span className={styles.swatch} style={{ background: SPREAD_COLOR }} />US−Foreign 2Y spread (right axis)</span>
      </div>

      {loading
        ? <div className={styles.placeholder}>Loading…</div>
        : error
          ? <div className={styles.placeholder}>{error}</div>
          : data.length === 0
            ? <div className={styles.placeholder}>No data in selected range.</div>
            : (
              <ResponsiveContainer width="100%" height={520}>
                <LineChart data={data} margin={{ top: 12, right: 12, left: 12, bottom: 6 }}>
                  <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                    stroke="#728197" tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    tickFormatter={fmtAxisDate} minTickGap={40}
                  />
                  <YAxis
                    yAxisId="dxy" orientation="left" stroke={DXY_COLOR}
                    tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)} domain={['auto', 'auto']} width={42}
                  />
                  <YAxis
                    yAxisId="spread" orientation="right" stroke={SPREAD_COLOR}
                    tick={{ fill: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    // Spread is in percentage points and can be negative; render
                    // with a sign and "pp" suffix so the y=0 line reads clearly.
                    tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`}
                    domain={['auto', 'auto']} width={52}
                  />
                  {/* Zero is the rate-advantage flip — above = US has a positive
                      carry advantage over the basket; below = US disadvantage. */}
                  <ReferenceLine yAxisId="spread" y={0} stroke="#475569" strokeDasharray="3 3" />
                  <Tooltip content={<CustomTooltip />} />
                  <Line yAxisId="dxy"    type="monotone" dataKey="dxy"    name="DXY"                     stroke={DXY_COLOR}    strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
                  <Line yAxisId="spread" type="monotone" dataKey="spread" name="US−Foreign 2Y spread"   stroke={SPREAD_COLOR} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
                  <Brush dataKey="t" height={22} stroke="#728197" fill="#0d1520" travellerWidth={8} tickFormatter={(ms: number) => fmtAxisDate(ms)} />
                </LineChart>
              </ResponsiveContainer>
            )
      }
    </div>
  )
}
