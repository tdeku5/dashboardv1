// viewAsOf (R1 definition: only incomplete rows block; missing rows never do)
// against a temp SQLite DB. docs/prompts/tv-completed-bars-phase1-rulings.md.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DAY = 86400
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000
// London-midnight epochs (BST: 23:00 UTC the day before)
const lm = (y: number, mo: number, d: number) => utc(y, mo, d) - 3600
const MON_19_OCT = lm(2026, 10, 19)
const TUE_20_OCT = lm(2026, 10, 20)
const DEC_2025 = utc(2025, 12, 15)
const TUE_1200_CT = utc(2026, 10, 20, 17)
const TUE_1700_CT = utc(2026, 10, 20, 22)
const TUE_1900_CT = utc(2026, 10, 21, 0)

let tmp: string
let db: typeof import('../db').db
let lib: typeof import('./tvViewAsOf')
let complete: typeof import('./tvBarComplete')
type Group = Parameters<typeof import('./tvViewAsOf').viewAsOf>[0][number]

function put(symbol: string, time: number, close: number, capturedAt: number | null): void {
  db.prepare('INSERT INTO tv_series (symbol, time, close, source_file, captured_at) VALUES (?, ?, ?, ?, ?)')
    .run(symbol, String(time), close, 'fixture.csv', capturedAt)
}
/** The reader pattern Phase 2 uses: latest complete close at or before the view's as-of. */
function closeAsOf(symbol: string, asOf: number | null): { time: number; close: number } | undefined {
  return db.prepare(`
    SELECT CAST(time AS INTEGER) AS time, close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL AND CAST(time AS INTEGER) <= ? AND ${complete.tvCompleteSql()}
    ORDER BY CAST(time AS INTEGER) DESC LIMIT 1
  `).get(symbol, asOf ?? Number.MAX_SAFE_INTEGER) as { time: number; close: number } | undefined
}
/** Assert the bounded and unbounded scans agree (R1 test 7), then return the bounded answer. */
function view(groups: Group[]): number | null {
  const bounded = lib.viewAsOf(groups)
  expect(lib.viewAsOf(groups, { bounded: false }), `bounded == unbounded for {${groups.join(', ')}}`).toBe(bounded)
  return bounded
}

