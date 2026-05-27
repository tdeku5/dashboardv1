// Statistics Bureau of Japan (e-Stat) collector for the JPY rates fundamental
// model. Pulls four Japanese macro series from the public e-Stat REST API
// (https://api.e-stat.go.jp/rest/3.0/app/json) and upserts them into
// `estat_observations`. Requires a free application id (ESTAT_APP_ID).
//
// VECTOR / DATASET VERIFICATION (read before editing):
// The task referenced an uploaded `estat-japanese-fundamental-series-guide.md`
// that was NOT present in the repo, and its dataset table was partly wrong. All
// ids/codes below were resolved EMPIRICALLY against the live e-Stat metadata
// (getMetaInfo, lang=E) and cross-checked against published Apr-2026 values on
// 2026-05-26 (criterion #2). verifyMetadata() re-asserts them on first run.
//
// CPI (statsDataId 0003427113, "CPI 2020-base, monthly, not seasonally adjusted"):
//   tab=1 (Index), area=00000 (All Japan), cat01 = item:
//     0001 "All items"                              -> CPI_HEADLINE_JP
//     0161 "All items, less fresh food"             -> CPI_CORE_JP   (Japan "core")
//     0178 "All items, less fresh food and energy"  -> CPI_CORECORE_JP
//   (NB cat01 0201 is an identical "All items" total under a second classification
//    tree; the headline pins to the lower code 0001. SA variants 0901/0902/0906
//    carry a ", seasonally adjusted" suffix and are intentionally NOT used —
//    NSA-only for now, per the task.)
//
// UNEMPLOYMENT (statsDataId 0003005865, Labour Force Survey monthly rates):
//   tab=02 (Rate), cat01=000 (All industries), cat02=08 (Unemployed person),
//   cat03=0 (Both sexes), area=00000 (All Japan) -> UNRATE_JP.
//   The task's id 0002060001 was WRONG (employment counts by status, no rate).
//   This series is NSA: e-Stat exposes no clean SA monthly unemployment-rate
//   table (all 1,664 Labour Force Survey tables checked) — Japan's SA series are
//   distributed as Statistics Bureau Excel files, not API datasets. Labeled NSA
//   in the UI accordingly. Japanese unemployment seasonality is mild (~0.3-0.5pp).

import {
  storeEstatObservations,
  getEstatLatestDate,
} from '../db'

const ESTAT_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json'

function getAppId(): string {
  const id = process.env.ESTAT_APP_ID
  if (!id || !id.trim()) {
    throw new Error(
      '[eStat] ESTAT_APP_ID is missing from the environment. Set it in .env ' +
      '(register at https://www.e-stat.go.jp -> My Page -> API function).'
    )
  }
  return id.trim()
}

interface EstatSeriesDef {
  code: string
  statsDataId: string
  unit: 'index' | 'percent'
  // cdXXX coordinate filters that pin this series to a single cell of the cube.
  params: Record<string, string>
  // First-run label check: the member identified by `code` in dimension `dim`
  // must carry exactly this English `label` (and that label must resolve back to
  // `code`). Verified 2026-05-26.
  verify: { dim: string; code: string; label: string }
}

const SERIES: EstatSeriesDef[] = [
  {
    code: 'CPI_HEADLINE_JP', statsDataId: '0003427113', unit: 'index',
    params: { cdTab: '1', cdArea: '00000', cdCat01: '0001' },
    verify: { dim: 'cat01', code: '0001', label: 'All items' },
  },
  {
    code: 'CPI_CORE_JP', statsDataId: '0003427113', unit: 'index',
    params: { cdTab: '1', cdArea: '00000', cdCat01: '0161' },
    verify: { dim: 'cat01', code: '0161', label: 'All items, less fresh food' },
  },
  {
    code: 'CPI_CORECORE_JP', statsDataId: '0003427113', unit: 'index',
    params: { cdTab: '1', cdArea: '00000', cdCat01: '0178' },
    verify: { dim: 'cat01', code: '0178', label: 'All items, less fresh food and energy' },
  },
  {
    code: 'UNRATE_JP', statsDataId: '0003005865', unit: 'percent',
    params: { cdTab: '02', cdCat01: '000', cdCat02: '08', cdCat03: '0', cdArea: '00000' },
    verify: { dim: 'cat02', code: '08', label: 'Unemployed person' },
  },
]

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const THROTTLE_MS = 350 // ~3 req/s, per the e-Stat guidance

