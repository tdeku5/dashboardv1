import { Router, Request, Response } from 'express'
import { getOnsObservations, getBoeObservations } from '../db'

export const ukFundamentalRouter = Router()

// Tab → ONS series. CPI/CORE-CPI work on indices (project forward).
// LABOR is a rate (no projections, no MoM/YoY decomposition).
// GROWTH is a monthly index (YoY + MoM, no projections).
type TabKey = 'cpi' | 'core_cpi' | 'labor' | 'growth'

interface TabConfig {
  cdid: string
  datasetId: string
  isIndex: boolean
  projects: boolean
}

const TAB_CONFIG: Record<TabKey, TabConfig> = {
  cpi:      { cdid: 'D7BT', datasetId: 'mm23', isIndex: true,  projects: true  },
  core_cpi: { cdid: 'DKC6', datasetId: 'mm23', isIndex: true,  projects: true  },
  labor:    { cdid: 'MGSX', datasetId: 'lms',  isIndex: false, projects: false },
  growth:   { cdid: 'ECY2', datasetId: 'mgdp', isIndex: true,  projects: false },
}

interface Point { date: string; value: number }

// Add `months` calendar months to an ISO date (first-of-month assumed).
function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

// YoY % from a monthly index series, aligned by date string. Returns one
// point per month where a 12-months-prior value exists.
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

// 12-month forward projection of YoY%, given recent MoM rates carried forward.
// `paceMoM` is the constant MoM growth rate (in decimal form, e.g. 0.0025).
// Each projected month: project the index forward by paceMoM, then YoY = ratio
// to the actual index level 12 months prior (using the historical series for
// the first 11 projected months, then falling into the projected series).
function buildProjection(series: Point[], paceMoM: number): Array<{ date: string; yoy: number }> {
  if (series.length === 0) return []
  const last = series[series.length - 1]

  // Walk forward 12 months. Build a "projected index" array indexed by month.
  const projectedLevels: Point[] = [last]
  for (let i = 1; i <= 12; i++) {
    const prev = projectedLevels[i - 1]
    projectedLevels.push({
      date: addMonths(last.date, i),
      value: prev.value * (1 + paceMoM),
    })
  }

  // For YoY, look up the level 12 months prior — first in historical, then
  // (for projected months that overlap with projected past) in the projected
  // array itself. With a 12-month projection horizon, the first projected
  // month (m+1) has an actual prior (m-11), the 12th has an actual prior at m.
  // None reach into projected territory, so historical lookup alone suffices.
  const histByDate = new Map<string, number>(series.map(p => [p.date, p.value]))
  const out: Array<{ date: string; yoy: number }> = []
  for (let i = 1; i < projectedLevels.length; i++) {
    const cur = projectedLevels[i]
    const priorDate = addMonths(cur.date, -12)
    const prior = histByDate.get(priorDate)
    if (prior == null || prior === 0) continue
    out.push({ date: cur.date, yoy: ((cur.value / prior) - 1) * 100 })
  }
  return out
}

ukFundamentalRouter.get('/:tab', (req: Request, res: Response) => {
  try {
    const tab = req.params.tab as TabKey
    const cfg = TAB_CONFIG[tab]
    if (!cfg) {
      res.status(400).json({ error: `Unknown tab: ${tab}` })
      return
    }

    const series = getOnsObservations(cfg.cdid, cfg.datasetId)
    if (series.length === 0) {
      res.status(404).json({ error: `No data for ${cfg.cdid}/${cfg.datasetId}` })
      return
    }

    const bankRate = getBoeObservations('IUDBEDR')

    if (!cfg.isIndex) {
      // LABOR: pass series through as-is, no MoM/YoY/projections.
      const last = series[series.length - 1]
      res.json({
        tab,
        series,
        yoyHistorical: [],
        momHistorical: [],
        projections: null,
        bankRate,
        latestReading: { date: last.date, indexLevel: last.value, mom: null, yoy: null },
      })
      return
    }

    const yoyHistorical = computeYoY(series)
    const momHistorical = computeMoM(series)

    const last = series[series.length - 1]
    const lastMoM = momHistorical[momHistorical.length - 1]?.value ?? null
    const lastYoY = yoyHistorical[yoyHistorical.length - 1]?.value ?? null

    let projections: { mom1: ReturnType<typeof buildProjection>; mom3avg: ReturnType<typeof buildProjection>; mom6avg: ReturnType<typeof buildProjection> } | null = null
    if (cfg.projects && momHistorical.length >= 6) {
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
      tab,
      series,
      yoyHistorical,
      momHistorical,
      projections,
      bankRate,
      latestReading: {
        date: last.date,
        indexLevel: last.value,
        mom: lastMoM,
        yoy: lastYoY,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected UK fundamental error'
    console.error('[uk/fundamental] error:', msg)
    res.status(500).json({ error: msg })
  }
})
