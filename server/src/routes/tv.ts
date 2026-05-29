import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { db } from '../db'
import { getIngestLog } from '../tvCsvIngest'

export const tvRouter = Router()

const DROP_FOLDER = process.env.TV_DROP_FOLDER ?? path.join(os.homedir(), 'tradingview-drops')
const ARCHIVE_FOLDER = path.join(DROP_FOLDER, 'archive')

// ── GET /api/tv/ohlcv/:symbol ────────────────────────────────────────────────

tvRouter.get('/ohlcv/:symbol', (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)
  const timeframe = String(req.query.timeframe || '1D')
  const from = req.query.from ? String(req.query.from) : undefined
  const to = req.query.to ? String(req.query.to) : undefined
  const limit = Math.min(parseInt(String(req.query.limit || '500')), 5000)

  const params: (string | number)[] = [symbol, timeframe]
  let sql = 'SELECT time, open, high, low, close, volume FROM tv_ohlcv WHERE symbol = ? AND timeframe = ?'

  if (from) { sql += ' AND time >= ?'; params.push(from) }
  if (to) { sql += ' AND time <= ?'; params.push(to) }

  sql += ' ORDER BY time ASC LIMIT ?'
  params.push(limit)

  const data = db.prepare(sql).all(...params) as Array<{
    time: string; open: number; high: number; low: number; close: number; volume: number
  }>

  res.json({ symbol, timeframe, count: data.length, data })
})

// ── GET /api/tv/series/:symbol ───────────────────────────────────────────────

tvRouter.get('/series/:symbol', (req: Request, res: Response) => {
  const symbol = String(req.params.symbol)
  const from = req.query.from ? String(req.query.from) : undefined
  const to = req.query.to ? String(req.query.to) : undefined
  // Cap raised to 50000 so the VOL tab can pull SPX/VIX full history at once
  // (SPX has ~18k daily bars in tv_series; the old 5000-row ASC cap clipped the
  // most recent data — exactly the part every chart needs).
  const limit = Math.min(parseInt(String(req.query.limit || '500')), 50000)

  const params: (string | number)[] = [symbol]
  let sql = 'SELECT time, close FROM tv_series WHERE symbol = ?'

  if (from) { sql += ' AND time >= ?'; params.push(from) }
  if (to) { sql += ' AND time <= ?'; params.push(to) }

  sql += ' ORDER BY time ASC LIMIT ?'
  params.push(limit)

  const data = db.prepare(sql).all(...params) as Array<{ time: string; close: number }>

  res.json({ symbol, count: data.length, data })
})

// ── GET /api/tv/symbols ──────────────────────────────────────────────────────

interface SymbolInfo {
  symbol: string
  type: 'ohlcv' | 'series'
  from: string
  to: string
  rowCount: number
}

tvRouter.get('/symbols', (_req: Request, res: Response) => {
  const ohlcvRows = db.prepare(`
    SELECT symbol,
           MIN(time) AS "from",
           MAX(time) AS "to",
           COUNT(*) AS rowCount
    FROM tv_ohlcv
    GROUP BY symbol
    ORDER BY symbol ASC
  `).all() as Array<{ symbol: string; from: string; to: string; rowCount: number }>

  const seriesRows = db.prepare(`
    SELECT symbol,
           MIN(time) AS "from",
           MAX(time) AS "to",
           COUNT(*) AS rowCount
    FROM tv_series
    GROUP BY symbol
    ORDER BY symbol ASC
  `).all() as Array<{ symbol: string; from: string; to: string; rowCount: number }>

  const result: SymbolInfo[] = []

  for (const row of ohlcvRows) {
    result.push({ symbol: row.symbol, type: 'ohlcv', from: row.from, to: row.to, rowCount: row.rowCount })
  }

  for (const row of seriesRows) {
    result.push({ symbol: row.symbol, type: 'series', from: row.from, to: row.to, rowCount: row.rowCount })
  }

  result.sort((a, b) => a.symbol.localeCompare(b.symbol))

  res.json(result)
})

// ── GET /api/tv/ingest-log ───────────────────────────────────────────────────

tvRouter.get('/ingest-log', (_req: Request, res: Response) => {
  res.json(getIngestLog())
})

// ── POST /api/tv/reingest ────────────────────────────────────────────────────

tvRouter.post('/reingest', (req: Request, res: Response) => {
  const { filename } = req.body as { filename?: string }
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename is required' })
    return
  }

  // Sanitize: only allow basenames, no path traversal
  const base = path.basename(filename)
  const archivePath = path.join(ARCHIVE_FOLDER, base)

  if (!fs.existsSync(archivePath)) {
    res.status(404).json({ error: `File not found in archive: ${base}` })
    return
  }

  const destPath = path.join(DROP_FOLDER, base)
  fs.renameSync(archivePath, destPath)
  res.json({ status: 'queued' })
})
