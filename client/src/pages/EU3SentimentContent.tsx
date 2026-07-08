import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Brush,
  XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from 'recharts'
import { fetchEu3Batch } from '../lib/eurostat'
import {
  fmtAxisDate,
  TICK, TOOLTIP_STYLE, BRUSH_STYLE,
} from '../lib/seriesTransforms'
import { ProxyBadge } from '../components/ProxyBadge'
import { eu3Caveat, type Eu3Country } from '../data/eu3ProxyCaveats'
import { EU3_COUNTRY_LABEL } from './EU3HICPContent'
import kit from '../components/charts/ChartKit.module.css'

// EU3 sentiment & saving dashboard — one parameterized page serving DE / FR /
// IT. Survey panels come from the DG-ECFIN harmonized EU business & consumer
// surveys (the free alternative to the national market-movers — ifo/ZEW in
// Germany, INSEE climat in France, ISTAT fiducia in Italy — which are separate
// surveys with different panels and timing): ESI (index, long-term mean 100)
// and consumer/industry confidence balances (negative readings are normal for
// consumer confidence). Every survey panel carries the sentiment_survey PROXY
// badge. The household saving rate is Eurostat quarterly sector accounts —
// national accounts, DIRECT, unbadged.

type AllData = Record<string, { date: string; value: number }[]>
type Row = { date: string; [key: string]: number | string | null }

const HISTORY_NOTE: Record<Eu3Country, string> = {
  DE: 'ESI and industry confidence from 1980, consumer confidence from 1985; saving rate quarterly from 1999.',
  FR: 'ESI and confidence balances from 1985; saving rate quarterly from 1980 — but published one quarter behind Germany/Italy.',
  IT: 'ESI and industry confidence from 1980, consumer confidence from 1985; saving rate quarterly from 1999.',
}

const SAVING_NOTE: Record<Eu3Country, string> = {
  DE: 'Quarterly, SA, 1999→',
  FR: 'Quarterly, SA, 1980→ — publishes one quarter behind Germany/Italy',
  IT: 'Quarterly, SA, 1999→',
}

const DEFAULT_M = 120 // ~10 years of months
const DEFAULT_Q = 40  // ~10 years of quarters

// ── formatters ───────────────────────────────────────────────────────────────

const fmtIdxTick = (v: number) => v.toFixed(0)
const fmtIdxTooltip = (v: number) => v.toFixed(1)
const fmtBalTick = (v: number) => v.toFixed(0)
const fmtBalTooltip = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
const fmtRateTick = (v: number) => `${v.toFixed(0)}%`
const fmtRateTooltip = (v: number) => `${v.toFixed(2)}%`

// ── helpers ──────────────────────────────────────────────────────────────────

/** Align multiple series on the union of their dates (missing values → null). */
function buildRows(
  series: ReadonlyArray<{ key: string; data: ReadonlyArray<{ date: string; value: number | null }> }>,
): Row[] {
  const dates = new Set<string>()
  for (const s of series) for (const p of s.data) dates.add(p.date)
  const maps = series.map(s => ({
    key: s.key,
    m: new Map(s.data.map(p => [p.date, p.value])),
  }))
  return [...dates].sort().map(date => {
    const row: Row = { date }
    for (const { key, m } of maps) row[key] = m.get(date) ?? null
    return row
  })
}

function useBrush(len: number, defaultCount: number) {
  const [brush, setBrush] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  useEffect(() => {
    if (!len) return
    setBrush({ start: Math.max(0, len - defaultCount), end: len - 1 })
  }, [len, defaultCount])
  return [brush, setBrush] as const
}

// ── multi-line panel (toggleable legend, optional reference line + badge) ────

type LineDef = { key: string; label: string; color: string; width?: number }
type RefDef = { y: number; label?: string }

