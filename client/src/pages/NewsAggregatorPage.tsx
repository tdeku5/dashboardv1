import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import {
  fetchArticles, triggerNewsRefresh,
  fmtDate, fmtTime,
  type Article,
} from '../lib/news'
import styles from './NewsAggregatorPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'bloomberg' | 'reuters'

const BLOOMBERG_COLOR = '#F5C542'
const REUTERS_COLOR   = '#4ade80'

function sourceColor(source: 'bloomberg' | 'reuters'): string {
  return source === 'bloomberg' ? BLOOMBERG_COLOR : REUTERS_COLOR
}

// ── Article Card ──────────────────────────────────────────────────────────────

interface CardProps {
  article: Article
  index:   number
}

function ArticleCard({ article, index }: CardProps) {
  const accent = sourceColor(article.source)

  return (
    <div
      className={styles.card}
      style={{
        animationDelay: `${index * 35}ms`,
        '--card-accent': accent,
      } as React.CSSProperties}
    >
      {/* Header row */}
      <div className={styles.cardHeader}>
        <span className={styles.cardNum}>{String(index + 1).padStart(2, '0')}</span>
        <div className={styles.cardTags}>
          {article.topics.map(t => (
            <span key={t} className={styles.cardTag} style={{ color: accent, borderColor: `${accent}33` }}>
              {t}
            </span>
          ))}
        </div>
        <span className={styles.cardDate}>{fmtDate(article.published_at)}</span>
      </div>

      {/* Title */}
      <h3 className={styles.cardTitle}>{article.title}</h3>

      {/* Description */}
      {article.description && (
        <p className={styles.cardDesc}>{article.description}</p>
      )}

      {/* Footer */}
      <div className={styles.cardFooter}>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.readLink}
          style={{ color: accent }}
        >
          Read →
        </a>
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  source:   'bloomberg' | 'reuters'
  articles: Article[]
}

