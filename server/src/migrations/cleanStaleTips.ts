import { db } from '../db'

// Bump when adding new migrations. Existing DBs persist user_version across restarts,
// so a migration only runs once per database.
const TARGET_USER_VERSION = 1

interface Candidate {
  symbol: string
  latest_time: string
  latest_close: number
  prior_time: string
  prior_close: number
}

function formatTime(t: string): string {
  const n = Number(t)
  if (Number.isFinite(n) && n > 1e9 && t.length <= 12) {
    return new Date(n * 1000).toISOString().slice(0, 10)
  }
  return t
}

export function runStaleTipCleanup(): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= TARGET_USER_VERSION) return

  console.log('[stale-tip-cleanup] Starting one-time tv_series stale-tip cleanup migration...')

  const candidates = db.prepare(`
    WITH ranked AS (
      SELECT symbol, time, close,
             ROW_NUMBER() OVER (
               PARTITION BY symbol
               ORDER BY CAST(time AS INTEGER) DESC, time DESC
             ) AS rn
      FROM tv_series
      WHERE close IS NOT NULL
    )
    SELECT a.symbol      AS symbol,
           a.time        AS latest_time,
           a.close       AS latest_close,
           b.time        AS prior_time,
           b.close       AS prior_close
    FROM ranked a
    JOIN ranked b ON a.symbol = b.symbol AND b.rn = 2
    WHERE a.rn = 1 AND a.close = b.close
  `).all() as Candidate[]

  const del = db.prepare('DELETE FROM tv_series WHERE symbol = ? AND time = ?')
  const symbolsTouched = new Set<string>()
  let deleted = 0

  db.transaction(() => {
    for (const c of candidates) {
      const result = del.run(c.symbol, c.latest_time)
      if (result.changes > 0) {
        deleted += result.changes
        symbolsTouched.add(c.symbol)
        console.log(
          `[stale-tip-cleanup] Deleted ${c.symbol} @ ${formatTime(c.latest_time)} ` +
          `(close=${c.latest_close}, matched prior ${formatTime(c.prior_time)})`
        )
      }
    }
    db.pragma(`user_version = ${TARGET_USER_VERSION}`)
  })()

  console.log(
    `[stale-tip-cleanup] Stale-tip cleanup migration complete: ${deleted} rows deleted across ${symbolsTouched.size} symbols`
  )
}
