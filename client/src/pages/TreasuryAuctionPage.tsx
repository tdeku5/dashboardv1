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
  Legend,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
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

const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:   '#090e15',
    border:       '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:   'var(--font-mono)',
    fontSize:     11,
    padding:      '6px 10px',
  },
  labelStyle:  { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle:   { color: '#CBD5E1', padding: '1px 0' },
  cursor:      { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
}

const BRUSH_STYLE = {
  height:         34,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  gap:            3,
} as const

const ACCENT = '#38bdf8'   // sky blue

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
    <div style={{
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      padding: '6px 10px',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 2, letterSpacing: '0.05em' }}>
        {fmtFullDate(d.auctionDate)}
      </div>
      <div style={{ color: '#CBD5E1' }}>
        <span style={{ color: ACCENT }}>Bid/Cover:</span>{' '}
        {d.bidToCover != null ? d.bidToCover.toFixed(2) : '—'}x
      </div>
      {d.highYield != null && (
        <div style={{ color: '#CBD5E1' }}>
          <span style={{ color: '#94A3B8' }}>High Yield:</span>{' '}
          {d.highYield.toFixed(3)}%
        </div>
      )}
      {d.offeringAmount != null && (
        <div style={{ color: '#CBD5E1' }}>
          <span style={{ color: '#94A3B8' }}>Offering:</span>{' '}
          {fmtAmount(d.offeringAmount)}
        </div>
      )}
      <div style={{ color: '#4e6070', fontSize: 10, marginTop: 2 }}>
        {d.securityTerm} {d.securityType}
      </div>
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
    <div style={{
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      padding: '6px 10px',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 2, letterSpacing: '0.05em' }}>
        {fmtFullDate(d.auctionDate)}
      </div>
      <div style={{ color: '#CBD5E1' }}>
        <span style={{ color: '#f59e0b' }}>Offering:</span>{' '}
        {d.offeringAmountB != null ? `$${d.offeringAmountB.toFixed(1)}B` : '—'}
      </div>
      <div style={{ color: '#4e6070', fontSize: 10, marginTop: 2 }}>
        {d.securityTerm} {d.securityType}
      </div>
      {d.reopening === 'Yes' && (
        <div style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>
          Reopening
        </div>
      )}
    </div>
  )
}

// ── Investor class config ──────────────────────────────────────────────────

