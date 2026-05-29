import fs from 'fs'
import path from 'path'
import os from 'os'
import chokidar, { FSWatcher } from 'chokidar'
import { parse } from 'csv-parse/sync'
import { db } from './db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface IngestLogEntry {
  id: number
  filename: string
  symbol: string | null
  timeframe: string | null
  rowsIngested: number | null
  status: string
  errorMessage: string | null
  ingestedAt: string
}

interface OhlcvRow {
  symbol: string
  timeframe: string
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface SeriesRow {
  symbol: string
  time: string
  close: number
}

interface ParseResult {
  ohlcvRows: OhlcvRow[]
  seriesRows: SeriesRow[]
  seriesTickers: string[]
}

// ── Paths ────────────────────────────────────────────────────────────────────

const DROP_FOLDER = process.env.TV_DROP_FOLDER ?? path.join(os.homedir(), 'tradingview-drops')
const ARCHIVE_FOLDER = path.join(DROP_FOLDER, 'archive')
const ERROR_FOLDER = path.join(DROP_FOLDER, 'errors')

// ── Config ───────────────────────────────────────────────────────────────────

// TradingView CSVs include a "today" bar even for sessions that haven't ticked
// yet, copying the prior close. Default-on detection drops that duplicate tip
// before it lands in tv_series. See docs in CLAUDE.md.
const SKIP_STALE_TIPS =
  (process.env.TV_INGEST_SKIP_STALE_TIPS ?? 'true').toLowerCase() !== 'false'

// Known TradingView export prefixes. Only files whose names begin with one of
// these are processed; anything else in the drop folder is left in place (not
// parsed, not archived). The watcher/poll itself still scans every CSV — the
// filter only gates handing files off to processFile(). Adding a new TV export
// later is a one-line addition to this array.
const TV_EXPORT_PREFIXES = ['TVC_US03MY', 'TVC_US01MY'] as const

function isKnownTvExport(filename: string): boolean {
  return TV_EXPORT_PREFIXES.some(p => filename.startsWith(p))
}

// ── Prepared statements ──────────────────────────────────────────────────────

const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO tv_ohlcv (symbol, timeframe, time, open, high, low, close, volume, ingested_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`)

const upsertSeriesStmt = db.prepare(`
  INSERT OR REPLACE INTO tv_series (symbol, time, close, source_file, ingested_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`)

const logStmt = db.prepare(`
  INSERT INTO tv_ingest_log (filename, symbol, timeframe, rows_ingested, status, error_message)
  VALUES (?, ?, ?, ?, ?, ?)
`)

// ── Filename parsing ─────────────────────────────────────────────────────────

function parseFilename(filename: string): { symbol: string; timeframe: string } | null {
  const base = filename.replace(/\.csv$/i, '')
  const sepIdx = base.lastIndexOf(', ')
  if (sepIdx === -1) return null
  const rawSymbol = base.slice(0, sepIdx).trim()
  const rawTf = base.slice(sepIdx + 2).trim()
  if (!rawSymbol || !rawTf) return null
  const tfMatch = rawTf.match(/^(\d*[DHWM]|\d+)/i)
  if (!tfMatch) return null
  const symbol = rawSymbol.replace(/_/g, ':')
  return { symbol, timeframe: tfMatch[1].toUpperCase() }
}

// ── CSV parsing ──────────────────────────────────────────────────────────────

function parseCsv(content: string, symbol: string, timeframe: string): ParseResult {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  if (records.length === 0) return { ohlcvRows: [], seriesRows: [], seriesTickers: [] }

  const firstRow = records[0]
  const knownKeys = new Set(['time', 'open', 'high', 'low', 'close', 'volume'])

  // Build a case-insensitive column lookup
  const colMap = new Map<string, string>()
  for (const key of Object.keys(firstRow)) {
    colMap.set(key.toLowerCase(), key)
  }

  const get = (row: Record<string, string>, field: string): string | undefined => {
    const actualKey = colMap.get(field)
    return actualKey ? row[actualKey] : undefined
  }

  // Identify series columns: skip OHLCV keys and any "datetime" separator columns
  const seriesCols: string[] = []
  for (const key of Object.keys(firstRow)) {
    if (knownKeys.has(key.toLowerCase())) continue
    if (key.toLowerCase() === 'datetime') continue
    seriesCols.push(key)
  }

  if (seriesCols.length > 0) {
    console.log(`[tv-ingest] Series columns detected: ${seriesCols.join(', ')}`)
  }

  const isDaily = ['1D', '1W', '1M', 'D', 'W', 'M'].includes(timeframe)
  const ohlcvRows: OhlcvRow[] = []
  const seriesRows: SeriesRow[] = []

  for (const rec of records) {
    const rawTime = get(rec, 'time')
    if (!rawTime) continue

    // Normalize time
    const time = isDaily ? rawTime.slice(0, 10) : rawTime

    // Primary OHLCV
    const rawClose = get(rec, 'close')
    if (rawClose) {
      const closeVal = parseFloat(rawClose)
      if (!isNaN(closeVal) && closeVal !== 0) {
        ohlcvRows.push({
          symbol,
          timeframe,
          time,
          open: parseFloat(get(rec, 'open') ?? '') || 0,
          high: parseFloat(get(rec, 'high') ?? '') || 0,
          low: parseFloat(get(rec, 'low') ?? '') || 0,
          close: closeVal,
          volume: Math.round(parseFloat(get(rec, 'volume') ?? '') || 0),
        })
      }
    }

    // Additional series columns
    for (const col of seriesCols) {
      const val = rec[col]
      if (val === undefined || val === null || val === '') continue
      const num = parseFloat(val)
      if (isNaN(num)) continue
      seriesRows.push({ symbol: col, time, close: num })
    }
  }

  return { ohlcvRows, seriesRows, seriesTickers: seriesCols }
}

// ── Upsert ───────────────────────────────────────────────────────────────────

function upsertRows(rows: OhlcvRow[]): void {
  db.transaction(() => {
    for (const r of rows) {
      upsertStmt.run(r.symbol, r.timeframe, r.time, r.open, r.high, r.low, r.close, r.volume)
    }
  })()
}

function upsertSeriesRows(rows: SeriesRow[], sourceFile: string): void {
  db.transaction(() => {
    for (const r of rows) {
      upsertSeriesStmt.run(r.symbol, r.time, r.close, sourceFile)
    }
  })()
}

// ── Stale-tip detection ──────────────────────────────────────────────────────
// Drop the absolute latest row per symbol when its close exactly equals the
// next-most-recent prior close (either earlier in the same CSV, or already in
// tv_series). Only the absolute tip is eligible — historical flat closes are
// preserved.

interface StaleTipSkip {
  symbol: string
  latestTime: string
  latestClose: number
  priorTime: string
  priorClose: number
}

const findDbPriorStmt = db.prepare(`
  SELECT time, close FROM tv_series
  WHERE symbol = ?
    AND CAST(time AS INTEGER) < CAST(? AS INTEGER)
    AND close IS NOT NULL
  ORDER BY CAST(time AS INTEGER) DESC, time DESC
  LIMIT 1
`)

function formatStaleTime(t: string): string {
  const n = Number(t)
  if (Number.isFinite(n) && n > 1e9 && t.length <= 12) {
    return new Date(n * 1000).toISOString().slice(0, 10)
  }
  return t
}

function detectStaleTips(rows: SeriesRow[]): { kept: SeriesRow[]; skips: StaleTipSkip[] } {
  if (rows.length === 0) return { kept: rows, skips: [] }

  const bySymbol = new Map<string, SeriesRow[]>()
  for (const r of rows) {
    const arr = bySymbol.get(r.symbol)
    if (arr) arr.push(r)
    else bySymbol.set(r.symbol, [r])
  }

  const skipKeys = new Set<string>() // `${symbol}|${time}`
  const skips: StaleTipSkip[] = []

  // Sort numerically. tv_series stores `time` as either a unix-epoch string or
  // an ISO date — Number(date) yields NaN for ISO dates, so fall back to
  // lexicographic compare in that case (which matches calendar order for ISO).
  const cmpTime = (a: string, b: string): number => {
    const na = Number(a), nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a < b ? -1 : a > b ? 1 : 0
  }

  for (const [sym, arr] of bySymbol) {
    let latest = arr[0]
    let secondInCsv: SeriesRow | undefined
    for (let i = 1; i < arr.length; i++) {
      if (cmpTime(arr[i].time, latest.time) > 0) {
        secondInCsv = latest
        latest = arr[i]
      } else if (cmpTime(arr[i].time, latest.time) < 0) {
        if (!secondInCsv || cmpTime(arr[i].time, secondInCsv.time) > 0) {
          secondInCsv = arr[i]
        }
      }
    }

    let priorTime: string | undefined
    let priorClose: number | undefined
    if (secondInCsv) {
      priorTime = secondInCsv.time
      priorClose = secondInCsv.close
    }
    const dbPrior = findDbPriorStmt.get(sym, latest.time) as { time: string; close: number } | undefined
    if (dbPrior && (!priorTime || cmpTime(dbPrior.time, priorTime) > 0)) {
      priorTime = dbPrior.time
      priorClose = dbPrior.close
    }

    if (priorTime !== undefined && priorClose !== undefined && priorClose === latest.close) {
      skips.push({
        symbol: sym,
        latestTime: latest.time,
        latestClose: latest.close,
        priorTime,
        priorClose,
      })
      skipKeys.add(`${sym}|${latest.time}`)
    }
  }

  if (skipKeys.size === 0) return { kept: rows, skips }
  const kept = rows.filter((r) => !skipKeys.has(`${r.symbol}|${r.time}`))
  return { kept, skips }
}

// ── File processing ──────────────────────────────────────────────────────────

const processing = new Set<string>()

async function processFile(filePath: string): Promise<void> {
  const filename = path.basename(filePath)

  if (processing.has(filePath)) return
  processing.add(filePath)

  try {
    console.log(`[tv-ingest] File detected: ${filename}`)

    // Wait for TradingView to finish writing
    await delay(2000)

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      console.log(`[tv-ingest] Cannot read file, retrying in 3s: ${filename}`)
      await delay(3000)
      try {
        content = fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[tv-ingest] Failed to read file: ${filename} — ${msg}`)
        logStmt.run(filename, null, null, null, 'error', `Cannot read file: ${msg}`)
        moveFile(filePath, ERROR_FOLDER)
        return
      }
    }

    // Parse filename
    const parsed = parseFilename(filename)
    if (!parsed) {
      console.warn(`[tv-ingest] Unrecognized filename format: ${filename}`)
      logStmt.run(filename, null, null, null, 'error', 'Unrecognized filename format')
      moveFile(filePath, ERROR_FOLDER)
      return
    }

    const { symbol, timeframe } = parsed
    console.log(`[tv-ingest] Parsing ${filename} → symbol=${symbol}, timeframe=${timeframe}`)

    // Parse CSV
    const { ohlcvRows, seriesRows, seriesTickers } = parseCsv(content, symbol, timeframe)
    if (ohlcvRows.length === 0 && seriesRows.length === 0) {
      console.warn(`[tv-ingest] No valid rows in ${filename}`)
      logStmt.run(filename, symbol, timeframe, 0, 'error', 'No valid rows')
      moveFile(filePath, ERROR_FOLDER)
      return
    }

    // Count existing OHLCV rows before upsert
    const countBefore = (db.prepare(
      'SELECT COUNT(*) as n FROM tv_ohlcv WHERE symbol = ? AND timeframe = ?'
    ).get(symbol, timeframe) as { n: number }).n

    if (ohlcvRows.length > 0) {
      upsertRows(ohlcvRows)
    }

    let seriesToWrite = seriesRows
    if (SKIP_STALE_TIPS && seriesRows.length > 0) {
      const { kept, skips } = detectStaleTips(seriesRows)
      seriesToWrite = kept
      if (skips.length > 0) {
        const symbolList = skips.map((s) => s.symbol).join(', ')
        console.log(
          `[tv-ingest] Stale-tip skips: ${skips.length} symbols had a stale tip dropped → [${symbolList}]`
        )
        for (const s of skips) {
          console.log(
            `[tv-ingest] [stale-tip] ${s.symbol} ${formatStaleTime(s.latestTime)} ` +
            `close=${s.latestClose} matches prior ${formatStaleTime(s.priorTime)} close=${s.priorClose} — skipping`
          )
        }
      } else {
        console.log('[tv-ingest] Stale-tip skips: 0')
      }
    }

    if (seriesToWrite.length > 0) {
      upsertSeriesRows(seriesToWrite, filename)
    }

    const countAfter = (db.prepare(
      'SELECT COUNT(*) as n FROM tv_ohlcv WHERE symbol = ? AND timeframe = ?'
    ).get(symbol, timeframe) as { n: number }).n

    const newRows = countAfter - countBefore
    const updatedRows = ohlcvRows.length - newRows

    const totalRows = ohlcvRows.length + seriesToWrite.length
    console.log(`[tv-ingest] Parsed ${ohlcvRows.length} rows. Primary OHLCV: ${symbol}. Series ingested: ${seriesTickers.length} tickers, ${seriesToWrite.length} data points`)
    console.log(`[tv-ingest] OHLCV: ${ohlcvRows.length} rows for ${symbol} ${timeframe}, ${newRows} new / ${updatedRows} updated`)
    logStmt.run(filename, symbol, timeframe, totalRows, 'success', null)

    // Archive
    moveFile(filePath, ARCHIVE_FOLDER)
    console.log(`[tv-ingest] Archived: ${filename}`)
  } finally {
    processing.delete(filePath)
  }
}

