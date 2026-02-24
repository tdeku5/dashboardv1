import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { fetchFredSeries } from '../lib/fred'
import styles from './ProductivityPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD      = { date: string; value: number }
type AllData = Record<string, WD[]>

interface BrushState { start: number; end: number; period: string }

interface ProdRow {
  date:  string
  level: number | null
  trend: number | null
  qqAnn: number | null
  yoy:   number | null
}

interface ULCRow {
  date:  string
  level: number | null
  qqAnn: number | null
  yoy:   number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FETCH_IDS = ['OPHNFB', 'ULCNFB'] as const

const QUICK_PERIODS = [
  { label: '10Y', count: 40  },
  { label: '20Y', count: 80  },
  { label: '50Y', count: 200 },
  { label: 'Max', count: Infinity },
] as const

// ── Chart constants ───────────────────────────────────────────────────────────

const CM   = { top: 8, right: 16, bottom: 28, left: 62 } as const
const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const MINI_BRUSH = {
  height:         34,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  tickFormatter:  (d: string) => {
    const [y, m] = d.split('-')
    const q = Math.ceil(parseInt(m) / 3)
    return `Q${q} '${y.slice(2)}`
  },
  gap: 3,
} as const

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtQDate(d: string): string {
  const [y, m] = d.split('-')
  const q = Math.ceil(parseInt(m) / 3)
  return `Q${q} '${y.slice(2)}`
}

function fmtFullQDate(d: string): string {
  const [y, m] = d.split('-')
  const q = Math.ceil(parseInt(m) / 3)
  return `Q${q} ${y}`
}

function fmtPct1(v: number): string { return `${v.toFixed(1)}%` }
function fmtIdx(v: number): string  { return v.toFixed(1) }

// ── OLS regression ────────────────────────────────────────────────────────────

function olsRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 }
  const sumX  = xs.reduce((a, b) => a + b, 0)
  const sumY  = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0)
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// Quarters since Q1 2000 (can be negative for pre-2000 dates)
function qSince2000(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return (y - 2000) * 4 + Math.floor((m - 1) / 3)
}

// ── Data builders ─────────────────────────────────────────────────────────────

function buildProdData(raw: WD[]): ProdRow[] {
  if (raw.length === 0) return []

  // OLS fit on Q1 2000 – Q4 2019
  const trainData = raw.filter(d => d.date >= '2000-01-01' && d.date <= '2019-12-31')
  const trainX    = trainData.map(d => qSince2000(d.date))
  const trainY    = trainData.map(d => d.value)
  const { slope, intercept } = olsRegression(trainX, trainY)

  return raw.map((d, i) => {
    const prev  = i > 0  ? raw[i - 1] : null
    const prev4 = i >= 4 ? raw[i - 4] : null
    const qqAnn = prev  ? (Math.pow(d.value / prev.value, 4) - 1) * 100 : null
    const yoy   = prev4 ? ((d.value / prev4.value) - 1) * 100           : null
    const trend = intercept + slope * qSince2000(d.date)
    return { date: d.date, level: d.value, trend, qqAnn, yoy }
  })
}

function buildULCData(raw: WD[]): ULCRow[] {
  return raw.map((d, i) => {
    const prev  = i > 0  ? raw[i - 1] : null
    const prev4 = i >= 4 ? raw[i - 4] : null
    const qqAnn = prev  ? (Math.pow(d.value / prev.value, 4) - 1) * 100 : null
    const yoy   = prev4 ? ((d.value / prev4.value) - 1) * 100           : null
    return { date: d.date, level: d.value, qqAnn, yoy }
  })
}

