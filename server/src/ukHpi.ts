import { parse } from 'csv-parse/sync'
import { storeUkHpiRows, getUkHpiLatestDate, UkHpiRow } from './db'

// UK House Price Index (HM Land Registry).
// The full-file CSV republishes the complete history (1968/1995→) every month,
// so a single download covers both backfill and incremental refresh.
// File naming: UK-HPI-full-file-YYYY-MM.csv, published ~mid-month with a
// roughly two-month reference lag; we probe backwards from the current month.

const HPI_BASE = 'https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data'

// Regions kept in SQLite — national aggregates + London (the terminal doesn't
// need the ~400 local authorities and keeping them would 100× the table).
const KEEP_REGIONS = new Set([
  'United Kingdom',
  'England',
  'Scotland',
  'Wales',
  'Northern Ireland',
  'London',
])

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

/** DD/MM/YYYY → YYYY-MM-DD */
function parseHpiDate(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

async function findLatestFullFileUrl(): Promise<string | null> {
  const now = new Date()
  for (let back = 1; back <= 6; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const url = `${HPI_BASE}/UK-HPI-full-file-${ym}.csv`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok) return url
    } catch {
      // network hiccup — try the next month back
    }
  }
  return null
}

export async function syncUkHpi(opts: { force?: boolean } = {}): Promise<void> {
  // The reference month trails publication by ~2 months; skip the 35MB download
  // unless our newest stored month is old enough that a new file must exist.
  const latest = getUkHpiLatestDate()
  if (!opts.force && latest) {
    const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000
    if (ageDays < 75) {
      console.log(`[UKHPI] Data current (latest ${latest}, ${Math.round(ageDays)}d old) — skipping download.`)
      return
    }
  }

  const url = await findLatestFullFileUrl()
  if (!url) {
    throw new Error('[UKHPI] Could not locate a full-file CSV in the last 6 months — naming scheme may have changed')
  }

  console.log(`[UKHPI] Downloading ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[UKHPI] Download failed: ${res.status}`)
  const text = await res.text()

  const records = parse(text, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>
  if (records.length === 0) throw new Error('[UKHPI] Full file parsed to zero rows')

  const rows: UkHpiRow[] = []
  for (const r of records) {
    if (!KEEP_REGIONS.has(r.RegionName)) continue
    const date = parseHpiDate(r.Date)
    if (!date) continue
    rows.push({
      region: r.RegionName,
      date,
      average_price: num(r.AveragePrice),
      average_price_sa: num(r.AveragePriceSA),
      index_value: num(r.Index),
      index_sa: num(r.IndexSA),
      annual_change: num(r['12m%Change']),
      monthly_change: num(r['1m%Change']),
      price_detached: num(r.DetachedPrice),
      price_semi: num(r.SemiDetachedPrice),
      price_terraced: num(r.TerracedPrice),
      price_flat: num(r.FlatPrice),
      sales_volume: num(r.SalesVolume),
    })
  }

  if (rows.length === 0) {
    throw new Error('[UKHPI] No rows matched the kept regions — RegionName values may have changed')
  }

  storeUkHpiRows(rows)
  const byRegion = new Map<string, number>()
  for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1)
  const summary = [...byRegion.entries()].map(([k, v]) => `${k}: ${v}`).join(', ')
  console.log(`[UKHPI] Stored ${rows.length} rows (${summary}); latest ${getUkHpiLatestDate()}`)
}