function moveFile(src: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(src))
  // If destination already exists, overwrite
  if (fs.existsSync(dest)) fs.unlinkSync(dest)
  fs.renameSync(src, dest)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Watcher ──────────────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const seenFiles = new Set<string>()
// Files that look like CSVs but don't match a known TV export prefix. Tracked
// separately so the 10-second poll doesn't log the same skip on every tick.
const seenUnknown = new Set<string>()

function scanFolder(): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(DROP_FOLDER)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.csv')) continue
    const filePath = path.join(DROP_FOLDER, name)
    if (seenFiles.has(filePath) || processing.has(filePath)) continue
    // Verify it's a file (not a directory)
    try { if (!fs.statSync(filePath).isFile()) continue } catch { continue }
    if (!isKnownTvExport(name)) {
      if (!seenUnknown.has(filePath)) {
        seenUnknown.add(filePath)
        console.log(`[tv-ingest] Ignoring unknown CSV (prefix not in [${TV_EXPORT_PREFIXES.join(', ')}]): ${name}`)
      }
      continue
    }
    seenFiles.add(filePath)
    console.log(`[tv-ingest] Poll scan found: ${name}`)
    processFile(filePath).catch(err =>
      console.error(`[tv-ingest] Unhandled error processing ${filePath}:`, err)
    )
  }
}

