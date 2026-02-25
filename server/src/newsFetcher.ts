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
      max_tokens: 100,
      messages: [{
        role:    'user',
        content: `You are a strict news categorization assistant for a financial and macroeconomic terminal. Categorize the following article into one or more of these topics ONLY if the article is explicitly and primarily about that topic:

- AI: artificial intelligence, machine learning, LLMs, AI models, AI companies, AI policy
- Federal Reserve: the US Federal Reserve, FOMC, Jerome Powell, US interest rates, US monetary policy, Fed officials, Fed governors, Fed chair. Valid signals include: "the Fed", "Fed's", "Fed said", "Fed officials", "Fed governors", "rate cut", "rate hike", "basis points". NOTE: Do NOT tag articles where "fed" is used in a non-Federal-Reserve context such as "FedEx", "fed up", "has been fed", or similar unrelated usages. When in doubt, ask: is this article about US central bank policy or officials? If yes, tag it. If no, do not.
- Geopolitics: international relations, wars, sanctions, diplomatic relations, national security, cross-border conflict
- Tariffs: import/export tariffs, trade wars, customs duties, trade agreements
- Markets: stock markets, equity markets, bond markets, commodities, market indices, trading
- Regulation: government regulation, antitrust, legislation, regulatory agencies (SEC, FTC, FCA etc.)
- Energy: oil, gas, renewable energy, power grids, energy policy, OPEC
- Labor: employment, unemployment, layoffs, wages, strikes, workforce trends

Rules:
- Only assign a topic if the article is clearly and directly about it — do not infer loosely
- An article can have multiple topics if it genuinely covers multiple areas
- If the article does not clearly fit any topic, return an empty array — it will be tagged General automatically
- Return ONLY a JSON array of matching topic names, no explanation or other text

Title: ${title}
Description: ${description}`,
      }],
    })

    const raw  = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]'
    // Strip markdown code fences that Haiku sometimes wraps around the JSON
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
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
