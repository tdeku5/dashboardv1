import dotenv from 'dotenv'
import path from 'path'
import { storeObservations, getSeriesLastFetched } from './db'

// Load .env when run as a standalone script (index.ts loads it first when used as a module)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

// ── Series list ───────────────────────────────────────────────────────────────

export const ALL_SERIES: string[] = [
  // Main dashboard
  'USALOLITONOSTSAM', 'PCEPILFE', 'CPILFESL', 'UNRATE', 'PAYEMS', 'TOTLL', 'DTWEXBGS',
  'FEDFUNDS', 'BAMLH0A0HYM2', 'M2SL', 'MZMSL', 'RPI', 'DPCERA3M086SBEA', 'RSXFS',
  'INDPRO', 'DGORDER', 'CES0500000003', 'GDP', 'GDPC1',
  // CPS / unemployment detail
  'CE16OV', 'CLF16OV', 'UNEMPLOY',
  'U1RATE', 'U2RATE', 'U4RATE', 'U5RATE', 'U6RATE',
  'LNS14024887', 'LNS14000060', 'LNU04000095',
  'LNS13026638', 'LNS13023557', 'LNS13023569', 'LNS13023705', 'LNS13026637', 'LNS13023653',
  'EMRATIO', 'LNS12300060', 'CIVPART', 'LNS11300060',
  // Claims
  'ICNSA', 'ICSA', 'CCNSA', 'CCSA',
  // CES payroll sectors
  'USMINE', 'USCONS', 'MANEMP', 'USWTRADE', 'USTRADE',
  'CES4300000001', 'CES4422000001', 'USINFO', 'USFIRE',
  'USPBS', 'USEHS', 'USLAH', 'USSERV', 'USGOVT',
  'CES9091000001', 'CES9092000001', 'CES9093000001',
  'USPRIV', 'USGOOD', 'CES0800000001',
  'SRVPRD', 'USTPU', 'USTRANSUTIL', 'USUTIL',
  // CES AHE (Average Hourly Earnings) series
  'CES0500000003', 'CES0600000003', 'CES0800000003',
  'CES1000000003', 'CES2000000003', 'CES3000000003',
  'CES4000000003', 'CES4142000003', 'CES4200000003', 'CES4300000003', 'CES4422000003',
  'CES5000000003', 'CES5500000003', 'CES6000000003', 'CES6500000003', 'CES7000000003', 'CES8000000003',
  // CES AWH (Average Weekly Hours) series
  'AWHAETP', 'AWHAEGP', 'AWHAEPSP',
  'AWHAEMAL', 'AWHAECON', 'AWHAEMAN',
  'AWHAETTU', 'AWHAEWT', 'AWHAERT', 'AWHAETAW', 'AWHAEUTIL',
  'AWHAEINFO', 'AWHAEFA', 'AWHAEPBS', 'AWHAEEHS', 'AWHAELAH', 'AWHAEOS',
  // JOLTS
  'JTSJOL', 'JTSHIL', 'JTSQUL', 'JTSLDL', 'JTSOSL', 'JTSTSL',
]

export const STALE_HOURS = 20

// ── Internals ─────────────────────────────────────────────────────────────────

const FRED_BASE     = 'https://api.stlouisfed.org/fred/series/observations'
const FETCH_DELAY   = 150  // ms between requests to stay under FRED rate limits

interface FredResponse {
  observations?: { date: string; value: string }[]
  error_message?: string
}

function getApiKey(): string {
  const key = process.env.FRED_API_KEY
  if (!key || key === 'your_fred_api_key_here' || key === 'your_32_character_key_here') {
    throw new Error('FRED_API_KEY is not configured in .env')
  }
  return key
}

function nowSqlite(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function isStale(lastFetched: string | null): boolean {
  if (!lastFetched) return true
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  return lastFetched < cutoff
}

async function fetchOneSeries(seriesId: string, apiKey: string): Promise<number> {
  const params = new URLSearchParams({
    series_id:         seriesId,
    api_key:           apiKey,
    file_type:         'json',
    observation_start: '1900-01-01',
  })

  const res  = await fetch(`${FRED_BASE}?${params}`)
  const body = await res.json() as FredResponse

  if (!res.ok) {
    throw new Error(`FRED ${res.status}: ${body.error_message ?? 'unknown error'}`)
  }
  if (!body.observations) {
    throw new Error(`No observations field in FRED response`)
  }

  storeObservations(seriesId, body.observations)
  return body.observations.length
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ProgressStatus = 'ok' | 'skip' | 'error'

export interface FetchProgress {
  done:     number
  total:    number
  seriesId: string
  status:   ProgressStatus
}

export async function fetchAllSeries(opts: {
  force?:      boolean
  seriesList?: string[]
  onProgress?: (p: FetchProgress) => void
} = {}): Promise<void> {
  const apiKey = getApiKey()
  const list   = opts.seriesList ?? ALL_SERIES
  const total  = list.length
  let fetched  = 0, skipped = 0, errors = 0
  let done     = 0

  console.log(
    `[fetch] Starting — ${total} series${opts.force ? ' (forced)' : ''}  ${nowSqlite()}`
  )

  for (const seriesId of list) {
    done++

    if (!opts.force && !isStale(getSeriesLastFetched(seriesId))) {
      skipped++
      console.log(`[fetch] SKIP  [${done}/${total}] ${seriesId}`)
      opts.onProgress?.({ done, total, seriesId, status: 'skip' })
      continue
    }

    try {
      const count = await fetchOneSeries(seriesId, apiKey)
      fetched++
      console.log(`[fetch] OK    [${done}/${total}] ${seriesId} — ${count} obs`)
      opts.onProgress?.({ done, total, seriesId, status: 'ok' })
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[fetch] ERR   [${done}/${total}] ${seriesId}: ${msg}`)
      opts.onProgress?.({ done, total, seriesId, status: 'error' })
    }

    if (done < total) {
      await new Promise<void>(r => setTimeout(r, FETCH_DELAY))
    }
  }

  console.log(
    `[fetch] Done — fetched=${fetched} skipped=${skipped} errors=${errors}  ${nowSqlite()}`
  )
}

// ── Standalone script ─────────────────────────────────────────────────────────

if (require.main === module) {
  const force = process.argv.includes('--force')
  console.log(`Running standalone fetch (force=${force})`)
  fetchAllSeries({ force })
    .then(() => { console.log('Complete.'); process.exit(0) })
    .catch(err => { console.error('Failed:', err); process.exit(1) })
}
