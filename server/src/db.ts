import Database from 'better-sqlite3'
import path from 'path'

// DB lives at the project root (two levels up from server/src/)
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'fred_data.db')

export const db = new Database(DB_PATH)

// WAL mode for safe concurrent reads while background writes happen
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS series_observations (
    series_id    TEXT     NOT NULL,
    date         TEXT     NOT NULL,
    value        REAL     NOT NULL,
    last_updated DATETIME NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (series_id, date)
  );

  CREATE TABLE IF NOT EXISTS series_metadata (
    series_id    TEXT PRIMARY KEY,
    title        TEXT,
    frequency    TEXT,
    units        TEXT,
    last_fetched DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_obs_series_date
    ON series_observations (series_id, date);

  CREATE TABLE IF NOT EXISTS news_articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guid         TEXT UNIQUE,
    source       TEXT,
    title        TEXT,
    description  TEXT,
    url          TEXT,
    published_at TEXT,
    fetched_at   TEXT,
    topics       TEXT,
    signals      TEXT,
    tag          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_news_published
    ON news_articles (published_at DESC);

  CREATE TABLE IF NOT EXISTS news_topics (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE,
    keywords TEXT
  );
`)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ObsRow { date: string; value: number }

// ── Query helpers ─────────────────────────────────────────────────────────────

export function getObservations(
  seriesId: string,
  opts: { observationStart?: string; observationEnd?: string } = {}
): ObsRow[] {
  const params: (string | number)[] = [seriesId]
  let sql = 'SELECT date, value FROM series_observations WHERE series_id = ?'
  if (opts.observationStart) { sql += ' AND date >= ?'; params.push(opts.observationStart) }
  if (opts.observationEnd)   { sql += ' AND date <= ?'; params.push(opts.observationEnd)   }
  sql += ' ORDER BY date ASC'
  return db.prepare(sql).all(...params) as ObsRow[]
}

export function storeObservations(
  seriesId:     string,
  observations: { date: string; value: string | number }[],
  meta?:        { title?: string; frequency?: string; units?: string }
): void {
  const insertObs = db.prepare(
    `INSERT OR REPLACE INTO series_observations (series_id, date, value, last_updated)
     VALUES (?, ?, ?, datetime('now'))`
  )
  const insertMeta = db.prepare(
    `INSERT OR REPLACE INTO series_metadata (series_id, title, frequency, units, last_fetched)
     VALUES (?, ?, ?, ?, datetime('now'))`
  )

  db.transaction(() => {
    for (const obs of observations) {
      const v = typeof obs.value === 'string' ? parseFloat(obs.value) : obs.value
      if (!isNaN(v)) insertObs.run(seriesId, obs.date, v)
    }
    insertMeta.run(seriesId, meta?.title ?? null, meta?.frequency ?? null, meta?.units ?? null)
  })()
}

export function getSeriesLastFetched(seriesId: string): string | null {
  const row = db.prepare(
    'SELECT last_fetched FROM series_metadata WHERE series_id = ?'
  ).get(seriesId) as { last_fetched: string | null } | undefined
  return row?.last_fetched ?? null
}

export function isDatabaseEmpty(): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM series_metadata').get() as { n: number }
  return row.n === 0
}

export function getDbStatus(): { lastUpdated: string | null; seriesCount: number } {
  const row = db.prepare(
    `SELECT MAX(last_fetched) as lastUpdated, COUNT(*) as seriesCount
     FROM series_metadata WHERE last_fetched IS NOT NULL`
  ).get() as { lastUpdated: string | null; seriesCount: number }
  return row
}

// Returns series from knownSeries that are stale (missing or older than maxAgeHours)
export function getStaleSeries(maxAgeHours: number, knownSeries: string[]): string[] {
  if (!knownSeries.length) return []
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const fresh = new Set(
    (db.prepare(
      'SELECT series_id FROM series_metadata WHERE last_fetched IS NOT NULL AND last_fetched >= ?'
    ).all(cutoff) as { series_id: string }[]).map(r => r.series_id)
  )
  return knownSeries.filter(id => !fresh.has(id))
}
