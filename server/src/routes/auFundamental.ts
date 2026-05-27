import { Router, Request, Response } from 'express'
import { getAbsObservations, db } from '../db'

export const auFundamentalRouter = Router()

// Australian sibling of jp/eu/caFundamentalRouter. Seven tabs spanning Australia's
// 2025-27 mixed-frequency CPI transition:
//   m_headline | m_trimmed | m_wgtmed   = MONTHLY CPI index → YoY + MoM + projections
//   q_headline | q_trimmed | q_wgtmed   = QUARTERLY CPI index → YoY + QoQ + projections
//   labor                               = unemployment rate (SA + trend lines)
//
// The monthly all-groups headline (RBA's new official target measure, back to
// 2024-04) and the quarterly trimmed mean (RBA's preferred underlying gauge
// during the transition, back to 1982) both matter, so the panel exposes a
// frequency toggle. All CPI tabs are raw index → full YoY/period-change/projection
// treatment; projection pace windows adapt to frequency ([1,3,6] months vs
// [1,2,4] quarters). Labor is a pass-through rate (no decomposition) carrying two
// lines: seasonally adjusted + ABS-recommended trend.
type TabKey =
  | 'm_headline' | 'm_trimmed' | 'm_wgtmed'
  | 'q_headline' | 'q_trimmed' | 'q_wgtmed'
  | 'labor'

type Freq = 'M' | 'Q'

interface TabConfig { code: string; isIndex: boolean; freq: Freq }
const TAB_CONFIG: Record<TabKey, TabConfig> = {
  m_headline: { code: 'AU_CPI_M_HEADLINE', isIndex: true,  freq: 'M' },
  m_trimmed:  { code: 'AU_CPI_M_TRIMMED',  isIndex: true,  freq: 'M' },
  m_wgtmed:   { code: 'AU_CPI_M_WGTMED',   isIndex: true,  freq: 'M' },
  q_headline: { code: 'AU_CPI_Q_HEADLINE', isIndex: true,  freq: 'Q' },
  q_trimmed:  { code: 'AU_CPI_Q_TRIMMED',  isIndex: true,  freq: 'Q' },
  q_wgtmed:   { code: 'AU_CPI_Q_WGTMED',   isIndex: true,  freq: 'Q' },
  labor:      { code: 'AU_UNRATE_SA',      isIndex: false, freq: 'M' },
}

// Projection pace windows (in periods) per frequency, mapped to the three
// projection lines, plus the forward horizon (1 year) and per-period month step.
const FREQ_PARAMS: Record<Freq, { windows: [number, number, number]; horizon: number; stepMonths: number }> = {
  M: { windows: [1, 3, 6], horizon: 12, stepMonths: 1 },
  Q: { windows: [1, 2, 4], horizon: 4,  stepMonths: 3 },
}

interface Point { date: string; value: number }
interface ProjectionPoint { date: string; yoy: number }

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

// YoY % via a 12-month-prior lookup. Works for both cadences: quarterly points are
// stored at the quarter's first month, so −12 months lands on the same quarter a
// year earlier.
function computeYoY(series: Point[]): Point[] {
  const byDate = new Map<string, number>(series.map(p => [p.date, p.value]))
  const out: Point[] = []
  for (const p of series) {
    const prior = byDate.get(addMonths(p.date, -12))
    if (prior == null || prior === 0) continue
    out.push({ date: p.date, value: ((p.value / prior) - 1) * 100 })
  }
  return out
}

// Sequential period-over-period % change (MoM for monthly, QoQ for quarterly —
// consecutive entries in the sorted series are consecutive periods).
function computeSeqChange(series: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value
    if (prev === 0) continue
    out.push({ date: series[i].date, value: ((series[i].value / prev) - 1) * 100 })
  }
  return out
}

