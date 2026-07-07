import { useState, useEffect } from 'react'
import { fetchOnsSeries } from '../lib/ons'
import { type WD } from '../lib/seriesTransforms'
import { SeriesExplorer, type ExplorerItem } from '../components/charts/SeriesExplorer'
import { RatesChart } from '../components/charts/RatesChart'
import kit from '../components/charts/ChartKit.module.css'

// UK Index of Production dashboard — mirrors the US Industrial Production page
// on ONS DIOP data (monthly, chained volume measures, SA). All series are
// DIRECT equivalents; no proxy badges needed. Contribution decomposition is
// deferred: IoP section weights are not published as a time series.

const IOP_ITEMS: ExplorerItem[] = [
  { id: 'K222', label: 'Index of Production (B–E)', depth: 0 },
  { id: 'K224', label: 'Mining & Quarrying (B)', depth: 1 },
  { id: 'K22A', label: 'Manufacturing (C)', depth: 1 },
  { id: 'K22G', label: 'Food, Beverages & Tobacco', depth: 2 },
  { id: 'K22I', label: 'Textiles & Apparel', depth: 2 },
  { id: 'K22K', label: 'Wood & Paper Products', depth: 2 },
  { id: 'K22M', label: 'Coke & Refined Petroleum', depth: 2 },
  { id: 'K22O', label: 'Chemicals & Pharmaceuticals', depth: 2 },
  { id: 'K22Q', label: 'Rubber, Plastics & Non-Metallic Minerals', depth: 2 },
  { id: 'K22S', label: 'Basic Metals & Metal Products', depth: 2 },
  { id: 'K22U', label: 'Computer & Electronic Products', depth: 2 },
  { id: 'K22W', label: 'Electrical Equipment', depth: 2 },
  { id: 'K22Y', label: 'Machinery & Equipment', depth: 2 },
  { id: 'K23T', label: 'Transport Equipment', depth: 2 },
  { id: 'K232', label: 'Other Manufacturing & Repair', depth: 2 },
  { id: 'K22C', label: 'Electricity & Gas (D)', depth: 1 },
  { id: 'K22E', label: 'Water Supply & Waste (E)', depth: 1 },
]

const ALL_CDIDS = IOP_ITEMS.map(i => i.id)

type AllData = Record<string, WD[]>

export function UKIoPContent() {
  const [allData, setAllData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_CDIDS.map(cdid =>
      fetchOnsSeries(cdid, 'diop')
        .then(d => [cdid, d] as [string, WD[]])
        .catch(() => [cdid, []] as [string, WD[]])
    )).then(entries => {
      if (cancelled) return
      setAllData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'Failed to load ONS IoP data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className={kit.statusBlock}>Loading {ALL_CDIDS.length} ONS IoP series...</div>
  if (error) return <div className={kit.statusBlock} style={{ color: '#f87171' }}>{error}</div>

  return (
    <>
      <div style={{
        fontSize: 10, letterSpacing: '0.08em', color: '#4e6070',
        fontFamily: 'var(--font-mono)', padding: '0 2px',
      }}>
        Office for National Statistics (IoP) &mdash; monthly, chained volume, seasonally adjusted.
        Contribution decomposition deferred (weights not published as time series).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        <RatesChart
          title="Index of Production"
          subtitle="K222 — Production industries B–E, YoY / annualized"
          data={allData['K222'] ?? []}
        />
        <RatesChart
          title="Manufacturing"
          subtitle="K22A — Manufacturing (C), YoY / annualized"
          data={allData['K22A'] ?? []}
        />
      </div>

      <SeriesExplorer
        title="IoP Explorer"
        selectorLabel="Series"
        items={IOP_ITEMS}
        data={allData}
        defaultId="K222"
        unitLabel="Index, CVM SA"
      />
    </>
  )
}
