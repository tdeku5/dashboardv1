// Client for /api/estat (e-Stat series stored in estat_observations).
// Serves the Japan econ-model codes (JP_*, fetchAllEstatSeries.ts), the
// customs trade codes (JP_TRADE_*, source='Customs'), and the rates-side
// codes (CPI_HEADLINE_JP, CPI_CORE_JP, CPI_CORECORE_JP, UNRATE_JP).

export interface EstatPoint {
  date: string
  value: number
}

export async function fetchEstatSeries(code: string): Promise<EstatPoint[]> {
  const res = await fetch(`/api/estat?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`estat ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: EstatPoint[] }
  return json.observations ?? []
}

/** Fetch many codes concurrently into a code-keyed map; failures resolve empty. */
export async function fetchEstatBatch(codes: readonly string[]): Promise<Record<string, EstatPoint[]>> {
  const entries = await Promise.all(codes.map(async c => {
    try {
      return [c, await fetchEstatSeries(c)] as [string, EstatPoint[]]
    } catch {
      return [c, []] as [string, EstatPoint[]]
    }
  }))
  return Object.fromEntries(entries)
}

// ── BoJ Time-Series API data (/api/boj-ts, bojts_observations) ──────────────
// JP_PPI, JP_LOANS, JP_LOANS_YOY, JP_DEPOSITS. Panels consuming these must
// render the BoJ attribution line (see JP_PROXY_CAVEATS.boj_lending).

export async function fetchBojTsSeries(code: string): Promise<EstatPoint[]> {
  const res = await fetch(`/api/boj-ts?code=${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(`boj-ts ${code}: HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; observations: EstatPoint[] }
  return json.observations ?? []
}

export async function fetchBojTsBatch(codes: readonly string[]): Promise<Record<string, EstatPoint[]>> {
  const entries = await Promise.all(codes.map(async c => {
    try {
      return [c, await fetchBojTsSeries(c)] as [string, EstatPoint[]]
    } catch {
      return [c, []] as [string, EstatPoint[]]
    }
  }))
  return Object.fromEntries(entries)
}
