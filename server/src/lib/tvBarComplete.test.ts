// isBarComplete fixtures (docs/prompts/tv-completed-bars-prompt.md §1e and
// phase0-decisions "Corrections"). Expected closes are hand-computed UTC
// instants, so these check the Intl/DST code rather than re-use it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isBarComplete, groupSessionClose, sessionDayStartUtc, sessionCloseEpoch, tvBarCompleteSql, tvCompleteSql,
  resetFallbackWarnings, FAST_PATH_SECONDS,
} from './tvBarComplete'
import { MARKET_CLOSES, FALLBACK_CLOSE, type MarketGroup } from '../tvMarketRegistry'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000

// tv_*.time convention: epoch at midnight Europe/London. BST (UTC+1) dates are
// stored as 23:00 UTC the previous day; GMT dates as 00:00 UTC.
const MON_19_OCT = utc(2026, 10, 18, 23)   // 1792364400
const TUE_20_OCT = utc(2026, 10, 19, 23)   // 1792450800
const WED_21_OCT = utc(2026, 10, 20, 23)
const FRI_14_AUG = utc(2026, 8, 13, 23)
const MON_26_OCT = utc(2026, 10, 26)       // GMT after the 25 Oct European change
const MON_02_NOV = utc(2026, 11, 2)        // after the 1 Nov US change

// Captures, as UTC. CDT = UTC-5 until 1 Nov 2026, CST = UTC-6 after.
const TUE_1200_CT = utc(2026, 10, 20, 17)
const TUE_1900_CT = utc(2026, 10, 21, 0)
const TUE_0700_CT = utc(2026, 10, 20, 12)
const THU_2143_CT = utc(2026, 8, 14, 2, 43)

afterEach(() => { vi.restoreAllMocks(); resetFallbackWarnings() })

describe('session date (+3600 convention)', () => {
  it('recovers the true session date for BST and GMT bars', () => {
    expect(sessionDayStartUtc(TUE_20_OCT)).toBe(utc(2026, 10, 20))
    expect(sessionDayStartUtc(String(TUE_20_OCT))).toBe(utc(2026, 10, 20))
    expect(sessionDayStartUtc(MON_26_OCT)).toBe(utc(2026, 10, 26))
  })
})

describe('CME (close 16:30 CT)', () => {
  it('Tuesday bar captured Tue 12:00 CT → incomplete', () => {
    expect(isBarComplete('SR3Z6', TUE_20_OCT, TUE_1200_CT)).toBe(false)
    expect(isBarComplete('CLZ6', TUE_20_OCT, TUE_1200_CT)).toBe(false)
  })
  it('same bar captured Tue 19:00 CT → complete', () => {
    expect(isBarComplete('SR3Z6', TUE_20_OCT, TUE_1900_CT)).toBe(true)
    expect(isBarComplete('CLZ6', TUE_20_OCT, TUE_1900_CT)).toBe(true)
  })
  it('a Wednesday-dated bar captured Tue 19:00 CT → incomplete', () => {
    expect(isBarComplete('SR3Z6', WED_21_OCT, TUE_1900_CT)).toBe(false)
  })
  it('close lands exactly at 16:30 CDT = 21:30 UTC (boundary inclusive)', () => {
    expect(groupSessionClose('CME_RATES', TUE_20_OCT)).toBe(utc(2026, 10, 20, 21, 30))
    expect(isBarComplete('FFZ26', TUE_20_OCT, utc(2026, 10, 20, 21, 30))).toBe(true)
    expect(isBarComplete('FFZ26', TUE_20_OCT, utc(2026, 10, 20, 21, 29, 59))).toBe(false)
  })
})

describe('Europe and Asia-Pacific close before a CT-morning capture', () => {
  it('European yield: captured on the session date at 12:00 CT → complete (18:00 CEST = 16:00 UTC)', () => {
    expect(groupSessionClose('EZ_YIELDS', TUE_20_OCT)).toBe(utc(2026, 10, 20, 16))
    expect(isBarComplete('DE10Y', TUE_20_OCT, TUE_1200_CT)).toBe(true)
    expect(isBarComplete('GB10Y', TUE_20_OCT, TUE_1200_CT)).toBe(true)
  })
  it('JGB / Australian: closed hours before a same-day 07:00 CT capture → complete', () => {
    expect(groupSessionClose('JP_YIELDS', TUE_20_OCT)).toBe(utc(2026, 10, 20, 6))        // 15:00 JST
    expect(groupSessionClose('AU_YIELDS', TUE_20_OCT)).toBe(utc(2026, 10, 20, 5, 30))    // 16:30 AEDT (UTC+11)
    expect(isBarComplete('JP10Y', TUE_20_OCT, TUE_0700_CT)).toBe(true)
    expect(isBarComplete('AU10Y', TUE_20_OCT, TUE_0700_CT)).toBe(true)
  })
})

describe('archive case: Friday-dated row captured Thursday 21:43 CT', () => {
  for (const [sym, group] of [['US10Y', 'US_YIELDS'], ['FFZ26', 'CME_RATES'], ['JP10Y', 'JP_YIELDS'], ['AU10Y', 'AU_YIELDS']] as const) {
    it(`${group} (${sym}) → incomplete`, () => {
      expect(isBarComplete(sym, FRI_14_AUG, THU_2143_CT)).toBe(false)
    })
  }
})

