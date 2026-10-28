import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  LineChart,
  Bar,
  Line,
  Scatter,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { AcmChartFrame, AcmPageHeader, AcmPanel, AcmStatStrip, AcmStatTile } from '../components/acm'
import { cx } from '../components/acm/acmFormat'
import { barTooltipCursor, chartTheme, referenceLabelStyle, referenceLines, tooltipLabelStyle, tooltipSurfaceStyle } from '../components/acm/chartTheme'
import { INVESTOR_CLASS_COLORS, TREASURY_AUCTION_COLORS, type InvestorClassKey } from '../constants/identityColors'
import { fetchAuctions, fetchInvestorClassData, type AuctionRecord, type InvestorClassRecord } from '../lib/treasury'
import styles from './TreasuryAuctionPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type BrushState = { start: number; end: number; period: string }

// ── Security term dropdown config ────────────────────────────────────────────

const SECURITY_TERMS = [
  { value: '2-Year',  label: '2-Year Note',  type: 'Note' },
  { value: '3-Year',  label: '3-Year Note',  type: 'Note' },
  { value: '5-Year',  label: '5-Year Note',  type: 'Note' },
  { value: '7-Year',  label: '7-Year Note',  type: 'Note' },
  { value: '10-Year', label: '10-Year Note', type: 'Note' },
  { value: '20-Year', label: '20-Year Bond', type: 'Bond' },
  { value: '30-Year', label: '30-Year Bond', type: 'Bond' },
  { value: 'TIPS',    label: 'TIPS',         type: 'TIPS' },
  { value: 'FRN',     label: 'FRNs',         type: 'FRN'  },
] as const

// ── Chart constants ──────────────────────────────────────────────────────────

const QUICK_PERIODS = [
  { label: '1Y',   months: 12     },
  { label: '3Y',   months: 36     },
  { label: '5Y',   months: 60     },
  { label: '10Y',  months: 120    },
  { label: 'All',  months: Infinity },
] as const

// R4: every metric here is a LEVEL (bid-to-cover, high yield, offering
// amount, allotment shares) — identity colours from the registry, never sign
// colours (rule 6); no yield changes are shown. Chart chrome = chartTheme.
const BTC_COLOR = TREASURY_AUCTION_COLORS.bidToCover
const OFFERING_COLOR = TREASURY_AUCTION_COLORS.offeringAmount
const CHART_HEIGHT = 300
/** Brush with date ticks: the theme brush, tall enough for its tick labels. */
const BRUSH_HEIGHT = 34

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m, day] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${mo[parseInt(m) - 1]} ${y}`
}

function fmtAmount(v: number | null): string {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString()}`
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function BtcTooltip({ active, payload }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as AuctionRecord | undefined
  if (!d) return null

  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{fmtFullDate(d.auctionDate)}</div>
      <div className={styles.taTipRow}>
        <span style={{ color: BTC_COLOR }}>Bid/Cover:</span>{' '}
        {d.bidToCover != null ? d.bidToCover.toFixed(2) : '—'}x
      </div>
      {d.highYield != null && (
        <div className={styles.taTipRow}>
          <span className={styles.taTipKey}>High Yield:</span>{' '}
          {d.highYield.toFixed(3)}%
        </div>
      )}
      {d.offeringAmount != null && (
        <div className={styles.taTipRow}>
          <span className={styles.taTipKey}>Offering:</span>{' '}
          {fmtAmount(d.offeringAmount)}
        </div>
      )}
      <div className={styles.taTipMeta}>{d.securityTerm} {d.securityType}</div>
    </div>
  )
}

// ── Offering amount tooltip ──────────────────────────────────────────────────

function OfferingTooltip({ active, payload }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as (AuctionRecord & { offeringAmountB: number | null }) | undefined
  if (!d) return null

  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{fmtFullDate(d.auctionDate)}</div>
      <div className={styles.taTipRow}>
        <span style={{ color: OFFERING_COLOR }}>Offering:</span>{' '}
        {d.offeringAmountB != null ? `$${d.offeringAmountB.toFixed(1)}B` : '—'}
      </div>
      <div className={styles.taTipMeta}>{d.securityTerm} {d.securityType}</div>
      {d.reopening === 'Yes' && <div className={styles.taTipMeta}>Reopening</div>}
    </div>
  )
}

// ── Investor class config ──────────────────────────────────────────────────

