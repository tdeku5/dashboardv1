export interface FredObservation {
  date:  string  // "YYYY-MM-DD"
  value: string  // numeric string or "." for missing
}

interface FredApiResponse {
  observations?:  FredObservation[]
  error_message?: string  // from FRED API upstream
  error?:         string  // from our own server proxy
}

export interface FetchOptions {
  observationStart?:  string
  frequency?:         string
  aggregationMethod?: string
}

/**
 * Thrown when the FRED_API_KEY is missing from .env or rejected by the API.
 * Detected upstream in useFredData to show the setup screen.
 */
export class FredConfigError extends Error {
  constructor(public readonly reason: 'missing' | 'invalid') {
    super(
      reason === 'missing'
        ? 'FRED_API_KEY is not set in the server .env file'
        : 'FRED API rejected the key — verify FRED_API_KEY in your .env file'
    )
    this.name = 'FredConfigError'
  }
}

// ── Database status ───────────────────────────────────────────────────────────

export interface DbStatus {
  lastUpdated:  string | null  // SQLite datetime string (UTC)
  seriesCount:  number
}

export async function fetchDbStatus(): Promise<DbStatus> {
  try {
    const res = await fetch('/api/fred/status')
    if (!res.ok) return { lastUpdated: null, seriesCount: 0 }
    return await res.json() as DbStatus
  } catch {
    return { lastUpdated: null, seriesCount: 0 }
  }
}

export async function triggerRefresh(): Promise<DbStatus | null> {
  const res = await fetch('/api/fred/refresh', { method: 'POST' })
  if (!res.ok) {
    const body = await res.json() as { error?: string }
    throw new Error(body.error ?? `Refresh failed (HTTP ${res.status})`)
  }
  return await res.json() as DbStatus
}

export async function fetchFredSeries(
  seriesId: string,
  opts: FetchOptions = {}
): Promise<FredObservation[]> {
  const params = new URLSearchParams({ series_id: seriesId })
  if (opts.observationStart)  params.set('observation_start',  opts.observationStart)
  if (opts.frequency)         params.set('frequency',          opts.frequency)
  if (opts.aggregationMethod) params.set('aggregation_method', opts.aggregationMethod)

  const res = await fetch(`/api/fred?${params}`)

  let body: FredApiResponse
  try {
    body = await res.json() as FredApiResponse
  } catch {
    throw new Error(`Non-JSON response from proxy (HTTP ${res.status})`)
  }

  if (!res.ok) {
    const msg = body.error_message ?? body.error ?? `HTTP ${res.status} for ${seriesId}`

    // Server returns 500 with our own message when the key is absent/placeholder
    if (res.status === 500 && body.error?.includes('FRED_API_KEY')) {
      throw new FredConfigError('missing')
    }

    // FRED returns 400/403 mentioning "api_key" when the key is wrong
    if ((res.status === 400 || res.status === 403) && msg.toLowerCase().includes('api_key')) {
      throw new FredConfigError('invalid')
    }

    throw new Error(msg)
  }

  return body.observations ?? []
}
