import { Router, Request, Response } from 'express'
import { db, storeObservations, getObservations, isSeriesStale } from '../db'

export const beaRouter = Router()

const STALE_HOURS = 12
const BEA_TABLE   = 'U20304'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBeaApiKey(): string {
  const key = process.env.BEA_API_KEY
  if (!key || key === 'YOUR_BEA_API_KEY_HERE') {
    throw new Error('BEA_API_KEY is not set — add it to your .env file')
  }
  return key
}

/** Convert BEA "YYYYMmm" → "YYYY-MM-01" */
function beaDateToIso(timePeriod: string): string | null {
  const match = timePeriod.match(/^(\d{4})M(\d{1,2})$/)
  if (!match) return null
  const [, year, month] = match
  return `${year}-${month.padStart(2, '0')}-01`
}

/** Strip commas from BEA DataValue */
function cleanValue(raw: string): string {
  return raw.replace(/,/g, '')
}

// ── BEA series ID convention ────────────────────────────────────────────────
// We store BEA observations under synthetic series IDs: "BEA_U20304_L{lineNumber}"

function beaSeriesId(lineNumber: number): string {
  return `BEA_${BEA_TABLE}_L${lineNumber}`
}

// ── Fetch lock (prevent concurrent fetches) ─────────────────────────────────

let fetchLock: Promise<void> | null = null

interface BeaDataRow {
  TableName:       string
  SeriesCode:      string
  LineNumber:      string
  LineDescription: string
  TimePeriod:      string
  CL_UNIT:         string
  UNIT_MULT:       string
  DataValue:       string
  NoteRef:         string
}