// Colours: INVESTOR_CLASS_COLORS (identity registry; Individuals #868D9B and
// Other #687385 are the contrast-lifted values).
const IC_CATEGORIES: ReadonlyArray<{ key: InvestorClassKey; label: string; color: string }> = [
  { key: 'dealersAndBrokers',       label: 'Dealers & Brokers',       color: INVESTOR_CLASS_COLORS.dealersAndBrokers },
  { key: 'foreignAndInternational', label: 'Foreign & International', color: INVESTOR_CLASS_COLORS.foreignAndInternational },
  { key: 'investmentFunds',         label: 'Investment Funds',        color: INVESTOR_CLASS_COLORS.investmentFunds },
  { key: 'depositoryInstitutions',  label: 'Depository Institutions', color: INVESTOR_CLASS_COLORS.depositoryInstitutions },
  { key: 'pensionAndRetirement',    label: 'Pension & Retirement',    color: INVESTOR_CLASS_COLORS.pensionAndRetirement },
  { key: 'federalReserve',          label: 'Federal Reserve',         color: INVESTOR_CLASS_COLORS.federalReserve },
  { key: 'individuals',             label: 'Individuals',             color: INVESTOR_CLASS_COLORS.individuals },
  { key: 'other',                   label: 'Other',                   color: INVESTOR_CLASS_COLORS.other },
]

const IC_TERM_OPTIONS = [
  { value: '2-Note',  label: '2-Year Note',  secType: 'Note', term: 2  },
  { value: '3-Note',  label: '3-Year Note',  secType: 'Note', term: 3  },
  { value: '5-Note',  label: '5-Year Note',  secType: 'Note', term: 5  },
  { value: '7-Note',  label: '7-Year Note',  secType: 'Note', term: 7  },
  { value: '10-Note', label: '10-Year Note', secType: 'Note', term: 10 },
  { value: '20-Bond', label: '20-Year Bond', secType: 'Bond', term: 20 },
  { value: '30-Bond', label: '30-Year Bond', secType: 'Bond', term: 30 },
  { value: 'TIPS',    label: 'TIPS',         secType: 'TIPS', term: 0  },
  { value: 'FRN',     label: 'FRNs',         secType: 'FRN',  term: 0  },
] as const

// ── Investor class tooltip ─────────────────────────────────────────────────

