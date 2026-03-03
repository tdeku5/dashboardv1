import { db } from './db'

const UMICH_CSV_URL =
  'https://www.sca.isr.umich.edu/files/tbmpx1px5.csv'

// ── Table creation ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS umich_inflation_expectations (
    date TEXT NOT NULL PRIMARY KEY,
    px5  REAL   -- 5-year ahead median expected inflation
  );
`)

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
}

interface UMichRow { date: string; px5: number }

function parseCSV(text: string): UMichRow[] {
  const lines = text.trim().split('\n')
  // Header: Month,YYYY,PX_MD,PX5_MD
  const rows: UMichRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 4) continue

    const monthStr = parts[0].trim()
    const yearStr  = parts[1].trim()
    const px5Str   = parts[3].trim()

    const mm = MONTHS[monthStr]
    if (!mm || !yearStr) continue
    if (!px5Str) continue  // PX5 column empty (pre-1979)

    const px5 = parseFloat(px5Str)
    if (isNaN(px5)) continue

    rows.push({ date: `${yearStr}-${mm}-01`, px5 })
  }

  return rows
}

// ── Store ────────────────────────────────────────────────────────────────────

const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO umich_inflation_expectations (date, px5)
  VALUES (?, ?)
`)

function storeRows(rows: UMichRow[]): void {
  db.transaction(() => {
    for (const r of rows) upsertStmt.run(r.date, r.px5)
  })()
}

// ── Query helper ─────────────────────────────────────────────────────────────

export interface UMichExpRow { date: string; px5: number }

export function getUMichInflationExpectations(): UMichExpRow[] {
  return db.prepare(
    `SELECT date, px5 FROM umich_inflation_expectations ORDER BY date ASC`
  ).all() as UMichExpRow[]
}

// ── Public sync ──────────────────────────────────────────────────────────────

export async function syncUMichExpectations(): Promise<void> {
  console.log('[umich] Syncing UMichigan 5-year inflation expectations…')
  try {
    const res = await fetch(UMICH_CSV_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

    const text = await res.text()
    const rows = parseCSV(text)
    console.log(`[umich] Parsed ${rows.length} rows (px5)`)

    storeRows(rows)
    console.log('[umich] Stored in SQLite — done.')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[umich] Sync failed: ${msg}`)
  }
}