async function fetchAndCacheBEATable(): Promise<void> {
  // If another request is already fetching, piggyback
  if (fetchLock) { await fetchLock; return }

  const apiKey = getBeaApiKey()

  const promise = (async () => {
    const url = new URL('https://apps.bea.gov/api/data/')
    url.searchParams.set('UserID', apiKey)
    url.searchParams.set('method', 'GetData')
    url.searchParams.set('DataSetName', 'NIUnderlyingDetail')
    url.searchParams.set('TableName', BEA_TABLE)
    url.searchParams.set('Frequency', 'M')
    url.searchParams.set('Year', 'ALL')
    url.searchParams.set('ResultFormat', 'JSON')

    console.log(`[BEA] Fetching table ${BEA_TABLE}...`)
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120_000), // 2 min timeout for large response
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`BEA API returned HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      BEAAPI?: {
        Results?: {
          Error?: { ErrorDetail?: { Description?: string } }
          Data?: BeaDataRow[]
        }
      }
    }

    // Check for API-level errors
    const apiError = json.BEAAPI?.Results?.Error?.ErrorDetail?.Description
    if (apiError) {
      throw new Error(`BEA API error: ${apiError}`)
    }

    const data = json.BEAAPI?.Results?.Data
    if (!data || !Array.isArray(data)) {
      throw new Error('BEA API returned no data array')
    }

    console.log(`[BEA] Received ${data.length} rows, ingesting...`)

    // Group by line number
    const byLine = new Map<number, { date: string; value: string }[]>()

    for (const row of data) {
      const lineNum = parseInt(row.LineNumber)
      if (isNaN(lineNum)) continue

      const date = beaDateToIso(row.TimePeriod)
      if (!date) continue

      const rawVal = cleanValue(row.DataValue)
      if (!rawVal || rawVal === 'N/A' || rawVal === '...' || rawVal.trim() === '') continue

      const numVal = parseFloat(rawVal)
      if (isNaN(numVal)) continue

      if (!byLine.has(lineNum)) byLine.set(lineNum, [])
      byLine.get(lineNum)!.push({ date, value: rawVal })
    }

    // Store each line as a separate "series" in our existing observations table
    for (const [lineNum, observations] of byLine) {
      const sid = beaSeriesId(lineNum)
      // Find the line description for metadata
      const desc = data.find(r => parseInt(r.LineNumber) === lineNum)?.LineDescription ?? ''
      storeObservations(sid, observations, {
        title:     `PCE ${desc}`,
        frequency: 'Monthly',
        units:     'Index, 2017=100',
      })
    }

    console.log(`[BEA] Ingested ${byLine.size} line items.`)
  })()

  fetchLock = promise
  try {
    await promise
  } finally {
    fetchLock = null
  }
}

// ── Ensure data is fresh ────────────────────────────────────────────────────

async function ensureFresh(lineNumber: number): Promise<void> {
  const sid = beaSeriesId(lineNumber)
  if (!isSeriesStale(sid, STALE_HOURS)) return
  // BEA returns ALL lines in one call, so fetching once refreshes everything
  await fetchAndCacheBEATable()
}

// ── GET /api/bea/pce?line_number=N ──────────────────────────────────────────

beaRouter.get('/pce', async (req: Request, res: Response) => {
  const { line_number } = req.query

  if (!line_number || isNaN(Number(line_number))) {
    res.status(400).json({ error: 'line_number query parameter is required (integer)' })
    return
  }

  const lineNum = parseInt(String(line_number))

  try {
    await ensureFresh(lineNum)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BEA API fetch failed'
    const status = msg.includes('BEA_API_KEY') ? 500 : 502
    res.status(status).json({ error: msg })
    return
  }

  const sid = beaSeriesId(lineNum)
  const rows = getObservations(sid)

  res.json({
    observations: rows.map(r => ({ date: r.date, value: String(r.value) })),
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ██  NIPA Table 1.5.2 — GDP Contribution (quarterly)
// ══════════════════════════════════════════════════════════════════════════════

const GDP_CONTRIB_TABLE = 'T10502'

function gdpContribSeriesId(lineNumber: number): string {
  return `BEA_${GDP_CONTRIB_TABLE}_L${lineNumber}`
}

/** Convert BEA "YYYYQn" -> "YYYY-MM-01" (first month of the quarter) */
function beaQuarterToIso(timePeriod: string): string | null {
  const match = timePeriod.match(/^(\d{4})Q([1-4])$/)
  if (!match) return null
  const [, year, q] = match
  const month = ['01', '04', '07', '10'][parseInt(q) - 1]
  return `${year}-${month}-01`
}

let gdpContribFetchLock: Promise<void> | null = null

async function fetchAndCacheNIPATable(): Promise<void> {
  if (gdpContribFetchLock) { await gdpContribFetchLock; return }

  const apiKey = getBeaApiKey()

  const promise = (async () => {
    const url = new URL('https://apps.bea.gov/api/data/')
    url.searchParams.set('UserID', apiKey)
    url.searchParams.set('method', 'GetData')
    url.searchParams.set('DataSetName', 'NIPA')
    url.searchParams.set('TableName', GDP_CONTRIB_TABLE)
    url.searchParams.set('Frequency', 'Q')
    url.searchParams.set('Year', 'ALL')
    url.searchParams.set('ResultFormat', 'JSON')

    console.log(`[BEA] Fetching NIPA table ${GDP_CONTRIB_TABLE}...`)
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`BEA API returned HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      BEAAPI?: {
        Results?: {
          Error?: { ErrorDetail?: { Description?: string } }
          Data?: BeaDataRow[]
        }
      }
    }

    const apiError = json.BEAAPI?.Results?.Error?.ErrorDetail?.Description
    if (apiError) {
      throw new Error(`BEA API error: ${apiError}`)
    }

    const data = json.BEAAPI?.Results?.Data
    if (!data || !Array.isArray(data)) {
      throw new Error('BEA API returned no data array')
    }

    console.log(`[BEA] Received ${data.length} rows for ${GDP_CONTRIB_TABLE}, ingesting...`)

    const byLine = new Map<number, { date: string; value: string }[]>()

    for (const row of data) {
      const lineNum = parseInt(row.LineNumber)
      if (isNaN(lineNum)) continue

      const date = beaQuarterToIso(row.TimePeriod)
      if (!date) continue

      const rawVal = cleanValue(row.DataValue)
      if (!rawVal || rawVal === 'N/A' || rawVal === '...' || rawVal.trim() === '') continue

      const numVal = parseFloat(rawVal)
      if (isNaN(numVal)) continue

      if (!byLine.has(lineNum)) byLine.set(lineNum, [])
      byLine.get(lineNum)!.push({ date, value: rawVal })
    }

    for (const [lineNum, observations] of byLine) {
      const sid = gdpContribSeriesId(lineNum)
      const desc = data.find(r => parseInt(r.LineNumber) === lineNum)?.LineDescription ?? ''
      storeObservations(sid, observations, {
        title:     `rGDP Contrib ${desc}`,
        frequency: 'Quarterly',
        units:     '%-pt contribution',
      })
    }

    console.log(`[BEA] Ingested ${byLine.size} line items for ${GDP_CONTRIB_TABLE}.`)
  })()

  gdpContribFetchLock = promise
  try {
    await promise
  } finally {
    gdpContribFetchLock = null
  }
}

async function ensureFreshGdp(lineNumber: number): Promise<void> {
  const sid = gdpContribSeriesId(lineNumber)
  if (!isSeriesStale(sid, STALE_HOURS)) return
  await fetchAndCacheNIPATable()
}

