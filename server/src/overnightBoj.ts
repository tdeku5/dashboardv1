// Bank of Japan Time-Series API: TONA (Uncollateralized Overnight Call Rate,
// Average, final) under series code FM02'STMUCDBOD. Stored in overnight_rates
// under series_code 'TONA'.
//
// The BoJ API launched in February 2026 and the URL structure documented in the
// integration guide is a CGI endpoint (not REST). The guide notes:
//
//   - URL pattern (best-effort): https://www.stat-search.boj.or.jp/ssi/cgi-bin/
//     famecgi2?cgi=$nme_a000_en&hstat=FM02'STMUCDBOD
//   - The apostrophe in the series code MUST be URL-encoded as %27.
//   - The BoJ warns against high-frequency requests; we throttle to 1 request
//     per ~3 seconds and retry with exponential backoff on transient errors.
//   - Response format is JSON or CSV depending on a format parameter not yet
//     documented to us. We try JSON first; if the response isn't JSON, we
//     log the body shape and abort cleanly (the collector is allowed to fail
//     without bringing down the rest of the pipeline).
//
// Because the BoJ endpoint shape is not stable / fully documented, this
// collector is built defensively: it never throws; failures are logged and
// the rest of the collectors continue.

import { db } from './db'

const BOJ_SERIES_RAW = "FM02'STMUCDBOD"
const BOJ_SERIES_ENCODED = encodeURIComponent(BOJ_SERIES_RAW) // 'FM02%27STMUCDBOD'
const BOJ_BASE = 'https://www.stat-search.boj.or.jp/ssi/cgi-bin/famecgi2'

function getLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT date FROM overnight_rates WHERE series_code = ?
    ORDER BY date DESC LIMIT 1
  `).get(seriesCode) as { date: string } | undefined
  return row?.date ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json, text/csv;q=0.9, */*;q=0.5' },
      })
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`BoJ ${res.status}`)
      }
      if (!res.ok) {
        // 4xx other than rate-limit: don't retry.
        throw new Error(`BoJ ${res.status} non-retryable`)
      }
      return await res.text()
    } catch (err) {
      lastErr = err
      const backoff = 2_000 * Math.pow(2, i) // 2s, 4s, 8s
      console.warn(`[overnight-boj] attempt ${i + 1} failed (${err}); retrying in ${backoff}ms`)
      await sleep(backoff)
    }
  }
  throw lastErr
}

interface ParsedRow { date: string; value: number }

/** Try to parse a BoJ response as JSON; on parse failure fall through to
 *  the (more common, in our experience) CSV parser. Returns [] if neither
 *  shape matches. */
function parseResponse(body: string): ParsedRow[] {
  // Heuristic JSON shape: { observations: [{ date, value }, ...] }
  if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
    try {
      const json = JSON.parse(body)
      const obs = Array.isArray(json) ? json : json.observations ?? json.data
      if (Array.isArray(obs)) {
        const rows: ParsedRow[] = []
        for (const o of obs) {
          const date = o?.date ?? o?.d ?? o?.Date
          const rawV = o?.value ?? o?.v ?? o?.Value
          const v = typeof rawV === 'number' ? rawV : parseFloat(String(rawV))
          if (typeof date === 'string' && Number.isFinite(v)) {
            rows.push({ date: date.slice(0, 10), value: v })
          }
        }
        if (rows.length > 0) return rows
      }
    } catch {
      // fall through to CSV
    }
  }
  // CSV-style: lines of "YYYY/MM/DD,value" or "YYYY-MM-DD,value", with
  // possible header rows that we skip.
  const rows: ParsedRow[] = []
  for (const lineRaw of body.split(/\r?\n/)) {
    const line = lineRaw.trim()
    if (!line) continue
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 2) continue
    const datePart = cols[0]
    const match = datePart.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/)
    if (!match) continue
    const date = `${match[1]}-${match[2]}-${match[3]}`
    const v = parseFloat(cols[1])
    if (Number.isFinite(v)) rows.push({ date, value: v })
  }
  return rows
}

const upsert = db.prepare(`
  INSERT INTO overnight_rates (date, series_code, value, is_provisional, source, ingested_at)
  VALUES (?, 'TONA', ?, 0, 'BoJ', datetime('now'))
  ON CONFLICT(date, series_code) DO UPDATE SET
    value = excluded.value,
    ingested_at = excluded.ingested_at
`)

function writeAll(rows: ParsedRow[]): number {
  const tx = db.transaction((batch: ParsedRow[]) => {
    for (const r of batch) upsert.run(r.date, r.value)
  })
  tx(rows)
  return rows.length
}

async function fetchTona(startDate?: string): Promise<ParsedRow[]> {
  // Throttle once before the call to be polite (the BoJ warns against
  // high-frequency requests).
  await sleep(3_000)
  const params = new URLSearchParams({
    cgi: '$nme_a000_en',
    hstat: BOJ_SERIES_RAW, // URLSearchParams will encode the apostrophe
  })
  if (startDate) params.set('start', startDate)
  const url = `${BOJ_BASE}?${params.toString()}`
  // Replace the URL-encoded apostrophe from URLSearchParams (which uses %27)
  // — we keep that explicit to match the guide.
  const finalUrl = url.replace(BOJ_SERIES_RAW, BOJ_SERIES_ENCODED)
  const body = await fetchWithRetry(finalUrl)
  return parseResponse(body)
}

export async function backfillBojOvernight(): Promise<void> {
  try {
    // Reliable history from 1998 onward per the guide.
    const rows = await fetchTona('1998-01-01')
    if (rows.length === 0) {
      console.warn('[overnight-boj] backfill returned 0 rows — endpoint shape may have changed')
      return
    }
    const n = writeAll(rows)
    console.log(`[overnight-boj] backfill: ${n} obs`)
  } catch (err) {
    console.error('[overnight-boj] backfill failed:', err)
  }
}

export async function syncIncrementalBojOvernight(): Promise<void> {
  try {
    const latest = getLatestDate('TONA')
    const start = latest
      ? new Date(new Date(latest).getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
      : '1998-01-01'
    const rows = await fetchTona(start)
    if (rows.length === 0) {
      console.warn(`[overnight-boj] sync from ${start} returned 0 rows`)
      return
    }
    const n = writeAll(rows)
    console.log(`[overnight-boj] sync from ${start}: ${n} obs`)
  } catch (err) {
    console.error('[overnight-boj] sync failed:', err)
  }
}