// ── Time code decoding ───────────────────────────────────────────────────────
// e-Stat monthly time codes look like `YYYY00MMMM` (e.g. 2026000404 = Mar→Apr
// encoding where chars 6-7 are the month: 2026000404 -> 2026-04). The same table
// also carries annual/fiscal aggregates (e.g. 2025100000, month part "00") which
// must be skipped — returns null for any non-monthly code so callers drop it.
export function decodeTimeCode(timeCode: string): string | null {
  if (!/^\d{10}$/.test(timeCode)) return null
  const year = timeCode.substring(0, 4)
  const month = timeCode.substring(6, 8)
  const m = parseInt(month, 10)
  if (!Number.isFinite(m) || m < 1 || m > 12) return null // annual/fiscal aggregate
  return `${year}-${month}-01`
}

// ── Low-level fetch helpers ──────────────────────────────────────────────────
function buildUrl(method: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ appId: getAppId(), ...params })
  return `${ESTAT_BASE}/${method}?${qs.toString()}`
}

async function fetchJson(method: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(buildUrl(method, params))
  if (!res.ok) throw new Error(`[eStat] ${method} HTTP ${res.status}`)
  return res.json()
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

// ── Metadata verification (first-run / fail-loud) ────────────────────────────
// For each distinct statsDataId, confirm every series' cached (dim, code, label)
// still holds: the cached code's live label must equal the expected label, AND
// matching by that label (exact, case-insensitive, lowest-code tiebreak) must
// resolve back to the cached code. Throws on any mismatch — never silently pulls
// the wrong series.
let metadataVerified = false

export async function verifyMetadata(): Promise<void> {
  const byDataset = new Map<string, EstatSeriesDef[]>()
  for (const s of SERIES) {
    const arr = byDataset.get(s.statsDataId) ?? []
    arr.push(s)
    byDataset.set(s.statsDataId, arr)
  }

  for (const [statsDataId, defs] of byDataset) {
    const json = await fetchJson('getMetaInfo', { statsDataId, lang: 'E' })
    const result = json?.GET_META_INFO?.RESULT
    if (!result || String(result.STATUS) !== '0') {
      throw new Error(`[eStat] getMetaInfo ${statsDataId} failed: ${result?.ERROR_MSG ?? 'unknown error'}`)
    }
    const objs = asArray<any>(json.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ)
    const dims = new Map<string, Map<string, string>>() // dimId -> (code -> name)
    for (const o of objs) {
      const members = new Map<string, string>()
      for (const m of asArray<any>(o.CLASS)) members.set(String(m['@code']), String(m['@name'] ?? ''))
      dims.set(String(o['@id']), members)
    }

    for (const def of defs) {
      const { dim, code, label } = def.verify
      const members = dims.get(dim)
      if (!members) {
        throw new Error(`[eStat] ${def.code}: dimension "${dim}" not found in ${statsDataId} metadata`)
      }
      // (a) cached code must still carry the expected label
      const liveLabel = members.get(code)
      if (liveLabel == null) {
        throw new Error(`[eStat] ${def.code}: category code ${code} no longer exists in ${dim} (${statsDataId})`)
      }
      if (liveLabel.trim().toLowerCase() !== label.toLowerCase()) {
        throw new Error(
          `[eStat] ${def.code}: category ${code} label changed — expected "${label}", got "${liveLabel}". ` +
          'e-Stat codes may have shifted (base-year revision). Re-verify before ingesting.'
        )
      }
      // (b) the expected label must resolve back to the cached code (lowest-code tiebreak)
      const matches = [...members.entries()]
        .filter(([, name]) => name.trim().toLowerCase() === label.toLowerCase())
        .map(([c]) => c)
        .sort()
      if (matches[0] !== code) {
        throw new Error(
          `[eStat] ${def.code}: label "${label}" now resolves to code ${matches[0] ?? '(none)'}, not cached ${code}.`
        )
      }
    }
    console.log(`[eStat] verifyMetadata ${statsDataId}: ${defs.length} category code(s) confirmed.`)
    await sleep(THROTTLE_MS)
  }
  metadataVerified = true
}

// ── Fetch one series' observations from getStatsData ─────────────────────────
async function fetchSeries(def: EstatSeriesDef, extra: Record<string, string>): Promise<Array<{ date: string; value: number | null }>> {
  const json = await fetchJson('getStatsData', {
    statsDataId: def.statsDataId,
    ...def.params,
    ...extra,
    metaGetFlg: 'N',
    cntGetFlg: 'N',
    lang: 'E',
  })
  const sd = json?.GET_STATS_DATA
  const status = sd?.RESULT?.STATUS
  if (String(status) !== '0') {
    // status 1 with "no data" is normal for incremental no-ops; treat as empty.
    const msg = sd?.RESULT?.ERROR_MSG ?? 'unknown'
    if (/該当するデータ|no.*data|NO_DATA/i.test(String(msg))) return []
    throw new Error(`[eStat] getStatsData ${def.code} failed: ${msg}`)
  }
  const values = asArray<any>(sd?.STATISTICAL_DATA?.DATA_INF?.VALUE)
  const out: Array<{ date: string; value: number | null }> = []
  for (const v of values) {
    const date = decodeTimeCode(String(v['@time'] ?? ''))
    if (!date) continue // skip annual/fiscal aggregates
    const raw = v['$']
    const num = typeof raw === 'number' ? raw : parseFloat(raw)
    out.push({ date, value: Number.isFinite(num) ? num : null })
  }
  return out
}

// ── backfill: full history for all four series ───────────────────────────────
export async function backfill(): Promise<void> {
  if (!metadataVerified) await verifyMetadata()
  console.log('[eStat] backfill starting…')
  for (const def of SERIES) {
    const obs = await fetchSeries(def, {})
    const n = storeEstatObservations(def.code, def.unit, obs)
    const kept = obs.filter(o => o.value != null)
    console.log(`[eStat] backfill ${def.code}: ${n} rows (${kept[0]?.date ?? '—'} → ${kept[kept.length - 1]?.date ?? '—'})`)
    await sleep(THROTTLE_MS)
  }
  console.log('[eStat] backfill done.')
}

// ── incremental: only observations on/after the latest stored month ──────────
// Falls back to a full backfill for any series with no rows yet, so one call
// covers first-run and steady-state. e-Stat CPI publishes monthly (mid-late
// month, prior month), so this is a no-op most days.
export async function syncIncremental(): Promise<void> {
  const anyData = SERIES.some(s => getEstatLatestDate(s.code) != null)
  if (!anyData) {
    await backfill()
    return
  }
  if (!metadataVerified) await verifyMetadata()

  for (const def of SERIES) {
    const latest = getEstatLatestDate(def.code)
    // cdTimeFrom expects an e-Stat time code; build the monthly code for the
    // latest stored month (YYYY00MMMM) and re-pull from there (overlap upserts).
    let extra: Record<string, string> = {}
    if (latest) {
      const [y, m] = latest.split('-')
      extra = { cdTimeFrom: `${y}00${m}${m}` }
    }
    const obs = await fetchSeries(def, extra)
    const n = storeEstatObservations(def.code, def.unit, obs)
    if (n > 0) console.log(`[eStat] sync ${def.code}: ${n} rows upserted from ${latest ?? 'start'}`)
    await sleep(THROTTLE_MS)
  }
}