beforeAll(async () => {
  tmp = path.join(os.tmpdir(), `tv-viewasof-test-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = tmp
  ;({ db } = await import('../db'))
  lib = await import('./tvViewAsOf')
  complete = await import('./tvBarComplete')
})
beforeEach(() => {
  db.exec('DELETE FROM tv_series; DELETE FROM tv_ohlcv;')
  lib.clearViewAsOfCache()
})
afterAll(() => {
  db.close()
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true })
})

describe('R1 viewAsOf — only incomplete rows block', () => {
  it('1. holiday: {US_EQUITY, NSE} after both closes, NSE has no 20 Oct row → Tue; NIFTY50 shows its 19 Oct close', () => {
    put('SPX', MON_19_OCT, 6000, TUE_1900_CT); put('SPX', TUE_20_OCT, 6010, TUE_1900_CT)
    put('NIFTY50', MON_19_OCT, 25000, TUE_1900_CT)            // no Tue row: Indian holiday
    expect(view(['US_EQUITY', 'NSE'])).toBe(TUE_20_OCT)
    expect(closeAsOf('NIFTY50', lib.viewAsOf(['US_EQUITY', 'NSE']))).toEqual({ time: MON_19_OCT, close: 25000 })
    expect(closeAsOf('SPX', lib.viewAsOf(['US_EQUITY', 'NSE']))).toEqual({ time: TUE_20_OCT, close: 6010 })
  })

  it('2. multi-day holiday: CN_YIELDS missing 5 consecutive dates; {US_YIELDS, CN_YIELDS} advances with the US', () => {
    const days = [5, 6, 7, 8, 9, 12, 13].map(d => lm(2026, 10, d))    // Mon 5 Oct … Tue 13 Oct
    const cap = utc(2026, 10, 14, 0)                                     // Tue 13 Oct 19:00 CT
    for (const t of days) put('US10Y', t, 4, cap)
    put('CN10Y', days[0], 1.8, cap); put('CN10Y', days[6], 1.81, cap)   // 6–12 Oct missing (Golden Week)
    expect(view(['US_YIELDS', 'CN_YIELDS'])).toBe(days[6])
    put('US10Y', lm(2026, 10, 14), 4.01, utc(2026, 10, 15, 0))          // US moves on (Wed 14 Oct, captured 19:00 CT); CN doesn't hold it back
    lib.clearViewAsOfCache()
    expect(view(['US_YIELDS', 'CN_YIELDS'])).toBe(lm(2026, 10, 14))
  })

  it('3. intraday Tue 12:00 CT: {US, EZ, JP} → Monday; {JP} → Tuesday', () => {
    for (const s of ['US10Y', 'DE10Y', 'JP10Y']) { put(s, MON_19_OCT, 4, TUE_1200_CT); put(s, TUE_20_OCT, 4.1, TUE_1200_CT) }
    expect(lib.firstIncomplete('US_YIELDS')).toBe(TUE_20_OCT)
    expect(lib.firstIncomplete('EZ_YIELDS')).toBeNull()
    expect(view(['US_YIELDS', 'EZ_YIELDS', 'JP_YIELDS'])).toBe(MON_19_OCT)
    expect(view(['JP_YIELDS'])).toBe(TUE_20_OCT)
  })

  it('4. mixed-time files: US03MY file at 12:00 CT, US01MY file at 17:00 CT → US_YIELDS blocks Tuesday; every US symbol shows Monday', () => {
    put('US10Y', MON_19_OCT, 4.0, TUE_1200_CT); put('US10Y', TUE_20_OCT, 4.1, TUE_1200_CT)        // from the 12:00 file
    put('US01MY', MON_19_OCT, 5.0, TUE_1700_CT); put('US01MY', TUE_20_OCT, 5.1, TUE_1700_CT)      // from the 17:00 file
    expect(complete.isBarComplete('US01MY', TUE_20_OCT, TUE_1700_CT)).toBe(true)                // its own Tue bar is complete…
    expect(view(['US_YIELDS'])).toBe(MON_19_OCT)                                                  // …but the group blocks Tuesday
    const asOf = lib.viewAsOf(['US_YIELDS'])
    expect(closeAsOf('US10Y', asOf)).toEqual({ time: MON_19_OCT, close: 4.0 })
    expect(closeAsOf('US01MY', asOf)).toEqual({ time: MON_19_OCT, close: 5.0 })
  })

  it('5. expired contract in CME_RATES does not affect the view', () => {
    put('FFZ25', DEC_2025, 96.0, null)                                                           // legacy, long expired
    put('FFZ26', MON_19_OCT, 95.9, TUE_1900_CT); put('FFZ26', TUE_20_OCT, 95.8, TUE_1900_CT)
    put('JP10Y', MON_19_OCT, 1, TUE_1900_CT); put('JP10Y', TUE_20_OCT, 1.1, TUE_1900_CT)
    expect(view(['CME_RATES', 'JP_YIELDS'])).toBe(TUE_20_OCT)
    put('FFZ24', DEC_2025 - 365 * DAY, 97.0, DEC_2025 - 365 * DAY + 2 * DAY)                     // expired, captured after its close
    lib.clearViewAsOfCache()
    expect(view(['CME_RATES', 'JP_YIELDS'])).toBe(TUE_20_OCT)
  })

  it('6. legacy NULL rows never block, even an unfinished-looking latest bar', () => {
    for (const s of ['US10Y', 'SR3Z6', 'DE10Y']) { put(s, MON_19_OCT, 4, null); put(s, TUE_20_OCT, 4.1, null) }
    expect(lib.firstIncomplete('US_YIELDS')).toBeNull()
    expect(view(['US_YIELDS', 'CME_RATES', 'EZ_YIELDS'])).toBe(TUE_20_OCT)
  })

  it('no rows at all → null', () => {
    expect(view(['NZ_YIELDS'])).toBeNull()
  })
})

describe('scan bound', () => {
  it('7. bounded == unbounded on every fixture above (asserted inside each case via view())', () => {
    // Plus a direct check where the incomplete row sits right at the bound's edge:
    // captured exactly one day before the group's newest capture.
    put('US10Y', MON_19_OCT, 4.0, TUE_1200_CT - DAY)               // Mon bar captured Mon 12:00 CT → incomplete
    put('US02Y', TUE_20_OCT, 4.1, TUE_1900_CT)                      // newest capture
    expect(lib.firstIncomplete('US_YIELDS')).toBe(MON_19_OCT)
    expect(lib.firstIncomplete('US_YIELDS', { bounded: false })).toBe(MON_19_OCT)
  })

  it('a symbol frozen incomplete after leaving the export stops blocking once captures move past the bound (deliberate divergence)', () => {
    put('FFV26', lm(2026, 10, 6), 95.0, utc(2026, 10, 6, 17))      // Tue 6 Oct bar, captured that noon, then dropped from the export
    put('FFZ26', MON_19_OCT, 95.9, TUE_1900_CT); put('FFZ26', TUE_20_OCT, 95.8, TUE_1900_CT)
    expect(lib.firstIncomplete('CME_RATES', { bounded: false })).toBe(lm(2026, 10, 6)) // unbounded: would hold every CME view at 5 Oct
    expect(lib.firstIncomplete('CME_RATES')).toBeNull()                                 // bounded: no longer blocks
    expect(lib.viewAsOf(['CME_RATES'])).toBe(TUE_20_OCT)
  })
})

describe('groupsForSymbols and the SQL function', () => {
  it('groupsForSymbols uses the resolver (unknowns contribute no group)', () => {
    expect(lib.groupsForSymbols(['US10Y', 'DE10Y', 'FR10Y', 'SR3Z6', 'BVOL']).sort()).toEqual(['CME_RATES', 'EZ_YIELDS', 'US_YIELDS'])
  })
  it('tv_bar_complete agrees with isBarComplete row by row', () => {
    for (const s of ['US10Y', 'SR3Z6', 'DE10Y', 'JP10Y', 'BTC']) {
      put(s, MON_19_OCT, 1, TUE_1200_CT); put(s, TUE_20_OCT, 2, TUE_1200_CT)
    }
    const rows = db.prepare(`SELECT symbol, time, captured_at AS cap, tv_bar_complete(symbol, time, captured_at) AS sql FROM tv_series`)
      .all() as Array<{ symbol: string; time: string; cap: number | null; sql: number }>
    expect(rows).toHaveLength(10)
    for (const r of rows) expect(r.sql === 1, `${r.symbol} ${r.time}`).toBe(complete.isBarComplete(r.symbol, r.time, r.cap))
  })
})
