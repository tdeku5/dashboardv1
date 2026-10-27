// Every symbol currently stored in tv_series / tv_ohlcv must resolve to a named
// market group, except the explicit FALLBACK_ALLOWLIST (phase0-decisions,
// "Symbol resolver"). An unexpected fallback fails — add the symbol to the
// registry, or to the allowlist with a reason.
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { resolveMarketGroup, FALLBACK_ALLOWLIST, MARKET_CLOSES } from './tvMarketRegistry'

const DB_FILE = process.env.TV_REGISTRY_DB ?? path.join(__dirname, '..', '..', 'fred_data.db')

describe('market registry resolves every stored TradingView symbol', () => {
  it.skipIf(!fs.existsSync(DB_FILE))('all symbols map to a named group; only allowlisted ones fall back', () => {
    const db = new Database(DB_FILE, { readonly: true, fileMustExist: true })
    const symbols = (db.prepare(`
      SELECT symbol FROM tv_series GROUP BY symbol
      UNION SELECT symbol FROM tv_ohlcv GROUP BY symbol
    `).all() as Array<{ symbol: string }>).map(r => r.symbol)
    const seriesCount = (db.prepare('SELECT COUNT(DISTINCT symbol) AS n FROM tv_series').get() as { n: number }).n
    db.close()

    const byGroup = new Map<string, number>()
    const fallback: string[] = []
    for (const s of symbols) {
      const g = resolveMarketGroup(s)
      if (g) byGroup.set(g, (byGroup.get(g) ?? 0) + 1)
      else fallback.push(s)
    }
    console.log(`tv_series symbols: ${seriesCount}; resolved (series+ohlcv): ${symbols.length - fallback.length} of ${symbols.length}; fallback: [${fallback.join(', ')}]`)
    console.log([...byGroup].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}=${n}`).join(' '))

    expect(seriesCount).toBeGreaterThanOrEqual(662)
    expect(fallback.sort()).toEqual([...FALLBACK_ALLOWLIST].sort())
    // every group that resolves is a registry row
    for (const g of byGroup.keys()) expect(Object.keys(MARKET_CLOSES)).toContain(g)
  })

  it('resolver shapes: roots, tenors, FX, exact names, unknowns', () => {
    expect(resolveMarketGroup('SR3Z6')).toBe('CME_RATES')
    expect(resolveMarketGroup('TOA3H0')).toBe('OSE_STIR')
    expect(resolveMarketGroup('EURM6')).toBe('ICE_EU_STIR')
    expect(resolveMarketGroup('EURUSD')).toBe('FX_NY17')
    expect(resolveMarketGroup('GB03MY')).toBe('GB_YIELDS')
    expect(resolveMarketGroup('GN10Y')).toBe('CN_YIELDS')
    expect(resolveMarketGroup('TVC:US03MY')).toBe('US_YIELDS')
    expect(resolveMarketGroup('TSX:TSX')).toBe('TSX')
    expect(resolveMarketGroup('CL')).toBe('CME_ENERGY_METALS')
    expect(resolveMarketGroup('BVOL')).toBeNull()
    expect(resolveMarketGroup('NEWTICKER')).toBeNull()
  })
})
