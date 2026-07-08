// Client for /api/abs (ABS series stored in au_macro_series).
// Serves the Australia econ-model codes (AU_*, fetchAllAbsSeries.ts) and the
// rates-side codes (AU_CPI_M_*, AU_CPI_Q_*, AU_UNRATE_SA/TREND). Points carry
// obs_status (TVD p=preliminary / r=revised) for caption gating.
//
// Dual-frequency convention: monthly and quarterly CPI live under DISTINCT
// series codes (AU_CPIM_* vs AU_CPIQ_*; AU_CPI_M_* vs AU_CPI_Q_*) on different
// index bases — never splice or overlay LEVELS across the two; rate (%)
// comparisons are base-invariant and fine.

export interface AbsPoint {
  date: string
  value: number
  obs_status?: string | null
}

export async function fetchAbsSeries(code: string): Promise<AbsPoint[]> {
  const res = await fetch(`/api/abs?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`abs ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: AbsPoint[] }
  return json.observations ?? []
}

/** Fetch many codes concurrently into a code-keyed map; failures resolve empty. */
export async function fetchAbsBatch(codes: readonly string[]): Promise<Record<string, AbsPoint[]>> {
  const entries = await Promise.all(codes.map(async c => {
    try {
      return [c, await fetchAbsSeries(c)] as [string, AbsPoint[]]
    } catch {
      return [c, []] as [string, AbsPoint[]]
    }
  }))
  return Object.fromEntries(entries)
}

/** True when the latest observation carries a p (preliminary) flag. */
export function latestIsPreliminary(points: AbsPoint[]): boolean {
  const last = points[points.length - 1]
  return !!last?.obs_status?.includes('p')
}
