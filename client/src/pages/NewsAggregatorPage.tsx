import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  fetchArticles, triggerNewsRefresh, fetchTopics, saveTopics,
  SIGNAL_COLORS, ALL_SIGNAL_DEFS,
  generateWhyItMatters, fmtDate, fmtTime,
  type Article, type TopicConfig,
} from '../lib/news'
import styles from './NewsAggregatorPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'bloomberg' | 'reuters'

// ── Article Card ──────────────────────────────────────────────────────────────

interface CardProps {
  article:  Article
  index:    number
  expanded: boolean
  onToggle: (guid: string) => void
}

function ArticleCard({ article, index, expanded, onToggle }: CardProps) {
  const accentColor = article.source === 'bloomberg' ? '#60a5fa' : '#fb923c'

  return (
    <div
      className={styles.card}
      style={{
        animationDelay:     `${index * 35}ms`,
        '--card-accent':    accentColor,
      } as React.CSSProperties}
    >
      {/* Header row */}
      <div className={styles.cardHeader}>
        <span className={styles.cardNum}>{String(index + 1).padStart(2, '0')}</span>
        <span className={styles.cardTag} style={{ color: accentColor }}>
          {article.tag}
        </span>
        <span className={styles.cardDate}>{fmtDate(article.published_at)}</span>
      </div>

      {/* Title */}
      <h3 className={styles.cardTitle}>{article.title}</h3>

      {/* Signal pills */}
      {article.signals.length > 0 && (
        <div className={styles.pillRow}>
          {article.signals.map(sig => {
            const colors = SIGNAL_COLORS[sig.theme] ?? SIGNAL_COLORS['market-mover']
            return (
              <span
                key={sig.theme}
                className={styles.pill}
                style={{
                  background:  colors.bg,
                  color:       colors.color,
                  borderColor: colors.border,
                }}
              >
                {sig.label}
              </span>
            )
          })}
        </div>
      )}

      {/* Description */}
      {article.description && (
        <p className={styles.cardDesc}>{article.description}</p>
      )}

      {/* Footer */}
      <div className={styles.cardFooter}>
        <button
          className={styles.whyBtn}
          onClick={() => onToggle(article.guid)}
          aria-expanded={expanded}
        >
          {expanded ? '▲ Why it matters?' : '▼ Why it matters?'}
        </button>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.readLink}
        >
          Read →
        </a>
      </div>

      {/* Expandable why-panel */}
      {expanded && (
        <div className={styles.whyPanel}>
          {generateWhyItMatters(article)}
        </div>
      )}
    </div>
  )
}

// ── Topics Modal ──────────────────────────────────────────────────────────────

interface TopicsModalProps {
  initial:  TopicConfig[]
  onClose:  () => void
  onSaved:  () => void
}

