import Database from 'better-sqlite3'
import path from 'path'
import { Router, Request, Response } from 'express'

const FUTURES_API_BASE = process.env.FUTURES_API_URL || 'http://localhost:3100/api'
const FUTURES_ROUTE_PREFIX = '/api/futures/'
const FUTURES_DB_PATH = process.env.FUTURES_DB_PATH
  || path.resolve(__dirname, '..', '..', '..', '..', 'schwab_api_test', 'futures-data.db')
const MONTH_CODE_ORDER_SQL = `
  CASE month_code
    WHEN 'F' THEN 1
    WHEN 'G' THEN 2
    WHEN 'H' THEN 3
    WHEN 'J' THEN 4
    WHEN 'K' THEN 5
    WHEN 'M' THEN 6
    WHEN 'N' THEN 7
    WHEN 'Q' THEN 8
    WHEN 'U' THEN 9
    WHEN 'V' THEN 10
    WHEN 'X' THEN 11
    WHEN 'Z' THEN 12
  END
`

const futuresRouter = Router()
let futuresDb: Database.Database | null = null

interface StripRow {
  symbol: string
  root_symbol: string
  month_code: string
  year: number
  expiry_label: string
  last_price: number | null
  volume: number | null
  open_interest: number | null
}

function getFuturesDb(): Database.Database {
  if (!futuresDb) {
    futuresDb = new Database(FUTURES_DB_PATH, { readonly: true, fileMustExist: true })
  }
  return futuresDb
}

function getNthPriorPullDate(db: Database.Database, rootSymbol: string, latestDate: string, offset: number): string | null {
  const row = db.prepare(`
    SELECT DISTINCT pull_date
    FROM futures_quotes
    WHERE root_symbol = ?
      AND pull_date < ?
    ORDER BY pull_date DESC
    LIMIT 1 OFFSET ?
  `).get(rootSymbol, latestDate, offset) as { pull_date: string } | undefined

  return row?.pull_date ?? null
}

function getContractsForDate(db: Database.Database, rootSymbol: string, pullDate: string): StripRow[] {
  return db.prepare(`
    SELECT
      symbol,
      root_symbol,
      month_code,
      year,
      expiry_label,
      last_price,
      volume,
      open_interest
    FROM futures_quotes
    WHERE root_symbol = ?
      AND pull_date = ?
      AND last_price IS NOT NULL
      AND last_price > 0
    ORDER BY year ASC, ${MONTH_CODE_ORDER_SQL}
  `).all(rootSymbol, pullDate) as StripRow[]
}

futuresRouter.get('/strip/:rootSymbol', (req: Request, res: Response) => {
  try {
    const db = getFuturesDb()
    const rootSymbol = String(req.params.rootSymbol || '').toUpperCase()

    if (!rootSymbol) {
      res.status(400).json({ error: 'Missing root symbol' })
      return
    }

    const latestRow = db.prepare(`
      SELECT MAX(pull_date) AS latest
      FROM futures_quotes
      WHERE root_symbol = ?
    `).get(rootSymbol) as { latest: string | null }

    if (!latestRow.latest) {
      res.status(404).json({ error: `No futures strip data found for root ${rootSymbol}` })
      return
    }

    const latestDate = latestRow.latest
    const currentContracts = getContractsForDate(db, rootSymbol, latestDate)
    const lookbackDates = {
      '1d': getNthPriorPullDate(db, rootSymbol, latestDate, 0),
      '5d': getNthPriorPullDate(db, rootSymbol, latestDate, 4),
      '1m': getNthPriorPullDate(db, rootSymbol, latestDate, 20),
    }

    const lookbackMaps = {
      '1d': new Map<string, StripRow>(),
      '5d': new Map<string, StripRow>(),
      '1m': new Map<string, StripRow>(),
    }

    for (const key of Object.keys(lookbackDates) as Array<keyof typeof lookbackDates>) {
      const lookbackDate = lookbackDates[key]
      if (!lookbackDate) continue
      for (const row of getContractsForDate(db, rootSymbol, lookbackDate)) {
        lookbackMaps[key].set(row.symbol, row)
      }
    }

    const contracts = currentContracts.map((row) => {
      const oneDay = lookbackMaps['1d'].get(row.symbol)
      const fiveDay = lookbackMaps['5d'].get(row.symbol)
      const oneMonth = lookbackMaps['1m'].get(row.symbol)
      const lastPrice = row.last_price ?? 0

      return {
        symbol: row.symbol,
        monthCode: row.month_code,
        year: row.year,
        expiryLabel: row.expiry_label,
        lastPrice,
        impliedRate: 100 - lastPrice,
        volume: row.volume ?? 0,
        openInterest: row.open_interest ?? 0,
        pxChg1d: oneDay?.last_price != null ? lastPrice - oneDay.last_price : null,
        pxChg5d: fiveDay?.last_price != null ? lastPrice - fiveDay.last_price : null,
        pxChg1m: oneMonth?.last_price != null ? lastPrice - oneMonth.last_price : null,
        oiChg: oneDay?.open_interest != null && row.open_interest != null ? row.open_interest - oneDay.open_interest : null,
      }
    })

    res.json({
      rootSymbol,
      latestDate,
      lookbackDates,
      contracts,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected futures strip error'
    console.error('[futures] Strip error:', msg)
    res.status(500).json({ error: msg })
  }
})

futuresRouter.get('/*', async (req: Request, res: Response) => {
  const originalUrl = req.originalUrl || ''
  const pathStart = originalUrl.indexOf(FUTURES_ROUTE_PREFIX)
  const rawSuffix = pathStart >= 0
    ? originalUrl.slice(pathStart + FUTURES_ROUTE_PREFIX.length)
    : ''

  if (!rawSuffix) {
    res.status(400).json({ error: 'Missing futures API path' })
    return
  }

  const targetUrl = `${FUTURES_API_BASE}/${rawSuffix}`

  try {
    const upstream = await fetch(targetUrl)
    const body = await upstream.text()
    const contentType = upstream.headers.get('content-type')

    if (contentType) {
      res.setHeader('content-type', contentType)
    }

    res.status(upstream.status).send(body)
  } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? (err as Error & { cause?: NodeJS.ErrnoException }).cause : undefined
    if (cause?.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'Futures data service unavailable. Ensure the schwab collector is running on port 3100.',
      })
      return
    }

    const msg = err instanceof Error ? err.message : 'Unexpected futures proxy error'
    console.error('[futures] Proxy error:', msg)
    res.status(500).json({ error: msg })
  }
})

export default futuresRouter
