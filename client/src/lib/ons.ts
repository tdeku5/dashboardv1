export interface OnsDataPoint {
  date: string
  value: number
}

export async function fetchOnsSeries(
  cdid: string,
  datasetId: string
): Promise<OnsDataPoint[]> {
  try {
    const params = new URLSearchParams({ cdid, dataset: datasetId })
    const res = await fetch(`/api/ons?${params}`)
    if (!res.ok) {
      console.error(`[ONS client] Failed to fetch ${cdid}/${datasetId}: ${res.status}`)
      return []
    }
    const data = await res.json() as { observations?: Array<{ date: string; value: number }> }
    return (data.observations || []).map(obs => ({
      date: obs.date,
      value: Number(obs.value),
    }))
  } catch (err) {
    console.error(`[ONS client] Network error fetching ${cdid}/${datasetId}:`, err)
    return []
  }
}

// ── Monthly GDP Contributions ────────────────────────────────────────────────

export interface GDPContribution {
  date: string
  gdp?: number
  services?: number
  production?: number
  construction?: number
  agriculture?: number
  // Services sub-sectors
  wholesale_retail?: number
  transport_storage?: number
  accommodation_food?: number
  info_communication?: number
  financial_insurance?: number
  real_estate?: number
  professional_scientific?: number
  admin_support?: number
  public_admin?: number
  education?: number
  health_social?: number
  arts_recreation?: number
  other_services?: number
  // Production sub-sectors
  manufacturing?: number
  mining?: number
  electricity_gas?: number
  water_waste?: number
  [key: string]: string | number | undefined
}

export async function fetchGDPContributions(
  periodType: string = 'mom',
  start?: string
): Promise<GDPContribution[]> {
  try {
    const params = new URLSearchParams({ type: periodType })
    if (start) params.set('start', start)
    const res = await fetch(`/api/ons/gdp-contributions?${params}`)
    if (!res.ok) return []
    const json = await res.json() as { data?: GDPContribution[] }
    return json.data || []
  } catch {
    return []
  }
}

export async function fetchOnsSeriesBatch(
  series: Array<{ cdid: string; datasetId: string }>
): Promise<Record<string, OnsDataPoint[]>> {
  const results: Record<string, OnsDataPoint[]> = {}
  await Promise.all(
    series.map(async (s) => {
      const data = await fetchOnsSeries(s.cdid, s.datasetId)
      results[s.cdid.toUpperCase()] = data
    })
  )
  return results
}
