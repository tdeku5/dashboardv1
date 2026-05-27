import { Router, Request, Response } from 'express'
import { getStatcanObservations, db } from '../db'

export const caFundamentalRouter = Router()

// Canadian sibling of euFundamentalRouter. Three tabs:
//   cpi       = CPI_HEADLINE       (NSA index → YoY + MoM + projections)
//   core_cpi  = the BoC core trio  (CPI_TRIM + CPI_MEDIAN + CPI_COMMON, each a
//                                   YoY % series, plus their simple average)
//   labor     = UNRATE_CA          (rate; pass-through, no decomposition)
//
// IMPORTANT STRUCTURAL NOTE — CORE is multi-line YoY, not index-decomposed:
// the BoC's preferred core measures are published (and universally quoted) as
// YoY % only. CPI-trim and CPI-median do have NSA index versions on StatCan, but
// nobody quotes their MoM and an NSA index would carry the same seasonal
// contamination as headline — so CORE deliberately shows the three measures +
// their average as YoY lines with a 2% target, no momentum projections, no MoM
// panel. (Headline CPI is NSA too — Canada has no all-items SA index at source —
// so its MoM/projection paths carry an NSA seasonality caveat, surfaced in UI.)
type TabKey = 'cpi' | 'core_cpi' | 'labor'

interface Point { date: string; value: number }
interface ProjectionPoint { date: string; yoy: number }

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

// YoY % from a monthly index series, aligned by date string.
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

// MoM % from a monthly index series.
function computeMoM(series: Point[]): Point[] {
  const out: Point[] = []
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value
    if (prev === 0) continue
    out.push({ date: series[i].date, value: ((series[i].value / prev) - 1) * 100 })
  }
  return out
}

// 12-month forward YoY projection carrying a constant MoM pace (decimal) forward.
// Each projected month's YoY = projected level ÷ actual level 12 months prior
// (the denominator never reaches into projected territory over a 12-month
// horizon, so historical lookup suffices — same logic as the EU/UK models).
function buildProjection(series: Point[], paceMoM: number): ProjectionPoint[] {
  if (series.length === 0) return []
  const last = series[series.length - 1]
  const projectedLevels: Point[] = [last]
  for (let i = 1; i <= 12; i++) {
    const prev = projectedLevels[i - 1]
    projectedLevels.push({ date: addMonths(last.date, i), value: prev.value * (1 + paceMoM) })
  }
  const histByDate = new Map<string, number>(series.map(p => [p.date, p.value]))
  const out: ProjectionPoint[] = []
  for (let i = 1; i < projectedLevels.length; i++) {
    const cur = projectedLevels[i]
    const prior = histByDate.get(addMonths(cur.date, -12))
    if (prior == null || prior === 0) continue
    out.push({ date: cur.date, yoy: ((cur.value / prior) - 1) * 100 })
  }
  return out
}

// Simple cross-sectional average of the three BoC core measures, by date. Each
// date averages whichever of trim/median/common are present (they publish
// together, so this is normally all three).
function averageLines(...lines: Point[][]): Point[] {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const line of lines) {
    for (const p of line) {
      const cur = acc.get(p.date) ?? { sum: 0, n: 0 }
      cur.sum += p.value
      cur.n += 1
      acc.set(p.date, cur)
    }
  }
  return [...acc.entries()]
    .map(([date, { sum, n }]) => ({ date, value: sum / n }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// BoC Target Overnight Rate history (daily) from overnight_rates — ingested via
// the BoC Valet API by the overnight-rate work (read-only here). Mirrors how the
// EU model reads ECBDFR. The component collapses daily → monthly for overlay.
function getBocTarget(): Point[] {
  return db.prepare(`
    SELECT date, value FROM overnight_rates
    WHERE series_code = 'CA_TARGET' AND value IS NOT NULL
    ORDER BY date ASC
  `).all() as Point[]
}

caFundamentalRouter.get('/:tab', (req: Request, res: Response) => {
  try {
    const tab = req.params.tab as TabKey
    const bocTarget = getBocTarget()

    if (tab === 'labor') {
      const series = getStatcanObservations('UNRATE_CA')
      if (series.length === 0) {
        res.status(404).json({ error: 'No data for UNRATE_CA — StatCan backfill may not have run yet' })
        return
      }
      const last = series[series.length - 1]
      res.json({
        tab, kind: 'rate',
        series, yoyHistorical: [], momHistorical: [], projections: null, coreLines: null,
        bocTarget,
        latestReading: { date: last.date, indexLevel: last.value, mom: null, yoy: null },
      })
      return
    }

    if (tab === 'core_cpi') {
      const trim = getStatcanObservations('CPI_TRIM')
      const median = getStatcanObservations('CPI_MEDIAN')
      const common = getStatcanObservations('CPI_COMMON')
      if (trim.length === 0 && median.length === 0 && common.length === 0) {
        res.status(404).json({ error: 'No BoC core data — StatCan backfill may not have run yet' })
        return
      }
      const average = averageLines(trim, median, common)
      // Snapshot from the latest common date across the measures.
      const lastDate = [trim, median, common, average]
        .map(l => l[l.length - 1]?.date)
        .filter((d): d is string => !!d)
        .sort()
        .pop() ?? ''
      const at = (line: Point[]) => line.find(p => p.date === lastDate)?.value ?? null
      res.json({
        tab, kind: 'multi_yoy',
        series: [], yoyHistorical: [], momHistorical: [], projections: null,
        coreLines: { trim, median, common, average },
        bocTarget,
        latestReading: {
          date: lastDate, indexLevel: null, mom: null, yoy: at(average),
          trim: at(trim), median: at(median), common: at(common), average: at(average),
        },
      })
      return
    }

    // cpi (HEADLINE): NSA all-items index → YoY + MoM + projections.
    const series = getStatcanObservations('CPI_HEADLINE')
    if (series.length === 0) {
      res.status(404).json({ error: 'No data for CPI_HEADLINE — StatCan backfill may not have run yet' })
      return
    }
    const yoyHistorical = computeYoY(series)
    const momHistorical = computeMoM(series)   // NSA — seasonally contaminated (caveat in UI)
    const last = series[series.length - 1]
    const lastMoM = momHistorical[momHistorical.length - 1]?.value ?? null
    const lastYoY = yoyHistorical[yoyHistorical.length - 1]?.value ?? null

    let projections: { mom1: ProjectionPoint[]; mom3avg: ProjectionPoint[]; mom6avg: ProjectionPoint[] } | null = null
    if (momHistorical.length >= 6) {
      const recent = momHistorical.slice(-6).map(p => p.value / 100) // back to decimal
      const pace1 = recent[recent.length - 1]
      const pace3 = recent.slice(-3).reduce((s, v) => s + v, 0) / 3
      const pace6 = recent.reduce((s, v) => s + v, 0) / 6
      projections = {
        mom1:    buildProjection(series, pace1),
        mom3avg: buildProjection(series, pace3),
        mom6avg: buildProjection(series, pace6),
      }
    }

    res.json({
      tab, kind: 'index',
      series, yoyHistorical, momHistorical, projections, coreLines: null,
      bocTarget,
      latestReading: { date: last.date, indexLevel: last.value, mom: lastMoM, yoy: lastYoY },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected CA fundamental error'
    console.error('[ca/fundamental] error:', msg)
    res.status(500).json({ error: msg })
  }
})