function LinesPanel({
  title, subtitle, badge, lines, rows,
  tickFmt, tooltipFmt, refLine, defaultCount = DEFAULT_M,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  lines: readonly LineDef[]
  rows: Row[]
  tickFmt: (v: number) => string
  tooltipFmt: (v: number) => string
  refLine?: RefDef
  defaultCount?: number
}) {
  const [vis, setVis] = useState<Set<string>>(() => new Set(lines.map(l => l.key)))
  const toggle = (key: string) => setVis(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  const [brush, setBrush] = useBrush(rows.length, defaultCount)

  return (
    <div className={kit.section}>
      <div className={kit.sectionHeader}>
        <div>
          <div className={kit.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={kit.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={kit.legendRow}>
        <div className={kit.legend}>
          {lines.map(l => (
            <button key={l.key} type="button"
              className={`${kit.legendItem} ${vis.has(l.key) ? '' : kit.legendItemOff}`}
              onClick={() => toggle(l.key)}>
              <span className={kit.legendLine} style={{ background: l.color }} />
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className={kit.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false}
              tickFormatter={fmtAxisDate} minTickGap={60} />
            <YAxis tick={TICK} tickLine={false} axisLine={false} width={58}
              tickFormatter={tickFmt} domain={['auto', 'auto']} />
            <Tooltip {...TOOLTIP_STYLE}
              formatter={(v: unknown, name: unknown) => {
                const l = lines.find(x => x.key === name)
                return [typeof v === 'number' ? tooltipFmt(v) : '-', l?.label ?? String(name)] as [string, string]
              }} />
            {refLine && (
              <ReferenceLine y={refLine.y}
                stroke="rgba(255,255,255,0.30)" strokeDasharray="4 3" strokeWidth={1}
                label={refLine.label
                  ? { value: refLine.label, position: 'insideTopRight', fill: '#4e6070', fontSize: 10, fontFamily: 'var(--font-mono)' }
                  : undefined} />
            )}
            {lines.filter(l => vis.has(l.key)).map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key}
                stroke={l.color} strokeWidth={l.width ?? 1.8}
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

// ══════════════════════════════════════════════════════════════════════════════

export function EU3SentimentContent({ cc }: { cc: Eu3Country }) {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allCodes = useMemo(
    () => [`${cc}_ESI`, `${cc}_CONS_CONF`, `${cc}_IND_CONF`, `${cc}_SAVING_RATE`],
    [cc]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchEu3Batch(allCodes).then(map => {
      if (cancelled) return
      setAllData(map)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load sentiment data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [allCodes])

  const surveyBadge = <ProxyBadge caveat={eu3Caveat('sentiment_survey', cc)} />

  const esiRows = useMemo(
    () => buildRows([{ key: 'esi', data: allData[`${cc}_ESI`] ?? [] }]),
    [allData, cc]
  )
  const confRows = useMemo(
    () => buildRows([
      { key: 'cons', data: allData[`${cc}_CONS_CONF`] ?? [] },
      { key: 'ind', data: allData[`${cc}_IND_CONF`] ?? [] },
    ]),
    [allData, cc]
  )
  const savingRows = useMemo(
    () => buildRows([{ key: 'saving', data: allData[`${cc}_SAVING_RATE`] ?? [] }]),
    [allData, cc]
  )

  if (loading) return <div className={kit.statusBlock}>Loading {allCodes.length} {cc} sentiment series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        DG-ECFIN harmonized EU business &amp; consumer surveys (ESI + confidence balances) &mdash;
        the free alternative to the national market-movers (ifo/ZEW, INSEE climat, ISTAT fiducia),
        which are separate surveys with different panels and timing. Saving rate: Eurostat quarterly
        sector accounts (national accounts, unbadged). {HISTORY_NOTE[cc]}
      </div>

      <LinesPanel
        title={`${EU3_COUNTRY_LABEL[cc]} Economic Sentiment Indicator (ESI)`}
        subtitle="DG-ECFIN composite, index — long-term average = 100"
        badge={surveyBadge}
        lines={[{ key: 'esi', label: 'ESI (mean 100)', color: '#60a5fa', width: 2.2 }]}
        rows={esiRows}
        tickFmt={fmtIdxTick}
        tooltipFmt={fmtIdxTooltip}
        refLine={{ y: 100, label: 'long-term average' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <LinesPanel
          title="Consumer &amp; Industry Confidence"
          subtitle="DG-ECFIN balances (pp) — negative readings are normal for consumer confidence"
          badge={surveyBadge}
          lines={[
            { key: 'cons', label: 'Consumer Confidence', color: '#fbbf24', width: 2 },
            { key: 'ind', label: 'Industry Confidence', color: '#4ade80' },
          ]}
          rows={confRows}
          tickFmt={fmtBalTick}
          tooltipFmt={fmtBalTooltip}
          refLine={{ y: 0 }}
        />
        <LinesPanel
          title="Household Saving Rate"
          subtitle={`Gross household saving rate, % of disposable income — ${SAVING_NOTE[cc]}`}
          lines={[{ key: 'saving', label: 'Saving Rate (%)', color: '#a78bfa', width: 2 }]}
          rows={savingRows}
          tickFmt={fmtRateTick}
          tooltipFmt={fmtRateTooltip}
          defaultCount={DEFAULT_Q}
        />
      </div>
    </>
  )
}