describe('DST boundaries', () => {
  it('Europe, day after the 25 Oct change: 18:00 CET = 17:00 UTC (CEST would wrongly be 16:00)', () => {
    expect(groupSessionClose('EZ_YIELDS', MON_26_OCT)).toBe(utc(2026, 10, 26, 17))
    expect(isBarComplete('DE10Y', MON_26_OCT, utc(2026, 10, 26, 16, 30))).toBe(false) // 11:30 CDT
    expect(isBarComplete('DE10Y', MON_26_OCT, utc(2026, 10, 26, 17, 5))).toBe(true)   // 12:05 CDT
  })
  it('US, day after the 1 Nov change: 17:30 EST = 22:30 UTC (EDT would wrongly be 21:30)', () => {
    expect(groupSessionClose('US_YIELDS', MON_02_NOV)).toBe(utc(2026, 11, 2, 22, 30))
    expect(isBarComplete('US10Y', MON_02_NOV, utc(2026, 11, 2, 22, 20))).toBe(false)  // 16:20 CST
    expect(isBarComplete('US10Y', MON_02_NOV, utc(2026, 11, 2, 22, 35))).toBe(true)   // 16:35 CST
  })
})

describe('legacy rows, 24:00 and the fallback', () => {
  it('captured_at NULL → complete', () => {
    expect(isBarComplete('SR3Z6', WED_21_OCT, null)).toBe(true)
    expect(isBarComplete('SR3Z6', WED_21_OCT, undefined)).toBe(true)
    expect(tvBarCompleteSql('SR3Z6', String(WED_21_OCT), null)).toBe(1)
  })
  it('crypto 24:00 = 00:00 UTC the next day', () => {
    expect(groupSessionClose('CRYPTO_UTC', TUE_20_OCT)).toBe(utc(2026, 10, 21))
    expect(isBarComplete('BTC', TUE_20_OCT, utc(2026, 10, 20, 23, 59, 59))).toBe(false)
    expect(isBarComplete('BTC', TUE_20_OCT, utc(2026, 10, 21))).toBe(true)
  })
  it('unknown symbol uses 23:59 Pacific/Honolulu (= 09:59 UTC next day) and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(isBarComplete('ZZZTEST', TUE_20_OCT, utc(2026, 10, 21, 9, 58))).toBe(false)
    expect(isBarComplete('ZZZTEST', TUE_20_OCT, utc(2026, 10, 21, 9, 59))).toBe(true)
    expect(isBarComplete('ZZZTEST', MON_19_OCT, utc(2026, 10, 19, 12))).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("'ZZZTEST'")
  })
})

describe('SQL form', () => {
  it('tvBarCompleteSql agrees with isBarComplete (incl. numeric-string inputs SQLite passes)', () => {
    const cases: Array<[string, number, number | null]> = [
      ['SR3Z6', TUE_20_OCT, TUE_1200_CT], ['SR3Z6', TUE_20_OCT, TUE_1900_CT], ['DE10Y', MON_26_OCT, utc(2026, 10, 26, 16, 30)],
      ['BTC', TUE_20_OCT, utc(2026, 10, 21)], ['ZZZTEST', TUE_20_OCT, TUE_1900_CT], ['US10Y', FRI_14_AUG, null],
    ]
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const [s, t, c] of cases) expect(tvBarCompleteSql(s, String(t), c)).toBe(isBarComplete(s, t, c) ? 1 : 0)
  })
  it('fragment short-circuits NULL before calling the function', () => {
    expect(tvCompleteSql()).toBe('(captured_at IS NULL OR tv_bar_complete(symbol, time, captured_at) = 1)')
    expect(tvCompleteSql('t')).toBe('(t.captured_at IS NULL OR tv_bar_complete(t.symbol, t.time, t.captured_at) = 1)')
  })
})

describe('fast path is safe for every registry row and the fallback', () => {
  it(`every close falls before session date + ${FAST_PATH_SECONDS / 86400} days 00:00 UTC (2024–2028, every day)`, () => {
    const rules: Array<[string, typeof FALLBACK_CLOSE]> = [
      ...(Object.entries(MARKET_CLOSES) as Array<[MarketGroup, typeof FALLBACK_CLOSE]>),
      ['(fallback)', FALLBACK_CLOSE],
    ]
    let worst = { group: '', date: '', afterDayStartHours: -Infinity }
    const violations: string[] = []
    for (let day = utc(2024, 1, 1); day <= utc(2028, 12, 31); day += 86400) {
      for (const [group, rule] of rules) {
        const close = sessionCloseEpoch(rule, day)
        const after = close - day
        if (after > worst.afterDayStartHours * 3600) {
          worst = { group, date: new Date(day * 1000).toISOString().slice(0, 10), afterDayStartHours: after / 3600 }
        }
        if (close >= day + FAST_PATH_SECONDS) violations.push(`${group} ${new Date(day * 1000).toISOString().slice(0, 10)}`)
      }
    }
    console.log(`latest close found: ${worst.group} on ${worst.date} at session date + ${worst.afterDayStartHours.toFixed(2)} h UTC (limit ${FAST_PATH_SECONDS / 3600} h)`)
    expect(violations).toEqual([])
  })
})
