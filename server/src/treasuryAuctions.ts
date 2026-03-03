import { upsertAuctionsBatch, isTreasuryTableEmpty, type ParsedAuction } from './db'

// ── TreasuryDirect API ──────────────────────────────────────────────────────

const TREASURY_API_BASE = 'https://www.treasurydirect.gov/TA_WS/securities/search'
const FETCH_DELAY = 1200        // ms between requests (API can be slow)
const MAX_PER_PAGE = 250        // API max per request
const HISTORY_START_YEAR = 2000 // how far back to fetch on initial load

// Security types we care about (skip Bills for now)
const SECURITY_TYPES = ['Note', 'Bond', 'TIPS', 'FRN'] as const

interface TreasuryApiRecord {
  cusip: string
  securityType: string
  securityTerm: string
  auctionDate: string
  issueDate: string
  maturityDate: string
  bidToCoverRatio: string
  highYield: string
  interestRate: string
  totalAccepted: string
  totalTendered: string
  competitiveAccepted: string
  competitiveTendered: string
  directBidderAccepted: string
  directBidderTendered: string
  indirectBidderAccepted: string
  indirectBidderTendered: string
  allocationPercentage: string
  offeringAmount: string
  reopening: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined | null): number | null {
  if (!s || s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseDate(s: string | undefined | null): string | null {
  if (!s || s.trim() === '') return null
  // "2025-01-15T00:00:00" → "2025-01-15"
  return s.slice(0, 10)
}

function parseRecord(r: TreasuryApiRecord): ParsedAuction {
  return {
    cusip:                  r.cusip,
    auctionDate:            parseDate(r.auctionDate) ?? '',
    securityType:           r.securityType ?? '',
    securityTerm:           r.securityTerm ?? '',
    issueDate:              parseDate(r.issueDate),
    maturityDate:           parseDate(r.maturityDate),
    bidToCover:             parseNum(r.bidToCoverRatio),
    highYield:              parseNum(r.highYield),
    interestRate:           parseNum(r.interestRate),
    totalAccepted:          parseNum(r.totalAccepted),
    totalTendered:          parseNum(r.totalTendered),
    competitiveAccepted:    parseNum(r.competitiveAccepted),
    competitiveTendered:    parseNum(r.competitiveTendered),
    directBidderAccepted:   parseNum(r.directBidderAccepted),
    directBidderTendered:   parseNum(r.directBidderTendered),
    indirectBidderAccepted: parseNum(r.indirectBidderAccepted),
    indirectBidderTendered: parseNum(r.indirectBidderTendered),
    allocationPct:          parseNum(r.allocationPercentage),
    offeringAmount:         parseNum(r.offeringAmount),
    reopening:              r.reopening === 'Yes' ? 'Yes' : r.reopening === 'No' ? 'No' : null,
  }
}

async function fetchAuctionPage(params: Record<string, string>): Promise<TreasuryApiRecord[]> {
  const url = new URL(TREASURY_API_BASE)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`TreasuryDirect API error: ${res.status} ${res.statusText}`)
  }

  const body = await res.json()
  // API returns an array directly
  if (Array.isArray(body)) return body
  return []
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Convert "YYYY-MM-DD" to "MM/DD/YYYY" (TreasuryDirect API format) */
function toApiDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// ── Full historical fetch ───────────────────────────────────────────────────

async function fetchFullHistory(): Promise<number> {
  const currentYear = new Date().getFullYear()
  let totalInserted = 0

  for (const secType of SECURITY_TYPES) {
    console.log(`[treasury] Fetching ${secType} history…`)

    for (let year = HISTORY_START_YEAR; year <= currentYear; year++) {
      const startDate = `${year}-01-01`
      const endDate = year === currentYear
        ? new Date().toISOString().slice(0, 10)
        : `${year}-12-31`

      try {
        const records = await fetchAuctionPage({
          type: secType,
          startDate: toApiDate(startDate),
          endDate: toApiDate(endDate),
        })

        if (records.length > 0) {
          const parsed = records
            .map(parseRecord)
            .filter(r => r.cusip && r.auctionDate)
          upsertAuctionsBatch(parsed)
          totalInserted += parsed.length
          console.log(`[treasury]   ${secType} ${year}: ${parsed.length} records`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[treasury]   ${secType} ${year}: ERROR — ${msg}`)
      }

      await delay(FETCH_DELAY)
    }
  }

  return totalInserted
}

// ── Incremental sync (last 90 days) ────────────────────────────────────────

async function fetchRecent(): Promise<number> {
  const now = new Date()
  const start = new Date(now.getTime() - 90 * 24 * 3_600_000)
  const startStr = toApiDate(start.toISOString().slice(0, 10))
  const endStr = toApiDate(now.toISOString().slice(0, 10))
  let totalInserted = 0

  for (const secType of SECURITY_TYPES) {
    try {
      const records = await fetchAuctionPage({
        type: secType,
        startDate: startStr,
        endDate: endStr,
      })

      if (records.length > 0) {
        const parsed = records
          .map(parseRecord)
          .filter(r => r.cusip && r.auctionDate)
        upsertAuctionsBatch(parsed)
        totalInserted += parsed.length
        console.log(`[treasury] Incremental ${secType}: ${parsed.length} records`)
      }

      await delay(FETCH_DELAY)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[treasury] Incremental ${secType}: ERROR — ${msg}`)
    }
  }

  return totalInserted
}

// ── Public sync function ────────────────────────────────────────────────────

export async function syncTreasuryAuctions(opts: { force?: boolean } = {}): Promise<void> {
  const empty = isTreasuryTableEmpty()

  if (empty || opts.force) {
    console.log(`[treasury] Starting full historical fetch (${HISTORY_START_YEAR}–present)…`)
    const count = await fetchFullHistory()
    console.log(`[treasury] Full fetch complete — ${count} records inserted/updated`)
  } else {
    console.log('[treasury] Running incremental sync (last 90 days)…')
    const count = await fetchRecent()
    console.log(`[treasury] Incremental sync complete — ${count} records inserted/updated`)
  }
}
