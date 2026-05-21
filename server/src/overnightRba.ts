// Reserve Bank of Australia F1 CSV: AONIA (FIRMMCRID) + Cash Rate Target
// (FIRMMCRTD). Stored under series_code 'AONIA' and 'AU_CASH_RATE_TARGET'.
// See docs/overnight-rates-integration-guide.md §3.
//
// RBA CSVs prepend ~10 metadata rows before the data block. The data block
// always starts after a row beginning with "Series ID". Dates in the data
// block are formatted as DD-Mmm-YYYY (e.g., 19-May-2026). This parser locates
// the data block defensively and logs (rather than throws) on shape surprises.

import { db } from './db'

const RBA_F1_URL = 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv'

function getLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT date FROM overnight_rates WHERE series_code = ?
    ORDER BY date DESC LIMIT 1
  `).get(seriesCode) as { date: string } | undefined
  return row?.date ?? null
}

const MONTH_ABBR: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function parseRbaDate(s: string): string | null {
  // Accepts '19-May-2026' or '19 May 2026'.
  const m = s.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/)
  if (!m) return null
  const mm = MONTH_ABBR[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()]
  if (!mm) return null
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`
}

function splitCsvLine(line: string): string[] {
  // Lightweight CSV splitter — RBA CSVs don't quote fields with embedded
  // commas in the data block; the only commas are field separators.
  return line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
}

interface ParsedRow {
  date: string
  cashRateTarget: number | null
  aonia: number | null
}

function parseF1Csv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/)
  const seriesIdRowIdx = lines.findIndex(l => /^Series\s*ID/i.test(l))
  if (seriesIdRowIdx === -1) {
    console.warn('[overnight-rba] could not find Series ID header row in F1 CSV')
    return []
  }
  const headerCols = splitCsvLine(lines[seriesIdRowIdx])
  const cashRateIdx = headerCols.indexOf('FIRMMCRTD')
  const aoniaIdx = headerCols.indexOf('FIRMMCRID')
  if (cashRateIdx === -1 || aoniaIdx === -1) {
    console.warn(`[overnight-rba] expected columns missing — cashRate=${cashRateIdx} aonia=${aoniaIdx}`)
    return []
  }

  const rows: ParsedRow[] = []
  for (let i = seriesIdRowIdx + 1; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue
    const cols = splitCsvLine(lines[i])
    const date = parseRbaDate(cols[0] ?? '')
    if (!date) continue
    const ct = parseFloat(cols[cashRateIdx])
    const a = parseFloat(cols[aoniaIdx])
    rows.push({
      date,
      cashRateTarget: Number.isFinite(ct) ? ct : null,
      aonia: Number.isFinite(a) ? a : null,
    })
  }
  return rows
}

const upsert = db.prepare(`
  INSERT INTO overnight_rates (date, series_code, value, is_provisional, source, ingested_at)
  VALUES (?, ?, ?, 0, 'RBA', datetime('now'))
  ON CONFLICT(date, series_code) DO UPDATE SET
    value = excluded.value,
    ingested_at = excluded.ingested_at
`)

function writeAll(rows: ParsedRow[]): { aonia: number; target: number } {
  let aonia = 0, target = 0
  const tx = db.transaction((batch: ParsedRow[]) => {
    for (const r of batch) {
      if (r.aonia !== null) { upsert.run(r.date, 'AONIA', r.aonia); aonia++ }
      if (r.cashRateTarget !== null) {
        upsert.run(r.date, 'AU_CASH_RATE_TARGET', r.cashRateTarget); target++
      }
    }
  })
  tx(rows)
  return { aonia, target }
}

async function fetchF1(): Promise<string> {
  const res = await fetch(RBA_F1_URL)
  if (!res.ok) throw new Error(`RBA F1 CSV ${res.status}`)
  return await res.text()
}

export async function backfillRbaOvernight(): Promise<void> {
  try {
    const csv = await fetchF1()
    const rows = parseF1Csv(csv)
    if (rows.length === 0) {
      console.warn('[overnight-rba] backfill: no rows parsed from F1 CSV')
      return
    }
    const counts = writeAll(rows)
    console.log(`[overnight-rba] backfill:`, counts)
  } catch (err) {
    console.error('[overnight-rba] backfill failed:', err)
  }
}

export async function syncIncrementalRbaOvernight(): Promise<void> {
  // RBA F1 is a single CSV with the full history — incremental and backfill
  // are the same operation from the network side. The upsert PK keeps duplicate
  // writes idempotent. We still filter to rows newer than the latest stored
  // date minus 14 days to keep write volume small after a backfill.
  try {
    const csv = await fetchF1()
    const all = parseF1Csv(csv)
    const latest = getLatestDate('AONIA')
    const cutoff = latest
      ? new Date(new Date(latest).getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
      : null
    const rows = cutoff ? all.filter(r => r.date >= cutoff) : all
    if (rows.length === 0) {
      console.log('[overnight-rba] sync: nothing new')
      return
    }
    const counts = writeAll(rows)
    console.log(`[overnight-rba] sync:`, counts)
  } catch (err) {
    console.error('[overnight-rba] sync failed:', err)
  }
}
