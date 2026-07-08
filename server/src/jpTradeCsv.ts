// Japan merchandise trade totals — Customs CSV collector (Japan Phase 2).
// e-Stat carries only commodity×country detail with NO totals (verified), so
// monthly world exports/imports come from the Customs long-series CSV
// (verified live 2026-07): https://www.customs.go.jp/toukei/suii/html/data/d41ma.csv
// — "WORLD Monthly Data (a thousand yen)", 1979-01→, NSA. Quirks handled:
// Shift-JIS encoding, browser UA required, and FUTURE months are zero-filled
// (must be dropped, not stored as ¥0). Stored into estat_observations with
// source='Customs' (codes JP_TRADE_EXP / JP_TRADE_IMP / JP_TRADE_BAL).

import { storeEstatObservations, getEstatLatestDate } from './db'

const CSV_URL = 'https://www.customs.go.jp/toukei/suii/html/data/d41ma.csv'

export async function syncJpTrade(): Promise<void> {
  console.log('[JP-Trade] downloading Customs world monthly CSV…')
  const res = await fetch(CSV_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TND-Research-Terminal/1.0)' },
  })
  if (!res.ok) throw new Error(`[JP-Trade] CSV download failed: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('shift_jis').decode(buf)

  const lines = text.split(/\r?\n/)
  // Layout (verified): row "Years/Months,Exp-Total,Imp-Total", then data rows
  // "1979/01,<exports>,<imports>" — one combined YYYY/MM column.
  const headerIdx = lines.findIndex(l => /Exp/i.test(l) && /Imp/i.test(l))
  if (headerIdx < 0) throw new Error('[JP-Trade] header row with Exp/Imp columns not found — CSV layout changed')
  const header = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''))
  const dateCol = header.findIndex(h => /Year/i.test(h))
  const expCol = header.findIndex(h => /Exp/i.test(h))
  const impCol = header.findIndex(h => /Imp/i.test(h))
  if (dateCol < 0 || expCol < 0 || impCol < 0) {
    throw new Error(`[JP-Trade] expected columns missing (header: ${header.slice(0, 8).join('|')})`)
  }

  const exp: Array<{ date: string; value: number | null }> = []
  const imp: Array<{ date: string; value: number | null }> = []
  const bal: Array<{ date: string; value: number | null }> = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''))
    const dm = /^(\d{4})\/(\d{2})$/.exec(cols[dateCol] ?? '')
    if (!dm) continue
    const year = parseInt(dm[1], 10)
    const month = parseInt(dm[2], 10)
    if (year < 1979 || month < 1 || month > 12) continue
    const e = Number(cols[expCol]?.replace(/,/g, ''))
    const m = Number(cols[impCol]?.replace(/,/g, ''))
    // Future months are zero-filled in the source — a genuine zero month has
    // never occurred; drop rows where both totals are 0.
    if (!Number.isFinite(e) || !Number.isFinite(m) || (e === 0 && m === 0)) continue
    const date = `${year}-${String(month).padStart(2, '0')}-01`
    exp.push({ date, value: e })
    imp.push({ date, value: m })
    bal.push({ date, value: e - m })
  }

  if (exp.length === 0) throw new Error('[JP-Trade] parsed zero rows — CSV layout changed')

  const n1 = storeEstatObservations('JP_TRADE_EXP', 'thousand yen', exp, 'Customs')
  const n2 = storeEstatObservations('JP_TRADE_IMP', 'thousand yen', imp, 'Customs')
  const n3 = storeEstatObservations('JP_TRADE_BAL', 'thousand yen', bal, 'Customs')
  console.log(`[JP-Trade] stored exp=${n1} imp=${n2} bal=${n3} rows (latest ${getEstatLatestDate('JP_TRADE_EXP')})`)
}
