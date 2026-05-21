// Bank of Canada Valet API: CORRA (AVG.INTWO) + Target for the Overnight Rate
// (V39078). Stored in overnight_rates under series_code 'CORRA' and 'CA_TARGET'.
// See docs/overnight-rates-integration-guide.md §1.

import { db } from './db'

interface ValetResponse {
  observations?: Array<Record<string, { v: string; r?: string } | string>>
}

const BASE = 'https://www.bankofcanada.ca/valet/observations'

const SERIES: Array<{ valetId: string; seriesCode: string }> = [
  { valetId: 'AVG.INTWO', seriesCode: 'CORRA' },
  { valetId: 'V39078',    seriesCode: 'CA_TARGET' },
]

function getLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT date FROM overnight_rates WHERE series_code = ?
    ORDER BY date DESC LIMIT 1
  `).get(seriesCode) as { date: string } | undefined
  return row?.date ?? null
}

interface BocRow {
  date: string
  values: Record<string, { v: number; revised: boolean } | null>
}

async function fetchValet(startDate: string): Promise<BocRow[]> {
  const ids = SERIES.map(s => s.valetId).join(',')
  const url = `${BASE}/${ids}/json?start_date=${startDate}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`BoC Valet ${res.status} on ${url}`)
  const body = (await res.json()) as ValetResponse
  if (!body.observations) throw new Error('BoC Valet: missing observations')
  const out: BocRow[] = []
  for (const obs of body.observations) {
    const dateField = obs['d']
    const date = typeof dateField === 'string' ? dateField : null
    if (!date) continue
    const values: BocRow['values'] = {}
    for (const s of SERIES) {
      const cell = obs[s.valetId]
      if (cell && typeof cell !== 'string') {
        const v = parseFloat(cell.v)
        if (Number.isFinite(v)) {
          values[s.valetId] = { v, revised: cell.r === 'R' }
          continue
        }
      }
      values[s.valetId] = null
    }
    out.push({ date, values })
  }
  return out
}

const upsert = db.prepare(`
  INSERT INTO overnight_rates (date, series_code, value, is_provisional, source, ingested_at)
  VALUES (?, ?, ?, ?, 'BoC', datetime('now'))
  ON CONFLICT(date, series_code) DO UPDATE SET
    value = excluded.value,
    is_provisional = excluded.is_provisional,
    ingested_at = excluded.ingested_at
`)

function writeAll(rows: BocRow[]): { byCode: Record<string, number> } {
  const counts: Record<string, number> = {}
  const tx = db.transaction((batch: BocRow[]) => {
    for (const row of batch) {
      for (const s of SERIES) {
        const cell = row.values[s.valetId]
        if (!cell) continue
        // BoC flags same-day revisions with "R" — we surface that via
        // is_provisional=1 (revised observations may still be revised again).
        upsert.run(row.date, s.seriesCode, cell.v, cell.revised ? 1 : 0)
        counts[s.seriesCode] = (counts[s.seriesCode] ?? 0) + 1
      }
    }
  })
  tx(rows)
  return { byCode: counts }
}

export async function backfillBocOvernight(): Promise<void> {
  try {
    // CORRA series goes back to 1998 per the guide.
    const rows = await fetchValet('1998-01-01')
    const { byCode } = writeAll(rows)
    console.log(`[overnight-boc] backfill:`, byCode)
  } catch (err) {
    console.error('[overnight-boc] backfill failed:', err)
  }
}

export async function syncIncrementalBocOvernight(): Promise<void> {
  try {
    // Use the latest CORRA date as anchor (CA_TARGET may have sparser updates).
    const latest = getLatestDate('CORRA')
    const start = latest
      ? new Date(new Date(latest).getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
      : '1998-01-01'
    const rows = await fetchValet(start)
    const { byCode } = writeAll(rows)
    console.log(`[overnight-boc] sync from ${start}:`, byCode)
  } catch (err) {
    console.error('[overnight-boc] sync failed:', err)
  }
}
