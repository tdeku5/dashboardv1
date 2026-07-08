// Clients for the EU3 (DE/FR/IT) economic models.
// /api/eurostat — eurostat_observations; points carry obs_flag (b=break,
// p=provisional, e=estimate, d=definition-differs, u=low reliability) which
// panels surface as chart markers.
// /api/ecb — ecb_observations; serves the EU3 country extension codes
// ({CC}_HICP_*, UNRATE_{CC}, {CC}_LOANS_*) and the euro-area HICP codes used
// as reference overlays (decision g).

export interface EurostatPoint {
  date: string
  value: number
  obs_flag?: string | null
}

export async function fetchEurostatSeries(code: string): Promise<EurostatPoint[]> {
  const res = await fetch(`/api/eurostat?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`eurostat ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: EurostatPoint[] }
  return json.observations ?? []
}

export async function fetchEcbSeries(code: string): Promise<EurostatPoint[]> {
  const res = await fetch(`/api/ecb?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`ecb ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: EurostatPoint[] }
  return json.observations ?? []
}

/** Batch fetch across both endpoints: codes starting with a source prefix map
 *  accordingly. ECB-hosted codes: *_HICP*, UNRATE_*, *_LOANS_*, HICP_* (EA). */
function isEcbCode(code: string): boolean {
  return /(_HICP|^HICP_|^UNRATE_|_LOANS_)/.test(code)
}

export async function fetchEu3Batch(codes: readonly string[]): Promise<Record<string, EurostatPoint[]>> {
  const entries = await Promise.all(codes.map(async c => {
    try {
      const pts = isEcbCode(c) ? await fetchEcbSeries(c) : await fetchEurostatSeries(c)
      return [c, pts] as [string, EurostatPoint[]]
    } catch {
      return [c, []] as [string, EurostatPoint[]]
    }
  }))
  return Object.fromEntries(entries)
}

/** Dates whose obs_flag contains `b` — vertical break-marker positions. */
export function breakDates(points: EurostatPoint[]): string[] {
  return points.filter(p => p.obs_flag?.includes('b')).map(p => p.date)
}

/** Count of estimate-flagged observations (`e`) — for visible captions. */
export function estimateCount(points: EurostatPoint[]): number {
  return points.filter(p => p.obs_flag?.includes('e')).length
}