export function startTvCsvWatcher(): void {
  fs.mkdirSync(DROP_FOLDER, { recursive: true })
  fs.mkdirSync(ARCHIVE_FOLDER, { recursive: true })
  fs.mkdirSync(ERROR_FOLDER, { recursive: true })

  // Chokidar watcher (works reliably on Linux-native paths)
  watcher = chokidar.watch(path.join(DROP_FOLDER, '*.csv'), {
    usePolling: true,
    interval: 1000,
    depth: 0,
    ignoreInitial: false,
    awaitWriteFinish: false,
  })

  watcher.on('add', (filePath: string) => {
    if (path.dirname(filePath) !== DROP_FOLDER) return
    const name = path.basename(filePath)
    if (!isKnownTvExport(name)) {
      if (!seenUnknown.has(filePath)) {
        seenUnknown.add(filePath)
        console.log(`[tv-ingest] Ignoring unknown CSV (prefix not in [${TV_EXPORT_PREFIXES.join(', ')}]): ${name}`)
      }
      return
    }
    seenFiles.add(filePath)
    processFile(filePath).catch(err =>
      console.error(`[tv-ingest] Unhandled error processing ${filePath}:`, err)
    )
  })

  watcher.on('error', (err: unknown) => {
    console.error('[tv-ingest] Watcher error:', err)
  })

  // Manual scan on startup + periodic poll (WSL /mnt/c/ fallback)
  scanFolder()
  pollTimer = setInterval(scanFolder, 10_000)

  if (!SKIP_STALE_TIPS) {
    console.warn(
      '[tv-ingest] WARNING: TV_INGEST_SKIP_STALE_TIPS=false — duplicate "today" bars from TradingView CSVs will be ingested as-is.'
    )
  }

  console.log(`[tv-ingest] TV CSV watcher started, watching: ${DROP_FOLDER}`)
  console.log(`[tv-ingest] Accepting prefixes: [${TV_EXPORT_PREFIXES.join(', ')}]`)
}

export function stopTvCsvWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  console.log('[tv-ingest] TV CSV watcher stopped')
}

// ── Query helpers ────────────────────────────────────────────────────────────

export function getIngestLog(): IngestLogEntry[] {
  return db.prepare(`
    SELECT id, filename, symbol, timeframe,
           rows_ingested AS rowsIngested,
           status, error_message AS errorMessage,
           ingested_at AS ingestedAt
    FROM tv_ingest_log
    ORDER BY id DESC
    LIMIT 50
  `).all() as IngestLogEntry[]
}
