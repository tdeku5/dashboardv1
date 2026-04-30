import { db } from '../db'

interface Row {
  symbol: string
  row_count: number
  earliest: string
  latest: string
}

const COUNTRY_GROUPS: { prefix: string; label: string }[] = [
  { prefix: 'GB', label: 'UK (GB)' },
  { prefix: 'DE', label: 'Eurozone — Germany (DE)' },
  { prefix: 'FR', label: 'Eurozone — France (FR)' },
  { prefix: 'IT', label: 'Eurozone — Italy (IT)' },
  { prefix: 'CA', label: 'Canada (CA)' },
  { prefix: 'JP', label: 'Japan (JP)' },
  { prefix: 'CN', label: 'China (CN)' },
  { prefix: 'AU', label: 'Australia (AU)' },
]

function tsToDate(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10)
}

const rows = db.prepare(`
  SELECT symbol, COUNT(*) as row_count, MIN(CAST(time AS INTEGER)) as earliest, MAX(CAST(time AS INTEGER)) as latest
  FROM tv_series
  WHERE symbol GLOB 'CA*Y'
     OR symbol GLOB 'AU*Y'
     OR symbol GLOB 'FR*Y'
     OR symbol GLOB 'JP*Y'
     OR symbol GLOB 'CN*Y'
     OR symbol GLOB 'GB*Y'
     OR symbol GLOB 'DE*Y'
     OR symbol GLOB 'IT*Y'
  GROUP BY symbol
  ORDER BY symbol
`).all() as Row[]

for (const group of COUNTRY_GROUPS) {
  const matching = rows.filter(r => r.symbol.startsWith(group.prefix))
  if (matching.length === 0) continue

  console.log(`\n=== ${group.label} ===`)
  for (const r of matching) {
    const earliest = tsToDate(String(r.earliest))
    const latest = tsToDate(String(r.latest))
    const sym = r.symbol.padEnd(10)
    console.log(`${sym} | ${String(r.row_count).padStart(5)} rows | ${earliest} → ${latest}`)
  }
}

const total = rows.reduce((s, r) => s + r.row_count, 0)
console.log(`\nTotal: ${rows.length} symbols, ${total} data points`)