function ICTooltip({ active, payload }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  return (
    <div style={tooltipSurfaceStyle}>
      <div style={tooltipLabelStyle}>{fmtFullDate(d.issueDate)}</div>
      {IC_CATEGORIES.map(cat => {
        const val = d[`${cat.key}Raw`] as number | null
        if (val == null) return null
        return (
          <div key={cat.key} className={cx(styles.taTipRow, styles.taTipSwatchRow)}>
            <span className={styles.taTipSwatch} style={{ background: cat.color }} />
            <span className={styles.taTipKey}>{cat.label}:</span>
            <span>{val.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Brush tick formatter ────────────────────────────────────────────────────

function brushTickFormatter(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

// ── QuickSelectRow ──────────────────────────────────────────────────────────

function QuickSelectRow({ brushState, onSelect }: {
  brushState: BrushState
  onSelect: (months: number, label: string) => void
}) {
  return (
    <div className={styles.taRangeRow}>
      <span className={styles.taRangeLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
        <button
          key={p.label}
          type="button"
          className={cx(styles.taRangeBtn, brushState.period === p.label && styles.taRangeBtnActive)}
          onClick={() => onSelect(p.months, p.label)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ── Page Component ──────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

export function TreasuryAuctionContent() {
  // ── Auction state ────────────────────────────────────────────────────────
  const [selectedTerm, setSelectedTerm] = useState('10-Year')
  const [auctions, setAuctions]   = useState<AuctionRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [brush, setBrush]         = useState<BrushState>({ start: 0, end: 0, period: '5Y' })
  const [refreshKey, setRefreshKey]       = useState(0)
  const [refreshing, setRefreshing]       = useState(false)
  const [refreshMsg, setRefreshMsg]       = useState<string | null>(null)

  // ── Investor class state ────────────────────────────────────────────────
  const [icTerm, setIcTerm]       = useState('10-Note')
  const [icData, setIcData]       = useState<InvestorClassRecord[]>([])
  const [icLoading, setIcLoading] = useState(true)
  const [icError, setIcError]     = useState<string | null>(null)
  const [icBrush, setIcBrush]     = useState<BrushState>({ start: 0, end: 0, period: '10Y' })

  // ── Data fetching ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const termCfg = SECURITY_TERMS.find(t => t.value === selectedTerm)
    const opts = termCfg?.type === 'TIPS' || termCfg?.type === 'FRN'
      ? { type: termCfg.type }
      : { term: selectedTerm }

    fetchAuctions(opts)
      .then(data => {
        if (cancelled) return
        const valid = data.filter(a => a.bidToCover != null && a.bidToCover > 0)
        setAuctions(valid)
        // Init brush to last 5 years
        const start5y = Math.max(0, valid.length - 60 * 5)  // ~5y of monthly auctions (varies by type)
        setBrush({ start: start5y, end: valid.length - 1, period: '5Y' })
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [selectedTerm, refreshKey])

  // ── Investor class data fetching ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setIcLoading(true)
    setIcError(null)

    const cfg = IC_TERM_OPTIONS.find(t => t.value === icTerm)
    if (!cfg) return

    const params: { securityType: string; term?: number } = { securityType: cfg.secType }
    if (cfg.term > 0) params.term = cfg.term

    fetchInvestorClassData(params)
      .then(data => {
        if (cancelled) return
        setIcData(data)
        const start10y = Math.max(0, data.length - Math.ceil(data.length * (10 / 25)))
        setIcBrush({ start: start10y, end: data.length - 1, period: '10Y' })
        setIcLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setIcError(err.message)
        setIcLoading(false)
      })

    return () => { cancelled = true }
  }, [icTerm, refreshKey])

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!auctions.length) return null
    const btcs = auctions.map(a => a.bidToCover!).filter(v => v > 0)
    const avg = btcs.reduce((s, v) => s + v, 0) / btcs.length
    const last = auctions[auctions.length - 1]
    const last6 = btcs.slice(-6)
    const avg6 = last6.reduce((s, v) => s + v, 0) / last6.length
    return {
      count: auctions.length,
      average: avg,
      latest: last.bidToCover!,
      latestDate: last.auctionDate,
      avg6mo: avg6,
      latestYield: last.highYield,
    }
  }, [auctions])

  // ── Chart data with derived fields ────────────────────────────────────────
  const chartData = useMemo(() => {
    return auctions.map(a => ({
      ...a,
      offeringAmountB: a.offeringAmount != null ? a.offeringAmount / 1e9 : null,
    }))
  }, [auctions])

  // ── Refresh handler ──────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/treasury/refresh', { method: 'POST' })
      if (res.status === 409) {
        setRefreshMsg('Sync already running')
      } else if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setRefreshMsg(body.error ?? `Error ${res.status}`)
      } else {
        setRefreshMsg('Synced')
        setRefreshKey(k => k + 1)
      }
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(null), 3000)
    }
  }, [])

  // ── Brush / quick-select ──────────────────────────────────────────────────
  const handleQuickSelect = useCallback((months: number, label: string) => {
    if (!auctions.length) return
    if (months === Infinity) {
      setBrush({ start: 0, end: auctions.length - 1, period: label })
    } else {
      // Approximate: for Notes, ~12 auctions/year; for TIPS, fewer
      // Use date-based calculation instead
      const cutoffDate = new Date()
      cutoffDate.setMonth(cutoffDate.getMonth() - months)
      const cutoffStr = cutoffDate.toISOString().slice(0, 10)
      const startIdx = auctions.findIndex(a => a.auctionDate >= cutoffStr)
      setBrush({
        start: startIdx >= 0 ? startIdx : 0,
        end: auctions.length - 1,
        period: label,
      })
    }
  }, [auctions])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBrushChange = useCallback((range: any) => {
    if (range && typeof range.startIndex === 'number') {
      setBrush({ start: range.startIndex, end: range.endIndex, period: '' })
    }
  }, [])

  // ── Investor class chart data (raw + 4-auction moving average) ────────
  const icChartData = useMemo(() => {
    const pctKey = (k: string) => `${k}Pct` as keyof InvestorClassRecord
    const raw = icData.map(d => {
      const row: Record<string, string | number> = { issueDate: d.issueDate }
      for (const cat of IC_CATEGORIES) {
        row[`${cat.key}Raw`] = (d[pctKey(cat.key)] as number) ?? 0
      }
      return row
    })
    // Compute 4-auction simple moving average (expanding window for first 3)
    return raw.map((row, i) => {
      const out = { ...row }
      for (const cat of IC_CATEGORIES) {
        const rawKey = `${cat.key}Raw`
        const windowStart = Math.max(0, i - 3)
        let sum = 0
        let count = 0
        for (let j = windowStart; j <= i; j++) {
          sum += raw[j][rawKey] as number
          count++
        }
        out[`${cat.key}MA`] = sum / count
      }
      return out
    })
  }, [icData])

  const handleIcQuickSelect = useCallback((months: number, label: string) => {
    if (!icData.length) return
    if (months === Infinity) {
      setIcBrush({ start: 0, end: icData.length - 1, period: label })
    } else {
      const cutoffDate = new Date()
      cutoffDate.setMonth(cutoffDate.getMonth() - months)
      const cutoffStr = cutoffDate.toISOString().slice(0, 10)
      const startIdx = icData.findIndex(a => a.issueDate >= cutoffStr)
      setIcBrush({
        start: startIdx >= 0 ? startIdx : 0,
        end: icData.length - 1,
        period: label,
      })
    }
  }, [icData])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleIcBrushChange = useCallback((range: any) => {
    if (range && typeof range.startIndex === 'number') {
      setIcBrush({ start: range.startIndex, end: range.endIndex, period: '' })
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  // Cross-route component (RATES › US › TREASURY AUCTIONS and /treasury): its
  // own outermost element carries acm-root (component-level root rule).
  const brushTheme = { ...chartTheme.brush, height: BRUSH_HEIGHT, tickFormatter: brushTickFormatter }
  return (
    <div className={cx('acm-root', styles.taRoot)}>
      <AcmPageHeader
        title="Treasury Auction Monitor"
        subtitle="Auction results from TreasuryDirect — bid-to-cover ratios across security types"
        actions={(
          <button type="button" className={styles.taRefreshBtn} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Syncing…' : refreshMsg ?? 'Refresh Data'}
          </button>
        )}
      />

      <AcmPanel
        title="AUCTION RESULTS"
        actions={(
          <select className={styles.taSelect} value={selectedTerm} onChange={e => setSelectedTerm(e.target.value)} aria-label="Security">
            {SECURITY_TERMS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        )}
      >
        {loading && <div className={styles.taStatus}>Loading auction data…</div>}
        {error && <div className={cx(styles.taStatus, styles.taStatusError)}>Error: {error}</div>}
        {!loading && !error && auctions.length === 0 && (
          <div className={styles.taStatus}>No auction data available. The server may still be syncing — check back shortly.</div>
        )}

        {!loading && !error && auctions.length > 0 && (
          <>
            {/* Stats: all levels → plain primary text, no tone (rule 6) */}
            {stats && (
              <AcmStatStrip className={styles.taStats}>
                <AcmStatTile label="Latest" value={`${stats.latest.toFixed(2)}x`} />
                <AcmStatTile label="Date" value={fmtFullDate(stats.latestDate)} />
                <AcmStatTile label="Avg (All)" value={`${stats.average.toFixed(2)}x`} />
                <AcmStatTile label="Avg (6)" value={`${stats.avg6mo.toFixed(2)}x`} />
                {stats.latestYield != null && <AcmStatTile label="High Yield" value={`${stats.latestYield.toFixed(3)}%`} />}
                <AcmStatTile label="Auctions" value={stats.count} />
              </AcmStatStrip>
            )}

            <AcmChartFrame
              title="BID-TO-COVER RATIO"
              legend={[
                { label: 'Bid-to-cover', color: BTC_COLOR },
                ...(stats ? [{ label: `Average (${stats.average.toFixed(2)})`, color: String(referenceLines.level.stroke), dashed: true }] : []),
              ]}
              height={CHART_HEIGHT}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 16, right: 24, bottom: 0, left: 8 }}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="auctionDate" {...chartTheme.xAxis} tickFormatter={fmtDate} />
                  <YAxis {...chartTheme.yAxis} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(1)} />
                  <Tooltip content={<BtcTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
                  {stats && (
                    <ReferenceLine
                      y={stats.average}
                      {...referenceLines.level}
                      label={{ value: `Avg ${stats.average.toFixed(2)}`, position: 'right', ...referenceLabelStyle }}
                    />
                  )}
                  <Scatter dataKey="bidToCover" fill={BTC_COLOR} r={2.5} isAnimationActive={false} />
                  <Line type="monotone" dataKey="bidToCover" stroke={BTC_COLOR} strokeWidth={1.2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Brush dataKey="auctionDate" startIndex={brush.start} endIndex={brush.end} onChange={handleBrushChange} {...brushTheme} />
                </ComposedChart>
              </ResponsiveContainer>
            </AcmChartFrame>

            <AcmChartFrame title="OFFERING AMOUNT ($B)" legend={[{ label: 'Offering amount', color: OFFERING_COLOR }]} height={CHART_HEIGHT}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 16, right: 24, bottom: 0, left: 8 }}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="auctionDate" {...chartTheme.xAxis} tickFormatter={fmtDate} />
                  <YAxis {...chartTheme.yAxis} domain={[0, 'auto']} tickFormatter={(v: number) => `$${v}B`} />
                  <Tooltip content={<OfferingTooltip />} cursor={barTooltipCursor} isAnimationActive={false} />
                  <Bar dataKey="offeringAmountB" fill={OFFERING_COLOR} fillOpacity={0.7} isAnimationActive={false} />
                  <Brush dataKey="auctionDate" startIndex={brush.start} endIndex={brush.end} onChange={handleBrushChange} {...brushTheme} />
                </BarChart>
              </ResponsiveContainer>
            </AcmChartFrame>

            <QuickSelectRow brushState={brush} onSelect={handleQuickSelect} />
          </>
        )}
      </AcmPanel>

      {/* ── Investor Class Allocation ────────────────────────────────── */}
      <AcmPanel
        title="INVESTOR CLASS ALLOCATION"
        actions={(
          <select className={styles.taSelect} value={icTerm} onChange={e => setIcTerm(e.target.value)} aria-label="Investor class tenor">
            {IC_TERM_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        )}
      >
        {icLoading && <div className={styles.taStatus}>Loading investor class data…</div>}
        {icError && <div className={cx(styles.taStatus, styles.taStatusError)}>Error: {icError}</div>}
        {!icLoading && !icError && icChartData.length === 0 && (
          <div className={styles.taStatus}>No investor class data available for this tenor.</div>
        )}

        {!icLoading && !icError && icChartData.length > 0 && (
          <>
            <AcmChartFrame
              title="ALLOTMENT SHARE BY INVESTOR CLASS (%)"
              subtitle="Solid: 4-auction moving average · dashed: each auction"
              legend={IC_CATEGORIES.map(cat => ({ label: cat.label, color: cat.color }))}
              height={CHART_HEIGHT}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={icChartData} margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="issueDate" {...chartTheme.xAxis} tickFormatter={fmtDate} />
                  <YAxis {...chartTheme.yAxis} domain={[0, 'auto']} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip content={<ICTooltip />} cursor={chartTheme.tooltip.cursor} isAnimationActive={false} />
                  {/* Raw series — dashed, thin, low opacity */}
                  {IC_CATEGORIES.map(cat => (
                    <Line
                      key={`${cat.key}Raw`}
                      type="monotone"
                      dataKey={`${cat.key}Raw`}
                      stroke={cat.color}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                      strokeOpacity={0.4}
                      dot={false}
                      isAnimationActive={false}
                      legendType="none"
                    />
                  ))}
                  {/* 4-auction moving average — solid */}
                  {IC_CATEGORIES.map(cat => (
                    <Line
                      key={`${cat.key}MA`}
                      type="monotone"
                      dataKey={`${cat.key}MA`}
                      stroke={cat.color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  <Brush dataKey="issueDate" startIndex={icBrush.start} endIndex={icBrush.end} onChange={handleIcBrushChange} {...brushTheme} />
                </LineChart>
              </ResponsiveContainer>
            </AcmChartFrame>

            <QuickSelectRow brushState={icBrush} onSelect={handleIcQuickSelect} />
          </>
        )}
      </AcmPanel>
    </div>
  )
}

export function TreasuryAuctionPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>
      <nav className={styles.breadcrumb}>
        <Link to="/" className={styles.breadcrumbLink}>Home</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Treasury Auction Monitor</span>
      </nav>
      <main className={styles.body}>
        <TreasuryAuctionContent />
      </main>
    </div>
  )
}
