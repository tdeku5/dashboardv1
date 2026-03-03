import type { FredObservation } from './fred'

interface BeaApiResponse {
  observations?: FredObservation[]
  error?:        string
}

export class BeaConfigError extends Error {
  constructor(public readonly reason: 'missing' | 'invalid') {
    super(
      reason === 'missing'
        ? 'BEA_API_KEY is not set in the server .env file'
        : 'BEA API rejected the key — verify BEA_API_KEY in your .env file'
    )
    this.name = 'BeaConfigError'
  }
}

export async function fetchBEASeries(lineNumber: number): Promise<FredObservation[]> {
  const params = new URLSearchParams({ line_number: String(lineNumber) })
  const res = await fetch(`/api/bea/pce?${params}`)

  let body: BeaApiResponse
  try {
    body = await res.json() as BeaApiResponse
  } catch {
    throw new Error(`Non-JSON response from BEA proxy (HTTP ${res.status})`)
  }

  if (!res.ok) {
    const msg = body.error ?? `HTTP ${res.status} for line ${lineNumber}`

    if (res.status === 500 && body.error?.includes('BEA_API_KEY')) {
      throw new BeaConfigError('missing')
    }
    if ((res.status === 400 || res.status === 403) && msg.toLowerCase().includes('api_key')) {
      throw new BeaConfigError('invalid')
    }

    throw new Error(msg)
  }

  return body.observations ?? []
}
