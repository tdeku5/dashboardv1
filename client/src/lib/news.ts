// ── Shared types ──────────────────────────────────────────────────────────────

export interface Article {
  id:           number
  guid:         string
  source:       'bloomberg' | 'reuters'
  title:        string
  description:  string
  url:          string
  published_at: string
  fetched_at:   string
  topics:       string[]
  tag:          string
}

// ── API helpers ───────────────────────────────────────────────────────────────

export async function fetchArticles(): Promise<Article[]> {
  const res = await fetch('/api/news')
  if (!res.ok) throw new Error(`Failed to fetch news (HTTP ${res.status})`)
  return res.json() as Promise<Article[]>
}

export async function triggerNewsRefresh(): Promise<{ inserted: number; skipped: number }> {
  const res = await fetch('/api/news/refresh', { method: 'POST' })
  if (!res.ok) {
    const body = await res.json() as { error?: string }
    throw new Error(body.error ?? `Refresh failed (HTTP ${res.status})`)
  }
  return res.json() as Promise<{ inserted: number; skipped: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateWhyItMatters(article: Article): string {
  const topicStr = article.topics.length > 0 ? article.topics.join(', ') : 'General interest'
  return `Tagged under ${topicStr}.`
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
