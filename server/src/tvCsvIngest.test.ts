// Integration: processFile writes captured_at = file mtime, and re-ingesting a
// later file refreshes values AND captured_at through the ON CONFLICT upsert
// (no extra rows). Temp SQLite DB + temp drop folder.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MON = 1792364400  // Mon 19 Oct 2026 (London-midnight epoch)
const TUE = 1792450800  // Tue 20 Oct 2026
const CAPTURE_1 = Date.UTC(2026, 9, 20, 17) / 1000   // Tue 12:00 CT (intraday)
const CAPTURE_2 = Date.UTC(2026, 9, 21, 0) / 1000    // Tue 19:00 CT (post-close)

let tmpDb: string
let drop: string
let db: typeof import('./db').db
let processFile: typeof import('./tvCsvIngest').processFile

function writeExport(name: string, rows: Array<[number, number, number, number]>, mtime: number): string {
  const lines = ['time,open,high,low,close,US10Y,SR3Z6', ...rows.map(([t, c, us, sr]) => `${t},${c},${c},${c},${c},${us},${sr}`)]
  const p = path.join(drop, name)
  fs.writeFileSync(p, lines.join('\n'))
  fs.utimesSync(p, mtime, mtime)
  return p
}

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`
  tmpDb = path.join(os.tmpdir(), `tv-ingest-test-${stamp}.db`)
  drop = fs.mkdtempSync(path.join(os.tmpdir(), `tv-drop-${stamp}-`))
  process.env.DB_PATH = tmpDb
  process.env.TV_DROP_FOLDER = drop
  ;({ db } = await import('./db'))
  ;({ processFile } = await import('./tvCsvIngest'))
})

afterAll(() => {
  db.close()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) fs.rmSync(f, { force: true })
  fs.rmSync(drop, { recursive: true, force: true })
})

const seriesRows = () => db.prepare(`SELECT symbol, time, close, captured_at FROM tv_series ORDER BY symbol, CAST(time AS INTEGER)`).all() as Array<{ symbol: string; time: string; close: number; captured_at: number }>
const ohlcvRows = () => db.prepare(`SELECT time, close, captured_at FROM tv_ohlcv ORDER BY CAST(time AS INTEGER)`).all() as Array<{ time: string; close: number; captured_at: number }>

describe('tvCsvIngest — captured_at', () => {
  it('first (intraday) file: every written bar carries the file mtime', async () => {
    await processFile(writeExport('TVC_US03MY, 1D_aaaaa.csv', [[MON, 4.10, 4.00, 96.10], [TUE, 4.12, 4.05, 96.20]], CAPTURE_1))
    expect(seriesRows().map(r => r.captured_at)).toEqual([CAPTURE_1, CAPTURE_1, CAPTURE_1, CAPTURE_1])
    expect(ohlcvRows().map(r => r.captured_at)).toEqual([CAPTURE_1, CAPTURE_1])
    expect(fs.existsSync(path.join(drop, 'archive', 'TVC_US03MY, 1D_aaaaa.csv'))).toBe(true)
  }, 20_000)

  it('later (post-close) file: same rows upserted — values and captured_at refreshed, no new rows', async () => {
    await processFile(writeExport('TVC_US03MY, 1D_bbbbb.csv', [[MON, 4.10, 4.00, 96.10], [TUE, 4.15, 4.07, 96.25]], CAPTURE_2))
    const s = seriesRows()
    expect(s).toHaveLength(4)
    expect(s.map(r => r.captured_at)).toEqual([CAPTURE_2, CAPTURE_2, CAPTURE_2, CAPTURE_2])
    expect(s.find(r => r.symbol === 'US10Y' && Number(r.time) === TUE)?.close).toBe(4.07)
    expect(s.find(r => r.symbol === 'SR3Z6' && Number(r.time) === TUE)?.close).toBe(96.25)
    const o = ohlcvRows()
    expect(o).toHaveLength(2)
    expect(o.map(r => r.captured_at)).toEqual([CAPTURE_2, CAPTURE_2])
    expect(o[1].close).toBe(4.15)
  }, 20_000)
})

describe('tvCsvIngest — a failed stat rejects the file (R2)', () => {
  it('writes nothing, logs an error with the path, and leaves the file in place', async () => {
    const counts = () => ({
      series: (db.prepare('SELECT COUNT(*) AS n, SUM(captured_at) AS c, SUM(close) AS v FROM tv_series').get() as object),
      ohlcv: (db.prepare('SELECT COUNT(*) AS n, SUM(captured_at) AS c, SUM(close) AS v FROM tv_ohlcv').get() as object),
      log: (db.prepare('SELECT COUNT(*) AS n FROM tv_ingest_log').get() as object),
    })
    const before = counts()
    const p = writeExport('TVC_US03MY, 1D_ccccc.csv', [[MON, 9.99, 9.99, 99.99], [TUE, 9.99, 9.99, 99.99]], CAPTURE_2 + 3600)
    const realStat = fs.statSync
    const stat = vi.spyOn(fs, 'statSync').mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
      if (String(target) === p) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return (realStat as (...a: unknown[]) => fs.Stats)(target, ...rest)
    }) as typeof fs.statSync)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await processFile(p)
    } finally {
      stat.mockRestore()
    }
    expect(counts()).toEqual(before)
    expect(fs.existsSync(p)).toBe(true)
    expect(fs.existsSync(path.join(drop, 'archive', 'TVC_US03MY, 1D_ccccc.csv'))).toBe(false)
    expect(String(err.mock.calls.at(-1)?.[0])).toContain(p)
    err.mockRestore()
  }, 20_000)
})