// ── Flip tooltip ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FlipTooltip(props: any) {
  const { active, payload, label, coordinate, viewBox, formatter } = props
  if (!active || !payload?.length || !label) return null
  const isRight = (coordinate?.x ?? 0) > ((viewBox?.x ?? 0) + (viewBox?.width ?? 9999) / 2)
  return (
    <div style={{
      background:    '#090e15',
      border:        '1px solid rgba(255,255,255,0.13)',
      borderRadius:  2,
      fontFamily:    'var(--font-mono)',
      fontSize:      11,
      padding:       '6px 10px',
      pointerEvents: 'none',
      transform:     isRight ? 'translateX(calc(-100% - 20px))' : undefined,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' }}>
        {fmtFullQDate(label)}
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {(payload as any[]).map((p: any, i: number) => (
        <div key={i} style={{ color: '#CBD5E1', padding: '1px 0' }}>
          <span style={{ color: p.color ?? '#CBD5E1' }}>{p.name}</span>
          {': '}
          {formatter && p.value !== undefined
            ? formatter(p.value, p.name ?? '')
            : typeof p.value === 'number' ? p.value.toFixed(2) : '–'}
        </div>
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductivityPage() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Six independent brushes
  const [bProdLvl, setBProdLvl] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [bProdQQ,  setBProdQQ]  = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [bProdYoy, setBProdYoy] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [bUlcLvl,  setBUlcLvl]  = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [bUlcQQ,   setBUlcQQ]   = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [bUlcYoy,  setBUlcYoy]  = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all(FETCH_IDS.map(id =>
      fetchFredSeries(id).then(obs => ({
        id,
        data: obs
          .filter(o => o.value !== '.')
          .map(o => ({ date: o.date, value: parseFloat(o.value) }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      }))
    ))
      .then(results => {
        if (cancelled) return
        const data: AllData = {}
        for (const r of results) data[r.id] = r.data
        setAllData(data)

        const np = (data['OPHNFB'] ?? []).length
        const nu = (data['ULCNFB'] ?? []).length
        if (np > 0) {
          setBProdLvl({ start: 0, end: np - 1, period: 'Max' })
          setBProdQQ(  { start: 0, end: np - 1, period: 'Max' })
          setBProdYoy( { start: 0, end: np - 1, period: 'Max' })
        }
        if (nu > 0) {
          setBUlcLvl({ start: 0, end: nu - 1, period: 'Max' })
          setBUlcQQ(  { start: 0, end: nu - 1, period: 'Max' })
          setBUlcYoy( { start: 0, end: nu - 1, period: 'Max' })
        }
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

  // ── Derived data ───────────────────────────────────────────────────────────

  const prodData = useMemo(() => buildProdData(allData['OPHNFB'] ?? []), [allData])
  const ulcData  = useMemo(() => buildULCData(allData['ULCNFB']  ?? []), [allData])

  // ── Brush helpers ──────────────────────────────────────────────────────────

  type Setter = React.Dispatch<React.SetStateAction<BrushState>>

  function onBrushChange(setter: Setter) {
    return (e: { startIndex?: number; endIndex?: number }) =>
      setter(prev => ({ ...prev, start: e.startIndex ?? 0, end: e.endIndex ?? 0, period: '' }))
  }

  function setByPeriod(setter: Setter, dataLen: number, count: number, label: string) {
    const end   = dataLen - 1
    const start = count === Infinity ? 0 : Math.max(0, end - count + 1)
    setter({ start, end, period: label })
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function qsRow(brush: BrushState, setter: Setter, dataLen: number) {
    return (
      <div className={styles.quickSelectRow}>
        <span className={styles.quickSelectLabel}>Range</span>
        {QUICK_PERIODS.map(qp => (
          <button
            key={qp.label}
            className={`${styles.qsBtn} ${brush.period === qp.label ? styles.qsBtnActive : ''}`}
            onClick={() => setByPeriod(setter, dataLen, qp.count, qp.label)}
          >
            {qp.label}
          </button>
        ))}
      </div>
    )
  }

  function mkTt(fmtVal: (v: unknown) => string) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: (props: any) => (
        <FlipTooltip
          {...props}
          formatter={(v: unknown) => fmtVal(v)}
        />
      ),
    }
  }

  const ttIdx = mkTt(v => typeof v === 'number' ? fmtIdx(v)  : '–')
  const ttPct = mkTt(v => typeof v === 'number' ? fmtPct1(v) : '–')

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>
      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb}>
        <Link to="/models"       className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor" className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>Productivity &amp; Unit Labor Costs</span>
      </nav>

      {/* Body */}
      <main className={styles.body}>
        {loading && <div className={styles.statusBlock}>Loading productivity data…</div>}
        {error   && <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>}

        {!loading && !error && (
          <div className={styles.twoColGrid}>

            {/* ── Left: Productivity ─────────────────────────────────────── */}
            <div className={styles.column}>
              <div className={styles.columnHeader} style={{ borderLeftColor: '#7FB3D3' }}>
                <div className={styles.columnTitle} style={{ color: '#7FB3D3' }}>Productivity</div>
                <div className={styles.columnSub}>
                  Nonfarm Business Sector · OPHNFB · Index 2017=100 · SA · Quarterly
                </div>
              </div>

              {/* Chart 1 — Level + Pre-Covid Trend */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Productivity</div>
                </div>
                <div className={styles.legendRow}>
                  <div className={styles.legend}>
                    <div className={styles.legendItem}>
                      <span className={styles.legendLine} style={{ background: '#7FB3D3' }} />
                      <span>Productivity</span>
                    </div>
                    <div className={styles.legendItem}>
                      <span className={styles.legendDash} />
                      <span>Pre-Covid Trend (2000–2019)</span>
                    </div>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={prodData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtIdx} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <Tooltip {...ttIdx} />
                      <Line dataKey="level" name="Productivity"              stroke="#7FB3D3"               dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Line dataKey="trend" name="Pre-Covid Trend (2000–2019)" stroke="rgba(200,210,220,0.55)" dot={false} strokeWidth={1.5} strokeDasharray="6 3" connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bProdLvl.start} endIndex={bProdLvl.end} onChange={onBrushChange(setBProdLvl)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bProdLvl, setBProdLvl, prodData.length)}
              </div>

              {/* Chart 2 — q/q annualized */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Productivity — q/q %Δ annualized</div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={prodData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtPct1} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                      <Tooltip {...ttPct} />
                      <Line dataKey="qqAnn" name="q/q Ann. %Δ" stroke="#90EE90" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bProdQQ.start} endIndex={bProdQQ.end} onChange={onBrushChange(setBProdQQ)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bProdQQ, setBProdQQ, prodData.length)}
              </div>

              {/* Chart 3 — y/y %Δ */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Productivity — y/y %Δ</div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={prodData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtPct1} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                      <Tooltip {...ttPct} />
                      <Line dataKey="yoy" name="y/y %Δ" stroke="#DDA0DD" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bProdYoy.start} endIndex={bProdYoy.end} onChange={onBrushChange(setBProdYoy)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bProdYoy, setBProdYoy, prodData.length)}
              </div>
            </div>

            {/* ── Right: Unit Labor Costs ────────────────────────────────── */}
            <div className={styles.column}>
              <div className={styles.columnHeader} style={{ borderLeftColor: '#FFAA80' }}>
                <div className={styles.columnTitle} style={{ color: '#FFAA80' }}>Unit Labor Costs</div>
                <div className={styles.columnSub}>
                  Nonfarm Business Sector · ULCNFB · Index 2017=100 · SA · Quarterly
                </div>
              </div>

              {/* Chart 4 — Level */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Unit Labor Costs</div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={ulcData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtIdx} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <Tooltip {...ttIdx} />
                      <Line dataKey="level" name="Unit Labor Costs" stroke="#FFAA80" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bUlcLvl.start} endIndex={bUlcLvl.end} onChange={onBrushChange(setBUlcLvl)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bUlcLvl, setBUlcLvl, ulcData.length)}
              </div>

              {/* Chart 5 — q/q annualized */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Unit Labor Costs — q/q %Δ annualized</div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={ulcData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtPct1} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                      <Tooltip {...ttPct} />
                      <Line dataKey="qqAnn" name="q/q Ann. %Δ" stroke="#FF8080" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bUlcQQ.start} endIndex={bUlcQQ.end} onChange={onBrushChange(setBUlcQQ)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bUlcQQ, setBUlcQQ, ulcData.length)}
              </div>

              {/* Chart 6 — y/y %Δ */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>Nonfarm Business Sector Unit Labor Costs — y/y %Δ</div>
                </div>
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={ulcData} margin={CM}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" tickFormatter={fmtQDate} tick={TICK} minTickGap={80} />
                      <YAxis tickFormatter={fmtPct1} tick={TICK} width={58} domain={['auto', 'auto']} />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                      <Tooltip {...ttPct} />
                      <Line dataKey="yoy" name="y/y %Δ" stroke="#FFE680" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                      <Brush dataKey="date" startIndex={bUlcYoy.start} endIndex={bUlcYoy.end} onChange={onBrushChange(setBUlcYoy)} {...MINI_BRUSH} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {qsRow(bUlcYoy, setBUlcYoy, ulcData.length)}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  )
}
