import type { FredObservation } from './fred'

export async function fetchCensusTradeSeries(seriesId: string): Promise<FredObservation[]> {
  const res = await fetch(`/api/census-trade/${seriesId}`)
  if (!res.ok) throw new Error(`Census trade fetch failed: ${res.status}`)
  const data = await res.json()
  return data.observations ?? []
}
