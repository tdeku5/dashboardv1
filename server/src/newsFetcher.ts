import dotenv from 'dotenv'
import path from 'path'
import Parser from 'rss-parser'
import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

// ── RSS Feeds ─────────────────────────────────────────────────────────────────

const FEEDS = [
  { source: 'bloomberg', url: 'https://feeds.bloomberg.com/technology/news.rss' },
  { source: 'reuters',   url: 'https://news.google.com/rss/search?q=site:reuters.com+technology&hl=en-US&gl=US&ceid=US:EN' },
] as const

// ── Topic list (hardcoded; Claude classifies against this) ────────────────────

const TOPIC_LIST = [
  'AI', 'Federal Reserve', 'Geopolitics', 'Tariffs',
  'Markets', 'Regulation', 'Energy', 'Labor',
] as const

type Topic = typeof TOPIC_LIST[number]

// ── Claude classifier ─────────────────────────────────────────────────────────

const anthropic = new Anthropic()   // reads ANTHROPIC_API_KEY from env

async function classifyTopics(title: string, description: string): Promise<string[]> {
  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{
        role:    'user',
        content: `You are a news categorization assistant. Given the following article, return a JSON array of topics it belongs to from this list: [AI, Federal Reserve, Geopolitics, Tariffs, Markets, Regulation, Energy, Labor]. Return only the JSON array, no other text. If the article does not clearly fit any topic, return an empty array.

Title: ${title}
Description: ${description}`,
      }],
    })

    const text   = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]'
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []

    return (parsed as unknown[]).filter(
      (t): t is Topic => typeof t === 'string' && (TOPIC_LIST as readonly string[]).includes(t)
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    console.warn(`[news] Claude classification error: ${msg}`)
    return []
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanOldArticles(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString()
  const result = db.prepare('DELETE FROM news_articles WHERE published_at < ?').run(cutoff)
  if (result.changes > 0) {
    console.log(`[news] Pruned ${result.changes} articles older than 30 days`)
  }
}

// ── Fetch & Ingest ────────────────────────────────────────────────────────────

const parser = new Parser({ timeout: 12_000 })

export async function fetchAndIngestNews(): Promise<{ inserted: number; skipped: number }> {
  const fetchedAt = new Date().toISOString()
  let inserted = 0, skipped = 0

  cleanOldArticles()

  const existsStmt = db.prepare('SELECT 1 FROM news_articles WHERE guid = ?')
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO news_articles
      (guid, source, title, description, url, published_at, fetched_at, topics, signals, tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
  `)

  for (const feed of FEEDS) {
    let feedData
    try {
      feedData = await parser.parseURL(feed.url)
    } catch (err) {
      console.error(`[news] Failed to fetch ${feed.source} feed:`, err)
      continue
    }

    for (const item of feedData.items ?? []) {
      const guid = item.guid || item.link || ''
      if (!guid) continue

      // Skip articles already in the DB — don't burn Claude calls on dupes
      if (existsStmt.get(guid)) { skipped++; continue }

      const title       = item.title ?? ''
      const description = (item.contentSnippet || item.content || item.summary || '').slice(0, 600)
      const url         = item.link ?? guid
      const publishedAt = item.isoDate ?? item.pubDate ?? fetchedAt

      // Claude classification — fall back to ["General"] on any failure
      const rawTopics   = await classifyTopics(title, description)
      const topics      = rawTopics.length > 0 ? rawTopics : ['General']
      const tag         = topics[0]

      insertStmt.run(
        guid, feed.source, title, description, url,
        publishedAt, fetchedAt,
        JSON.stringify(topics),
        tag,
      )
      inserted++

      // Brief pause between Claude calls
      await new Promise<void>(r => setTimeout(r, 120))
    }
  }

  console.log(`[news] Ingest complete — inserted=${inserted} skipped=${skipped}`)
  return { inserted, skipped }
}
