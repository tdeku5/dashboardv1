export interface BoeDataPoint {
  date: string
  value: number
}

/** Fetch one or more BoE series (comma-separated or array). */
export async function fetchBoeSeries(
  seriesCodes: string | string[]
): Promise<Record<string, BoeDataPoint[]>> {
  const codes = Array.isArray(seriesCodes) ? seriesCodes.join(',') : seriesCodes
  const res = await fetch(`/api/boe?series=${encodeURIComponent(codes)}`)
  if (!res.ok) {
    console.error(`[BoE client] Failed: ${res.status}`)
    return {}
  }
  const data = await res.json() as { series?: Record<string, Array<{ date: string; value: number }>> }
  const result: Record<string, BoeDataPoint[]> = {}
  for (const [code, obs] of Object.entries(data.series || {})) {
    result[code] = obs.map(o => ({ date: o.date, value: Number(o.value) }))
  }
  return result
}

/** Fetch a single BoE series. */
export async function fetchBoeOneSeries(seriesCode: string): Promise<BoeDataPoint[]> {
  const result = await fetchBoeSeries(seriesCode)
  return result[seriesCode.toUpperCase()] || []
}

// ── Gilt Yield Curve ────────────────────────────────────────────────────────

export interface GiltCurvePoint {
  maturity: number
  value: number
}

/** Fetch the full gilt curve for a specific date and type. */
export async function fetchGiltCurve(
  curveType: string = 'nominal_spot',
  date?: string
): Promise<{ date: string; curve: GiltCurvePoint[] }> {
  const params = new URLSearchParams({ type: curveType })
  if (date) params.set('date', date)

  const res = await fetch(`/api/boe/yield-curve?${params}`)
  if (!res.ok) return { date: '', curve: [] }
  const data = await res.json() as { date?: string; curve?: GiltCurvePoint[] }
  return { date: data.date || '', curve: data.curve || [] }
}

/** Fetch time series for a specific maturity on the gilt curve. */
export async function fetchGiltCurveTimeSeries(
  curveType: string,
  maturity: number,
  start?: string,
  end?: string
): Promise<BoeDataPoint[]> {
  const params = new URLSearchParams({
    type: curveType,
    maturity: maturity.toString(),
  })
  if (start) params.set('start', start)
  if (end) params.set('end', end)

  const res = await fetch(`/api/boe/yield-curve/timeseries?${params}`)
  if (!res.ok) return []
  const data = await res.json() as { observations?: Array<{ date: string; value: number }> }
  return (data.observations || []).map(o => ({ date: o.date, value: o.value }))
}

/** Fetch available dates for a curve type (most recent 30). */
export async function fetchGiltCurveDates(
  curveType: string = 'nominal_spot'
): Promise<string[]> {
  const res = await fetch(`/api/boe/yield-curve/dates?type=${curveType}`)
  if (!res.ok) return []
  const data = await res.json() as { dates?: string[] }
  return data.dates || []
}
