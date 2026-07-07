// Client for /api/statcan (StatCan WDS series stored in statcan_observations).
// Serves both the Canada econ-model codes (CA_*, fetchAllStatcanSeries.ts) and
// the rates-side codes (CPI_HEADLINE, CPI_XFE, CPI_TRIM, CPI_MEDIAN,
// CPI_COMMON, UNRATE_CA).

export interface StatcanPoint {
  date: string
  value: number
}

export async function fetchStatcanSeries(code: string): Promise<StatcanPoint[]> {
  const res = await fetch(`/api/statcan?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`statcan ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: StatcanPoint[] }
  return json.observations ?? []
}

/** Fetch many codes concurrently into a code-keyed map; failures resolve empty. */
export async function fetchStatcanBatch(codes: readonly string[]): Promise<Record<string, StatcanPoint[]>> {
  const entries = await Promise.all(codes.map(async c => {
    try {
      return [c, await fetchStatcanSeries(c)] as [string, StatcanPoint[]]
    } catch {
      return [c, []] as [string, StatcanPoint[]]
    }
  }))
  return Object.fromEntries(entries)
}
