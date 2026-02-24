import Parser from 'rss-parser'
import { db } from './db'

// ── RSS Feeds ─────────────────────────────────────────────────────────────────

const FEEDS = [
  { source: 'bloomberg', url: 'https://feeds.bloomberg.com/technology/news.rss' },
  { source: 'reuters',   url: 'https://news.google.com/rss/search?q=site:reuters.com+technology&hl=en-US&gl=US&ceid=US:EN' },
] as const

// ── Topic Definitions ─────────────────────────────────────────────────────────

export interface TopicDef {
  name:     string
  keywords: string[]
}

export const DEFAULT_TOPICS: TopicDef[] = [
  {
    name:     'Federal Reserve',
    keywords: ['fed', 'federal reserve', 'fomc', 'interest rate', 'rate cut', 'rate hike',
               'powell', 'monetary policy', 'basis points', 'bps'],
  },
  {
    name:     'Geopolitics',
    keywords: ['geopolit', 'nato', 'sanctions', 'china', 'russia', 'ukraine', 'taiwan',
               'middle east', 'war', 'conflict', 'diplomacy', 'trade war', 'foreign policy'],
  },
  {
    name:     'Tariffs',
    keywords: ['tariff', 'trade war', 'import duty', 'export control', 'trade deal', 'wto', 'customs'],
  },
  {
    name:     'AI',
    keywords: ['artificial intelligence', 'machine learning', 'large language model', 'llm',
               'openai', 'anthropic', 'deepmind', 'gpt', 'claude', 'gemini',
               'generative ai', 'neural network'],
  },
  {
    name:     'Markets',
    keywords: ['stock market', 's&p', 'nasdaq', 'dow jones', 'equity', 'bond market',
               'yield', 'treasury', 'hedge fund', 'earnings', 'ipo', 'valuation'],
  },
  {
    name:     'Regulation',
    keywords: ['regulation', 'regulator', 'antitrust', 'legislation', 'congress', 'senate',
               'sec', 'ftc', 'gdpr', 'compliance', 'lawsuit', 'fine', 'penalty'],
  },
  {
    name:     'Energy',
    keywords: ['oil', 'gas', 'opec', 'energy', 'renewable', 'solar', 'wind',
               'nuclear', 'carbon', 'climate', 'emissions'],
  },
  {
    name:     'Labor',
    keywords: ['jobs', 'unemployment', 'layoffs', 'hiring', 'wages', 'payroll',
               'workforce', 'strike', 'union'],
  },
]

// ── Signal Definitions ────────────────────────────────────────────────────────

interface SignalRule { label: string; theme: string; keywords: string[] }

const SIGNAL_RULES: SignalRule[] = [
  { label: 'Breaking',        theme: 'breaking',        keywords: ['breaking', 'just in', 'alert', 'exclusive'] },
  { label: 'Market Mover',    theme: 'market-mover',    keywords: ['stock', 'shares', 'rally', 'plunge', 'surge', 'tumble', 'market'] },
  { label: 'Threat',          theme: 'threat',          keywords: ['hack', 'breach', 'attack', 'malware', 'vulnerability', 'risk', 'threat'] },
  { label: 'Geopolitical',    theme: 'geopolitical',    keywords: ['china', 'russia', 'nato', 'sanctions', 'war', 'conflict'] },
  { label: 'Policy Signal',   theme: 'policy-signal',   keywords: ['regulation', 'law', 'legislation', 'congress', 'senate', 'fed', 'fomc'] },
  { label: 'Investor Alert',  theme: 'investor-alert',  keywords: ['earnings', 'revenue', 'profit', 'loss', 'ipo', 'acquisition', 'merger'] },
  { label: 'Industry Shift',  theme: 'industry-shift',  keywords: ['disruption', 'transformation', 'shift', 'revolution', 'reshape'] },
]

const KNOWN_COMPANIES = [
  'apple', 'google', 'microsoft', 'amazon', 'meta', 'nvidia', 'tesla',
  'openai', 'anthropic', 'bloomberg', 'reuters', 'samsung', 'intel',
]

function isViralPotential(title: string): boolean {
  if (title.length >= 80) return false
  const lower = title.toLowerCase()
  return /\d/.test(title) || KNOWN_COMPANIES.some(c => lower.includes(c))
}

// ── Active topic loader ───────────────────────────────────────────────────────

function getActiveTopics(): TopicDef[] {
  const rows = db.prepare(
    'SELECT name, keywords FROM news_topics'
  ).all() as { name: string; keywords: string }[]
  if (rows.length === 0) return DEFAULT_TOPICS
  return rows.map(r => ({
    name:     r.name,
    keywords: JSON.parse(r.keywords) as string[],
  }))
}

// ── Matchers ──────────────────────────────────────────────────────────────────

function matchTopics(text: string, topics: TopicDef[]): string[] {
  const lower = text.toLowerCase()
  return topics
    .filter(t => t.keywords.some(kw => lower.includes(kw.toLowerCase())))
    .map(t => t.name)
}

function matchSignals(text: string, title: string): { label: string; theme: string }[] {
  const lower = text.toLowerCase()
  const signals = SIGNAL_RULES
    .filter(r => r.keywords.some(kw => lower.includes(kw)))
    .map(r => ({ label: r.label, theme: r.theme }))
  if (isViralPotential(title)) {
    signals.push({ label: 'Viral Potential', theme: 'viral-potential' })
  }
  return signals
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
  const topics    = getActiveTopics()
  const fetchedAt = new Date().toISOString()
  let inserted = 0, skipped = 0

  cleanOldArticles()

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO news_articles
      (guid, source, title, description, url, published_at, fetched_at, topics, signals, tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      const title       = item.title        ?? ''
      const description = (item.contentSnippet || item.content || item.summary || '').slice(0, 600)
      const url         = item.link         ?? guid
      const publishedAt = item.isoDate      ?? item.pubDate ?? fetchedAt
      const text        = `${title} ${description}`

      const matchedTopics  = matchTopics(text, topics)
      const matchedSignals = matchSignals(text, title)
      const tag            = matchedTopics[0] ?? 'General'

      const res = insertStmt.run(
        guid, feed.source, title, description, url,
        publishedAt, fetchedAt,
        JSON.stringify(matchedTopics),
        JSON.stringify(matchedSignals),
        tag,
      )

      if (res.changes > 0) inserted++
      else skipped++
    }
  }

  console.log(`[news] Ingest complete — inserted=${inserted} skipped=${skipped}`)
  return { inserted, skipped }
}
