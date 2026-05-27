import { Router, Request, Response } from 'express'
import { getEstatObservations, db } from '../db'

export const jpFundamentalRouter = Router()

// Japanese sibling of euFundamentalRouter / caFundamentalRouter. Three tabs:
//   cpi       = CPI_HEADLINE_JP  (NSA index → YoY + MoM + projections)
//   core_cpi  = CPI_CORE_JP      (ex fresh food — Japan's "core"; NSA index →
//                                 same decomposition as headline)
//   labor     = UNRATE_JP        (rate; pass-through, no decomposition)
//
// NSA-only (Japan publishes no all-items SA index at source here, and Japanese
// CPI seasonality is mild). Both CPI tabs are index series so both support the
// full YoY/MoM/projection treatment — unlike CAD core (YoY-only). The "core"
// here strips fresh food ONLY (energy stays in) — the BoJ's targeted measure;
// CPI_CORECORE_JP (ex fresh food AND energy, the US/EU "core" equivalent) is
// ingested but intentionally not surfaced in the toggle yet.
type TabKey = 'cpi' | 'core_cpi' | 'labor'

interface TabConfig { code: string; isIndex: boolean }
const TAB_CONFIG: Record<TabKey, TabConfig> = {
  cpi:      { code: 'CPI_HEADLINE_JP', isIndex: true },
  core_cpi: { code: 'CPI_CORE_JP',     isIndex: true },
  labor:    { code: 'UNRATE_JP',       isIndex: false },
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
// Same logic as the EU/CAD models (denominator stays in historical territory
// over a 12-month horizon, so a historical lookup suffices).
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

// BoJ policy rate proxy: the BoJ targets the uncollateralized overnight call rate
// (TONA) tightly, so TONA from overnight_rates serves as the policy-rate line —
// ingested by the BoJ-direct overnight work (read-only here). Mirrors how the EU
// model reads ECBDFR and CAD reads CA_TARGET. Component collapses daily→monthly.
function getBojRate(): Point[] {
  return db.prepare(`
    SELECT date, value FROM overnight_rates
    WHERE series_code = 'TONA' AND value IS NOT NULL
    ORDER BY date ASC
  `).all() as Point[]
}

jpFundamentalRouter.get('/:tab', (req: Request, res: Response) => {
  try {
    const tab = req.params.tab as TabKey
    const cfg = TAB_CONFIG[tab]
    if (!cfg) {
      res.status(400).json({ error: `Unknown tab: ${tab}` })
      return
    }

    const series = getEstatObservations(cfg.code)
    if (series.length === 0) {
      res.status(404).json({ error: `No data for ${cfg.code} — e-Stat backfill may not have run yet` })
      return
    }

    const bojRate = getBojRate()

    if (!cfg.isIndex) {
      // LABOR: NSA unemployment rate, pass-through.
      const last = series[series.length - 1]
      res.json({
        tab, kind: 'rate',
        series, yoyHistorical: [], momHistorical: [], projections: null,
        bojRate,
        latestReading: { date: last.date, indexLevel: last.value, mom: null, yoy: null },
      })
      return
    }

    const yoyHistorical = computeYoY(series)
    const momHistorical = computeMoM(series)   // NSA — mild seasonality for Japan
    const last = series[series.length - 1]
    const lastMoM = momHistorical[momHistorical.length - 1]?.value ?? null
    const lastYoY = yoyHistorical[yoyHistorical.length - 1]?.value ?? null

    let projections: { mom1: ProjectionPoint[]; mom3avg: ProjectionPoint[]; mom6avg: ProjectionPoint[] } | null = null
    if (momHistorical.length >= 6) {
      const recent = momHistorical.slice(-6).map(p => p.value / 100)
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
      series, yoyHistorical, momHistorical, projections,
      bojRate,
      latestReading: { date: last.date, indexLevel: last.value, mom: lastMoM, yoy: lastYoY },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected JP fundamental error'
    console.error('[jp/fundamental] error:', msg)
    res.status(500).json({ error: msg })
  }
})