function NewsColumn({ source, articles }: ColumnProps) {
  const accent      = sourceColor(source)
  const sourceLabel = source === 'bloomberg' ? 'Bloomberg' : 'Reuters'

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader} style={{ borderLeftColor: accent }}>
        <span className={styles.columnTitle} style={{ color: accent }}>
          {sourceLabel}
        </span>
        <span className={styles.columnCount} style={{ color: accent, opacity: 0.6 }}>
          {articles.length} articles
        </span>
      </div>
      <div className={styles.columnFeed}>
        {articles.length === 0 ? (
          <div className={styles.emptyCol}>No articles match the current filters.</div>
        ) : (
          articles.map((a, i) => (
            <ArticleCard key={a.guid} article={a} index={i} />
          ))
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function NewsAggregatorPage() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [articles,   setArticles]   = useState<Article[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // ── Filter state ───────────────────────────────────────────────────────────
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [topicFilter,  setTopicFilter]  = useState('all')
  const [search,       setSearch]       = useState('')

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const loadArticles = useCallback(async () => {
    try {
      const data = await fetchArticles()
      setArticles(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news')
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadArticles().finally(() => setLoading(false))
  }, [loadArticles])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await triggerNewsRefresh()
      await loadArticles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const allTopics = useMemo(() => {
    const set = new Set<string>()
    articles.forEach(a => a.topics.forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [articles])

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return articles.filter(a => {
      if (sourceFilter !== 'all' && a.source !== sourceFilter) return false
      if (topicFilter  !== 'all' && !a.topics.includes(topicFilter)) return false
      if (q && !a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [articles, sourceFilter, topicFilter, search])

  const bloombergFiltered = useMemo(
    () => filteredArticles.filter(a => a.source === 'bloomberg'),
    [filteredArticles]
  )
  const reutersFiltered = useMemo(
    () => filteredArticles.filter(a => a.source === 'reuters'),
    [filteredArticles]
  )

  const lastUpdated = useMemo(() => {
    if (!articles.length) return null
    return articles.reduce((best, a) =>
      a.fetched_at > best ? a.fetched_at : best, articles[0].fetched_at
    )
  }, [articles])

  const stats = useMemo(() => ({
    total:     articles.length,
    bloomberg: articles.filter(a => a.source === 'bloomberg').length,
    reuters:   articles.filter(a => a.source === 'reuters').length,
    visible:   filteredArticles.length,
  }), [articles, filteredArticles])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>

      {/* ── Terminal nav bar ────────────────────────────────────────────────── */}
      <header className={styles.termBar}>
        <div className={styles.termBarLeft}>
          <NavDropdown />
          <span className={styles.termLogo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.termBarRight} />
      </header>

      {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
      <nav className={styles.breadcrumb}>
        <Link to="/" className={styles.breadcrumbLink}>Home</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>News Aggregator</span>
      </nav>

      {/* ── News sub-header ─────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.logo}>
            Signal<span className={styles.logoDot}>.</span>
          </span>
          <span className={styles.logoSub}>News Aggregator</span>
        </div>
        <div className={styles.topBarRight}>
          {lastUpdated && (
            <div className={styles.liveStatus}>
              <span className={styles.liveDot} />
              <span className={styles.liveLabel}>Updated {fmtTime(lastUpdated)}</span>
            </div>
          )}
          <button
            className={`${styles.refreshBtn} ${refreshing ? styles.refreshBtnSpin : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh feeds"
          >
            {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        {/* Source filter */}
        <div className={styles.filterGroup}>
          {(['all', 'bloomberg', 'reuters'] as const).map(src => (
            <button
              key={src}
              className={`${styles.filterBtn} ${sourceFilter === src ? styles.filterBtnActive : ''}`}
              onClick={() => setSourceFilter(src)}
              style={sourceFilter === src && src !== 'all'
                ? { borderColor: sourceColor(src), color: sourceColor(src) }
                : undefined
              }
            >
              {src === 'all' ? 'All' : src === 'bloomberg' ? 'Bloomberg' : 'Reuters'}
            </button>
          ))}
        </div>

        <div className={styles.divider} />

        {/* Topic filter */}
        <div className={styles.filterGroup}>
          <button
            className={`${styles.filterBtn} ${topicFilter === 'all' ? styles.filterBtnActive : ''}`}
            onClick={() => setTopicFilter('all')}
          >
            All Topics
          </button>
          {allTopics.map(t => (
            <button
              key={t}
              className={`${styles.filterBtn} ${topicFilter === t ? styles.filterBtnActive : ''}`}
              onClick={() => setTopicFilter(prev => prev === t ? 'all' : t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className={styles.rightControls}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className={styles.statsBar}>
        <span className={styles.stat}><strong>{stats.total}</strong> total</span>
        <span className={styles.statSep}>·</span>
        <span className={styles.stat} style={{ color: BLOOMBERG_COLOR }}>
          <strong>{stats.bloomberg}</strong> Bloomberg
        </span>
        <span className={styles.statSep}>·</span>
        <span className={styles.stat} style={{ color: REUTERS_COLOR }}>
          <strong>{stats.reuters}</strong> Reuters
        </span>
        <span className={styles.statSep}>·</span>
        <span className={styles.stat}><strong>{stats.visible}</strong> visible</span>
      </div>

      {/* ── Feed ───────────────────────────────────────────────────────────── */}
      <main className={styles.feed}>
        {loading && (
          <div className={styles.statusBlock}>Loading news feed…</div>
        )}
        {!loading && error && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>{error}</div>
        )}

        {!loading && !error && (
          sourceFilter === 'all' ? (
            <div className={styles.splitGrid}>
              <NewsColumn source="bloomberg" articles={bloombergFiltered} />
              <NewsColumn source="reuters"   articles={reutersFiltered} />
            </div>
          ) : (
            <div className={styles.singleCol}>
              {filteredArticles.length === 0 ? (
                <div className={styles.statusBlock}>No articles match the current filters.</div>
              ) : (
                filteredArticles.map((a, i) => (
                  <ArticleCard key={a.guid} article={a} index={i} />
                ))
              )}
            </div>
          )
        )}
      </main>
    </div>
  )
}
