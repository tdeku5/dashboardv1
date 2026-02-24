// ── Shared types ──────────────────────────────────────────────────────────────

export interface Signal {
  label: string
  theme: string
}

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
  signals:      Signal[]
  tag:          string
}

export interface TopicConfig {
  id:       number | null
  name:     string
  keywords: string[]
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

export async function fetchTopics(): Promise<TopicConfig[]> {
  const res = await fetch('/api/news/topics')
  if (!res.ok) throw new Error(`Failed to fetch topics (HTTP ${res.status})`)
  return res.json() as Promise<TopicConfig[]>
}

export async function saveTopics(topics: TopicConfig[]): Promise<void> {
  const res = await fetch('/api/news/topics/batch', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(topics),
  })
  if (!res.ok) {
    const body = await res.json() as { error?: string }
    throw new Error(body.error ?? `Save failed (HTTP ${res.status})`)
  }
}

// ── Signal color palette ──────────────────────────────────────────────────────

export const SIGNAL_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  'breaking':         { bg: 'rgba(239,68,68,0.13)',  color: '#f87171', border: 'rgba(239,68,68,0.35)'  },
  'market-mover':     { bg: 'rgba(59,130,246,0.13)', color: '#60a5fa', border: 'rgba(59,130,246,0.35)' },
  'threat':           { bg: 'rgba(239,68,68,0.08)',  color: '#fca5a5', border: 'rgba(239,68,68,0.22)'  },
  'geopolitical':     { bg: 'rgba(245,158,11,0.13)', color: '#fbbf24', border: 'rgba(245,158,11,0.35)' },
  'policy-signal':    { bg: 'rgba(139,92,246,0.13)', color: '#a78bfa', border: 'rgba(139,92,246,0.35)' },
  'investor-alert':   { bg: 'rgba(34,197,94,0.13)',  color: '#4ade80', border: 'rgba(34,197,94,0.35)'  },
  'industry-shift':   { bg: 'rgba(6,182,212,0.13)',  color: '#22d3ee', border: 'rgba(6,182,212,0.35)'  },
  'viral-potential':  { bg: 'rgba(236,72,153,0.13)', color: '#f472b6', border: 'rgba(236,72,153,0.35)' },
}

export const ALL_SIGNAL_DEFS: { label: string; theme: string }[] = [
  { label: 'Breaking',       theme: 'breaking'        },
  { label: 'Market Mover',   theme: 'market-mover'    },
  { label: 'Threat',         theme: 'threat'           },
  { label: 'Geopolitical',   theme: 'geopolitical'     },
  { label: 'Policy Signal',  theme: 'policy-signal'    },
  { label: 'Investor Alert', theme: 'investor-alert'   },
  { label: 'Industry Shift', theme: 'industry-shift'   },
  { label: 'Viral Potential',theme: 'viral-potential'  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateWhyItMatters(article: Article): string {
  const topicStr  = article.topics.length  > 0 ? article.topics.join(', ')                 : 'General interest'
  const signalStr = article.signals.length > 0 ? article.signals.map(s => s.label).join(', ') : 'none detected'
  return `Tagged under ${topicStr}. Signals detected: ${signalStr}.`
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
