import { useState, useEffect, useCallback } from 'react'
import { SpecChart } from '../../components/charts/SpecChart'
import {
  listSavedCharts, renameSavedChart, deleteSavedChart, type SavedChart,
} from '../../lib/hephaestus'
import styles from '../MiscChartsPage.module.css'

/*
 * Saved Charts — Hephaestus specs saved by the user, re-rendered live via
 * <SpecChart> (the same render path as the agent preview; only the spec is
 * stored, never data). Renders nothing while empty so the page looks
 * unchanged until the first chart is saved. Newest first (server order).
 */

export function SavedChartsSection() {
  const [charts, setCharts] = useState<SavedChart[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    listSavedCharts()
      .then(setCharts)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => { reload() }, [reload])

  const onRename = async (chart: SavedChart) => {
    const name = window.prompt('Rename chart:', chart.name)
    if (!name || name.trim() === '' || name.trim() === chart.name) return
    try {
      await renameSavedChart(chart.id, name.trim())
      reload()
    } catch (err) {
      window.alert(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onDelete = async (chart: SavedChart) => {
    if (!window.confirm(`Delete saved chart "${chart.name}"?`)) return
    try {
      await deleteSavedChart(chart.id)
      reload()
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (error) {
    return <div className={`${styles.statusBlock} ${styles.statusError}`}>Saved charts unavailable: {error}</div>
  }
  if (!charts || charts.length === 0) return null

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>SAVED CHARTS</div>
        <div className={styles.pageSubtitle}>Hephaestus charts — re-rendered live from the spec on every load</div>
      </div>
      <div className={styles.stack}>
        {charts.map(chart => (
          <SpecChart
            key={chart.id}
            spec={{ ...chart.spec, title: chart.name }}
            headerExtra={
              <div className={styles.savedActions}>
                <button type="button" className={styles.actionBtn} onClick={() => void onRename(chart)}>RENAME</button>
                <button type="button" className={styles.actionBtn} onClick={() => void onDelete(chart)}>DELETE</button>
              </div>
            }
          />
        ))}
      </div>
    </>
  )
}
