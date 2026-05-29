// VIX futures term-structure builder. Mirrors `crudeCurves.ts` for the
// distinct-timestamps-DESC offset lookup + at-or-before close map + expiry
// cutoff filtering, but parses VIX's two-digit-year contract codes
// (e.g. `VXM26` → month=M=Jun, year=2026) and anchors the curve with spot VIX.
//
// Returns a `CrudeCurveData`-shaped object so the existing client component
// can render it unchanged — only the visual formatters differ on the panel.

import { db } from './db'

const MONTH_CODES = 'FGHJKMNQUVXZ'
const MONTH_CODE_MAP: Record<string, number> = {
  F: 0, G: 1, H: 2, J: 3, K: 4, M: 5,
  N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11,
}

const FUTURES_PREFIX = 'VX'
const SPOT_SYMBOL = 'VIX'

export interface VixCurveContract {
  code: string
  current: number | null
  offset1: number | null
  offset2: number | null   // unused for VIX (we expose only one offset); kept for shape parity
}

export interface VixCurveResponse {
  product: 'vix'
  asOf: string
  offset1Date: string | null
  offset1Days: number
  offset2Date: string | null
  offset2Days: number
  contracts: VixCurveContract[]
}

interface ParsedVxContract {
  symbol: string       // e.g. "VXM26"
  code: string         // display label, e.g. "M26"
  monthIndex: number   // 0–11
  year: number         // full year, e.g. 2026
  sortKey: number      // for chronological order
}

// `VX` + 1 month letter + 2-digit year, e.g. VXM26, VXF27. Returns null for
// other patterns (notably `VX1`, `VX2` — continuous-front proxies that the
// prompt deliberately excludes from this dated-contract curve).
function parseVxContract(symbol: string): ParsedVxContract | null {
  if (!symbol.startsWith(FUTURES_PREFIX)) return null
  const rest = symbol.slice(FUTURES_PREFIX.length)
  if (rest.length !== 3) return null
  const monthCode = rest[0].toUpperCase()
  const monthIndex = MONTH_CODE_MAP[monthCode]
  if (monthIndex === undefined) return null
  const yy = parseInt(rest.slice(1), 10)
  if (!Number.isFinite(yy)) return null
  // YY ≥ 50 → 20YY (1950+); else 20YY for current era. VIX futures only ever
  // list near-dated contracts, so 2000-2099 is sufficient — same convention as
  // the wider repo.
  const year = 2000 + yy
  const sortKey = year * 100 + monthIndex
  return { symbol, code: `${monthCode}${rest.slice(1)}`, monthIndex, year, sortKey }
}

// First day of the month *after* the contract month — a contract is "live"
// while asOf < cutoff. Same cutoff convention as the crude/STIR curves.
function getExpiryCutoff(monthIndex: number, year: number): Date {
  const cutoffMonth = (monthIndex + 1) % 12
  const cutoffYear  = monthIndex === 11 ? year + 1 : year
  return new Date(Date.UTC(cutoffYear, cutoffMonth, 1))
}

function tsToDate(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10)
}

// Distinct timestamps DESC across the union of (spot VIX + all VX dated
// contracts). Used to pick the asOf and t−offset reference points.
function getDistinctTimestampsDesc(limit: number): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT time FROM tv_series
    WHERE (symbol = 'VIX' OR symbol GLOB 'VX[FGHJKMNQUVXZ]??')
      AND close IS NOT NULL AND close > 0
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(limit) as { time: string }[]
  return rows.map(r => r.time)
}

// Latest close at-or-before a given timestamp for each VIX-curve symbol.
function getLatestRowsAtOrBefore(asOfTs: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT s.symbol AS symbol, s.close AS close
    FROM tv_series s
    JOIN (
      SELECT symbol, MAX(CAST(time AS INTEGER)) AS maxt
      FROM tv_series
      WHERE (symbol = 'VIX' OR symbol GLOB 'VX[FGHJKMNQUVXZ]??')
        AND close IS NOT NULL AND close > 0
        AND CAST(time AS INTEGER) <= CAST(? AS INTEGER)
      GROUP BY symbol
    ) m ON m.symbol = s.symbol AND CAST(s.time AS INTEGER) = m.maxt
  `).all(asOfTs) as Array<{ symbol: string; close: number }>
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.symbol, r.close)
  return out
}

// Builds the VIX futures curve: spot VIX first (anchor), then live dated
// contracts in chronological expiry order, each with current + offset closes.
export function getVixFuturesCurve(offset1Days: number): VixCurveResponse {
  const fetchLimit = Math.max(20, Math.min(2000, offset1Days + 20))
  const timestamps = getDistinctTimestampsDesc(fetchLimit)

  if (timestamps.length === 0) {
    return { product: 'vix', asOf: '', offset1Date: null, offset1Days, offset2Date: null, offset2Days: 0, contracts: [] }
  }

  const currentTs = timestamps[0]
  const offset1Ts = timestamps[Math.min(offset1Days, timestamps.length - 1)] ?? null

  const currentMap = getLatestRowsAtOrBefore(currentTs)
  const offset1Map = offset1Ts ? getLatestRowsAtOrBefore(offset1Ts) : new Map<string, number>()

  // Find live dated contracts (parsed + still alive as of currentTs).
  const asOfDate = tsToDate(currentTs)
  const asOfDateObj = new Date(asOfDate + 'T00:00:00Z')
  const live: ParsedVxContract[] = []
  for (const symbol of currentMap.keys()) {
    if (symbol === SPOT_SYMBOL) continue
    const p = parseVxContract(symbol)
    if (!p) continue
    if (getExpiryCutoff(p.monthIndex, p.year) <= asOfDateObj) continue
    live.push(p)
  }
  live.sort((a, b) => a.sortKey - b.sortKey)

  // Spot VIX anchors the left of the curve, then the dated contracts.
  const contracts: VixCurveContract[] = []
  if (currentMap.has(SPOT_SYMBOL)) {
    contracts.push({
      code: 'VIX',
      current: currentMap.get(SPOT_SYMBOL) ?? null,
      offset1: offset1Map.get(SPOT_SYMBOL) ?? null,
      offset2: null,
    })
  }
  for (const p of live) {
    contracts.push({
      code: p.code,
      current: currentMap.get(p.symbol) ?? null,
      offset1: offset1Map.get(p.symbol) ?? null,
      offset2: null,
    })
  }

  return {
    product: 'vix',
    asOf: asOfDate,
    offset1Date: offset1Ts ? tsToDate(offset1Ts) : null,
    offset1Days,
    offset2Date: null,
    offset2Days: 0,
    contracts,
  }
}
