import XLSX from 'xlsx'
import { db } from './db'

const SCE_URL =
  'https://www.newyorkfed.org/medialibrary/interactives/sce/sce/downloads/data/frbny-sce-data.xlsx'

// ── Table creation ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sce_inflation_expectations (
    date         TEXT NOT NULL,
    horizon      TEXT NOT NULL,   -- '1y', '3y', '5y'
    median_value REAL,
    PRIMARY KEY (date, horizon)
  );
`)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert YYYYMM number (e.g. 201306) to YYYY-MM-01 date string */
function yyyymmToDate(raw: unknown): string | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (isNaN(n) || n < 190000 || n > 209912) return null
  const y = Math.floor(n / 100)
  const m = n % 100
  if (m < 1 || m > 12) return null
  return `${y}-${String(m).padStart(2, '0')}-01`
}

interface SCERow { date: string; horizon: string; medianValue: number }

// ── Parse workbook ───────────────────────────────────────────────────────────

function parseWorkbook(buf: Buffer): SCERow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const rows: SCERow[] = []

  // -- 1y and 3y from "Inflation expectations" sheet -------------------------
  const infSheet = wb.Sheets['Inflation expectations']
  if (infSheet) {
    const data = XLSX.utils.sheet_to_json<unknown[]>(infSheet, { header: 1 }) as unknown[][]
    // Row 3 = headers, Row 4+ = data
    // Col 0 = date (YYYYMM), Col 1 = median 1y, Col 2 = median 3y
    for (let i = 4; i < data.length; i++) {
      const r = data[i]
      if (!r || !r.length) continue
      const date = yyyymmToDate(r[0])
      if (!date) continue

      const v1y = typeof r[1] === 'number' ? r[1] : NaN
      const v3y = typeof r[2] === 'number' ? r[2] : NaN

      if (!isNaN(v1y)) rows.push({ date, horizon: '1y', medianValue: v1y })
      if (!isNaN(v3y)) rows.push({ date, horizon: '3y', medianValue: v3y })
    }
  } else {
    console.warn('[sce] "Inflation expectations" sheet not found')
  }

  // -- 5y from "Five-year ahead Infl Exp" sheet ------------------------------
  const fiveSheet = wb.Sheets['Five-year ahead Infl Exp']
  if (fiveSheet) {
    const data = XLSX.utils.sheet_to_json<unknown[]>(fiveSheet, { header: 1 }) as unknown[][]
    // Same layout: Row 3 = headers, Row 4+ = data
    // Col 0 = date (YYYYMM), Col 1 = median 5y
    for (let i = 4; i < data.length; i++) {
      const r = data[i]
      if (!r || !r.length) continue
      const date = yyyymmToDate(r[0])
      if (!date) continue

      const v5y = typeof r[1] === 'number' ? r[1] : NaN
      if (!isNaN(v5y)) rows.push({ date, horizon: '5y', medianValue: v5y })
    }
  } else {
    console.warn('[sce] "Five-year ahead Infl Exp" sheet not found')
  }

  return rows
}

// ── Store ────────────────────────────────────────────────────────────────────

const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO sce_inflation_expectations (date, horizon, median_value)
  VALUES (?, ?, ?)
`)

function storeRows(rows: SCERow[]): void {
  db.transaction(() => {
    for (const r of rows) upsertStmt.run(r.date, r.horizon, r.medianValue)
  })()
}

// ── Query helper ─────────────────────────────────────────────────────────────

export interface SCEExpRow { date: string; horizon: string; value: number }

export function getSCEInflationExpectations(): SCEExpRow[] {
  return db.prepare(
    `SELECT date, horizon, median_value AS value
     FROM sce_inflation_expectations
     ORDER BY date ASC, horizon ASC`
  ).all() as SCEExpRow[]
}

// ── Public sync ──────────────────────────────────────────────────────────────

export async function syncSCEData(): Promise<void> {
  console.log('[sce] Syncing NY Fed SCE inflation expectations…')
  try {
    const res = await fetch(SCE_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const arrayBuf = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuf)
    console.log(`[sce] Downloaded ${(buf.length / 1024).toFixed(0)} KB`)

    const rows = parseWorkbook(buf)
    console.log(`[sce] Parsed ${rows.length} rows (1y + 3y + 5y)`)

    storeRows(rows)
    console.log('[sce] Stored in SQLite — done.')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[sce] Sync failed: ${msg}`)
  }
}
