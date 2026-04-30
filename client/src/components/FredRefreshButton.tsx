import { useState } from 'react'

export function FredRefreshButton() {
  const [refreshing, setRefreshing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    setResult(null)
    try {
      const res = await fetch('/api/fred/refresh', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setResult(`Refreshed ${data.seriesCount ?? '?'} series`)
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setResult(`Error: ${data.error}`)
      }
    } catch (err) {
      setResult(`Error: ${String(err)}`)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: refreshing ? '#4a5568' : '#94A3B8',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.55rem',
          padding: '2px 6px',
          cursor: refreshing ? 'not-allowed' : 'pointer',
          borderRadius: '2px',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
        }}
      >
        {refreshing ? 'REFRESHING...' : '↻ REFRESH DATA'}
      </button>
      {result && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5rem',
          color: result.startsWith('Error') ? '#f87171' : '#4ade80',
        }}>
          {result}
        </span>
      )}
    </div>
  )
}
