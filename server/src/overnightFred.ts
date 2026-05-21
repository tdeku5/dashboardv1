// FRED-sourced overnight rates: UK SONIA (IUDSOIA) and EU Deposit Facility
// Rate (ECBDFR). Written into the unified `overnight_rates` table so the
// Forward Pricing headers can read every country's overnight rate from one
// place regardless of source. See docs/overnight-rates-integration-guide.md.

import { db } from './db'
import { getApiKey } from './fetchAllSeries'

interface FredResponse {
  observations?: { date: string; value: string }[]
  error_message?: string
}

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

interface FredSeriesSpec {
  fredId: string       // FRED series ID, e.g. 'IUDSOIA'
  seriesCode: string   // overnight_rates.series_code, e.g. 'SONIA'
}

const SERIES: FredSeriesSpec[] = [
  { fredId: 'IUDSOIA', seriesCode: 'SONIA' },
  { fredId: 'ECBDFR',  seriesCode: 'ECBDFR' },
]

function getLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT date FROM overnight_rates WHERE series_code = ?
    ORDER BY date DESC LIMIT 1
  `).get(seriesCode) as { date: string } | undefined
  return row?.date ?? null
}

async function fetchFromFred(fredId: string, startDate: string): Promise<{ date: string; value: number }[]> {
  const apiKey = getApiKey()
  const params = new URLSearchParams({
    series_id: fredId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: startDate,
  })
  const res = await fetch(`${FRED_BASE}?${params}`)
  const body = (await res.json()) as FredResponse
  if (!res.ok) {
    throw new Error(`FRED ${res.status}: ${body.error_message ?? 'unknown error'}`)
  }
  if (!body.observations) {
    throw new Error(`No observations field in FRED response for ${fredId}`)
  }
  const out: { date: string; value: number }[] = []
  for (const o of body.observations) {
    // FRED uses '.' for missing values on non-publication days.
    if (o.value === '.' || o.value === '') continue
    const v = parseFloat(o.value)
    if (Number.isFinite(v)) out.push({ date: o.date, value: v })
  }
  return out
}

const upsert = db.prepare(`
  INSERT INTO overnight_rates (date, series_code, value, is_provisional, source, ingested_at)
  VALUES (?, ?, ?, 0, 'FRED', datetime('now'))
  ON CONFLICT(date, series_code) DO UPDATE SET
    value = excluded.value,
    ingested_at = excluded.ingested_at
`)

function writeAll(seriesCode: string, rows: { date: string; value: number }[]): number {
  const tx = db.transaction((batch: typeof rows) => {
    for (const r of batch) upsert.run(r.date, seriesCode, r.value)
  })
  tx(rows)
  return rows.length
}

export async function backfillFredOvernight(): Promise<void> {
  for (const spec of SERIES) {
    try {
      const rows = await fetchFromFred(spec.fredId, '1900-01-01')
      const n = writeAll(spec.seriesCode, rows)
      console.log(`[overnight-fred] backfill ${spec.seriesCode} (${spec.fredId}): ${n} obs`)
    } catch (err) {
      console.error(`[overnight-fred] backfill ${spec.seriesCode} failed:`, err)
    }
  }
}

export async function syncIncrementalFredOvernight(): Promise<void> {
  for (const spec of SERIES) {
    try {
      const latest = getLatestDate(spec.seriesCode)
      // Pull from 14 days before latest to catch revisions; if empty, full backfill.
      const start = latest
        ? new Date(new Date(latest).getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
        : '1900-01-01'
      const rows = await fetchFromFred(spec.fredId, start)
      const n = writeAll(spec.seriesCode, rows)
      console.log(`[overnight-fred] sync ${spec.seriesCode}: ${n} obs from ${start}`)
    } catch (err) {
      console.error(`[overnight-fred] sync ${spec.seriesCode} failed:`, err)
    }
  }
}
