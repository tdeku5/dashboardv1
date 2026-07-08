import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEstatBatch, type EstatPoint } from '../lib/estat'
import {
  fmtAxisDate, fmtPctTick, fmtPctTooltip, fmtFullDate,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { RatesChart } from '../components/charts/RatesChart'
import { ProxyBadge } from '../components/ProxyBadge'
import { JP_PROXY_CAVEATS } from '../data/jpProxyCaveats'
import kit from '../components/charts/ChartKit.module.css'

// Tokyo CPI ADVANCE tab — the LEADING read on Japanese inflation. The
// Ku-area-of-Tokyo index (e-Stat 0003427113, cdArea=13A01) publishes ~3–4
// weeks BEFORE the national print and is the market-moving release: it runs
// one month ahead in the data (Tokyo already has the month the national index
// has not yet printed — visible as the extra point on the right edge of every
// comparison panel). Tokyo is only ~7% of national weights, so the national
// print can diverge from the advance — every panel carries the tokyo_advance
// ProxyBadge. Same core nomenclature as national: "core" = ex fresh food only
// (energy included, BoJ reference); "core-core" = ex fresh food & energy (the
// US-core analog).

type AllData = Record<string, EstatPoint[]>

const TOKYO_TRIO = [
  { code: 'JP_TOKYO_CPI_ALL', label: 'All items (Tokyo)', color: '#e2e8f0' },
  { code: 'JP_TOKYO_CPI_CORE', label: 'Core — ex fresh food, energy incl. (BoJ reference)', color: '#f59e0b' },
  { code: 'JP_TOKYO_CPI_CORECORE', label: 'Core-core — ex fresh food & energy (US-core analog)', color: '#60a5fa' },
] as const

const NATIONAL_TRIO = ['CPI_HEADLINE_JP', 'CPI_CORE_JP', 'CPI_CORECORE_JP'] as const

const ALL_CODES = [...TOKYO_TRIO.map(s => s.code), ...NATIONAL_TRIO]

// ── Shared helpers (duplicated per-file per house convention) ────────────────

/** Calendar-month YoY map from a raw index series (robust to gaps). */
function yoyMapOf(data: EstatPoint[]): Map<string, number | null> {
  const idx = new Map(data.map(p => [p.date, p.value]))
  const out = new Map<string, number | null>()
  for (const p of data) {
    const [y, m] = p.date.split('-').map(Number)
    const prior = idx.get(`${y - 1}-${String(m).padStart(2, '0')}-01`)
    out.set(p.date, prior != null && prior !== 0 ? (p.value / prior - 1) * 100 : null)
  }
  return out
}

function unionDates(series: readonly EstatPoint[][]): string[] {
  const set = new Set<string>()
  for (const s of series) for (const p of s) set.add(p.date)
  return [...set].sort()
}

// ── Tokyo trio YoY panel (modeled on JPCPIContent's CoreTrioPanel) ───────────

function TokyoTrioPanel({ allData }: { allData: AllData }) {
  const rows = useMemo(() => {
    const maps = TOKYO_TRIO.map(s => yoyMapOf(allData[s.code] ?? []))
    return unionDates(TOKYO_TRIO.map(s => allData[s.code] ?? [])).map(date => {
      const row: Record<string, number | string | null> = { date }
      TOKYO_TRIO.forEach((s, i) => { row[s.code] = maps[i].get(date) ?? null })
      return row
    })
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!rows.length) return
    setBrush({ start: Math.max(0, rows.length - 180), end: rows.length - 1 })
  }, [rows.length])

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            Tokyo Advance — Headline vs Core vs Core-core, YoY
            <ProxyBadge caveat={JP_PROXY_CAVEATS.tokyo_advance} />
          </div>
          <div className={kit.sectionSubtitle}>
            The LEADING read: Ku-area-of-Tokyo publishes ~3&ndash;4 weeks before the national print.
            &ldquo;Core&rdquo; = ex fresh food only (energy INCLUDED); &ldquo;core-core&rdquo; = ex fresh food &amp; energy.
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {TOKYO_TRIO.map(s => (
            <span key={s.code} className={kit.legendItem} style={{ cursor: 'default' }}>
              <span className={kit.legendLine} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                const s = TOKYO_TRIO.find(x => x.code === name)
                return [fmtPctTooltip(v), s?.label ?? String(name)] as [string, string]
              }} />
            <ReferenceLine y={2} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1} />
            {TOKYO_TRIO.map(s => (
              <Line key={s.code} type="monotone" dataKey={s.code} name={s.code}
                stroke={s.color} strokeWidth={s.code === 'JP_TOKYO_CPI_CORE' ? 2.2 : 1.6}
                dot={false} isAnimationActive={false} connectNulls legendType="none" />
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
  )
}

// ── Tokyo vs National panel — the "does the advance lead the print" view ─────

function TokyoVsNationalPanel({ allData }: { allData: AllData }) {
  const model = useMemo(() => {
    const tokyo = allData['JP_TOKYO_CPI_ALL'] ?? []
    const national = allData['CPI_HEADLINE_JP'] ?? []
    const tMap = yoyMapOf(tokyo)
    const nMap = yoyMapOf(national)
    const rows = unionDates([tokyo, national]).map(date => {
      const t = tMap.get(date) ?? null
      const n = nMap.get(date) ?? null
      return { date, tokyo: t, national: n, gap: t != null && n != null ? t - n : null }
    })
    const latestTokyo = tokyo.length > 0 ? tokyo[tokyo.length - 1].date : null
    const latestNational = national.length > 0 ? national[national.length - 1].date : null
    const lastGapRow = [...rows].reverse().find(r => r.gap != null)
    return { rows, latestTokyo, latestNational, lastGap: lastGapRow?.gap ?? null }
  }, [allData])

  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!model.rows.length) return
    setBrush({ start: Math.max(0, model.rows.length - 180), end: model.rows.length - 1 })
  }, [model.rows.length])

  const fmtStat = (v: number | null) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp` : '–'

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>
            Tokyo vs National — All-items YoY
            <ProxyBadge caveat={JP_PROXY_CAVEATS.tokyo_advance} />
          </div>
          <div className={kit.sectionSubtitle}>
            Does the advance lead the print? Bars = Tokyo minus national gap (pp).
            Tokyo runs one month ahead &mdash; the unpaired point on the right edge is the month
            the national index has not yet published.
          </div>
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#f59e0b' }} />
            Tokyo (Ku-area) YoY
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendLine} style={{ background: '#e2e8f0' }} />
            National YoY
          </span>
          <span className={kit.legendItem} style={{ cursor: 'default' }}>
            <span className={kit.legendSwatch} style={{ background: 'rgba(96,165,250,0.65)' }} />
            Tokyo &minus; national gap (pp)
          </span>
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={model.rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58} tickFormatter={fmtPctTick} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                if (typeof v !== 'number') return ['-', ''] as [string, string]
                const lbl = name === 'tokyo' ? 'Tokyo YoY'
                  : name === 'national' ? 'National YoY'
                  : 'Tokyo − national (pp)'
                return [fmtPctTooltip(v), lbl] as [string, string]
              }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
            <ReferenceLine y={2} stroke="rgba(148,163,184,0.6)" strokeWidth={1} strokeDasharray="4 4"
              label={{ value: 'BoJ 2% target', position: 'insideTopLeft', fill: '#64748B', fontSize: 10 }} />
            <Bar dataKey="gap" isAnimationActive={false} legendType="none" maxBarSize={16}>
              {model.rows.map((entry, idx) => (
                <Cell key={`gap-${idx}`}
                  fill={(entry.gap ?? 0) >= 0 ? 'rgba(96,165,250,0.65)' : 'rgba(239,68,68,0.65)'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="national" name="national"
              stroke="#e2e8f0" strokeWidth={1.6}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Line type="monotone" dataKey="tokyo" name="tokyo"
              stroke="#f59e0b" strokeWidth={2.2}
              dot={false} isAnimationActive={false} connectNulls legendType="none" />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={kit.statsRow}>
        <div className={kit.stat}>
          <span className={kit.statLabel}>Latest Tokyo Month</span>
          <span className={kit.statValue} style={{ color: '#f59e0b' }}>
            {model.latestTokyo ? fmtFullDate(model.latestTokyo) : '–'}
          </span>
        </div>
        <div className={kit.stat}>
          <span className={kit.statLabel}>Latest National Month</span>
          <span className={kit.statValue}>
            {model.latestNational ? fmtFullDate(model.latestNational) : '–'}
          </span>
        </div>
        <div className={kit.stat}>
          <span className={kit.statLabel}>Latest Gap (paired month)</span>
          <span className={kit.statValue} style={{ color: (model.lastGap ?? 0) >= 0 ? '#60a5fa' : '#f87171' }}>
            {fmtStat(model.lastGap)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════

export function JPTokyoCPIContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchEstatBatch(ALL_CODES).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load e-Stat data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CODES.length} e-Stat CPI series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Statistics Bureau of Japan &mdash; e-Stat 0003427113, cdArea=13A01 (Ku-area of Tokyo), monthly, 2020=100, NSA
        &mdash; leading release, ~7% of national weights. Publishes ~3&ndash;4 weeks before the national index:
        the market-moving advance read on the national print.
      </div>

      <TokyoTrioPanel allData={allData} />

      <TokyoVsNationalPanel allData={allData} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Tokyo Headline CPI"
          subtitle="Ku-area all items (NSA — short-run rates carry seasonality)"
          data={allData['JP_TOKYO_CPI_ALL'] ?? []}
          badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.tokyo_advance} />}
        />
        <RatesChart
          title="Tokyo Core CPI — ex Fresh Food (BoJ reference)"
          subtitle="Energy INCLUDED — this is not US core (NSA)"
          data={allData['JP_TOKYO_CPI_CORE'] ?? []}
          badge={<ProxyBadge caveat={JP_PROXY_CAVEATS.tokyo_advance} />}
        />
      </div>
    </>
  )
}