// ── GET /api/bea/gdp-contrib?line_number=N ──────────────────────────────────

beaRouter.get('/gdp-contrib', async (req: Request, res: Response) => {
  const { line_number } = req.query

  if (!line_number || isNaN(Number(line_number))) {
    res.status(400).json({ error: 'line_number query parameter is required (integer)' })
    return
  }

  const lineNum = parseInt(String(line_number))

  try {
    await ensureFreshGdp(lineNum)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BEA API fetch failed'
    const status = msg.includes('BEA_API_KEY') ? 500 : 502
    res.status(status).json({ error: msg })
    return
  }

  const sid = gdpContribSeriesId(lineNum)
  const rows = getObservations(sid)

  res.json({
    observations: rows.map(r => ({ date: r.date, value: String(r.value) })),
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ██  NIPA Table T20805 — Nominal PCE (monthly, SAAR, millions $)
// ══════════════════════════════════════════════════════════════════════════════

const NPCE_TABLE = 'T20805'

function npceSeriesId(lineNumber: number): string {
  return `BEA_${NPCE_TABLE}_L${lineNumber}`
}

let npceFetchLock: Promise<void> | null = null

async function fetchAndCacheNPCETable(): Promise<void> {
  if (npceFetchLock) { await npceFetchLock; return }

  const apiKey = getBeaApiKey()

  const promise = (async () => {
    const url = new URL('https://apps.bea.gov/api/data/')
    url.searchParams.set('UserID', apiKey)
    url.searchParams.set('method', 'GetData')
    url.searchParams.set('DataSetName', 'NIPA')
    url.searchParams.set('TableName', NPCE_TABLE)
    url.searchParams.set('Frequency', 'M')
    url.searchParams.set('Year', 'ALL')
    url.searchParams.set('ResultFormat', 'JSON')

    console.log(`[BEA] Fetching NIPA table ${NPCE_TABLE}...`)
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`BEA API returned HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      BEAAPI?: {
        Results?: {
          Error?: { ErrorDetail?: { Description?: string } }
          Data?: BeaDataRow[]
        }
      }
    }

    const apiError = json.BEAAPI?.Results?.Error?.ErrorDetail?.Description
    if (apiError) {
      throw new Error(`BEA API error: ${apiError}`)
    }

    const data = json.BEAAPI?.Results?.Data
    if (!data || !Array.isArray(data)) {
      throw new Error('BEA API returned no data array')
    }

    console.log(`[BEA] Received ${data.length} rows for ${NPCE_TABLE}, ingesting...`)

    const byLine = new Map<number, { date: string; value: string }[]>()

    for (const row of data) {
      const lineNum = parseInt(row.LineNumber)
      if (isNaN(lineNum)) continue

      const date = beaDateToIso(row.TimePeriod)
      if (!date) continue

      const rawVal = cleanValue(row.DataValue)
      if (!rawVal || rawVal === 'N/A' || rawVal === '...' || rawVal.trim() === '') continue

      const numVal = parseFloat(rawVal)
      if (isNaN(numVal)) continue

      if (!byLine.has(lineNum)) byLine.set(lineNum, [])
      byLine.get(lineNum)!.push({ date, value: rawVal })
    }

    for (const [lineNum, observations] of byLine) {
      const sid = npceSeriesId(lineNum)
      const desc = data.find(r => parseInt(r.LineNumber) === lineNum)?.LineDescription ?? ''
      storeObservations(sid, observations, {
        title:     `nPCE ${desc}`,
        frequency: 'Monthly',
        units:     'Millions of dollars, SAAR',
      })
    }

    console.log(`[BEA] Ingested ${byLine.size} line items for ${NPCE_TABLE}.`)
  })()

  npceFetchLock = promise
  try {
    await promise
  } finally {
    npceFetchLock = null
  }
}

async function ensureFreshNPCE(lineNumber: number): Promise<void> {
  const sid = npceSeriesId(lineNumber)
  if (!isSeriesStale(sid, STALE_HOURS)) return
  await fetchAndCacheNPCETable()
}

// ── GET /api/bea/npce?line_number=N ─────────────────────────────────────────

beaRouter.get('/npce', async (req: Request, res: Response) => {
  const { line_number } = req.query

  if (!line_number || isNaN(Number(line_number))) {
    res.status(400).json({ error: 'line_number query parameter is required (integer)' })
    return
  }

  const lineNum = parseInt(String(line_number))

  try {
    await ensureFreshNPCE(lineNum)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BEA API fetch failed'
    const status = msg.includes('BEA_API_KEY') ? 500 : 502
    res.status(status).json({ error: msg })
    return
  }

  const sid = npceSeriesId(lineNum)
  const rows = getObservations(sid)

  res.json({
    observations: rows.map(r => ({ date: r.date, value: String(r.value) })),
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ██  NIPA Table T20803 — Real PCE (monthly, quantity indexes, 2017=100)
// ══════════════════════════════════════════════════════════════════════════════

const RPCE_TABLE = 'T20803'

function rpceSeriesId(lineNumber: number): string {
  return `BEA_${RPCE_TABLE}_L${lineNumber}`
}

let rpceFetchLock: Promise<void> | null = null

async function fetchAndCacheRPCETable(): Promise<void> {
  if (rpceFetchLock) { await rpceFetchLock; return }

  const apiKey = getBeaApiKey()

  const promise = (async () => {
    const url = new URL('https://apps.bea.gov/api/data/')
    url.searchParams.set('UserID', apiKey)
    url.searchParams.set('method', 'GetData')
    url.searchParams.set('DataSetName', 'NIPA')
    url.searchParams.set('TableName', RPCE_TABLE)
    url.searchParams.set('Frequency', 'M')
    url.searchParams.set('Year', 'ALL')
    url.searchParams.set('ResultFormat', 'JSON')

    console.log(`[BEA] Fetching NIPA table ${RPCE_TABLE}...`)
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`BEA API returned HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    const json = await res.json() as {
      BEAAPI?: {
        Results?: {
          Error?: { ErrorDetail?: { Description?: string } }
          Data?: BeaDataRow[]
        }
      }
    }

    const apiError = json.BEAAPI?.Results?.Error?.ErrorDetail?.Description
    if (apiError) {
      throw new Error(`BEA API error: ${apiError}`)
    }

    const data = json.BEAAPI?.Results?.Data
    if (!data || !Array.isArray(data)) {
      throw new Error('BEA API returned no data array')
    }

    console.log(`[BEA] Received ${data.length} rows for ${RPCE_TABLE}, ingesting...`)

    const byLine = new Map<number, { date: string; value: string }[]>()

    for (const row of data) {
      const lineNum = parseInt(row.LineNumber)
      if (isNaN(lineNum)) continue

      const date = beaDateToIso(row.TimePeriod)
      if (!date) continue

      const rawVal = cleanValue(row.DataValue)
      if (!rawVal || rawVal === 'N/A' || rawVal === '...' || rawVal.trim() === '') continue

      const numVal = parseFloat(rawVal)
      if (isNaN(numVal)) continue

      if (!byLine.has(lineNum)) byLine.set(lineNum, [])
      byLine.get(lineNum)!.push({ date, value: rawVal })
    }

    for (const [lineNum, observations] of byLine) {
      const sid = rpceSeriesId(lineNum)
      const desc = data.find(r => parseInt(r.LineNumber) === lineNum)?.LineDescription ?? ''
      storeObservations(sid, observations, {
        title:     `rPCE ${desc}`,
        frequency: 'Monthly',
        units:     'Quantity index, 2017=100',
      })
    }

    console.log(`[BEA] Ingested ${byLine.size} line items for ${RPCE_TABLE}.`)
  })()

  rpceFetchLock = promise
  try {
    await promise
  } finally {
    rpceFetchLock = null
  }
}

async function ensureFreshRPCE(lineNumber: number): Promise<void> {
  const sid = rpceSeriesId(lineNumber)
  if (!isSeriesStale(sid, STALE_HOURS)) return
  await fetchAndCacheRPCETable()
}

// ── GET /api/bea/rpce?line_number=N ─────────────────────────────────────────

beaRouter.get('/rpce', async (req: Request, res: Response) => {
  const { line_number } = req.query

  if (!line_number || isNaN(Number(line_number))) {
    res.status(400).json({ error: 'line_number query parameter is required (integer)' })
    return
  }

  const lineNum = parseInt(String(line_number))

  try {
    await ensureFreshRPCE(lineNum)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BEA API fetch failed'
    const status = msg.includes('BEA_API_KEY') ? 500 : 502
    res.status(status).json({ error: msg })
    return
  }

  const sid = rpceSeriesId(lineNum)
  const rows = getObservations(sid)

  res.json({
    observations: rows.map(r => ({ date: r.date, value: String(r.value) })),
  })
})

// ── GET /api/bea/status ─────────────────────────────────────────────────────

beaRouter.get('/status', (_req: Request, res: Response) => {
  const row = db.prepare(
    `SELECT MAX(last_fetched) as lastUpdated, COUNT(*) as seriesCount
     FROM series_metadata WHERE series_id LIKE 'BEA_%' AND last_fetched IS NOT NULL`
  ).get() as { lastUpdated: string | null; seriesCount: number }
  res.json(row)
})
