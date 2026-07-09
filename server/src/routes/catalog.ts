import { Router } from 'express'
import { db } from '../db'

// Read-only series-catalog endpoints (AI Chart Agent, Phase 0/B).
//   GET /api/catalog?source=&country=&category=&q=   — filtered catalog
//   GET /api/catalog/summary                          — coverage stats
// The catalog is rebuilt by `npm run build-catalog`; these routes never write.

export const catalogRouter = Router()

catalogRouter.get('/summary', (_req, res) => {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM series_catalog').get() as { n: number }).n
  const unresolved = (db.prepare("SELECT COUNT(*) AS n FROM series_catalog WHERE description_source = 'unresolved'").get() as { n: number }).n
  const group = (col: string) =>
    db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM series_catalog GROUP BY ${col} ORDER BY n DESC`).all() as Array<{ k: string | null; n: number }>
  const updated = (db.prepare('SELECT MAX(updated_at) AS u FROM series_catalog').get() as { u: string | null }).u
  res.json({
    total,
    unresolved,
    description_coverage: total > 0 ? Math.round(1000 * (total - unresolved) / total) / 10 : 0,
    by_source: group('data_source'),
    by_country: group('country'),
    by_category: group('category'),
    by_kind: group('series_kind'),
    updated_at: updated,
  })
})

catalogRouter.get('/', (req, res) => {
  const clauses: string[] = []
  const params: string[] = []
  const add = (param: unknown, clause: string, transform?: (v: string) => string) => {
    if (typeof param === 'string' && param.trim() !== '') {
      clauses.push(clause)
      params.push(transform ? transform(param.trim()) : param.trim())
    }
  }
  add(req.query.source, 'data_source = ?')
  add(req.query.country, 'country = ?')
  add(req.query.category, 'category = ?')
  if (typeof req.query.q === 'string' && req.query.q.trim() !== '') {
    clauses.push("(series_id LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)")
    const like = `%${req.query.q.trim()}%`
    params.push(like, like)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT series_id, series_kind, source_table, source_db, description, units, frequency,
           data_source, country, category, first_date, last_date, obs_count, member_count,
           description_source
    FROM series_catalog ${where}
    ORDER BY category, data_source, series_id
  `).all(...params)
  res.json({ count: rows.length, entries: rows })
})