// Forward YoY projection carrying a constant per-period pace (decimal). Steps the
// level forward `horizon` periods (stepMonths months each); the YoY denominator
// stays in historical territory over a 1-year horizon, so a historical lookup
// suffices. Same logic as the EU/CA/JP models, generalised over frequency.
function buildProjection(series: Point[], pacePeriod: number, horizon: number, stepMonths: number): ProjectionPoint[] {
  if (series.length === 0) return []
  const last = series[series.length - 1]
  const levels: Point[] = [last]
  for (let i = 1; i <= horizon; i++) {
    const prev = levels[i - 1]
    levels.push({ date: addMonths(last.date, i * stepMonths), value: prev.value * (1 + pacePeriod) })
  }
  const histByDate = new Map<string, number>(series.map(p => [p.date, p.value]))
  const out: ProjectionPoint[] = []
  for (let i = 1; i < levels.length; i++) {
    const cur = levels[i]
    const prior = histByDate.get(addMonths(cur.date, -12))
    if (prior == null || prior === 0) continue
    out.push({ date: cur.date, yoy: ((cur.value / prior) - 1) * 100 })
  }
  return out
}

// RBA policy-rate line: the RBA targets the cash rate; AU_CASH_RATE_TARGET from
// overnight_rates is the policy reference (mirrors EU→ECBDFR, CAD→CA_TARGET,
// JP→TONA). Ingested by the RBA overnight work (read-only here). The panel
// collapses this daily series to the tab's cadence.
function getRbaRate(): Point[] {
  return db.prepare(`
    SELECT date, value FROM overnight_rates
    WHERE series_code = 'AU_CASH_RATE_TARGET' AND value IS NOT NULL
    ORDER BY date ASC
  `).all() as Point[]
}

auFundamentalRouter.get('/:tab', (req: Request, res: Response) => {
  try {
    const tab = req.params.tab as TabKey
    const cfg = TAB_CONFIG[tab]
    if (!cfg) {
      res.status(400).json({ error: `Unknown tab: ${tab}` })
      return
    }

    const series = getAbsObservations(cfg.code)
    if (series.length === 0) {
      res.status(404).json({ error: `No data for ${cfg.code} — ABS backfill may not have run yet` })
      return
    }

    const rbaRate = getRbaRate()

    if (!cfg.isIndex) {
      // LABOR: unemployment rate, pass-through. Two lines: SA + ABS trend.
      const trend = getAbsObservations('AU_UNRATE_TREND')
      const last = series[series.length - 1]
      res.json({
        tab, kind: 'rate', freq: cfg.freq,
        series, seriesTrend: trend,
        yoyHistorical: [], seqHistorical: [], projections: null,
        rbaRate,
        latestReading: { date: last.date, indexLevel: last.value, seq: null, yoy: null },
      })
      return
    }

    const { windows, horizon, stepMonths } = FREQ_PARAMS[cfg.freq]
    const yoyHistorical = computeYoY(series)
    const seqHistorical = computeSeqChange(series)
    const last = series[series.length - 1]
    const lastSeq = seqHistorical[seqHistorical.length - 1]?.value ?? null
    const lastYoY = yoyHistorical[yoyHistorical.length - 1]?.value ?? null

    let projections: { p1: ProjectionPoint[]; p2: ProjectionPoint[]; p3: ProjectionPoint[] } | null = null
    if (seqHistorical.length >= windows[2]) {
      const recent = seqHistorical.slice(-windows[2]).map(p => p.value / 100)
      const avg = (n: number) => recent.slice(-n).reduce((s, v) => s + v, 0) / n
      projections = {
        p1: buildProjection(series, avg(windows[0]), horizon, stepMonths),
        p2: buildProjection(series, avg(windows[1]), horizon, stepMonths),
        p3: buildProjection(series, avg(windows[2]), horizon, stepMonths),
      }
    }

    res.json({
      tab, kind: 'index', freq: cfg.freq, paceWindows: windows,
      series, yoyHistorical, seqHistorical, projections,
      rbaRate,
      latestReading: { date: last.date, indexLevel: last.value, seq: lastSeq, yoy: lastYoY },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected AU fundamental error'
    console.error('[au/fundamental] error:', msg)
    res.status(500).json({ error: msg })
  }
})
