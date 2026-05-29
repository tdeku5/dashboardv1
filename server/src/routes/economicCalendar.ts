import { Router, Request, Response } from 'express'
import {
  getEconomicReleases, getLatestReleaseScrapedAt,
  getSurpriseRulesFromDb, upsertSurpriseRule, deleteSurpriseRule, getUnclassifiedEvents,
  type EconomicReleaseFilter,
} from '../db'
import { syncEconomicCalendar, reclassifyAll } from '../economicCalendar'
import { ECONOMIC_SURPRISE_RULES } from '../config/economicSurpriseRules'
import type { SurpriseRule } from '../economicCalendar/types'

export const economicCalendarRouter = Router()

const VALID_UNITS = new Set(['absolute', 'percent', 'thousands'])

// GET /api/economic-calendar
// Reads straight from SQLite at request time (no caching) so the terminal UI
// always reflects the latest scrape. Optional filters (used by the FILTERED
// VIEW tab; THIS WEEK / UPCOMING pass date ranges):
//   countries=United States,Japan   minImportance=2
//   startDate=2026-05-25  endDate=2026-05-31  eventSearch=cpi
// Returns { latestScrapedAt, releases } — latestScrapedAt drives the stale banner.
economicCalendarRouter.get('/', (req: Request, res: Response) => {
  try {
    const { countries, minImportance, startDate, endDate, eventSearch } = req.query
    const filter: EconomicReleaseFilter = {}

    if (typeof countries === 'string' && countries.trim() !== '') {
      filter.countries = countries.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (minImportance != null && String(minImportance).trim() !== '') {
      const n = parseInt(String(minImportance), 10)
      if (Number.isFinite(n)) filter.minImportance = n
    }
    if (typeof startDate === 'string' && startDate.trim() !== '') filter.startDate = startDate.trim()
    if (typeof endDate === 'string' && endDate.trim() !== '') filter.endDate = endDate.trim()
    if (typeof eventSearch === 'string' && eventSearch.trim() !== '') filter.eventSearch = eventSearch.trim()

    res.json({
      latestScrapedAt: getLatestReleaseScrapedAt(),
      releases: getEconomicReleases(filter),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected economic calendar error'
    console.error('[economic-calendar] route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// POST /api/economic-calendar/refresh — manual on-demand scrape (the "refresh
// now" button). Guarded against concurrent runs, mirroring /api/news/refresh.
let refreshInProgress = false
economicCalendarRouter.post('/refresh', async (_req: Request, res: Response) => {
  if (refreshInProgress) {
    res.status(409).json({ error: 'A refresh is already in progress' })
    return
  }
  refreshInProgress = true
  try {
    const result = await syncEconomicCalendar()
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Refresh failed' })
  } finally {
    refreshInProgress = false
  }
})

// GET /api/economic-calendar/unclassified — triage queue: distinct events with
// no matching rule, each with a sample value to inform unit/threshold choice.
economicCalendarRouter.get('/unclassified', (_req: Request, res: Response) => {
  try {
    res.json({ events: getUnclassifiedEvents() })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
})

// GET /api/economic-calendar/rules — effective rules: static seeds + DB overrides.
economicCalendarRouter.get('/rules', (_req: Request, res: Response) => {
  try {
    res.json({
      seedEvents: Object.keys(ECONOMIC_SURPRISE_RULES),
      userRules: getSurpriseRulesFromDb(),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
})

// POST /api/economic-calendar/rules — add/override a surprise rule from the
// triage UI, then re-classify all stored rows so the change is visible at once.
economicCalendarRouter.post('/rules', (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>
    const event = typeof b.event === 'string' ? b.event.trim() : ''
    if (event === '') { res.status(400).json({ error: 'event is required' }); return }

    const nums = ['in_line_threshold', 'warm_threshold', 'hot_threshold'] as const
    const parsed: Record<string, number> = {}
    for (const k of nums) {
      const n = Number(b[k])
      if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: `${k} must be a non-negative number` }); return }
      parsed[k] = n
    }
    const direction = Number(b.direction)
    if (direction !== 1 && direction !== -1) { res.status(400).json({ error: 'direction must be 1 or -1' }); return }
    const unit = String(b.unit)
    if (!VALID_UNITS.has(unit)) { res.status(400).json({ error: `unit must be one of ${[...VALID_UNITS].join(', ')}` }); return }

    const rule: SurpriseRule = {
      in_line_threshold: parsed.in_line_threshold,
      warm_threshold: parsed.warm_threshold,
      hot_threshold: parsed.hot_threshold,
      direction,
      unit: unit as SurpriseRule['unit'],
    }
    upsertSurpriseRule(event, rule)
    const counts = reclassifyAll()
    res.json({ success: true, event, reclassified: counts })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
})

// DELETE /api/economic-calendar/rules/:event — remove a user rule + re-classify.
economicCalendarRouter.delete('/rules/:event', (req: Request, res: Response) => {
  try {
    deleteSurpriseRule(String(req.params.event))
    const counts = reclassifyAll()
    res.json({ success: true, reclassified: counts })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
})
