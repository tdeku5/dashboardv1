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

    const buildTenors = (lookback: number): { rows: Record<string, unknown>[]; asOfDate: string } => {
      const rows: Record<string, unknown>[] = []
      let asOfDate = ''

      for (const spec of TENOR_SPECS) {
        const row: Record<string, unknown> = { tenor: spec.tenor, years: spec.years }
        let hasAny = false

        for (const ck of COUNTRY_KEYS) {
          const symbol = spec[ck as keyof TenorSpec] as string | undefined
          if (!symbol) continue
          const point = getTvYieldAtLookback(symbol, lookback)
          if (point) {
            row[RESPONSE_KEYS[ck]] = point.value
            hasAny = true
            if (!asOfDate || point.date > asOfDate) asOfDate = point.date
          }
        }

        if (hasAny) rows.push(row)
      }

      return { rows, asOfDate }
    }

    const current = buildTenors(0)
    const lookback = lookbackDays > 0 ? buildTenors(lookbackDays) : { rows: [], asOfDate: '' }

    res.json({
      asOfDate: current.asOfDate,
      lookbackDate: lookback.asOfDate,
      tenors: current.rows,            // back-compat field
      currentTenors: current.rows,
      lookbackTenors: lookback.rows,
    })
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

    const curves = FORWARD_MARKETS.map(fm => {
      const c = getTvCurve(fm.marketKey, Math.max(1, lookbackDays))
      return {
        responseKey: fm.responseKey,
        marketKey: fm.marketKey,
        currentContracts: c.currentCurve,
        lookbackContracts: c.lookbackCurve,
        currentDate: c.currentDate,
        lookbackDate: c.lookbackDate,
      }
    })

    const asOfDate = curves.find(c => c.currentDate)?.currentDate ?? ''
    const lookbackDate = lookbackDays > 0 ? (curves.find(c => c.lookbackDate)?.lookbackDate ?? '') : ''

    const sr3 = curves.find(c => c.marketKey === 'SR3')
    if (!sr3 || sr3.currentContracts.length === 0) {
      res.json({ asOfDate, lookbackDate, contracts: [], currentContracts: [], lookbackContracts: [] })
      return
    }
    const front = sr3.currentContracts[0]
    const axis = buildContractAxis(front.monthCode, front.year, 2030)

    type Contract = (typeof sr3.currentContracts)[number]
    const findByCode = (contracts: Contract[], code: string): Contract | undefined => {
      const monthCode = code[0]
      const yearDigit = parseInt(code.slice(1), 10)
      return contracts.find(c => c.monthCode === monthCode && c.year % 10 === yearDigit)
    }

    const buildRows = (which: 'currentContracts' | 'lookbackContracts') =>
      axis.map(code => {
        const row: Record<string, string | number | null> = { code }
        for (const c of curves) {
          const ct = findByCode(c[which], code)
          row[c.responseKey] = ct?.impliedRate != null ? ct.impliedRate : null
        }
        return row
      })

    const contracts = buildRows('currentContracts')
    const lookbackContracts = lookbackDays > 0 ? buildRows('lookbackContracts') : []

    res.json({
      asOfDate,
      lookbackDate,
      contracts,                  // back-compat
      currentContracts: contracts,
      lookbackContracts,
    })
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
      return {
        marketKey: fm.marketKey,
        currentContracts: c.currentCurve,
        lookbackContracts: c.lookbackCurve,
        currentDate: c.currentDate,
        lookbackDate: c.lookbackDate,
      }
    })

    const countries = FORWARD_MARKETS.map(fm => {
      const m = getMarket(fm.marketKey)
      return {
        marketKey: fm.marketKey,
        displayName: m?.displayName ?? fm.marketKey,
        shortName: m?.shortName ?? fm.marketKey,
      }
    })

    const asOfDate = curves.find(c => c.currentDate)?.currentDate ?? ''
    const lookbackDate = lookbackDays > 0 ? (curves.find(c => c.lookbackDate)?.lookbackDate ?? '') : ''

    const shortLabel = (c: { monthCode: string; year: number }) => `${c.monthCode}${c.year % 10}`

    type Contract = (typeof curves)[number]['currentContracts'][number]
    const buildStrides = (which: 'currentContracts' | 'lookbackContracts') => {
      const out: Record<number, Array<Record<string, string | number>>> = {}
      for (const stride of SPREAD_STRIDES) {
        const maxRows = Math.max(0, ...curves.map(c => c[which].length - stride))
        const rows: Array<Record<string, string | number>> = []
        for (let i = 0; i < maxRows; i++) {
          const row: Record<string, string | number> = { position: i + 1, label: '' }
          const sr3 = curves.find(c => c.marketKey === 'SR3')
          if (sr3 && sr3[which].length > i + stride) {
            row.label = `${shortLabel(sr3[which][i])}/${shortLabel(sr3[which][i + stride])}`
          } else {
            const fallback = curves.find(c => c[which].length > i + stride)
            if (fallback) {
              row.label = `${shortLabel(fallback[which][i])}/${shortLabel(fallback[which][i + stride])}`
            }
          }
          for (const c of curves) {
            const arr: Contract[] = c[which]
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
        out[stride] = rows
      }
      return out
    }

    const strides = buildStrides('currentContracts')
    const lookbackStrides = lookbackDays > 0 ? buildStrides('lookbackContracts') : { 1: [], 2: [], 3: [], 4: [] }

    res.json({ asOfDate, lookbackDate, countries, strides, lookbackStrides })
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
  US:      { '2Y': { kind: 'fred', id: 'DGS2' }, '5Y': { kind: 'fred', id: 'DGS5' }, '10Y': { kind: 'fred', id: 'DGS10' }, '30Y': { kind: 'fred', id: 'DGS30' } },
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
