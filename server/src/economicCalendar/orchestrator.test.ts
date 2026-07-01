import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import type { FirecrawlLike } from './firecrawlScrape'

// Point db.ts at a throwaway file BEFORE importing anything db-backed (the
// connection + schema are created at module load), so these tests never touch
// the real fred_data.db.
let mod: typeof import('./index')
let dbmod: typeof import('../db')
let tmpPath: string

beforeAll(async () => {
  tmpPath = path.join(os.tmpdir(), `econ-orch-test-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = tmpPath
  dbmod = await import('../db')
  mod = await import('./index')
})

afterAll(() => {
  for (const f of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore */ }
  }
})

// Claude stub: returns one released US event with a populated actual. The
// orchestrator's parse layer validates this JSON verbatim.
const generate = async () => JSON.stringify([{
  release_date: '2026-06-25', day_of_week: 'Thursday', country: 'United States',
  event: 'Orchestrator Test Event', expected: '1.0%', actual: '1.2%',
  previous: '0.9%', importance: 3,
}])

// Firecrawl stub that inspects the injected range action and FAILS the
// "Previous Month" range while succeeding for the others — exercising the
// graceful-degradation path (allSettled) deterministically, no network.
const partialFailClient: FirecrawlLike = {
  async scrape(_url, options) {
    if (JSON.stringify(options).includes('Previous Month')) {
      throw new Error('simulated ERR_TUNNEL_CONNECTION_FAILED')
    }
    return { markdown: '# calendar', html: '' }
  },
}

const allGoodClient: FirecrawlLike = {
  async scrape() { return { markdown: '# calendar', html: '' } },
}

describe('syncEconomicCalendar orchestration', () => {
  it('degrades gracefully: a failed range is skipped, the rest persist + stats are correct', async () => {
    const res = await mod.syncEconomicCalendar({
      ranges: ['Previous Month', 'This Month'],
      scrapeClient: partialFailClient,
      generate,
      backoffMs: 0,          // no real 5-min wait on the simulated failure
    })

    expect(res.rangesFailed).toBe(1)          // "Previous Month" failed
    expect(res.rangesOk).toBe(1)              // "This Month" survived
    expect(res.upserted).toBe(1)              // its row still persisted
    expect(res.inserted).toBe(1)              // fresh temp DB → an insert
    expect(res.updated).toBe(0)
    expect(res.actualsFilled).toBe(1)         // actual went blank → "1.2%"
    expect(res.parseLoss).toBe(0)             // nothing dropped

    const stored = dbmod.getEconomicReleases({ eventSearch: 'Orchestrator Test Event' })
    expect(stored).toHaveLength(1)
    expect(stored[0].actual).toBe('1.2%')
  })

  it('re-scraping in place updates (not inserts) and never blanks a populated actual', async () => {
    // Second run, all ranges good, but Claude now returns a BLANK actual for the
    // same event (as TE's "Previous Month" view sometimes does for aged rows).
    const generateBlankActual = async () => JSON.stringify([{
      release_date: '2026-06-25', day_of_week: 'Thursday', country: 'United States',
      event: 'Orchestrator Test Event', expected: '1.0%', actual: null,
      previous: '0.9%', importance: 3,
    }])

    const res = await mod.syncEconomicCalendar({
      ranges: ['This Month'],
      scrapeClient: allGoodClient,
      generate: generateBlankActual,
      backoffMs: 0,
    })

    expect(res.rangesFailed).toBe(0)
    expect(res.inserted).toBe(0)              // same PK → update, not insert
    expect(res.updated).toBe(1)
    expect(res.actualsFilled).toBe(0)         // already had an actual

    const stored = dbmod.getEconomicReleases({ eventSearch: 'Orchestrator Test Event' })
    expect(stored[0].actual).toBe('1.2%')     // preserved — NOT blanked
  })
})
