import { Router, Request, Response } from 'express'
import { db } from '../db'
import { fetchAndIngestNews, DEFAULT_TOPICS } from '../newsFetcher'

export const newsRouter = Router()

// ── Types shared with client ───────────────────────────────────────────────────

interface ArticleRow {
  id:           number
  guid:         string
  source:       string
  title:        string
  description:  string
  url:          string
  published_at: string
  fetched_at:   string
  topics:       string   // JSON
  signals:      string   // JSON
  tag:          string
}

// ── GET /api/news ─────────────────────────────────────────────────────────────

newsRouter.get('/', (req: Request, res: Response) => {
  const { source, topic, search } = req.query

  let sql    = 'SELECT * FROM news_articles WHERE 1=1'
  const params: (string | number)[] = []

  if (source && typeof source === 'string' && source !== 'all') {
    sql += ' AND source = ?'
    params.push(source)
  }

  if (search && typeof search === 'string' && search.trim()) {
    sql += ' AND (title LIKE ? OR description LIKE ?)'
    params.push(`%${search.trim()}%`, `%${search.trim()}%`)
  }

  sql += ' ORDER BY published_at DESC LIMIT 500'

  let rows = (db.prepare(sql).all(...params) as ArticleRow[]).map(r => ({
    ...r,
    topics:  JSON.parse(r.topics  || '[]') as string[],
    signals: JSON.parse(r.signals || '[]') as { label: string; theme: string }[],
  }))

  // Topic filter applied after JSON parse (topics is a JSON array field)
  if (topic && typeof topic === 'string' && topic !== 'all') {
    rows = rows.filter(r => r.topics.includes(topic))
  }

  res.json(rows)
})

// ── POST /api/news/refresh ────────────────────────────────────────────────────

let refreshInProgress = false

newsRouter.post('/refresh', async (_req: Request, res: Response) => {
  if (refreshInProgress) {
    res.status(409).json({ error: 'Refresh already in progress' })
    return
  }
  refreshInProgress = true
  try {
    const result = await fetchAndIngestNews()
    res.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Refresh failed'
    res.status(500).json({ error: msg })
  } finally {
    refreshInProgress = false
  }
})

// ── GET /api/news/topics ──────────────────────────────────────────────────────

newsRouter.get('/topics', (_req: Request, res: Response) => {
  const rows = db.prepare(
    'SELECT id, name, keywords FROM news_topics ORDER BY id ASC'
  ).all() as { id: number; name: string; keywords: string }[]

  if (rows.length === 0) {
    res.json(DEFAULT_TOPICS.map((t, i) => ({ id: i, name: t.name, keywords: t.keywords })))
    return
  }

  res.json(rows.map(r => ({
    ...r,
    keywords: JSON.parse(r.keywords || '[]') as string[],
  })))
})

// ── POST /api/news/topics/batch — replace entire topic list ───────────────────

newsRouter.post('/topics/batch', (req: Request, res: Response) => {
  const topics = req.body as { name: string; keywords: string[] }[] | undefined
  if (!Array.isArray(topics)) {
    res.status(400).json({ error: 'Expected array of topics' })
    return
  }

  db.transaction(() => {
    db.prepare('DELETE FROM news_topics').run()
    const insert = db.prepare('INSERT INTO news_topics (name, keywords) VALUES (?, ?)')
    for (const t of topics) {
      if (t.name?.trim()) {
        insert.run(t.name.trim(), JSON.stringify(t.keywords ?? []))
      }
    }
  })()

  res.json({ success: true })
})