const IC_CATEGORIES = [
  { key: 'dealersAndBrokers',       label: 'Dealers & Brokers',       color: '#3b82f6' },
  { key: 'foreignAndInternational', label: 'Foreign & International', color: '#f59e0b' },
  { key: 'investmentFunds',        label: 'Investment Funds',        color: '#10b981' },
  { key: 'depositoryInstitutions', label: 'Depository Institutions', color: '#8b5cf6' },
  { key: 'pensionAndRetirement',   label: 'Pension & Retirement',    color: '#ec4899' },
  { key: 'federalReserve',         label: 'Federal Reserve',         color: '#ef4444' },
  { key: 'individuals',            label: 'Individuals',             color: '#6b7280' },
  { key: 'other',                  label: 'Other',                   color: '#374151' },
] as const

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
    <div style={{
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      padding: '6px 10px',
      lineHeight: 1.7,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 3, letterSpacing: '0.05em' }}>
        {fmtFullDate(d.issueDate)}
      </div>
      {IC_CATEGORIES.map(cat => {
        const val = d[`${cat.key}Raw`] as number | null
        if (val == null) return null
        return (
          <div key={cat.key} style={{ color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 1, background: cat.color, flexShrink: 0 }} />
            <span style={{ color: '#94A3B8' }}>{cat.label}:</span>
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
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
        <button
          key={p.label}
          className={`${styles.qsBtn} ${brushState.period === p.label ? styles.qsBtnActive : ''}`}
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

export function TreasuryAuctionPage() {
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
  return (
    <div className={styles.shell}>
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <nav className={styles.breadcrumb}>
        <Link to="/" className={styles.breadcrumbLink}>Home</Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Treasury Auction Monitor</span>
      </nav>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <main className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.headerRow}>
            <div className={styles.pageTitle}>Treasury Auction Monitor</div>
            <button
              className={styles.refreshBtn}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Syncing\u2026' : refreshMsg ?? 'Refresh Data'}
            </button>
          </div>
          <div className={styles.pageSub}>
            Auction results from TreasuryDirect — bid-to-cover ratios across security types
          </div>
        </div>

        {/* ── Term selector ────────────────────────────────────────────────── */}
        <div className={styles.explorerHeader}>
          <div className={styles.sectorSelectWrap}>
            <div className={styles.sectionTitle}>Auction Results</div>
            <select
              className={styles.sectorSelect}
              value={selectedTerm}
              onChange={e => setSelectedTerm(e.target.value)}
            >
              {SECURITY_TERMS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Loading / error / chart ──────────────────────────────────────── */}
        {loading && (
          <div className={styles.statusBlock}>Loading auction data…</div>
        )}

        {error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>
            Error: {error}
          </div>
        )}

        {!loading && !error && auctions.length === 0 && (
          <div className={styles.statusBlock}>
            No auction data available. The server may still be syncing — check back shortly.
          </div>
        )}

        {!loading && !error && auctions.length > 0 && (
          <div className={styles.section}>
            {/* Stats bar */}
            {stats && (
              <div className={styles.statsBar}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Latest</span>
                  <span className={styles.statValue}>{stats.latest.toFixed(2)}x</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Date</span>
                  <span className={styles.statValue}>{fmtFullDate(stats.latestDate)}</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Avg (All)</span>
                  <span className={styles.statValue}>{stats.average.toFixed(2)}x</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Avg (6)</span>
                  <span className={styles.statValue}>{stats.avg6mo.toFixed(2)}x</span>
                </div>
                {stats.latestYield != null && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>High Yield</span>
                    <span className={styles.statValue}>{stats.latestYield.toFixed(3)}%</span>
                  </div>
                )}
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Auctions</span>
                  <span className={styles.statValue}>{stats.count}</span>
                </div>
              </div>
            )}

            {/* Bid-to-Cover chart */}
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Bid-to-Cover Ratio</div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 16, right: 24, bottom: 0, left: 8 }}
                >
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.04)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="auctionDate"
                    tick={TICK}
                    tickFormatter={fmtDate}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  />
                  <YAxis
                    tick={TICK}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip
                    content={<BtcTooltip />}
                    {...TOOLTIP_STYLE}
                  />
                  {stats && (
                    <ReferenceLine
                      y={stats.average}
                      stroke="rgba(255,255,255,0.18)"
                      strokeDasharray="4 4"
                      label={{
                        value: `Avg ${stats.average.toFixed(2)}`,
                        position: 'right',
                        fill: '#4e6070',
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  )}
                  <Scatter
                    dataKey="bidToCover"
                    fill={ACCENT}
                    r={2.5}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bidToCover"
                    stroke={ACCENT}
                    strokeWidth={1.2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Brush
                    dataKey="auctionDate"
                    startIndex={brush.start}
                    endIndex={brush.end}
                    onChange={handleBrushChange}
                    tickFormatter={brushTickFormatter}
                    {...BRUSH_STYLE}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Offering Amount chart */}
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Offering Amount ($B)</div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 16, right: 24, bottom: 0, left: 8 }}
                >
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.04)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="auctionDate"
                    tick={TICK}
                    tickFormatter={fmtDate}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  />
                  <YAxis
                    tick={TICK}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    domain={[0, 'auto']}
                    tickFormatter={(v: number) => `$${v}B`}
                  />
                  <Tooltip
                    content={<OfferingTooltip />}
                    {...TOOLTIP_STYLE}
                  />
                  <Bar
                    dataKey="offeringAmountB"
                    fill="rgba(245, 158, 11, 0.70)"
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Brush
                    dataKey="auctionDate"
                    startIndex={brush.start}
                    endIndex={brush.end}
                    onChange={handleBrushChange}
                    tickFormatter={brushTickFormatter}
                    {...BRUSH_STYLE}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Quick-select row */}
            <QuickSelectRow brushState={brush} onSelect={handleQuickSelect} />
          </div>
        )}
        {/* ── Investor Class Allocation ────────────────────────────────── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Investor Class Allocation</div>
            <select
              className={styles.sectorSelect}
              value={icTerm}
              onChange={e => setIcTerm(e.target.value)}
            >
              {IC_TERM_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {icLoading && (
            <div className={styles.statusBlock}>Loading investor class data…</div>
          )}

          {icError && (
            <div className={`${styles.statusBlock} ${styles.statusError}`}>
              Error: {icError}
            </div>
          )}

          {!icLoading && !icError && icChartData.length === 0 && (
            <div className={styles.statusBlock}>
              No investor class data available for this tenor.
            </div>
          )}

          {!icLoading && !icError && icChartData.length > 0 && (
            <>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={icChartData}
                    margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.04)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="issueDate"
                      tick={TICK}
                      tickFormatter={fmtDate}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    />
                    <YAxis
                      tick={TICK}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      domain={[0, 'auto']}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      content={<ICTooltip />}
                      {...TOOLTIP_STYLE}
                    />
                    <Legend
                      verticalAlign="top"
                      align="center"
                      wrapperStyle={{ fontSize: '13px', paddingBottom: 8 }}
                      formatter={(value: string) => {
                        const cat = IC_CATEGORIES.find(c => `${c.key}MA` === value)
                        return cat ? cat.label : value
                      }}
                    />
                    {/* Raw series — dotted, thin, low opacity */}
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
                    <Brush
                      dataKey="issueDate"
                      startIndex={icBrush.start}
                      endIndex={icBrush.end}
                      onChange={handleIcBrushChange}
                      tickFormatter={brushTickFormatter}
                      {...BRUSH_STYLE}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Quick-select */}
              <QuickSelectRow brushState={icBrush} onSelect={handleIcQuickSelect} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
