import { useState, useEffect } from 'react'
import { panels } from './data/panels'
import { Panel } from './components/Panel'
import { useFredData } from './hooks/useFredData'
import type { FredConfigError } from './lib/fred'
import { NavDropdown } from './components/NavDropdown'
import styles from './Dashboard.module.css'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function fmtClock(d: Date): string {
  return d.toLocaleString('en-US', {
    month:        'short',
    day:          '2-digit',
    year:         'numeric',
    hour:         '2-digit',
    minute:       '2-digit',
    second:       '2-digit',
    timeZoneName: 'short',
    hour12:       false,
  })
}

// ── Config error screen ────────────────────────────────────────────────────

function ConfigErrorScreen({ err, onRetry }: { err: FredConfigError; onRetry: () => void }) {
  const isMissing = err.reason === 'missing'

  return (
    <div className={styles.configErrorWrap}>
      <div className={styles.configErrorCard}>

        <span className={styles.configErrorIcon}>{isMissing ? '⚙' : '⚠'}</span>

        <div className={styles.configErrorTitle}>
          {isMissing ? 'API Key Required' : 'Invalid API Key'}
        </div>

        <p className={styles.configErrorBody}>
          {isMissing
            ? 'The dashboard needs a free FRED API key to load economic data. No key was found in the server environment.'
            : 'The FRED API rejected the provided key. Double-check that the value in your .env file is correct.'}
        </p>

        <ol className={styles.configErrorSteps}>
          {isMissing && (
            <li data-n="1">
              Get a free key at{' '}
              <a
                className={styles.configErrorLink}
                href="https://fred.stlouisfed.org/docs/api/api_key.html"
                target="_blank"
                rel="noreferrer"
              >
                fred.stlouisfed.org/docs/api/api_key.html
              </a>
            </li>
          )}
          <li data-n={isMissing ? '2' : '1'}>
            Add it to <code>.env</code> in the project root:
          </li>
        </ol>

        <code className={styles.configErrorCode}>
          {'# .env\nFRED_API_KEY=your_32_character_key_here'}
        </code>

        <ol className={styles.configErrorSteps}>
          <li data-n={isMissing ? '3' : '2'}>
            Restart the dev server (<code>npm run dev</code>), then click Retry below.
          </li>
        </ol>

        <hr className={styles.configErrorDivider} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={styles.configErrorHint}>
            Variable name: <strong>FRED_API_KEY</strong>
          </span>
          <button className={styles.refreshBtn} onClick={onRetry}>
            <span className={styles.refreshIcon}>↻</span>
            Retry
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export function Dashboard() {
  const now                                                        = useClock()
  const { panelMap, lastUpdated, refresh, isRefreshing, configError } = useFredData()
  const [maWindow, setMaWindow] = useState(3)

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>

        {/* Left: nav dropdown + brand */}
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>

        {/* Center: live / loading status */}
        <div className={styles.barCenter}>
          {isRefreshing ? (
            <span className={styles.loadingLabel}>FETCHING DATA…</span>
          ) : configError ? (
            <span className={styles.loadingLabel} style={{ color: 'var(--negative)' }}>
              {configError.reason === 'missing' ? 'KEY NOT CONFIGURED' : 'INVALID KEY'}
            </span>
          ) : (
            <>
              <span className={styles.liveDot} />
              <span className={styles.liveLabel}>LIVE</span>
              {lastUpdated && (
                <span className={styles.updatedAt}>
                  updated {fmtClock(lastUpdated)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Right: regime MA control + refresh button + clock */}
        <div className={styles.barRight}>
          <div className={styles.maWrap}>
            <span className={styles.maLabel}>Regime MA</span>
            <input
              type="number"
              className={styles.maField}
              value={maWindow}
              min={1}
              max={60}
              step={1}
              onChange={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v >= 1) setMaWindow(v)
              }}
            />
          </div>
          <button
            className={styles.refreshBtn}
            onClick={refresh}
            disabled={isRefreshing}
            title="Re-fetch all FRED series"
          >
            <span
              className={styles.refreshIcon}
              style={isRefreshing ? { animation: 'dashSpin 0.8s linear infinite' } : undefined}
            >
              ↻
            </span>
            Refresh
          </button>
          <span className={styles.clock}>{fmtClock(now)}</span>
        </div>

      </header>

      {configError ? (
        <ConfigErrorScreen err={configError} onRetry={refresh} />
      ) : (
        <main className={styles.grid}>
          {panels.map((config) => {
            const liveData = panelMap.get(config.id)
            if (!liveData) return null
            return (
              <Panel
                key={config.id}
                config={config}
                liveData={liveData}
                lastUpdated={lastUpdated}
                maWindow={maWindow}
              />
            )
          })}
        </main>
      )}
    </div>
  )
}
