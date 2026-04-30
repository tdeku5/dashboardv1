import { storeOnsObservations, upsertOnsSeriesMeta } from './db'

// The old api.ons.gov.uk was decommissioned 25/11/2024.
// New approach: use the ONS search API to discover the data URI, then
// fetch data from www.ons.gov.uk{uri}/data.

const ONS_SEARCH = 'https://api.beta.ons.gov.uk/v1/search'
const ONS_WEB = 'https://www.ons.gov.uk'
const REQUEST_DELAY_MS = 150

interface OnsObsRaw {
  year?: string
  month?: string
  quarter?: string
  date?: string
  value?: string
}

interface OnsDataResponse {
  years?: OnsObsRaw[]
  quarters?: OnsObsRaw[]
  months?: OnsObsRaw[]
}

interface OnsSearchResult {
  items?: Array<{
    cdid?: string
    dataset_id?: string
    uri?: string
    title?: string
  }>
}

const MONTH_MAP: Record<string, string> = {
  'January': '01', 'February': '02', 'March': '03', 'April': '04',
  'May': '05', 'June': '06', 'July': '07', 'August': '08',
  'September': '09', 'October': '10', 'November': '11', 'December': '12',
}

const QUARTER_MAP: Record<string, string> = {
  'Q1': '01', 'Q2': '04', 'Q3': '07', 'Q4': '10',
}

function parseOnsDate(obs: OnsObsRaw): string | null {
  if (obs.month && obs.year) {
    const m = MONTH_MAP[obs.month]
    if (m) return `${obs.year}-${m}-01`
    return null
  }
  if (obs.quarter && obs.year) {
    const m = QUARTER_MAP[obs.quarter]
    if (m) return `${obs.year}-${m}-01`
    return null
  }
  if (obs.year && !obs.month && !obs.quarter) {
    return `${obs.year}-01-01`
  }
  return null
}

// In-memory cache of CDID → URI mappings (persists for the lifetime of the server process)
const uriCache = new Map<string, string>()

/**
 * Discover the data URI for a given CDID using the ONS search API.
 * Returns the URI path e.g. "/economy/grossdomesticproductgdp/timeseries/abmi/pgdp"
 */
async function discoverUri(cdid: string, datasetId: string): Promise<string | null> {
  const cacheKey = `${cdid.toUpperCase()}:${datasetId.toLowerCase()}`
  const cached = uriCache.get(cacheKey)
  if (cached) return cached

  try {
    const searchUrl = `${ONS_SEARCH}?q=${cdid.toUpperCase()}&content_type=timeseries&limit=5`
    const res = await fetch(searchUrl)
    if (!res.ok) {
      console.error(`[ONS] Search API returned ${res.status} for ${cdid}`)
      return null
    }
    const data = (await res.json()) as OnsSearchResult
    const items = data.items || []

    // Find the matching item — prefer exact CDID + dataset match
    let match = items.find(it =>
      it.cdid?.toUpperCase() === cdid.toUpperCase() &&
      it.dataset_id?.toLowerCase() === datasetId.toLowerCase()
    )

    // Fall back to just CDID match
    if (!match) {
      match = items.find(it => it.cdid?.toUpperCase() === cdid.toUpperCase())
    }

    if (match?.uri) {
      uriCache.set(cacheKey, match.uri)
      return match.uri
    }

    console.warn(`[ONS] No URI found for ${cdid}/${datasetId} in search results`)
    return null
  } catch (err) {
    console.error(`[ONS] Search API error for ${cdid}:`, err)
    return null
  }
}

export async function fetchOnsSeries(
  cdid: string,
  datasetId: string
): Promise<Array<{ date: string; value: number }>> {
  console.log(`[ONS] Fetching ${cdid} from dataset ${datasetId}...`)

  // Step 1: Discover the data URI
  const uri = await discoverUri(cdid, datasetId)
  if (!uri) {
    console.error(`[ONS] Could not discover URI for ${cdid}/${datasetId}`)
    return []
  }

  // Step 2: Fetch data from www.ons.gov.uk{uri}/data
  const dataUrl = `${ONS_WEB}${uri}/data`
  const res = await fetch(dataUrl)
  if (!res.ok) {
    console.error(`[ONS] Failed to fetch data for ${cdid}: ${res.status} from ${dataUrl}`)
    return []
  }

  const data = (await res.json()) as OnsDataResponse

  // Determine frequency and extract title from URI
  const frequency = (data.months?.length ?? 0) > 0 ? 'monthly' :
                    (data.quarters?.length ?? 0) > 0 ? 'quarterly' : 'annual'

  upsertOnsSeriesMeta(cdid, datasetId, {
    title: cdid.toUpperCase(),
    units: '',
    frequency,
  })

  // Parse observations — prefer finest granularity
  const observations: Array<{ date: string; value: number | null }> = []

  const sourceArray: OnsObsRaw[] = (data.months?.length ?? 0) > 0 ? data.months! :
                    (data.quarters?.length ?? 0) > 0 ? data.quarters! :
                    data.years || []

  for (const obs of sourceArray) {
    const date = parseOnsDate(obs)
    if (!date) continue

    const rawVal = obs.value
    if (rawVal === '' || rawVal === '..' || rawVal === null || rawVal === undefined) {
      observations.push({ date, value: null })
    } else {
      const num = parseFloat(String(rawVal).replace(/,/g, ''))
      if (!isNaN(num)) {
        observations.push({ date, value: num })
      }
    }
  }

  if (observations.length > 0) {
    storeOnsObservations(cdid, datasetId, observations)
    console.log(`[ONS] Stored ${observations.filter(o => o.value !== null).length} observations for ${cdid}/${datasetId} (${frequency})`)
  } else {
    console.warn(`[ONS] No observations parsed for ${cdid}/${datasetId}`)
  }

  return observations.filter((o): o is { date: string; value: number } => o.value !== null)
}

export async function fetchOnsSeriesBatch(
  series: Array<{ cdid: string; datasetId: string }>
): Promise<void> {
  for (const s of series) {
    try {
      await fetchOnsSeries(s.cdid, s.datasetId)
    } catch (err) {
      console.error(`[ONS] Error fetching ${s.cdid}/${s.datasetId}:`, err)
    }
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS))
  }
}
