// Bank of Japan TONA collector — direct scrape of BoJ's daily Mutan files.
//
// Replaces an earlier subprocess wrapper around the `bojdata` Python package,
// which couldn't actually fetch IR01 (its CGI URL pattern hits BoJ's "Page
// cannot be displayed" error). Instead we read BoJ's own publication pages:
//
//   Current format (≥ 2025-10-03) — XLSX:
//     index :  https://www.boj.or.jp/en/statistics/market/short/mutan/d_release/md/{YYYY}/index.htm
//     leaf  :  https://www.boj.or.jp/en/statistics/market/short/mutan/d_release/md/{YYYY}/md{YYYYMMDD}.xlsx
//   Legacy format (≤ 2025-10-02) — HTML:
//     index :  https://www3.boj.or.jp/market/en/menuold_m_{YYYY}.htm
//     leaf  :  https://www3.boj.or.jp/market/en/stat/md{YYMMDD}.htm   (2-digit year)
//
// Empirical archive depth as of 2026-05: 2025 (both legacy + current) and 2026
// (current only). Earlier years return 404 on both URL patterns. The collector
// adapts automatically — `discoverYearLinks` enumerates whatever links the
// index pages actually publish.
//
// Public interface (unchanged from before so server/src/index.ts wiring doesn't
// need touching): backfillBojOvernight() and syncIncrementalBojOvernight().

import * as XLSX from 'xlsx'
import { db } from './db'

// ── Constants ──────────────────────────────────────────────────────────────

const FORMAT_CUTOVER = '2025-10-03' // first date with XLSX (current format)
const CURRENT_INDEX_URL = (y: number) =>
  `https://www.boj.or.jp/en/statistics/market/short/mutan/d_release/md/${y}/index.htm`
const CURRENT_LEAF_URL = (y: number, ymd: string) =>
  `https://www.boj.or.jp/en/statistics/market/short/mutan/d_release/md/${y}/md${ymd}.xlsx`
const LEGACY_INDEX_URL = (y: number) =>
  `https://www3.boj.or.jp/market/en/menuold_m_${y}.htm`
const LEGACY_LEAF_URL = (yymmdd: string) =>
  `https://www3.boj.or.jp/market/en/stat/md${yymmdd}.htm`

const CONCURRENCY = 4
const BATCH_DELAY_MS = 150
const FETCH_TIMEOUT_MS = 30_000
const HTTP_RETRY_ON_5XX_OR_NET = 1
const HTTP_RETRY_DELAY_MS = 5_000

// Earliest year to probe when discovering year-index pages. Stop walking back
// once two consecutive years 404 on both formats — BoJ's archive doesn't go
// far back via these URLs.
const PROBE_OLDEST_YEAR = 2018

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function ymd8(date: string): string {
  // 'YYYY-MM-DD' → 'YYYYMMDD'
  return date.replace(/-/g, '')
}

function ymd6(date: string): string {
  // 'YYYY-MM-DD' → 'YYMMDD'
  return date.slice(2).replace(/-/g, '')
}

