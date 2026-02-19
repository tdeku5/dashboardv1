import { Router, Request, Response } from 'express'

export const fredRouter = Router()

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred'

const VALID_FREQUENCIES = new Set(['d', 'w', 'bw', 'm', 'q', 'sa', 'a'])
const VALID_AGGREGATION_METHODS = new Set(['avg', 'sum', 'eop'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function getApiKey(): string | null {
  const key = process.env.FRED_API_KEY
  return key && key !== 'your_fred_api_key_here' ? key : null
}

// GET /api/fred
// Required: series_id
// Optional: observation_start, observation_end, frequency, aggregation_method
fredRouter.get('/', async (req: Request, res: Response) => {
  const apiKey = getApiKey()
  if (!apiKey) {
    res.status(500).json({ error: 'FRED_API_KEY is not configured on the server' })
    return
  }

  const { series_id, observation_start, observation_end, frequency, aggregation_method } = req.query

  // --- Validation ---

  if (!series_id || typeof series_id !== 'string' || !series_id.trim()) {
    res.status(400).json({ error: 'series_id is required' })
    return
  }

  if (observation_start && !DATE_RE.test(String(observation_start))) {
    res.status(400).json({ error: 'observation_start must be in YYYY-MM-DD format' })
    return
  }

  if (observation_end && !DATE_RE.test(String(observation_end))) {
    res.status(400).json({ error: 'observation_end must be in YYYY-MM-DD format' })
    return
  }

  if (frequency && !VALID_FREQUENCIES.has(String(frequency))) {
    res.status(400).json({
      error: `Invalid frequency "${frequency}". Must be one of: ${[...VALID_FREQUENCIES].join(', ')}`,
    })
    return
  }

  if (aggregation_method && !VALID_AGGREGATION_METHODS.has(String(aggregation_method))) {
    res.status(400).json({
      error: `Invalid aggregation_method "${aggregation_method}". Must be one of: ${[...VALID_AGGREGATION_METHODS].join(', ')}`,
    })
    return
  }

  // --- Build upstream URL ---

  const params = new URLSearchParams({
    series_id: series_id.trim(),
    api_key: apiKey,
    file_type: 'json',
  })

  if (observation_start)  params.set('observation_start',  String(observation_start))
  if (observation_end)    params.set('observation_end',    String(observation_end))
  if (frequency)          params.set('frequency',          String(frequency))
  if (aggregation_method) params.set('aggregation_method', String(aggregation_method))

  // --- Proxy to FRED ---

  let upstream: globalThis.Response
  try {
    upstream = await fetch(`${FRED_BASE_URL}/series/observations?${params}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: 'Could not reach the FRED API', detail })
    return
  }

  let data: unknown
  try {
    data = await upstream.json()
  } catch {
    res.status(502).json({
      error: 'FRED API returned a non-JSON response',
      fred_status: upstream.status,
    })
    return
  }

  // Forward FRED's own error status (e.g. 400 unknown series, 429 rate-limit)
  if (!upstream.ok) {
    const msg =
      data !== null &&
      typeof data === 'object' &&
      'error_message' in data &&
      typeof (data as Record<string, unknown>).error_message === 'string'
        ? (data as Record<string, string>).error_message
        : 'FRED API returned an error'

    res.status(upstream.status).json({ error: msg, fred_status: upstream.status })
    return
  }

  res.json(data)
})
