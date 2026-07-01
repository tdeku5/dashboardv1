import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import type { CategorizedRelease } from './types'

// Point db.ts at a throwaway file BEFORE importing it (the connection + schema
// are created at module load), so these tests never touch the real fred_data.db.
let dbmod: typeof import('../db')
let tmpPath: string

beforeAll(async () => {
  tmpPath = path.join(os.tmpdir(), `econ-upsert-test-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = tmpPath
  dbmod = await import('../db')
})

afterAll(() => {
  for (const f of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try { fs.rmSync(f, { force: true }) } catch { /* ignore */ }
  }
})

const row = (over: Partial<CategorizedRelease> = {}): CategorizedRelease => ({
  release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'United States',
  event: 'Core CPI', reference_period: null, category: 'Inflation',
  expected: '0.2% MoM', actual: null, previous: '0.3% MoM',
  importance: 3, scraped_at: '2026-05-27T08:00:00Z', ...over,
})

describe('economic_releases upsert', () => {
  it('inserts a new row', () => {
    expect(dbmod.upsertEconomicReleases([row()])).toBe(1)
    const all = dbmod.getEconomicReleases()
    expect(all).toHaveLength(1)
    expect(all[0].actual).toBeNull()
  })

  it('updates in place when actual fills in later — no duplicate row', () => {
    dbmod.upsertEconomicReleases([row({ actual: '0.5% MoM', scraped_at: '2026-05-27T23:00:00Z' })])
    const all = dbmod.getEconomicReleases()
    expect(all).toHaveLength(1)                       // still ONE row, same PK
    expect(all[0].actual).toBe('0.5% MoM')
    expect(all[0].scraped_at).toBe('2026-05-27T23:00:00Z')
  })

  it('clears a stale surprise when actual is revised', () => {
    dbmod.updateReleaseSurprise('2026-05-27', 'United States', 'Core CPI', 'hot')
    expect(dbmod.getEconomicReleases()[0].surprise).toBe('hot')
    dbmod.upsertEconomicReleases([row({ actual: '0.6% MoM', scraped_at: '2026-05-28T08:00:00Z' })])
    expect(dbmod.getEconomicReleases()[0].surprise).toBeNull()   // revised print → re-classify
  })

  it('does not clear surprise when actual is unchanged', () => {
    dbmod.updateReleaseSurprise('2026-05-27', 'United States', 'Core CPI', 'warm')
    dbmod.upsertEconomicReleases([row({ actual: '0.6% MoM', scraped_at: '2026-05-28T12:00:00Z' })])
    expect(dbmod.getEconomicReleases()[0].surprise).toBe('warm')
  })

  it('keeps distinct (date, country, event) tuples as separate rows', () => {
    dbmod.upsertEconomicReleases([row({ event: 'GDP Growth Rate' }), row({ country: 'Japan' })])
    expect(dbmod.getEconomicReleases()).toHaveLength(3)
  })

  it('filters by country, importance, date range, and event search', () => {
    expect(dbmod.getEconomicReleases({ countries: ['United States'] }).every(r => r.country === 'United States')).toBe(true)
    expect(dbmod.getEconomicReleases({ eventSearch: 'cpi' }).every(r => r.event.toLowerCase().includes('cpi'))).toBe(true)
    expect(dbmod.getEconomicReleases({ minImportance: 3 }).every(r => r.importance >= 3)).toBe(true)
    expect(dbmod.getEconomicReleases({ startDate: '2026-05-27', endDate: '2026-05-27' }).every(r => r.release_date === '2026-05-27')).toBe(true)
  })

  it('does NOT blank a populated actual/expected when a re-scrape returns null', () => {
    // Fully-populated row (an already-released event).
    dbmod.upsertEconomicReleases([row({
      event: 'Retail Sales MoM', expected: '0.4%', actual: '0.7%',
      scraped_at: '2026-05-28T08:00:00Z',
    })])
    // A later "Previous Month" re-scrape drops the forecast and actual (TE
    // sometimes serves blanks for aged rows) — both must be preserved.
    dbmod.upsertEconomicReleases([row({
      event: 'Retail Sales MoM', expected: null, actual: null,
      scraped_at: '2026-05-29T08:00:00Z',
    })])
    const r = dbmod.getEconomicReleases({ eventSearch: 'Retail Sales MoM' })[0]
    expect(r.expected).toBe('0.4%')                     // preserved, not blanked
    expect(r.actual).toBe('0.7%')                       // preserved, not blanked
    expect(r.scraped_at).toBe('2026-05-29T08:00:00Z')   // metadata still refreshes
  })
})
