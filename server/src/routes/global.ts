import { Router, Request, Response } from 'express'
import { db, getObservations } from '../db'
import { getTvCurve } from '../tvFutures'
import { getMarket } from '../stirRegistry'

export const globalRouter = Router()

// ── Helpers ──────────────────────────────────────────────────────────────────

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function getLatestTvYield(symbol: string): number | null {
  const row = db.prepare(`
    SELECT close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT 1
  `).get(symbol) as { close: number } | undefined
  return row?.close ?? null
}

// Returns the close N trading days before the most recent observation for `symbol`.
// lookbackDays = 0 returns the latest. Null if not enough history.
function getTvYieldAtLookback(symbol: string, lookbackDays: number): { value: number; date: string } | null {
  const rows = db.prepare(`
    SELECT time, close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(symbol, lookbackDays + 1) as { time: string; close: number }[]
  if (rows.length === 0) return null
  const target = rows[Math.min(lookbackDays, rows.length - 1)]
  return { value: target.close, date: tsToDate(parseInt(target.time, 10)) }
}

// ── Yield Curve Config ───────────────────────────────────────────────────────

interface TenorSpec {
  tenor: string
  years: number
  US?: string       // FRED series ID
  GB?: string       // tv_series symbol
  DE?: string
  FR?: string
  IT?: string
  CA?: string
  JP?: string
  AU?: string
}

const TENOR_SPECS: TenorSpec[] = [
  { tenor: '1M', years: 1/12,  US: 'US01MY', GB: 'GB01MY', DE: 'DE01MY', FR: 'FR01MY', IT: 'IT01MY', CA: 'CA01MY' },
  { tenor: '3M', years: 0.25,  US: 'US03MY', GB: 'GB03MY', DE: 'DE03MY', FR: 'FR03MY', IT: 'IT03MY', CA: 'CA03MY', JP: 'JP03MY' },
  { tenor: '1Y', years: 1,     US: 'US01Y',  GB: 'GB01Y',  DE: 'DE01Y',  FR: 'FR01Y',  IT: 'IT01Y',  CA: 'CA01Y',  JP: 'JP01Y', AU: 'AU01Y' },
  { tenor: '2Y', years: 2,     US: 'US02Y',  GB: 'GB02Y',  DE: 'DE02Y',  FR: 'FR02Y',  IT: 'IT02Y',  CA: 'CA02Y',  JP: 'JP02Y', AU: 'AU02Y' },
  { tenor: '3Y', years: 3,     US: 'US03Y',  GB: 'GB03Y',  DE: 'DE03Y',  FR: 'FR03Y',  IT: 'IT03Y',  CA: 'CA03Y',  JP: 'JP03Y', AU: 'AU03Y' },
  { tenor: '5Y', years: 5,     US: 'US05Y',  GB: 'GB05Y',  DE: 'DE05Y',  FR: 'FR05Y',  IT: 'IT05Y',  CA: 'CA05Y',  JP: 'JP05Y', AU: 'AU05Y' },
  { tenor: '7Y', years: 7,     US: 'US07Y',  GB: 'GB07Y',  DE: 'DE07Y',  FR: 'FR07Y',  IT: 'IT07Y',  CA: 'CA07Y',  JP: 'JP07Y', AU: 'AU07Y' },
  { tenor: '10Y', years: 10,   US: 'US10Y',  GB: 'GB10Y',  DE: 'DE10Y',  FR: 'FR10Y',  IT: 'IT10Y',  CA: 'CA10Y',  JP: 'JP10Y', AU: 'AU10Y' },
  { tenor: '20Y', years: 20,   US: 'US20Y',  GB: 'GB20Y',  DE: 'DE20Y',  FR: 'FR20Y',  IT: 'IT20Y',  CA: 'CA20Y',  JP: 'JP20Y', AU: 'AU20Y' },
  { tenor: '30Y', years: 30,   US: 'US30Y',  GB: 'GB30Y',  DE: 'DE30Y',  FR: 'FR30Y',  IT: 'IT30Y',  CA: 'CA30Y',  JP: 'JP30Y', AU: 'AU30Y' },
  { tenor: '40Y', years: 40,                                                                             JP: 'JP40Y' },
]

const COUNTRY_KEYS = ['US', 'GB', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
type CountryKey = typeof COUNTRY_KEYS[number]
// Map from server-side country keys to the response field names
const RESPONSE_KEYS: Record<CountryKey, string> = {
  US: 'US', GB: 'UK', DE: 'DE', FR: 'FR', IT: 'IT', CA: 'CA', JP: 'JP', AU: 'AU',
}

// ── GET /api/global/yield-curves ─────────────────────────────────────────────

globalRouter.get('/yield-curves', (req: Request, res: Response) => {
  try {
    const lookbackDays = Math.max(0, parseInt(String(req.query.lookbackDays ?? '0'), 10) || 0)

    const rows: Record<string, unknown>[] = []
    let asOfDate = ''

    for (const spec of TENOR_SPECS) {
      const row: Record<string, unknown> = { tenor: spec.tenor, years: spec.years }
      let hasAny = false

      for (const ck of COUNTRY_KEYS) {
        const symbol = spec[ck as keyof TenorSpec] as string | undefined
        if (!symbol) continue
        const point = getTvYieldAtLookback(symbol, lookbackDays)
        if (point) {
          row[RESPONSE_KEYS[ck]] = point.value
          hasAny = true
          if (!asOfDate || point.date > asOfDate) asOfDate = point.date
        }
      }

      if (hasAny) rows.push(row)
    }

    res.json({ asOfDate, lookbackDays, tenors: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected global yield curve error'
    console.error('[global] Yield curves error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/global/forward-curves ───────────────────────────────────────────

interface ForwardMarket {
  responseKey: string
  marketKey: string
}

const FORWARD_MARKETS: ForwardMarket[] = [
  { responseKey: 'US', marketKey: 'SR3' },
  { responseKey: 'UK', marketKey: 'SO3' },
  { responseKey: 'EU', marketKey: 'EUR' },
  { responseKey: 'CA', marketKey: 'CRA' },
  { responseKey: 'JP', marketKey: 'TOA3' },
  { responseKey: 'AU', marketKey: 'AUS' },
]

const QUARTERLY_CODES = ['H', 'M', 'U', 'Z']

function buildContractAxis(startMonthCode: string, startYear: number, endYear: number): string[] {
  const labels: string[] = []
  let monthIdx = QUARTERLY_CODES.indexOf(startMonthCode)
  if (monthIdx < 0) monthIdx = 0
  let year = startYear
  while (year < endYear || (year === endYear && monthIdx <= 3)) {
    labels.push(`${QUARTERLY_CODES[monthIdx]}${year % 10}`)
    monthIdx = (monthIdx + 1) % 4
    if (monthIdx === 0) year += 1
  }
  return labels
}

globalRouter.get('/forward-curves', (req: Request, res: Response) => {
  try {
    const lookbackDays = Math.max(0, parseInt(String(req.query.lookbackDays ?? '0'), 10) || 0)

    // getTvCurve always returns currentCurve = today; lookbackCurve = N back
    // (when N>0). For date-shift mode pick the snapshot at the resolved date.
    const curves = FORWARD_MARKETS.map(fm => {
      const c = getTvCurve(fm.marketKey, Math.max(1, lookbackDays))
      const contracts = lookbackDays > 0 ? c.lookbackCurve : c.currentCurve
      const asOfDate  = lookbackDays > 0 ? c.lookbackDate : c.currentDate
      return { responseKey: fm.responseKey, marketKey: fm.marketKey, contracts, asOfDate }
    })

    const asOfDate = curves.find(c => c.asOfDate)?.asOfDate ?? ''

    const sr3 = curves.find(c => c.marketKey === 'SR3')
    if (!sr3 || sr3.contracts.length === 0) {
      res.json({ asOfDate, lookbackDays, contracts: [] })
      return
    }
    const front = sr3.contracts[0]
    const axis = buildContractAxis(front.monthCode, front.year, 2030)

    type Contract = (typeof sr3.contracts)[number]
    const findByCode = (contracts: Contract[], code: string): Contract | undefined => {
      const monthCode = code[0]
      const yearDigit = parseInt(code.slice(1), 10)
      return contracts.find(c => c.monthCode === monthCode && c.year % 10 === yearDigit)
    }

    const contracts = axis.map(code => {
      const row: Record<string, string | number | null> = { code }
      for (const c of curves) {
        const ct = findByCode(c.contracts, code)
        row[c.responseKey] = ct?.impliedRate != null ? ct.impliedRate : null
      }
      return row
    })

    res.json({ asOfDate, lookbackDays, contracts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected global forward curve error'
    console.error('[global] Forward curves error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/global/calendar-spreads ─────────────────────────────────────────
// Returns 3m / 6m / 9m / 12m calendar spreads for SR3 / SO3 / EUR / CRA / TOA3 / AUS,
// keyed by row position (i.e. front contract index).

const SPREAD_STRIDES = [1, 2, 3, 4] as const // 3m, 6m, 9m, 12m at quarterly cadence

globalRouter.get('/calendar-spreads', (req: Request, res: Response) => {
  try {
    const lookbackDays = Math.max(0, parseInt(String(req.query.lookbackDays ?? '0'), 10) || 0)

    const curves = FORWARD_MARKETS.map(fm => {
      const c = getTvCurve(fm.marketKey, Math.max(1, lookbackDays))
      const contracts = lookbackDays > 0 ? c.lookbackCurve : c.currentCurve
      const asOfDate  = lookbackDays > 0 ? c.lookbackDate : c.currentDate
      return { marketKey: fm.marketKey, contracts, asOfDate }
    })

    const countries = FORWARD_MARKETS.map(fm => {
      const m = getMarket(fm.marketKey)
      return {
        marketKey: fm.marketKey,
        displayName: m?.displayName ?? fm.marketKey,
        shortName: m?.shortName ?? fm.marketKey,
      }
    })

    const asOfDate = curves.find(c => c.asOfDate)?.asOfDate ?? ''
    const shortLabel = (c: { monthCode: string; year: number }) => `${c.monthCode}${c.year % 10}`

    type Contract = (typeof curves)[number]['contracts'][number]
    const strides: Record<number, Array<Record<string, string | number>>> = {}
    for (const stride of SPREAD_STRIDES) {
      const maxRows = Math.max(0, ...curves.map(c => c.contracts.length - stride))
      const rows: Array<Record<string, string | number>> = []
      for (let i = 0; i < maxRows; i++) {
        const row: Record<string, string | number> = { position: i + 1, label: '' }
        const sr3 = curves.find(c => c.marketKey === 'SR3')
        if (sr3 && sr3.contracts.length > i + stride) {
          row.label = `${shortLabel(sr3.contracts[i])}/${shortLabel(sr3.contracts[i + stride])}`
        } else {
          const fallback = curves.find(c => c.contracts.length > i + stride)
          if (fallback) {
            row.label = `${shortLabel(fallback.contracts[i])}/${shortLabel(fallback.contracts[i + stride])}`
          }
        }
        for (const c of curves) {
          const arr: Contract[] = c.contracts
          if (arr.length > i + stride) {
            const front = arr[i]
            const back = arr[i + stride]
            if (front.impliedRate != null && back.impliedRate != null) {
              row[c.marketKey] = +(((back.impliedRate - front.impliedRate) * 100).toFixed(4))
            }
          }
        }
        rows.push(row)
      }
      strides[stride] = rows
    }

    res.json({ asOfDate, lookbackDays, countries, strides })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected global calendar spreads error'
    console.error('[global] Calendar spreads error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/global/yield-changes ────────────────────────────────────────────
// 1d nominal change (bps) and 200d vol-adjusted z-score for 2Y/5Y/10Y/30Y plus
// 2s10s / 10s30s spreads, across US (FRED DGS) and other G10 sovereigns
// (tv_series: <CC><TT>Y).

interface YieldSeries { date: string; value: number }

const ROLLING_WINDOW = 200
const MIN_OBSERVATIONS = 60
const HISTORY_LIMIT = 260

function getFredYieldHistory(seriesId: string): YieldSeries[] {
  const rows = db.prepare(`
    SELECT date, value FROM series_observations
    WHERE series_id = ? AND value IS NOT NULL
    ORDER BY date DESC
    LIMIT ?
  `).all(seriesId, HISTORY_LIMIT) as { date: string; value: number }[]
  return rows.reverse().map(r => ({ date: r.date, value: r.value }))
}

function getTvYieldHistory(symbol: string): YieldSeries[] {
  const rows = db.prepare(`
    SELECT time, close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(symbol, HISTORY_LIMIT) as { time: string; close: number }[]
  return rows.reverse().map(r => ({ date: tsToDate(parseInt(r.time, 10)), value: r.close }))
}

function rollingStdDev(changes: number[], window: number): number | null {
  if (changes.length === 0) return null
  const slice = changes.slice(-window)
  if (slice.length < 2) return null
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length
  const sse = slice.reduce((s, v) => s + (v - mean) * (v - mean), 0)
  const variance = sse / (slice.length - 1)
  return Math.sqrt(variance)
}

interface TenorMetric {
  current: number
  previous: number
  changeBps: number
  sigma200d: number | null
  zScore: number | null
}

function computeMetric(history: YieldSeries[]): TenorMetric | null {
  if (history.length < 2) return null
  const changes: number[] = []
  for (let i = 1; i < history.length; i++) {
    changes.push((history[i].value - history[i - 1].value) * 100)
  }
  if (changes.length < MIN_OBSERVATIONS - 1) return null
  const sigma = rollingStdDev(changes, ROLLING_WINDOW)
  const latest = history[history.length - 1]
  const prev = history[history.length - 2]
  const changeBps = (latest.value - prev.value) * 100
  return {
    current: latest.value,
    previous: prev.value,
    changeBps,
    sigma200d: sigma,
    zScore: sigma && sigma > 0 ? changeBps / sigma : null,
  }
}

interface SpreadMetric {
  current: number
  previous: number
  changeBps: number
  sigma200d: number | null
  zScore: number | null
}

function computeSpreadMetric(longLeg: YieldSeries[], shortLeg: YieldSeries[]): SpreadMetric | null {
  if (longLeg.length < 2 || shortLeg.length < 2) return null
  const shortByDate = new Map(shortLeg.map(p => [p.date, p.value]))
  const spread: { date: string; value: number }[] = []
  for (const p of longLeg) {
    const s = shortByDate.get(p.date)
    if (s != null) spread.push({ date: p.date, value: (p.value - s) * 100 }) // store spread as bps directly
  }
  if (spread.length < 2) return null
  const changes: number[] = []
  for (let i = 1; i < spread.length; i++) {
    changes.push(spread[i].value - spread[i - 1].value)
  }
  if (changes.length < MIN_OBSERVATIONS - 1) return null
  const sigma = rollingStdDev(changes, ROLLING_WINDOW)
  const latest = spread[spread.length - 1]
  const prev = spread[spread.length - 2]
  const changeBps = latest.value - prev.value
  return {
    current: latest.value,
    previous: prev.value,
    changeBps,
    sigma200d: sigma,
    zScore: sigma && sigma > 0 ? changeBps / sigma : null,
  }
}

// Country -> tenor -> source descriptor.
// `kind: 'fred'` reads from series_observations; `kind: 'tv'` reads from tv_series.
type SourceDescriptor = { kind: 'fred' | 'tv'; id: string }

const YIELD_SOURCES: Record<string, Partial<Record<'2Y' | '5Y' | '10Y' | '30Y', SourceDescriptor>>> = {
  US:      { '2Y': { kind: 'tv', id: 'US02Y' }, '5Y': { kind: 'tv', id: 'US05Y' }, '10Y': { kind: 'tv', id: 'US10Y' }, '30Y': { kind: 'tv', id: 'US30Y' } },
  Canada:  { '2Y': { kind: 'tv', id: 'CA02Y' }, '5Y': { kind: 'tv', id: 'CA05Y' }, '10Y': { kind: 'tv', id: 'CA10Y' }, '30Y': { kind: 'tv', id: 'CA30Y' } },
  AU:      { '2Y': { kind: 'tv', id: 'AU02Y' }, '5Y': { kind: 'tv', id: 'AU05Y' }, '10Y': { kind: 'tv', id: 'AU10Y' }, '30Y': { kind: 'tv', id: 'AU30Y' } },
  Japan:   { '2Y': { kind: 'tv', id: 'JP02Y' }, '5Y': { kind: 'tv', id: 'JP05Y' }, '10Y': { kind: 'tv', id: 'JP10Y' }, '30Y': { kind: 'tv', id: 'JP30Y' } },
  GB:      { '2Y': { kind: 'tv', id: 'GB02Y' }, '5Y': { kind: 'tv', id: 'GB05Y' }, '10Y': { kind: 'tv', id: 'GB10Y' }, '30Y': { kind: 'tv', id: 'GB30Y' } },
  Germany: { '2Y': { kind: 'tv', id: 'DE02Y' }, '5Y': { kind: 'tv', id: 'DE05Y' }, '10Y': { kind: 'tv', id: 'DE10Y' }, '30Y': { kind: 'tv', id: 'DE30Y' } },
  France:  { '2Y': { kind: 'tv', id: 'FR02Y' }, '5Y': { kind: 'tv', id: 'FR05Y' }, '10Y': { kind: 'tv', id: 'FR10Y' }, '30Y': { kind: 'tv', id: 'FR30Y' } },
  Italy:   { '2Y': { kind: 'tv', id: 'IT02Y' }, '5Y': { kind: 'tv', id: 'IT05Y' }, '10Y': { kind: 'tv', id: 'IT10Y' }, '30Y': { kind: 'tv', id: 'IT30Y' } },
}

const COUNTRY_ORDER = ['US', 'Canada', 'AU', 'Japan', 'GB', 'Germany', 'France', 'Italy'] as const
const TENORS = ['2Y', '5Y', '10Y', '30Y'] as const

globalRouter.get('/yield-changes', (_req: Request, res: Response) => {
  try {
    const out: Record<string, Record<string, TenorMetric | SpreadMetric | null>> = {}
    let asOfDate = ''
    let previousDate = ''

    for (const country of COUNTRY_ORDER) {
      const sources = YIELD_SOURCES[country]
      const histories: Partial<Record<'2Y' | '5Y' | '10Y' | '30Y', YieldSeries[]>> = {}
      for (const tenor of TENORS) {
        const src = sources[tenor]
        if (!src) continue
        const history = src.kind === 'fred' ? getFredYieldHistory(src.id) : getTvYieldHistory(src.id)
        if (history.length > 0) histories[tenor] = history
      }

      const countryOut: Record<string, TenorMetric | SpreadMetric | null> = {}
      for (const tenor of TENORS) {
        const h = histories[tenor]
        const metric = h ? computeMetric(h) : null
        countryOut[tenor] = metric
        if (metric) {
          const latest = h![h!.length - 1].date
          const prev = h![h!.length - 2].date
          if (!asOfDate || latest > asOfDate) asOfDate = latest
          if (!previousDate || prev > previousDate) previousDate = prev
        }
      }
      countryOut['2s10s']  = histories['10Y'] && histories['2Y']  ? computeSpreadMetric(histories['10Y'], histories['2Y'])  : null
      countryOut['10s30s'] = histories['30Y'] && histories['10Y'] ? computeSpreadMetric(histories['30Y'], histories['10Y']) : null
      out[country] = countryOut
    }

    res.json({ asOfDate, previousDate, countries: out })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected global yield changes error'
    console.error('[global] Yield changes error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/global/daily-change-history ─────────────────────────────────────
// Per-cell drilldown for the yield-changes matrix. Returns daily basis-point
// changes over the requested lookback, plus a 200-day rolling sigma (same
// window the matrix uses for its z-scores) for reference-line rendering.

const LOOKBACK_TRADING_DAYS: Record<string, number> = {
  '6m': 126,
  '1y': 252,
  '2y': 504,
  '5y': 1260,
}

const DETAIL_HISTORY_LIMIT = 1600 // covers 5y lookback + 200d sigma buffer

function getFredYieldHistoryFull(seriesId: string, limit: number): YieldSeries[] {
  const rows = db.prepare(`
    SELECT date, value FROM series_observations
    WHERE series_id = ? AND value IS NOT NULL
    ORDER BY date DESC
    LIMIT ?
  `).all(seriesId, limit) as { date: string; value: number }[]
  return rows.reverse().map(r => ({ date: r.date, value: r.value }))
}

function getTvYieldHistoryFull(symbol: string, limit: number): YieldSeries[] {
  const rows = db.prepare(`
    SELECT time, close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT ?
  `).all(symbol, limit) as { time: string; close: number }[]
  return rows.reverse().map(r => ({ date: tsToDate(parseInt(r.time, 10)), value: r.close }))
}

interface DailyChange { date: string; change_bps: number }

function buildYieldChanges(history: YieldSeries[]): DailyChange[] {
  const out: DailyChange[] = []
  for (let i = 1; i < history.length; i++) {
    out.push({ date: history[i].date, change_bps: (history[i].value - history[i - 1].value) * 100 })
  }
  return out
}

function buildSpreadChanges(longLeg: YieldSeries[], shortLeg: YieldSeries[]): DailyChange[] {
  const shortByDate = new Map(shortLeg.map(p => [p.date, p.value]))
  const spread: YieldSeries[] = []
  for (const p of longLeg) {
    const s = shortByDate.get(p.date)
    if (s != null) spread.push({ date: p.date, value: (p.value - s) * 100 }) // bps
  }
  const out: DailyChange[] = []
  for (let i = 1; i < spread.length; i++) {
    out.push({ date: spread[i].date, change_bps: spread[i].value - spread[i - 1].value })
  }
  return out
}

function loadHistory(src: SourceDescriptor, limit: number): YieldSeries[] {
  return src.kind === 'fred' ? getFredYieldHistoryFull(src.id, limit) : getTvYieldHistoryFull(src.id, limit)
}

globalRouter.get('/daily-change-history', (req: Request, res: Response) => {
  try {
    const country = String(req.query.country ?? '')
    const tenor = String(req.query.tenor ?? '')
    const lookback = String(req.query.lookback ?? '1y').toLowerCase()

    const sources = YIELD_SOURCES[country]
    if (!sources) {
      res.status(400).json({ error: `Unknown country '${country}'` })
      return
    }
    const lookbackDays = LOOKBACK_TRADING_DAYS[lookback]
    if (!lookbackDays) {
      res.status(400).json({ error: `Unknown lookback '${lookback}'` })
      return
    }

    let changes: DailyChange[]
    if (tenor === '2s10s' || tenor === '10s30s') {
      const [shortKey, longKey] = tenor === '2s10s' ? ['2Y', '10Y'] : ['10Y', '30Y']
      const shortSrc = sources[shortKey as '2Y' | '5Y' | '10Y' | '30Y']
      const longSrc = sources[longKey as '2Y' | '5Y' | '10Y' | '30Y']
      if (!shortSrc || !longSrc) {
        res.status(400).json({ error: `No source for ${country} ${tenor}` })
        return
      }
      const shortHist = loadHistory(shortSrc, DETAIL_HISTORY_LIMIT)
      const longHist = loadHistory(longSrc, DETAIL_HISTORY_LIMIT)
      if (shortHist.length < 2 || longHist.length < 2) {
        res.status(404).json({ error: 'Insufficient history' })
        return
      }
      changes = buildSpreadChanges(longHist, shortHist)
    } else if (tenor === '2Y' || tenor === '5Y' || tenor === '10Y' || tenor === '30Y') {
      const src = sources[tenor]
      if (!src) {
        res.status(400).json({ error: `No source for ${country} ${tenor}` })
        return
      }
      const hist = loadHistory(src, DETAIL_HISTORY_LIMIT)
      if (hist.length < 2) {
        res.status(404).json({ error: 'Insufficient history' })
        return
      }
      changes = buildYieldChanges(hist)
    } else {
      res.status(400).json({ error: `Unknown tenor '${tenor}'` })
      return
    }

    if (changes.length === 0) {
      res.status(404).json({ error: 'No daily changes available' })
      return
    }

    // 200d sigma anchored to the most recent date — same convention as the matrix.
    const sigma200dRaw = rollingStdDev(changes.map(c => c.change_bps), ROLLING_WINDOW)
    const sigma200d = sigma200dRaw && sigma200dRaw > 0 ? sigma200dRaw : null

    // Visible window: last N trading days.
    const visible = changes.slice(-lookbackDays)

    const latest = changes[changes.length - 1]
    const latestSigma = sigma200d ? latest.change_bps / sigma200d : null

    const visibleVals = visible.map(c => c.change_bps)
    const meanBps = visibleVals.reduce((s, v) => s + v, 0) / visibleVals.length
    let stdevBps: number | null = null
    if (visibleVals.length >= 2) {
      const sse = visibleVals.reduce((s, v) => s + (v - meanBps) * (v - meanBps), 0)
      stdevBps = Math.sqrt(sse / (visibleVals.length - 1))
    }

    res.json({
      country,
      tenor,
      lookback,
      asOfDate: latest.date,
      sigma200d,
      series: visible,
      stats: {
        latest_bps: latest.change_bps,
        latest_sigma: latestSigma,
        mean_bps: meanBps,
        stdev_bps: stdevBps,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected daily-change-history error'
    console.error('[global] Daily change history error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/global/rates-summary ────────────────────────────────────────────
// Per-country at-a-glance: yield Δ at 2Y/5Y/10Y/30Y, 2s10s + 10s30s curve
// regime, next CB move, terminal − OCR, front − 12m. Two configurable lookbacks
// drive the yield deltas and the regime classification respectively.

type CurveRegime =
  | 'Bull Steepener' | 'Bear Steepener' | 'Steepener Twist'
  | 'Bull Flattener' | 'Bear Flattener' | 'Flattener Twist'
  | 'Neutral'

// Mirrors client/src/lib/curveRegime.ts; inlined to keep server independent.
function classifyRegime(shortChange: number, longChange: number, spreadChange: number): CurveRegime {
  if (spreadChange > 0) {
    if (shortChange < 0 && longChange < 0) return 'Bull Steepener'
    if (shortChange > 0 && longChange > 0) return 'Bear Steepener'
    return 'Steepener Twist'
  }
  if (spreadChange < 0) {
    if (shortChange < 0 && longChange < 0) return 'Bull Flattener'
    if (shortChange > 0 && longChange > 0) return 'Bear Flattener'
    return 'Flattener Twist'
  }
  return 'Neutral'
}

interface SummaryCountry {
  country: 'US' | 'UK' | 'EU' | 'CA' | 'JP' | 'AU'
  yieldPrefix: string   // tv_series prefix for the country's sovereign curve
  stirMarketKey: string // STIR market key for the country
}

const SUMMARY_COUNTRIES: SummaryCountry[] = [
  { country: 'US', yieldPrefix: 'US', stirMarketKey: 'SR3' },
  { country: 'UK', yieldPrefix: 'GB', stirMarketKey: 'SO3' },
  { country: 'EU', yieldPrefix: 'DE', stirMarketKey: 'EUR' },  // Bunds = EU benchmark
  { country: 'CA', yieldPrefix: 'CA', stirMarketKey: 'CRA' },
  { country: 'JP', yieldPrefix: 'JP', stirMarketKey: 'TOA3' },
  { country: 'AU', yieldPrefix: 'AU', stirMarketKey: 'AUS' },
]

const YIELD_LOOKBACK_DAYS: Record<string, number> = {
  '1d': 1, '5d': 5, '1m': 21, '3m': 63, '6m': 126,
  // 'ytd' is special-cased in resolveYieldLookback
}

const REGIME_LOOKBACK_DAYS: Record<string, number> = {
  '20d': 20, '60d': 60, '200d': 200,
}

// Returns the close on-or-before the given calendar date for a tv_series symbol.
// Used for YTD-style lookups (date-based rather than N-back).
function getTvYieldOnOrBefore(symbol: string, isoDate: string): { value: number; date: string } | null {
  const cutoffTs = Math.floor(new Date(`${isoDate}T23:59:59Z`).getTime() / 1000)
  const row = db.prepare(`
    SELECT time, close FROM tv_series
    WHERE symbol = ? AND close IS NOT NULL AND CAST(time AS INTEGER) <= ?
    ORDER BY CAST(time AS INTEGER) DESC
    LIMIT 1
  `).get(symbol, cutoffTs) as { time: string; close: number } | undefined
  if (!row) return null
  return { value: row.close, date: tsToDate(parseInt(row.time, 10)) }
}

function getYieldPair(
  symbol: string,
  yieldLookback: string,
): { current: { value: number; date: string }; lookback: { value: number; date: string } } | null {
  const current = getTvYieldAtLookback(symbol, 0)
  if (!current) return null

  if (yieldLookback === 'ytd') {
    const year = parseInt(current.date.slice(0, 4), 10)
    // The Atlanta-Fed-style "first trading day of year" — use the most recent
    // close at or before Jan 1, then the next sync trading day. Simpler:
    // treat the lookback as the close ON or before the first business day
    // of the current year.
    const ytdAnchor = `${year - 1}-12-31`
    const lookback = getTvYieldOnOrBefore(symbol, ytdAnchor)
    if (!lookback) return null
    return { current, lookback }
  }

  const days = YIELD_LOOKBACK_DAYS[yieldLookback] ?? 1
  const lookback = getTvYieldAtLookback(symbol, days)
  if (!lookback) return null
  return { current, lookback }
}

function getLatestSeriesValue(seriesId: string): number | null {
  const row = db.prepare(`
    SELECT value FROM series_observations
    WHERE series_id = ? AND value IS NOT NULL
    ORDER BY date DESC
    LIMIT 1
  `).get(seriesId) as { value: number } | undefined
  return row?.value ?? null
}

function getAnchorRate(stirMarketKey: string): number | null {
  const market = getMarket(stirMarketKey)
  if (!market) return null
  if (market.anchorSource.type === 'static') return market.anchorSource.value
  // FRED-anchored markets: US Fed Funds (FF) anchors on DFF; US SOFR (SR3) —
  // the market this summary actually uses for US — anchors on SOFR. Both are
  // just the latest observation of the registry's seriesId. Previously only
  // DFF was handled, so SR3 fell through to null and the US Terminal−OCR cell
  // rendered a dash while every other (static-anchored) country populated.
  return getLatestSeriesValue(market.anchorSource.seriesId)
}

interface TerminalContractPick { impliedRate: number | null }

function findTerminalContract(contracts: TerminalContractPick[]): TerminalContractPick | null {
  if (contracts.length === 0) return null
  if (contracts.length < 3) return contracts[contracts.length - 1]

  const rate = (i: number) => contracts[i].impliedRate
  const r0 = rate(0), r1 = rate(1)
  if (r0 == null || r1 == null) return contracts[contracts.length - 1]

  let baseDirection = Math.sign(r1 - r0)
  let baseIdx = 0

  if (baseDirection === 0) {
    for (let i = 2; i < contracts.length; i++) {
      const a = rate(i), b = rate(i - 1)
      if (a == null || b == null) continue
      const dir = Math.sign(a - b)
      if (dir !== 0) { baseDirection = dir; baseIdx = i - 1; break }
    }
    if (baseDirection === 0) return contracts[contracts.length - 1]
  }

  for (let i = baseIdx + 1; i < contracts.length; i++) {
    const a = rate(i), b = rate(i - 1)
    if (a == null || b == null) continue
    const dir = Math.sign(a - b)
    if (dir !== 0 && dir !== baseDirection) return contracts[i - 1]
  }
  return contracts[contracts.length - 1]
}

interface SummaryRow {
  country: string
  delta2Y: number | null
  delta5Y: number | null
  delta10Y: number | null
  delta30Y: number | null
  regime2s10s: CurveRegime | null
  regime10s30s: CurveRegime | null
  nextMove: 'HIKE' | 'CUT' | 'UNCH' | null
  terminalMinusOcr: number | null
  frontMinus12m: number | null
}

globalRouter.get('/rates-summary', (req: Request, res: Response) => {
  try {
    const yieldLookback = String(req.query.yieldLookback ?? '1d').toLowerCase()
    const regimeLookback = String(req.query.regimeLookback ?? '20d').toLowerCase()
    const regimeDays = REGIME_LOOKBACK_DAYS[regimeLookback] ?? 20

    let asOfDate = ''
    let yieldLookbackDate = ''
    let regimeLookbackDate = ''

    const rows: SummaryRow[] = SUMMARY_COUNTRIES.map(({ country, yieldPrefix, stirMarketKey }) => {
      // ── Yield deltas ──────────────────────────────────────────────────
      const tenorPair = (tenorSuffix: '02Y' | '05Y' | '10Y' | '30Y'): number | null => {
        const pair = getYieldPair(`${yieldPrefix}${tenorSuffix}`, yieldLookback)
        if (!pair) return null
        if (pair.current.date > asOfDate) asOfDate = pair.current.date
        if (pair.lookback.date > yieldLookbackDate) yieldLookbackDate = pair.lookback.date
        return +((pair.current.value - pair.lookback.value) * 100).toFixed(2)
      }
      const delta2Y  = tenorPair('02Y')
      const delta5Y  = tenorPair('05Y')
      const delta10Y = tenorPair('10Y')
      const delta30Y = tenorPair('30Y')

      // ── Curve regimes (own lookback window, independent of yield delta) ─
      const regimePair = (
        shortSuffix: '02Y' | '10Y',
        longSuffix: '10Y' | '30Y',
      ): CurveRegime | null => {
        const shortNow = getTvYieldAtLookback(`${yieldPrefix}${shortSuffix}`, 0)
        const longNow  = getTvYieldAtLookback(`${yieldPrefix}${longSuffix}`,  0)
        const shortPrev = getTvYieldAtLookback(`${yieldPrefix}${shortSuffix}`, regimeDays)
        const longPrev  = getTvYieldAtLookback(`${yieldPrefix}${longSuffix}`,  regimeDays)
        if (!shortNow || !longNow || !shortPrev || !longPrev) return null
        if (shortPrev.date > regimeLookbackDate) regimeLookbackDate = shortPrev.date
        const shortChange = shortNow.value - shortPrev.value
        const longChange  = longNow.value  - longPrev.value
        const spreadChange = (longNow.value - shortNow.value) - (longPrev.value - shortPrev.value)
        return classifyRegime(shortChange, longChange, spreadChange)
      }
      const regime2s10s  = regimePair('02Y', '10Y')
      const regime10s30s = regimePair('10Y', '30Y')

      // ── STIR-derived columns ──────────────────────────────────────────
      const curve = getTvCurve(stirMarketKey, 1)
      const contracts = curve.currentCurve

      // Next move: front two contracts. Front rate > next rate → cuts priced
      // between now and the next CB meeting; front < next → hikes priced.
      let nextMove: 'HIKE' | 'CUT' | 'UNCH' | null = null
      if (contracts.length >= 2 && contracts[0].impliedRate != null && contracts[1].impliedRate != null) {
        const diffBps = (contracts[0].impliedRate - contracts[1].impliedRate) * 100
        if (diffBps > 0) nextMove = 'CUT'
        else if (diffBps < 0) nextMove = 'HIKE'
        else nextMove = 'UNCH'
      }

      // Terminal − OCR: terminal contract's implied rate minus the country's
      // anchor rate. anchorSource is in registry; DFF is fetched live for US.
      const terminal = findTerminalContract(contracts)
      const anchor = getAnchorRate(stirMarketKey)
      const terminalMinusOcr = (terminal?.impliedRate != null && anchor != null)
        ? +((terminal.impliedRate - anchor) * 100).toFixed(2)
        : null

      // Front − 12m: rate priced 12m forward minus the front rate. Positive
      // means the curve is rising forward (hikes priced over the next year),
      // negative means cuts priced. Same sign convention as the yield-Δ and
      // Terminal−OCR columns: positive = bearish for fixed income.
      let frontMinus12m: number | null = null
      if (contracts.length >= 5 && contracts[0].impliedRate != null && contracts[4].impliedRate != null) {
        frontMinus12m = +((contracts[4].impliedRate - contracts[0].impliedRate) * 100).toFixed(2)
      }

      return {
        country,
        delta2Y, delta5Y, delta10Y, delta30Y,
        regime2s10s, regime10s30s,
        nextMove,
        terminalMinusOcr,
        frontMinus12m,
      }
    })

    res.json({
      asOfDate,
      yieldLookbackDate,
      regimeLookbackDate,
      yieldLookback,
      regimeLookback,
      rows,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected rates-summary error'
    console.error('[global] Rates summary error:', msg)
    res.status(500).json({ error: msg })
  }
})
