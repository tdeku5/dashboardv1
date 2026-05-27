// Statistics Canada (StatCan WDS) collector for the CAD rates fundamental model.
// Pulls six Canadian macro series from the public StatCan Web Data Service REST
// API (https://www150.statcan.gc.ca/t1/wds/rest) as JSON and upserts them into
// `statcan_observations`. Read-only consumption of a public API — no key.
//
// VECTOR VERIFICATION (important — read before editing):
// The original task referenced an uploaded `statcan-canadian-fundamental-series-
// guide.md` that was NOT present in the repo, and its inline vector table was
// largely wrong (4 of 6 IDs were stale/invalid after StatCan's 2025 table
// restructurings). The vectors below were resolved EMPIRICALLY against the live
// WDS API via getSeriesInfoFromVector / getSeriesInfoFromCubePidCoord and each
// cross-checked against StatCan's published value for Apr-2026 (criterion #14):
//   CPI_HEADLINE v41690973  table 18-10-0004  "Canada;All-items" (NSA index)            168.0
//   CPI_XFE      v41691233  table 18-10-0004  "Canada;All-items excluding food and
//                                              energy" (NSA index)                      156.7
//   CPI_TRIM     v108785715 table 18-10-0256  CPI-trim  (YoY %, BoC core)               2.0
//   CPI_MEDIAN   v108785714 table 18-10-0256  CPI-median (YoY %, BoC core)              2.1
//   CPI_COMMON   v108785713 table 18-10-0256  CPI-common (YoY %, BoC core)              2.5
//   UNRATE_CA    v2062815   table 14-10-0287  unemployment rate 15+, SA                 6.9
// The task's IDs (v41690914, v111955442, v112593657, v112593658) pointed at an
// extra all-items series, the New Housing Price Index, and two non-existent
// vectors respectively — do NOT restore them.
//
// CORE measures: the task assumed CPI-trim/median/common are "YoY % only with no
// index". CPI-common genuinely is (factor model on YoY changes), but StatCan DOES
// publish index versions of CPI-trim (v1481215116) and CPI-median (v1481215115).
// We ingest only the YoY % versions here because the CAD CORE view surfaces the
// three BoC measures + their average as YoY lines (no momentum projections).

import {
  storeStatcanObservations,
  getStatcanLatestDate,
} from '../db'

const WDS_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest'

interface StatCanSeriesDef {
  code: string                      // dashboard series_code stored in statcan_observations
  vectorId: number                  // StatCan vector (no leading "v")
  unit: 'index' | 'percent'
}

const SERIES: StatCanSeriesDef[] = [
  { code: 'CPI_HEADLINE', vectorId: 41690973,  unit: 'index'   },
  { code: 'CPI_XFE',      vectorId: 41691233,  unit: 'index'   },
  { code: 'CPI_TRIM',     vectorId: 108785715, unit: 'percent' },
  { code: 'CPI_MEDIAN',   vectorId: 108785714, unit: 'percent' },
  { code: 'CPI_COMMON',   vectorId: 108785713, unit: 'percent' },
  { code: 'UNRATE_CA',    vectorId: 2062815,   unit: 'percent' },
]

const BY_VECTOR = new Map<number, StatCanSeriesDef>(SERIES.map(s => [s.vectorId, s]))

// CPI history reaches back to 1914; a 1990 release-date floor captures every
// data point (all historical points were loaded into WDS with modern release
// times) while staying comfortably valid for the API.
const BACKFILL_RELEASE_START = '1990-01-01T00:00'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface RawObs { date: string; value: number | null }

// A WDS vectorDataPoint → our { date, value }. StatCan refPer is already the
// first-of-month "YYYY-MM-DD", matching the dashboard's monthly-series
// convention. Non-numeric / suppressed points become null (filtered on store).
function mapDataPoints(points: Array<{ refPer?: string; value?: unknown }>): RawObs[] {
  const out: RawObs[] = []
  for (const p of points) {
    const refPer = p.refPer
    if (!refPer || !/^\d{4}-\d{2}-\d{2}$/.test(refPer)) continue
    // NB: the BoC core trio carries value:null for pre-2016 periods (the measures
    // only begin ~2016). Treat null/empty as null — do NOT pass through Number(),
    // since Number(null) === 0 would store a bogus flat 0% line back to 1949.
    const raw = p.value
    let value: number | null = null
    if (typeof raw === 'number') value = Number.isFinite(raw) ? raw : null
    else if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw)
      value = Number.isFinite(n) ? n : null
    }
    out.push({ date: refPer, value })
  }
  return out
}

