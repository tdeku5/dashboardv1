import { Router, Request, Response } from 'express'
import { getEcbObservations, db } from '../db'

export const euFundamentalRouter = Router()

// Tab → ECB series_code (stored in ecb_observations).
//   hicp      = HICP_HEADLINE   (index → YoY + MoM + projections)
//   core_hicp = HICP_SUPERCORE  (market core, excl. energy & food → same)
//   labor     = UNRATE_EA       (rate; pass-through, no decomposition)
// HICP_CORE (excl. energy & unprocessed food) is ingested but intentionally not
// exposed as a tab/toggle option yet (see EUFundamentalModelPanel + collector).
type TabKey = 'hicp' | 'core_hicp' | 'labor'

// Each HICP tab pulls BOTH the NSA and SA index of the same conceptual measure:
//   • NSA (nsaCode)  → YoY % + displayed Index level (the public reference number)
//   • SA  (saCode)   → sequential MoM + the 1M/3M/6M projection paths
// YoY washes out seasonality so it stays NSA (and matches ECB/market commentary);
// everything sequential uses SA so it reflects underlying momentum, not the
// January-sales / summer / heating seasonal pattern. Labor has no SA pair.
interface TabConfig { nsaCode: string; saCode: string | null; isIndex: boolean; projects: boolean }

const TAB_CONFIG: Record<TabKey, TabConfig> = {
  hicp:      { nsaCode: 'HICP_HEADLINE',  saCode: 'HICP_HEADLINE_SA',  isIndex: true,  projects: true  },
  core_hicp: { nsaCode: 'HICP_SUPERCORE', saCode: 'HICP_SUPERCORE_SA', isIndex: true,  projects: true  },
  labor:     { nsaCode: 'UNRATE_EA',      saCode: null,                isIndex: false, projects: false },
}

interface Point { date: string; value: number }

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
// Each projected month's YoY = projected level ÷ actual level 12 months prior.
// (12-month horizon never reaches into projected territory for the denominator,
// so historical lookup alone suffices — same logic as the UK model.)
function buildProjection(series: Point[], paceMoM: number): Array<{ date: string; yoy: number }> {
  if (series.length === 0) return []
  const last = series[series.length - 1]
  const projectedLevels: Point[] = [last]
  for (let i = 1; i <= 12; i++) {
    const prev = projectedLevels[i - 1]
    projectedLevels.push({ date: addMonths(last.date, i), value: prev.value * (1 + paceMoM) })
  }
  const histByDate = new Map<string, number>(series.map(p => [p.date, p.value]))
  const out: Array<{ date: string; yoy: number }> = []
  for (let i = 1; i < projectedLevels.length; i++) {
    const cur = projectedLevels[i]
    const prior = histByDate.get(addMonths(cur.date, -12))
    if (prior == null || prior === 0) continue
    out.push({ date: cur.date, yoy: ((cur.value / prior) - 1) * 100 })
  }
  return out
}

// ECB Deposit Facility Rate history (daily) from the overnight_rates table —
// ingested via FRED `ECBDFR` by the recent overnight-rate work (read-only here).
function getDfr(): Point[] {
  return db.prepare(`
    SELECT date, value FROM overnight_rates
    WHERE series_code = 'ECBDFR' AND value IS NOT NULL
    ORDER BY date ASC
  `).all() as Point[]
}

euFundamentalRouter.get('/:tab', (req: Request, res: Response) => {
  try {
    const tab = req.params.tab as TabKey
    const cfg = TAB_CONFIG[tab]
    if (!cfg) {
      res.status(400).json({ error: `Unknown tab: ${tab}` })
      return
    }

    const series = getEcbObservations(cfg.nsaCode)   // NSA — YoY + level
    if (series.length === 0) {
      res.status(404).json({ error: `No data for ${cfg.nsaCode} — ECB backfill may not have run yet` })
      return
    }

    const dfr = getDfr()

    if (!cfg.isIndex) {
      // LABOR: unemployment rate, pass-through (already SA at source).
      const last = series[series.length - 1]
      res.json({
        tab,
        series,
        yoyHistorical: [],
        momHistorical: [],
        projections: null,
        dfr,
        latestReading: { date: last.date, indexLevel: last.value, mom: null, yoy: null },
      })
      return
    }

    // SA index for everything sequential; fall back to NSA only if SA is missing
    // (so a not-yet-backfilled SA series degrades gracefully rather than 500ing).
    const saSeries = cfg.saCode ? getEcbObservations(cfg.saCode) : []
    const seqSeries = saSeries.length > 0 ? saSeries : series

    const yoyHistorical = computeYoY(series)        // NSA — washes out seasonality
    const momHistorical = computeMoM(seqSeries)     // SA — underlying momentum
    const last = series[series.length - 1]          // NSA anchor (public reference date/level)
    const lastMoM = momHistorical[momHistorical.length - 1]?.value ?? null
    const lastYoY = yoyHistorical[yoyHistorical.length - 1]?.value ?? null

    // Projection paths extrapolate the SA index forward at recent SA MoM pace.
    let projections: { mom1: ReturnType<typeof buildProjection>; mom3avg: ReturnType<typeof buildProjection>; mom6avg: ReturnType<typeof buildProjection> } | null = null
    if (cfg.projects && momHistorical.length >= 6) {
      const recent = momHistorical.slice(-6).map(p => p.value / 100) // back to decimal
      const pace1 = recent[recent.length - 1]
      const pace3 = recent.slice(-3).reduce((s, v) => s + v, 0) / 3
      const pace6 = recent.reduce((s, v) => s + v, 0) / 6
      projections = {
        mom1:    buildProjection(seqSeries, pace1),
        mom3avg: buildProjection(seqSeries, pace3),
        mom6avg: buildProjection(seqSeries, pace6),
      }
    }

    res.json({
      tab,
      series,
      yoyHistorical,
      momHistorical,
      projections,
      dfr,
      // date + indexLevel + yoy from NSA (reference); mom from SA (underlying).
      latestReading: { date: last.date, indexLevel: last.value, mom: lastMoM, yoy: lastYoY },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected EU fundamental error'
    console.error('[eu/fundamental] error:', msg)
    res.status(500).json({ error: msg })
  }
})
