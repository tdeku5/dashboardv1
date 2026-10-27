// Guard: every TradingView bar read goes through the completed-bars helpers
// (docs/prompts/tv-completed-bars-prompt.md Phase 2; lib/tvRead.ts).
//
// Static scan of non-test server code. A SQL literal that reads tv_series /
// tv_ohlcv must
//   1. live in an APPROVED READER (or an ALLOWLISTED non-bar file), and
//   2. include `${tvVisible(…)}` / `${tvVisibleGlob(…)}`, or carry an explicit
//      marker comment just before it: `tv-raw-ok: <reason>` (not a bar value,
//      e.g. an existence check) or `tv-visible: <how>` (predicate built elsewhere).
// A new module that queries the tables directly fails here until it is routed
// through the helper and added to the list.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = __dirname

/** The 18 TradingView readers from the Phase 0 inventory. */
const APPROVED_READERS = [
  'breadth.ts', 'countryReturns.ts', 'crossAssetVol.ts', 'crudeCurves.ts', 'fxPairReturns.ts', 'metalsData.ts',
  'routes/global.ts', 'routes/tv.ts', 'routes/tvYieldCurve.ts', 'sectorAttribution.ts', 'sectorContribution.ts',
  'tvFedWatch.ts', 'tvFutures.ts', 'usIndices.ts', 'usRatesRealizedVol.ts', 'usRatesVol.ts', 'vixCurve.ts',
  'hephaestus/render.ts',
]

/** Not bar readers (approved at the Phase 0 gate), plus the helpers themselves. */
const ALLOWLIST: Record<string, string> = {
  'db.ts': 'schema + migration',
  'tvCsvIngest.ts': 'ingest internals (writes, stale-tip prior lookup, row counts)',
  'migrations/cleanStaleTips.ts': 'one-time migration',
  'scripts/build-series-catalog.ts': 'offline catalog script (coverage metadata)',
  'scripts/enumerateYieldTickers.ts': 'offline inventory script',
  'hephaestus/catalogSearch.ts': 'symbol list only',
  'lib/tvViewAsOf.ts': 'the completeness/as-of helper (uses tv_bar_complete directly)',
  'lib/tvRead.ts': 'the reader helper',
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p)
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : []
  })
}

interface Hit { file: string; line: number; sql: string; ok: boolean; viaHelper: boolean }

/** SQL literals (template or quoted) that read a TV table, with their compliance. */
function tvQueries(file: string): Hit[] {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8')
  const hits: Hit[] = []
  const literal = /`[^`]*`|'(?:[^'\\\n]|\\.)*'/g
  for (const m of src.matchAll(literal)) {
    const sql = m[0]
    // A dynamic `FROM ${table}` counts when the enclosing code types `table` as a TV table.
    const dynamicTv = /\bFROM\s+\$\{table\}/.test(sql) &&
      /'tv_series'\s*\|\s*'tv_ohlcv'|'tv_ohlcv'\s*\|\s*'tv_series'/.test(src.slice(Math.max(0, m.index! - 800), m.index!))
    const readsTv = /\b(FROM|JOIN)\s+(tv_series|tv_ohlcv)\b/i.test(sql) || dynamicTv
    if (!readsTv) continue
    const before = src.slice(Math.max(0, m.index! - 160), m.index!)
    const viaHelper = /\$\{tvVisible(Glob)?\(/.test(sql)
    const ok = viaHelper || /tv-(raw-ok|visible):/.test(before)
    hits.push({ file, line: src.slice(0, m.index!).split('\n').length, sql: sql.replace(/\s+/g, ' ').slice(0, 90), ok, viaHelper })
  }
  return hits
}

describe('TV reader guard', () => {
  const files = walk(SRC).map(f => path.relative(SRC, f).split(path.sep).join('/'))
  const all = files.flatMap(tvQueries)

  it('no TV table query outside the approved readers and the allowlist', () => {
    const stray = all.filter(h => !APPROVED_READERS.includes(h.file) && !(h.file in ALLOWLIST))
    expect(stray.map(h => `${h.file}:${h.line} ${h.sql}`)).toEqual([])
  })

  it('every query in an approved reader applies tvVisible (or carries an explicit marker)', () => {
    const raw = all.filter(h => APPROVED_READERS.includes(h.file) && !h.ok)
    expect(raw.map(h => `${h.file}:${h.line} ${h.sql}`)).toEqual([])
  })

  it('all 18 approved readers exist and each still queries a TV table', () => {
    expect(APPROVED_READERS).toHaveLength(18)
    for (const f of APPROVED_READERS) {
      expect(fs.existsSync(path.join(SRC, f)), f).toBe(true)
      expect(all.some(h => h.file === f), `${f} has no TV query — remove it from the list`).toBe(true)
    }
    const counts = APPROVED_READERS.map(f => `${f}=${all.filter(h => h.file === f).length}`)
    const marked = all.filter(h => APPROVED_READERS.includes(h.file) && !h.viaHelper)
    console.log(`TV queries per reader: ${counts.join(' ')}`)
    console.log(`via marker instead of tvVisible: ${marked.map(h => `${h.file}:${h.line}`).join(', ')}`)
  })
})