function TopicsModal({ initial, onClose, onSaved }: TopicsModalProps) {
  const [topics,  setTopics]  = useState<TopicConfig[]>(initial)
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  function updateTopic(idx: number, field: 'name' | 'keywords', val: string | string[]) {
    setTopics(prev => prev.map((t, i) => i === idx ? { ...t, [field]: val } : t))
  }

  function addTopic() {
    setTopics(prev => [...prev, { id: null, name: '', keywords: [] }])
  }

  function removeTopic(idx: number) {
    setTopics(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    setSaving(true)
    setSaveErr(null)
    try {
      await saveTopics(topics.filter(t => t.name.trim()))
      onSaved()
      onClose()
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Manage Topics</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          {topics.map((topic, idx) => (
            <div key={idx} className={styles.topicRow}>
              <input
                className={styles.topicNameInput}
                value={topic.name}
                placeholder="Topic name"
                onChange={e => updateTopic(idx, 'name', e.target.value)}
              />
              <textarea
                className={styles.topicKwInput}
                value={topic.keywords.join(', ')}
                placeholder="comma-separated keywords"
                rows={2}
                onChange={e =>
                  updateTopic(idx, 'keywords',
                    e.target.value.split(',').map(k => k.trim()).filter(Boolean)
                  )
                }
              />
              <button
                className={styles.topicDeleteBtn}
                onClick={() => removeTopic(idx)}
                title="Delete topic"
              >
                ✕
              </button>
            </div>
          ))}

          <button className={styles.addTopicBtn} onClick={addTopic}>
            + Add topic
          </button>
        </div>

        {saveErr && <div className={styles.modalError}>{saveErr}</div>}

        <div className={styles.modalFooter}>
          <button className={styles.modalCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={styles.modalSave} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save topics'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  source:    'bloomberg' | 'reuters'
  articles:  Article[]
  expanded:  string | null
  onToggle:  (guid: string) => void
}

function NewsColumn({ source, articles, expanded, onToggle }: ColumnProps) {
  const accentColor  = source === 'bloomberg' ? '#60a5fa' : '#fb923c'
  const sourceLabel  = source === 'bloomberg' ? 'Bloomberg' : 'Reuters'

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader} style={{ borderLeftColor: accentColor }}>
        <span className={styles.columnTitle} style={{ color: accentColor }}>
          {sourceLabel}
        </span>
        <span className={styles.columnCount}>{articles.length} articles</span>
      </div>
      <div className={styles.columnFeed}>
        {articles.length === 0 ? (
          <div className={styles.emptyCol}>No articles match the current filters.</div>
        ) : (
          articles.map((a, i) => (
            <ArticleCard
              key={a.guid}
              article={a}
              index={i}
              expanded={expanded === a.guid}
              onToggle={onToggle}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function NewsAggregatorPage() {
  // ── Data state ─────────────────────────────────────────────────────────────
  const [articles,    setArticles]    = useState<Article[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [refreshing,  setRefreshing]  = useState(false)

  // ── Filter state ───────────────────────────────────────────────────────────
  const [sourceFilter,  setSourceFilter]  = useState<SourceFilter>('all')
  const [topicFilter,   setTopicFilter]   = useState('all')
  const [signalFilters, setSignalFilters] = useState<string[]>([])
  const [search,        setSearch]        = useState('')
  const [expanded,      setExpanded]      = useState<string | null>(null)

  // ── Modal state ────────────────────────────────────────────────────────────
  const [showTopicsModal, setShowTopicsModal] = useState(false)
  const [topicsConfig,    setTopicsConfig]    = useState<TopicConfig[]>([])

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

  async function openTopicsModal() {
    try {
      const data = await fetchTopics()
      setTopicsConfig(data)
      setShowTopicsModal(true)
    } catch {
      setShowTopicsModal(true)
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
      if (signalFilters.length > 0) {
        const labels = a.signals.map(s => s.label)
        if (!signalFilters.some(sf => labels.includes(sf))) return false
      }
      if (q && !a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [articles, sourceFilter, topicFilter, signalFilters, search])

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
    const latest = articles.reduce((best, a) =>
      a.fetched_at > best ? a.fetched_at : best, articles[0].fetched_at
    )
    return latest
  }, [articles])

  const stats = useMemo(() => ({
    total:     articles.length,
    bloomberg: articles.filter(a => a.source === 'bloomberg').length,
    reuters:   articles.filter(a => a.source === 'reuters').length,
    visible:   filteredArticles.length,
  }), [articles, filteredArticles])

  function toggleSignal(label: string) {
    setSignalFilters(prev =>
      prev.includes(label) ? prev.filter(s => s !== label) : [...prev, label]
    )
  }

  function toggleExpanded(guid: string) {
    setExpanded(prev => prev === guid ? null : guid)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>

      {/* ── Top Bar ────────────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
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
              <span className={styles.liveLabel}>
                Updated {fmtTime(lastUpdated)}
              </span>
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
      </header>

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
                ? { borderColor: src === 'bloomberg' ? '#60a5fa' : '#fb923c',
                    color:       src === 'bloomberg' ? '#60a5fa' : '#fb923c' }
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
          {/* Search */}
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {/* Manage topics */}
          <button className={styles.gearBtn} onClick={openTopicsModal} title="Manage Topics">
            ⚙ Manage Topics
          </button>
        </div>
      </div>

      {/* ── Signal filter row ───────────────────────────────────────────────── */}
      <div className={styles.signalRow}>
        <span className={styles.signalRowLabel}>Signals</span>
        {ALL_SIGNAL_DEFS.map(sig => {
          const colors  = SIGNAL_COLORS[sig.theme]
          const active  = signalFilters.includes(sig.label)
          return (
            <button
              key={sig.theme}
              className={`${styles.signalPill} ${active ? styles.signalPillActive : ''}`}
              onClick={() => toggleSignal(sig.label)}
              style={active ? {
                background:  colors?.bg,
                color:       colors?.color,
                borderColor: colors?.border,
              } : undefined}
            >
              {sig.label}
            </button>
          )
        })}
        {signalFilters.length > 0 && (
          <button className={styles.clearBtn} onClick={() => setSignalFilters([])}>
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className={styles.statsBar}>
        <span className={styles.stat}><strong>{stats.total}</strong> total</span>
        <span className={styles.statSep}>·</span>
        <span className={styles.stat} style={{ color: '#60a5fa' }}>
          <strong>{stats.bloomberg}</strong> Bloomberg
        </span>
        <span className={styles.statSep}>·</span>
        <span className={styles.stat} style={{ color: '#fb923c' }}>
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
            /* Split view */
            <div className={styles.splitGrid}>
              <NewsColumn
                source="bloomberg"
                articles={bloombergFiltered}
                expanded={expanded}
                onToggle={toggleExpanded}
              />
              <NewsColumn
                source="reuters"
                articles={reutersFiltered}
                expanded={expanded}
                onToggle={toggleExpanded}
              />
            </div>
          ) : (
            /* Single column */
            <div className={styles.singleCol}>
              {filteredArticles.length === 0 ? (
                <div className={styles.statusBlock}>No articles match the current filters.</div>
              ) : (
                filteredArticles.map((a, i) => (
                  <ArticleCard
                    key={a.guid}
                    article={a}
                    index={i}
                    expanded={expanded === a.guid}
                    onToggle={toggleExpanded}
                  />
                ))
              )}
            </div>
          )
        )}
      </main>

      {/* ── Topics Modal ─────────────────────────────────────────────────── */}
      {showTopicsModal && (
        <TopicsModal
          initial={topicsConfig}
          onClose={() => setShowTopicsModal(false)}
          onSaved={loadArticles}
        />
      )}
    </div>
  )
}
