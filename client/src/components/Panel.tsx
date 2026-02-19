import type { PanelConfig, LivePanelData } from '../types'
import { LiveRow } from './LiveRow'
import styles from './Panel.module.css'

interface Props {
  config:      PanelConfig
  liveData:    LivePanelData
  lastUpdated: Date | null
  maWindow:    number
}

function badgeLabel(liveData: LivePanelData): string {
  if (liveData.loading) return 'LOADING'
  if (liveData.rows.every(r => r.status === 'error')) return 'ERROR'
  if (liveData.rows.some(r => r.status === 'error'))  return 'PARTIAL'
  return 'FRED'
}

function badgeClass(liveData: LivePanelData): string {
  if (liveData.loading) return styles.badgeLoading
  if (liveData.rows.every(r => r.status === 'error')) return styles.badgeError
  if (liveData.rows.some(r => r.status === 'error'))  return styles.badgePartial
  return styles.badgeLive
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function Panel({ config, liveData, lastUpdated, maWindow }: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.accentBar} style={{ background: config.accentColor }} />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title} style={{ color: config.accentColor }}>
            {config.title}
          </span>
        </div>
        <span className={`${styles.statusBadge} ${badgeClass(liveData)}`}>
          {badgeLabel(liveData)}
        </span>
      </div>

      {/* Column group header — labels the regime signal columns */}
      <div className={styles.colStrip}>
        <span className={styles.csSeriesLabel}>Series</span>
        <span className={styles.csRegimeLabel}>Regime</span>
      </div>

      <div className={styles.body}>
        {liveData.rows.map((row) => (
          <LiveRow key={row.id} row={row} maWindow={maWindow} />
        ))}
      </div>

      {lastUpdated && !liveData.loading && (
        <div className={styles.footer}>
          <span className={styles.footerSource}>FRED</span>
          <span className={styles.footerDot}>·</span>
          <span className={styles.footerTime}>refreshed {fmtTime(lastUpdated)}</span>
        </div>
      )}
    </div>
  )
}