function fromYmd8(s: string): string {
  // 'YYYYMMDD' → 'YYYY-MM-DD'
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function fromYmd6(s: string): string {
  // 'YYMMDD' → 'YYYY-MM-DD'  (BoJ legacy uses 2-digit year; all archive entries are 20YY)
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`
}

async function fetchText(url: string): Promise<string | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (res.status === 404) return null
    if (!res.ok) {
      if (res.status >= 500) {
        // single retry on 5xx
        await sleep(HTTP_RETRY_DELAY_MS)
        const res2 = await fetch(url)
        if (!res2.ok) return null
        return await res2.text()
      }
      return null
    }
    return await res.text()
  } catch (err) {
    // network error — single retry
    if (HTTP_RETRY_ON_5XX_OR_NET > 0) {
      await sleep(HTTP_RETRY_DELAY_MS)
      try {
        const res2 = await fetch(url)
        if (!res2.ok) return null
        return await res2.text()
      } catch {
        return null
      }
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (res.status === 404) return null
    if (!res.ok) {
      if (res.status >= 500) {
        await sleep(HTTP_RETRY_DELAY_MS)
        const res2 = await fetch(url)
        if (!res2.ok) return null
        return await res2.arrayBuffer()
      }
      return null
    }
    return await res.arrayBuffer()
  } catch {
    await sleep(HTTP_RETRY_DELAY_MS)
    try {
      const res2 = await fetch(url)
      if (!res2.ok) return null
      return await res2.arrayBuffer()
    } catch {
      return null
    }
  } finally {
    clearTimeout(timer)
  }
}

// ── XLSX parser (current format, ≥ 2025-10-03) ─────────────────────────────
//
// File layout (confirmed by probing md20260519.xlsx):
//   Sheet: 'コール' (only sheet)
//   Range: A1:L33
//   Row 9 (1-indexed 10):  [_, 'Average', <value>, ...]
//   Row 10 (1-indexed 11): [_, 'Maximum', ...]
//   Row 11 (1-indexed 12): [_, 'Minimum', ...]
//
// We locate the Average row by matching its label cell rather than hard-coding
// the row index, so a future BoJ layout tweak doesn't silently break us.

async function parseXlsxFile(url: string): Promise<number | null> {
  const buf = await fetchArrayBuffer(url)
  if (!buf) return null
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array' })
  } catch (err) {
    console.warn(`[overnight-boj] xlsx parse error for ${url}:`, err)
    return null
  }
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return null
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    // BoJ stacks Japanese + English in a single cell like '平均\r\nAverage'.
    const label = row[1]
    if (typeof label === 'string' && /Average/i.test(label)) {
      const v = row[2]
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const f = parseFloat(v)
        if (Number.isFinite(f)) return f
      }
      return null
    }
  }
  return null
}

// ── HTML parser (legacy format, ≤ 2025-10-02) ──────────────────────────────
//
// File layout (confirmed by probing md251002.htm):
//   <li><STRONG>[Avg.]</STRONG> <SPAN class="...">0.477%</SPAN></li>
//
// We extract the first percentage value after the `[Avg.]` marker. The regex
// tolerates bold/non-bold markup and surrounding whitespace.

const AVG_RE = /\[Avg\.\][\s\S]*?(-?\d+(?:\.\d+)?)\s*%/i

async function parseHtmlFile(url: string): Promise<number | null> {
  const text = await fetchText(url)
  if (text == null) return null
  const m = text.match(AVG_RE)
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) ? v : null
}

// ── Year-index discovery ───────────────────────────────────────────────────

interface DateLink {
  date: string  // YYYY-MM-DD
  url: string
  format: 'xlsx' | 'html'
}

async function discoverCurrent(year: number): Promise<DateLink[]> {
  const html = await fetchText(CURRENT_INDEX_URL(year))
  if (!html) return []
  const matches = html.match(/md(\d{8})\.xlsx/g) ?? []
  const out = new Map<string, DateLink>()
  for (const m of matches) {
    const ymd = m.slice(2, 10)
    out.set(ymd, {
      date: fromYmd8(ymd),
      url: CURRENT_LEAF_URL(year, ymd),
      format: 'xlsx',
    })
  }
  return Array.from(out.values())
}

async function discoverLegacy(year: number): Promise<DateLink[]> {
  const html = await fetchText(LEGACY_INDEX_URL(year))
  if (!html) return []
  const matches = html.match(/md(\d{6})\.htm/g) ?? []
  const out = new Map<string, DateLink>()
  for (const m of matches) {
    const yymmdd = m.slice(2, 8)
    out.set(yymmdd, {
      date: fromYmd6(yymmdd),
      url: LEGACY_LEAF_URL(yymmdd),
      format: 'html',
    })
  }
  return Array.from(out.values())
}

async function discoverAllLinks(fromYear: number, toYear: number): Promise<DateLink[]> {
  // Probe every year in [fromYear, toYear] for BOTH formats. When the current-
  // format index supplies a date that the legacy index also covers (the Sept-Oct
  // 2025 transition), keep the XLSX entry. Years that 404 on both indexes are
  // beyond BoJ's archive; the loop just yields zero entries for them.
  const byDate = new Map<string, DateLink>()
  for (let y = fromYear; y <= toYear; y++) {
    const [cur, leg] = await Promise.all([discoverCurrent(y), discoverLegacy(y)])
    for (const link of leg) {
      if (!byDate.has(link.date)) byDate.set(link.date, link)
    }
    // current format wins on overlap.
    for (const link of cur) byDate.set(link.date, link)
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ── Database ───────────────────────────────────────────────────────────────

const upsert = db.prepare(`
  INSERT INTO overnight_rates (date, series_code, value, is_provisional, source, ingested_at)
  VALUES (?, 'TONA', ?, 0, 'BoJ', datetime('now'))
  ON CONFLICT(date, series_code) DO UPDATE SET
    value = excluded.value,
    is_provisional = excluded.is_provisional,
    source = excluded.source,
    ingested_at = excluded.ingested_at
`)

function getLatestBojDate(): string | null {
  const row = db.prepare(`
    SELECT date FROM overnight_rates
    WHERE series_code = 'TONA' AND source = 'BoJ' AND is_provisional = 0
    ORDER BY date DESC LIMIT 1
  `).get() as { date: string } | undefined
  return row?.date ?? null
}

function writeBatch(rows: Array<{ date: string; value: number }>): number {
  const tx = db.transaction((batch: typeof rows) => {
    for (const r of batch) upsert.run(r.date, r.value)
  })
  tx(rows)
  return rows.length
}

// ── Throttled batch fetcher ────────────────────────────────────────────────
//
// Pulls leaf files at a small concurrency cap with a brief delay between
// batches. The BoJ servers are small; this is polite without being slow
// (~1.5k requests at 4-way concurrency + 150ms gap ≈ 1 min). Errors are
// counted but never throw — the whole backfill keeps going.

interface FetchResult {
  date: string
  value: number | null
  err?: string
}

async function fetchAllValues(
  links: DateLink[],
  onProgress: (done: number, total: number, ok: number, miss: number) => void,
): Promise<FetchResult[]> {
  const out: FetchResult[] = []
  let i = 0
  let ok = 0
  let miss = 0
  while (i < links.length) {
    const batch = links.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (link): Promise<FetchResult> => {
      try {
        const v = link.format === 'xlsx'
          ? await parseXlsxFile(link.url)
          : await parseHtmlFile(link.url)
        if (v == null) return { date: link.date, value: null, err: 'no-value' }
        return { date: link.date, value: v }
      } catch (err) {
        return { date: link.date, value: null, err: err instanceof Error ? err.message : String(err) }
      }
    }))
    for (const r of results) {
      out.push(r)
      if (r.value != null) ok++; else miss++
    }
    i += CONCURRENCY
    if (i < links.length) {
      onProgress(i, links.length, ok, miss)
      await sleep(BATCH_DELAY_MS)
    }
  }
  onProgress(links.length, links.length, ok, miss)
  return out
}

// ── Public entry points ────────────────────────────────────────────────────

export async function backfillBojOvernight(): Promise<void> {
  try {
    const thisYear = new Date().getUTCFullYear()
    const links = await discoverAllLinks(PROBE_OLDEST_YEAR, thisYear)
    if (links.length === 0) {
      console.warn('[overnight-boj] backfill: 0 date links discovered — BoJ index pages may be unreachable')
      return
    }
    console.log(`[overnight-boj] backfill: discovered ${links.length} dates (${links[0].date} → ${links[links.length - 1].date})`)
    const results = await fetchAllValues(links, (done, total, ok, miss) => {
      if (done === total || done % 100 === 0) {
        console.log(`[overnight-boj] progress: ${done}/${total} (ok=${ok} miss=${miss})`)
      }
    })
    const rows = results
      .filter((r): r is FetchResult & { value: number } => r.value != null)
      .map(r => ({ date: r.date, value: r.value }))
    const n = writeBatch(rows)
    const miss = results.length - rows.length
    console.log(`[overnight-boj] backfill: wrote ${n} rows · skipped ${miss}`)
  } catch (err) {
    console.error('[overnight-boj] backfill failed:', err instanceof Error ? err.message : err)
  }
}

export async function syncIncrementalBojOvernight(): Promise<void> {
  try {
    const latest = getLatestBojDate()
    const today = isoToday()
    // Walk back 1 day from latest to catch BoJ's provisional → final flip.
    // First sync (no prior BoJ rows): start at FORMAT_CUTOVER so incremental
    // runs are always in the XLSX era.
    let start: string
    if (latest) {
      const lookback = new Date(new Date(latest + 'T00:00:00Z').getTime() - 86_400_000)
      start = lookback.toISOString().slice(0, 10)
    } else {
      start = FORMAT_CUTOVER
    }
    if (start > today) return

    // Incremental runs only ever touch the current-format era. Fetch the
    // year-index pages covering [start, today] and trim to the window.
    const startYear = Number(start.slice(0, 4))
    const endYear = Number(today.slice(0, 4))
    const allLinks: DateLink[] = []
    for (let y = startYear; y <= endYear; y++) {
      allLinks.push(...await discoverCurrent(y))
    }
    const links = allLinks
      .filter(l => l.date >= start && l.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (links.length === 0) {
      console.log(`[overnight-boj] sync: nothing new from ${start}`)
      return
    }
    const results = await fetchAllValues(links, () => {})
    const rows = results
      .filter((r): r is FetchResult & { value: number } => r.value != null)
      .map(r => ({ date: r.date, value: r.value }))
    const n = writeBatch(rows)
    const miss = results.length - rows.length
    console.log(`[overnight-boj] sync from ${start}: wrote ${n} rows · skipped ${miss}`)
  } catch (err) {
    console.error('[overnight-boj] sync failed:', err instanceof Error ? err.message : err)
  }
}
