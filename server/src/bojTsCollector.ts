// Bank of Japan Time-Series Data Search API collector (Japan Phase 2,
// docs/jp-models-mapping.md decisions (h) PPI + Credit category). No auth.
// API verified live 2026-07: GET stat-search.boj.or.jp/api/v1/getDataCode with
// db= and code= params — the site's apostrophe-form codes (MD13'FAAP@01) split
// into db + code; '@' URL-encodes normally. Limits: 250 series / 60k points
// per request. Response: RESULTSET[].{SERIES_CODE, NAME_OF_TIME_SERIES, UNIT,
// FREQUENCY, VALUES:{SURVEY_DATES:[YYYYMM], VALUES:[num]}}.
// BoJ asks for conservative access (throttled) and a UI attribution line
// (rendered on the consuming panels). Rates-side TONA ingestion is untouched.

import { storeBojTsObservations, getBojTsLatestDate } from './db'

const BASE = 'https://www.stat-search.boj.or.jp/api/v1'
const THROTTLE_MS = 800

export interface BojSeriesDef {
  code: string
  db: string
  seriesCode: string
  /** Substring of NAME_OF_TIME_SERIES — health check on every fetch */
  nameIncludes: string
  unit: string
  staleDays: number
}

export const ALL_BOJ_SERIES: BojSeriesDef[] = [
  // PPI (decision h — verified: "[Producer Price Index] All commodities", CY2020=100, May-26 = 134.5)
  { code: 'JP_PPI', db: 'PR01', seriesCode: 'PRCG20_2200000000', nameIncludes: 'All commodities', unit: 'index', staleDays: 70 },
  // Bank lending & deposits (Credit category; MD13, monthly, ¥100M)
  { code: 'JP_LOANS', db: 'MD13', seriesCode: 'FAAP@01', nameIncludes: 'Loans and Discounts', unit: '100 million yen', staleDays: 70 },
  { code: 'JP_LOANS_YOY', db: 'MD13', seriesCode: "FAAPOBAL1@", nameIncludes: 'Loans', unit: 'percent', staleDays: 70 },
  { code: 'JP_DEPOSITS', db: 'MD13', seriesCode: 'FAAPOBRDCD5', nameIncludes: 'Deposits', unit: '100 million yen', staleDays: 70 },
]

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface BojResult {
  SERIES_CODE?: string
  NAME_OF_TIME_SERIES?: string
  UNIT?: string
  VALUES?: { SURVEY_DATES?: Array<number | string>; VALUES?: Array<number | string | null> }
}

/** YYYYMM (monthly) → YYYY-MM-01 */
function decodeBojDate(d: number | string): string | null {
  const s = String(d)
  if (!/^\d{6}$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`
}

export async function syncBojTsSeries(): Promise<void> {
  console.log(`[BoJ-TS] syncing ${ALL_BOJ_SERIES.length} series…`)
  const stale: string[] = []

  for (const def of ALL_BOJ_SERIES) {
    const qs = new URLSearchParams({ db: def.db, code: def.seriesCode, format: 'json', lang: 'en' })
    let body: { STATUS?: number; MESSAGE?: string; RESULTSET?: BojResult[] }
    try {
      const res = await fetch(`${BASE}/getDataCode?${qs}`)
      await sleep(THROTTLE_MS)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      body = await res.json() as typeof body
    } catch (err) {
      console.error(`[BoJ-TS] ${def.code}: fetch failed —`, err instanceof Error ? err.message : String(err))
      continue
    }
    if (body.STATUS !== 200 || !body.RESULTSET?.length) {
      console.error(`[BoJ-TS] ${def.code}: STATUS ${body.STATUS} — ${body.MESSAGE ?? 'no result set'}`)
      continue
    }
    const r = body.RESULTSET[0]
    const name = String(r.NAME_OF_TIME_SERIES ?? '')
    if (!name.includes(def.nameIncludes)) {
      // Series-code drift defense — fail loudly, do not store mislabeled data.
      console.error(`[BoJ-TS] ${def.code}: series name "${name.slice(0, 70)}" lacks "${def.nameIncludes}" — SKIPPING (code drift?)`)
      continue
    }
    const dates = r.VALUES?.SURVEY_DATES ?? []
    const values = r.VALUES?.VALUES ?? []
    const obs: Array<{ date: string; value: number | null }> = []
    for (let i = 0; i < dates.length; i++) {
      const date = decodeBojDate(dates[i])
      if (!date) continue
      const raw = values[i]
      const num = raw !== null && raw !== undefined && String(raw).trim() !== '' ? Number(raw) : NaN
      obs.push({ date, value: Number.isFinite(num) ? num : null })
    }
    const n = storeBojTsObservations(def.code, def.unit, obs)
    if (n === 0) {
      console.error(`[BoJ-TS] ${def.code}: ZERO rows stored — investigate`)
      continue
    }
    console.log(`[BoJ-TS] ${def.code} (${def.db}/${def.seriesCode}): ${n} rows (latest ${getBojTsLatestDate(def.code)})`)

    const latest = getBojTsLatestDate(def.code)
    if (latest) {
      const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000
      if (ageDays > def.staleDays) stale.push(`${def.code}: latest ${latest} (${Math.round(ageDays)}d old)`)
    }
  }

  if (stale.length > 0) {
    console.warn(`[BoJ-TS] ⚠ FROZEN-FEED WARNING:\n  ${stale.join('\n  ')}`)
  }
  console.log('[BoJ-TS] sync done.')
}