interface WdsEnvelope {
  status: string
  object: { vectorId: number; vectorDataPoint?: Array<{ refPer?: string; value?: unknown }> }
}

function isSuccess(env: WdsEnvelope): boolean {
  return env.status === 'SUCCESS' && Array.isArray(env.object?.vectorDataPoint)
}

// ── backfill: full history for all six vectors in one bulk request ───────────
// Uses getBulkVectorDataByRange (a single POST for all vectors). The guide
// suggested getFullTableDownloadCSV, but each of our tables (18-10-0004,
// 14-10-0287) is a multi-hundred-MB dump of every product × geography; pulling
// six named vectors by range is far leaner and yields identical history.
export async function backfill(): Promise<void> {
  console.log('[StatCan] backfill starting…')
  const end = new Date().toISOString().slice(0, 16) // "YYYY-MM-DDTHH:mm"
  let res: Response
  try {
    res = await fetch(`${WDS_BASE}/getBulkVectorDataByRange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectorIds: SERIES.map(s => String(s.vectorId)),
        startDataPointReleaseDate: BACKFILL_RELEASE_START,
        endDataPointReleaseDate: end,
      }),
    })
  } catch (err) {
    console.warn(`[StatCan] backfill fetch failed — ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (!res.ok) {
    console.warn(`[StatCan] backfill HTTP ${res.status}`)
    return
  }
  const body = (await res.json()) as WdsEnvelope[]
  for (const env of body) {
    if (!isSuccess(env)) {
      console.warn(`[StatCan] backfill: vector ${env?.object?.vectorId ?? '?'} returned ${env?.status}`)
      continue
    }
    const def = BY_VECTOR.get(env.object.vectorId)
    if (!def) continue
    const obs = mapDataPoints(env.object.vectorDataPoint!)
    const n = storeStatcanObservations(def.code, def.unit, obs)
    const stored = obs.filter(o => o.value != null)
    console.log(`[StatCan] backfill ${def.code} (v${def.vectorId}): ${n} rows (${stored[0]?.date ?? '—'} → ${stored[stored.length - 1]?.date ?? '—'})`)
    await sleep(100) // courtesy throttle — well under the 25 req/sec/IP cap
  }
  console.log('[StatCan] backfill done.')
}

// ── incremental: latest 3 periods per vector ────────────────────────────────
// Uses getDataFromVectorsAndLatestNPeriods with latestN=3 (criterion #3). Falls
// back to a full backfill when no series has any rows yet, so a single startup
// or cron call handles both the empty and steady-state cases. StatCan CPI
// publishes monthly (mid-month, prior month), so this is a no-op most days.
export async function syncIncremental(): Promise<void> {
  const anyData = SERIES.some(s => getStatcanLatestDate(s.code) != null)
  if (!anyData) {
    await backfill()
    return
  }

  let res: Response
  try {
    res = await fetch(`${WDS_BASE}/getDataFromVectorsAndLatestNPeriods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SERIES.map(s => ({ vectorId: s.vectorId, latestN: 3 }))),
    })
  } catch (err) {
    console.warn(`[StatCan] sync fetch failed — ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (!res.ok) {
    console.warn(`[StatCan] sync HTTP ${res.status}`)
    return
  }
  const body = (await res.json()) as WdsEnvelope[]
  for (const env of body) {
    if (!isSuccess(env)) {
      console.warn(`[StatCan] sync: vector ${env?.object?.vectorId ?? '?'} returned ${env?.status}`)
      continue
    }
    const def = BY_VECTOR.get(env.object.vectorId)
    if (!def) continue
    const obs = mapDataPoints(env.object.vectorDataPoint!)
    const n = storeStatcanObservations(def.code, def.unit, obs)
    if (n > 0) console.log(`[StatCan] sync ${def.code}: ${n} latest rows upserted`)
  }
}
