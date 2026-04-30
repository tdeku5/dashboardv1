import { Router, Request, Response } from 'express'
import { db, getObservations } from '../db'
import { getTvCurve } from '../tvFutures'

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
  { tenor: '1M', years: 1/12,  US: 'DGS1MO', GB: 'GB01MY', DE: 'DE01MY', FR: 'FR01MY', IT: 'IT01MY', CA: 'CA01MY' },
  { tenor: '3M', years: 0.25,  US: 'DGS3MO', GB: 'GB03MY', DE: 'DE03MY', FR: 'FR03MY', IT: 'IT03MY', CA: 'CA03MY', JP: 'JP03MY' },
  { tenor: '1Y', years: 1,     US: 'DGS1',   GB: 'GB01Y',  DE: 'DE01Y',  FR: 'FR01Y',  IT: 'IT01Y',  CA: 'CA01Y',  JP: 'JP01Y', AU: 'AU01Y' },
  { tenor: '2Y', years: 2,     US: 'DGS2',   GB: 'GB02Y',  DE: 'DE02Y',  FR: 'FR02Y',  IT: 'IT02Y',  CA: 'CA02Y',  JP: 'JP02Y', AU: 'AU02Y' },
  { tenor: '3Y', years: 3,                    GB: 'GB03Y',  DE: 'DE03Y',  FR: 'FR03Y',  IT: 'IT03Y',  CA: 'CA03Y',  JP: 'JP03Y', AU: 'AU03Y' },
  { tenor: '5Y', years: 5,     US: 'DGS5',   GB: 'GB05Y',  DE: 'DE05Y',  FR: 'FR05Y',  IT: 'IT05Y',  CA: 'CA05Y',  JP: 'JP05Y', AU: 'AU05Y' },
  { tenor: '7Y', years: 7,     US: 'DGS7',   GB: 'GB07Y',  DE: 'DE07Y',  FR: 'FR07Y',  IT: 'IT07Y',  CA: 'CA07Y',  JP: 'JP07Y', AU: 'AU07Y' },
  { tenor: '10Y', years: 10,   US: 'DGS10',  GB: 'GB10Y',  DE: 'DE10Y',  FR: 'FR10Y',  IT: 'IT10Y',  CA: 'CA10Y',  JP: 'JP10Y', AU: 'AU10Y' },
  { tenor: '20Y', years: 20,   US: 'DGS20',  GB: 'GB20Y',  DE: 'DE20Y',  FR: 'FR20Y',  IT: 'IT20Y',  CA: 'CA20Y',  JP: 'JP20Y', AU: 'AU20Y' },
  { tenor: '30Y', years: 30,   US: 'DGS30',  GB: 'GB30Y',  DE: 'DE30Y',  FR: 'FR30Y',  IT: 'IT30Y',  CA: 'CA30Y',  JP: 'JP30Y', AU: 'AU30Y' },
  { tenor: '40Y', years: 40,                                                                             JP: 'JP40Y' },
]

const COUNTRY_KEYS = ['US', 'GB', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
type CountryKey = typeof COUNTRY_KEYS[number]
// Map from server-side country keys to the response field names
const RESPONSE_KEYS: Record<CountryKey, string> = {
  US: 'US', GB: 'UK', DE: 'DE', FR: 'FR', IT: 'IT', CA: 'CA', JP: 'JP', AU: 'AU',
}

// ── GET /api/global/yield-curves ─────────────────────────────────────────────

globalRouter.get('/yield-curves', (_req: Request, res: Response) => {
  try {
    let asOfDate = ''

    const tenors: Record<string, unknown>[] = []

    for (const spec of TENOR_SPECS) {
      const row: Record<string, unknown> = { tenor: spec.tenor, years: spec.years }
      let hasAny = false

      for (const ck of COUNTRY_KEYS) {
        const symbol = spec[ck as keyof TenorSpec] as string | undefined
        if (!symbol) continue

        let value: number | null = null

        if (ck === 'US') {
          // FRED data
          const obs = getObservations(symbol)
          if (obs.length > 0) {
            value = obs[obs.length - 1].value
            if (!asOfDate && obs[obs.length - 1].date) {
              asOfDate = obs[obs.length - 1].date
            }
          }
        } else {
          value = getLatestTvYield(symbol)
        }

        if (value != null) {
          row[RESPONSE_KEYS[ck]] = value
          hasAny = true
        }
      }

      if (hasAny) tenors.push(row)
    }

    // Get as-of date from TV data if FRED didn't provide one
    if (!asOfDate) {
      const tvRow = db.prepare(`
        SELECT MAX(CAST(time AS INTEGER)) AS latest FROM tv_series WHERE symbol LIKE 'GB%'
      `).get() as { latest: number | null } | undefined
      if (tvRow?.latest) asOfDate = tsToDate(tvRow.latest)
    }

    res.json({ asOfDate, tenors })
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

globalRouter.get('/forward-curves', (_req: Request, res: Response) => {
  try {
    // Collect all contracts by expiry date
    const byExpiry = new Map<string, Record<string, number>>()
    let asOfDate = ''

    for (const fm of FORWARD_MARKETS) {
      const curve = getTvCurve(fm.marketKey, 1)
      if (!asOfDate && curve.currentDate) asOfDate = curve.currentDate

      for (const contract of curve.currentCurve) {
        if (contract.impliedRate == null) continue
        const expiry = contract.expiryDate
        if (!byExpiry.has(expiry)) byExpiry.set(expiry, {})
        byExpiry.get(expiry)![fm.responseKey] = contract.impliedRate
      }
    }

    // Sort by expiry date and limit to ~2 years out. Lower-bound expiry filtering
    // happens upstream in getTvCurve() (see getContractExpiryCutoff), so the per-country
    // and global views show the same contracts.
    const today = asOfDate || new Date().toISOString().slice(0, 10)
    const twoYearsOut = new Date(new Date(today).getTime() + 2 * 365.25 * 86400000).toISOString().slice(0, 10)

    const contracts = Array.from(byExpiry.entries())
      .filter(([expiry]) => expiry <= twoYearsOut)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([expiry, values]) => {
        const d = new Date(expiry + 'T00:00:00Z')
        const display = `${MONTH_NAMES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`
        return { expiryDate: expiry, expiryDisplay: display, ...values }
      })

    res.json({ asOfDate, contracts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected global forward curve error'
    console.error('[global] Forward curves error:', msg)
    res.status(500).json({ error: msg })
  }
})
