// Australian Bureau of Statistics (ABS Data API, SDMX REST) collector for the
// AUD rates fundamental model. Pulls eight Australian macro series from the
// public ABS Data API (https://data.api.abs.gov.au/rest) as SDMX-CSV and upserts
// them into `au_macro_series`. No API key. Mixed monthly/quarterly frequency —
// the dashboard renders the two cadences differently, so `frequency` is stored.
//
// DATAFLOW / KEY VERIFICATION (read before editing — the guide was outdated):
// The uploaded `docs/abs-australian-fundamental-series-guide.md` predates the ABS
// dataflow restructure and was materially wrong about WHERE the series live. All
// dataflow IDs and SDMX keys below were resolved EMPIRICALLY against the live ABS
// API and cross-checked against ABS's own published % series on 2026-05-27
// (monthly headline YoY 102.8/98.68−1 = 4.18% vs ABS-published 4.2%; trimmed mean
// 3.4% M / 3.5% Q). Corrections vs the guide:
//   • The guide's `CPI_M` is the DISCONTINUED Monthly CPI *indicator* (data ends
//     2025-09). The NEW complete Monthly CPI lives in `CPI` v2.0.0, FREQ=M, on a
//     ~2023-24=100 base, back to 2024-04.
//   • `CPI` v2.0.0 also carries the long quarterly headline (FREQ=Q, back to 1948)
//     AND the *monthly* trimmed mean / weighted median (TSEST=20 SA). It does NOT
//     carry the *quarterly* trimmed mean / weighted median.
//   • The quarterly trimmed mean / weighted median (the RBA's preferred underlying
//     gauges during the 2025-27 transition) live in `CPI_Q` v1.0.0 (2011-12=100,
//     back to 1982-Q1). Quarterly headline 10001 is NOT in CPI_Q — it comes from
//     `CPI` v2.0.0. Different base years across flows are fine: we store the raw
//     index and compute YoY/QoQ downstream, which is base-invariant.
//
// SDMX key order (verified via /datastructure ?references=children):
//   CPI / CPI_Q:  MEASURE.INDEX.TSEST.REGION.FREQ
//     MEASURE 1=Index numbers; INDEX 10001=All groups CPI, 999902=Trimmed Mean,
//     999903=Weighted Median; TSEST 10=Original(NSA), 20=Seasonally Adjusted;
//     REGION 50=Australia / weighted avg of eight capital cities; FREQ M|Q.
//   LF:  MEASURE.SEX.AGE.TSEST.REGION.FREQ
//     MEASURE M13=Unemployment rate; SEX 3=Persons; AGE 1599=Total; TSEST 20=SA,
//     30=Trend; REGION AUS; FREQ M.
//
// The URL omits the dataflow VERSION entirely (ABS rejects the literal `latest`
// as an "Invalid version string", but omitting it resolves to the latest version)
// — so a future CPI v2.1.0 / CPI_Q v1.1.0 bump is picked up automatically.

import { parse } from 'csv-parse/sync'
import {
  storeAbsObservations,
  getAbsLatestDate,
} from '../db'

const ABS_BASE = 'https://data.api.abs.gov.au/rest'
const CSV_ACCEPT = 'application/vnd.sdmx.data+csv'

type Freq = 'M' | 'Q'

interface AbsSeriesDef {
  code: string                 // dashboard series_code stored in au_macro_series
  flow: string                 // SDMX dataflow id (version omitted in URL → latest)
  key: string                  // dot-separated dimension key
  freq: Freq
  unit: 'index' | 'percent'
  // First-run label checks: in dataflow `flow`, dimension `dim` code `code` must
  // still carry this exact English label. Guards against ABS rebasing/recoding.
  verify: Array<{ dim: string; code: string; label: string }>
}

const SERIES: AbsSeriesDef[] = [
  // ── Monthly CPI (CPI v2.0.0, ~2023-24=100, from 2024-04) ──────────────────
  {
    code: 'AU_CPI_M_HEADLINE', flow: 'CPI', key: '1.10001.10.50.M', freq: 'M', unit: 'index',
    verify: [
      { dim: 'INDEX', code: '10001', label: 'All groups CPI' },
      { dim: 'TSEST', code: '10', label: 'Original' },
    ],
  },
  {
    code: 'AU_CPI_M_TRIMMED', flow: 'CPI', key: '1.999902.20.50.M', freq: 'M', unit: 'index',
    verify: [
      { dim: 'INDEX', code: '999902', label: 'Trimmed Mean' },
      { dim: 'TSEST', code: '20', label: 'Seasonally Adjusted' },
    ],
  },
  {
    code: 'AU_CPI_M_WGTMED', flow: 'CPI', key: '1.999903.20.50.M', freq: 'M', unit: 'index',
    verify: [{ dim: 'INDEX', code: '999903', label: 'Weighted Median' }],
  },
  // ── Quarterly headline (CPI v2.0.0, FREQ=Q, from 1948) ────────────────────
  {
    code: 'AU_CPI_Q_HEADLINE', flow: 'CPI', key: '1.10001.10.50.Q', freq: 'Q', unit: 'index',
    verify: [{ dim: 'INDEX', code: '10001', label: 'All groups CPI' }],
  },
  // ── Quarterly underlying (CPI_Q v1.0.0, 2011-12=100, from 1982-Q1) ────────
  {
    code: 'AU_CPI_Q_TRIMMED', flow: 'CPI_Q', key: '1.999902.20.50.Q', freq: 'Q', unit: 'index',
    verify: [
      { dim: 'INDEX', code: '999902', label: 'Trimmed Mean' },
      { dim: 'TSEST', code: '20', label: 'Seasonally Adjusted' },
    ],
  },
  {
    code: 'AU_CPI_Q_WGTMED', flow: 'CPI_Q', key: '1.999903.20.50.Q', freq: 'Q', unit: 'index',
    verify: [{ dim: 'INDEX', code: '999903', label: 'Weighted Median' }],
  },
  // ── Unemployment rate (LF v1.0.0, persons 15+, from 1978-02) ──────────────
  {
    code: 'AU_UNRATE_SA', flow: 'LF', key: 'M13.3.1599.20.AUS.M', freq: 'M', unit: 'percent',
    verify: [
      { dim: 'MEASURE', code: 'M13', label: 'Unemployment rate' },
      { dim: 'TSEST', code: '20', label: 'Seasonally Adjusted' },
    ],
  },
  {
    code: 'AU_UNRATE_TREND', flow: 'LF', key: 'M13.3.1599.30.AUS.M', freq: 'M', unit: 'percent',
    verify: [{ dim: 'TSEST', code: '30', label: 'Trend' }],
  },
]

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const THROTTLE_MS = 250

interface RawObs { date: string; value: number | null }

// ── Time period parsing ──────────────────────────────────────────────────────
// Monthly periods are `YYYY-MM`; quarterly are `YYYY-Qn`. Both normalise to a
// first-of-period ISO date (Q1→01, Q2→04, Q3→07, Q4→10), matching the dashboard's
// monthly-series convention so the two cadences line up on a shared time axis.
export function parseTimePeriod(tp: string, freq: Freq): string | null {
  if (freq === 'M') {
    const m = /^(\d{4})-(\d{2})$/.exec(tp.trim())
    return m ? `${m[1]}-${m[2]}-01` : null
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(tp.trim())
  if (!q) return null
  const month = String((parseInt(q[2], 10) - 1) * 3 + 1).padStart(2, '0')
  return `${q[1]}-${month}-01`
}

// ── Metadata verification (first-run / fail-loud) ────────────────────────────
// For each distinct dataflow, fetch its DSD (?references=children), map every
// dimension to its codelist (code→label), and assert each series' cached verify
// entries still hold. Throws on any mismatch — never silently pulls a recoded
// series. Mirrors the e-Stat collector's verifyMetadata().
let metadataVerified = false

async function fetchDimensionLabels(flow: string): Promise<Map<string, Map<string, string>>> {
  const url = `${ABS_BASE}/datastructure/ABS/${flow}?references=children`
  const res = await fetch(url, { headers: { Accept: 'application/vnd.sdmx.structure+json' } })
  if (!res.ok) throw new Error(`[ABS] datastructure ${flow} HTTP ${res.status}`)
  const json: any = await res.json()
  const data = json?.data ?? {}
  const dsds: any[] = data.dataStructures ?? []
  const codelists: any[] = data.codelists ?? []

  // codelist id → (code → name)
  const clMap = new Map<string, Map<string, string>>()
  for (const cl of codelists) {
    const codes = new Map<string, string>()
    for (const c of cl.codes ?? []) codes.set(String(c.id), String(c.name ?? ''))
    clMap.set(String(cl.id), codes)
  }
  // dimension id → codelist id (enumeration ref ends with the codelist id)
  const dimToCodes = new Map<string, Map<string, string>>()
  for (const dsd of dsds) {
    const dims: any[] = dsd?.dataStructureComponents?.dimensionList?.dimensions ?? []
    for (const dim of dims) {
      const enumRef: string = dim?.localRepresentation?.enumeration ?? ''
      // enumRef looks like "urn:…:CL_CPI_INDEX(1.0.0)" or "ABS:CL_CPI_INDEX(1.0.0)"
      const m = /([A-Z0-9_]+)\(/.exec(enumRef) || /:([A-Za-z0-9_]+)$/.exec(enumRef)
      const clId = m ? m[1] : ''
      const codes = clMap.get(clId)
      if (codes) dimToCodes.set(String(dim.id), codes)
    }
  }
  return dimToCodes
}

export async function verifyMetadata(): Promise<void> {
  const flows = [...new Set(SERIES.map(s => s.flow))]
  for (const flow of flows) {
    const dimToCodes = await fetchDimensionLabels(flow)
    for (const def of SERIES.filter(s => s.flow === flow)) {
      for (const v of def.verify) {
        const codes = dimToCodes.get(v.dim)
        if (!codes) {
          throw new Error(`[ABS] ${def.code}: dimension "${v.dim}" not found in ${flow} DSD`)
        }
        const liveLabel = codes.get(v.code)
        if (liveLabel == null) {
          throw new Error(`[ABS] ${def.code}: ${v.dim} code ${v.code} no longer exists in ${flow}`)
        }
        if (liveLabel.trim().toLowerCase() !== v.label.toLowerCase()) {
          throw new Error(
            `[ABS] ${def.code}: ${v.dim} ${v.code} label changed — expected "${v.label}", got ` +
            `"${liveLabel}". ABS may have rebased/recoded; re-verify keys before ingesting.`
          )
        }
      }
    }
    console.log(`[ABS] verifyMetadata ${flow}: ${SERIES.filter(s => s.flow === flow).length} series confirmed.`)
    await sleep(THROTTLE_MS)
  }
  metadataVerified = true
}

// ── Fetch one series' observations (SDMX-CSV) ────────────────────────────────
async function fetchSeries(def: AbsSeriesDef, extra: Record<string, string>): Promise<RawObs[]> {
  const qs = new URLSearchParams({ dimensionAtObservation: 'TIME_PERIOD', ...extra })
  const url = `${ABS_BASE}/data/ABS,${def.flow}/${def.key}?${qs.toString()}`
  const res = await fetch(url, { headers: { Accept: CSV_ACCEPT } })
  const text = await res.text()
  // ABS returns the literal "NoRecordsFound" (200 or 404) for a valid query whose
  // window holds no data — normal for incremental no-ops. Treat as empty.
  if (/^\s*NoRecordsFound/i.test(text)) return []
  if (!res.ok) throw new Error(`[ABS] ${def.code} HTTP ${res.status}: ${text.slice(0, 120)}`)

  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true })
  const out: RawObs[] = []
  for (const row of records) {
    const tp = row.TIME_PERIOD
    const date = tp ? parseTimePeriod(tp, def.freq) : null
    if (!date) continue
    const raw = row.OBS_VALUE
    const num = raw != null && raw.trim() !== '' ? Number(raw) : NaN
    out.push({ date, value: Number.isFinite(num) ? num : null })
  }
  return out
}

// ── backfill: full history for all series ────────────────────────────────────
export async function backfill(): Promise<void> {
  if (!metadataVerified) await verifyMetadata()
  console.log('[ABS] backfill starting…')
  for (const def of SERIES) {
    const obs = await fetchSeries(def, {})
    const n = storeAbsObservations(def.code, def.unit, def.freq, obs)
    const kept = obs.filter(o => o.value != null)
    console.log(`[ABS] backfill ${def.code} (${def.freq}): ${n} rows (${kept[0]?.date ?? '—'} → ${kept[kept.length - 1]?.date ?? '—'})`)
    await sleep(THROTTLE_MS)
  }
  console.log('[ABS] backfill done.')
}

// ── incremental: latest few periods per series ───────────────────────────────
// Uses lastNObservations=6 (≈6 months / 1.5 years quarterly — ample overlap).
// Falls back to a full backfill when the table is empty, so one call covers both
// first-run and steady-state. ABS CPI/LFS publish monthly/quarterly with multi-
// week lags, so this is a no-op most days.
export async function syncIncremental(): Promise<void> {
  const anyData = SERIES.some(s => getAbsLatestDate(s.code) != null)
  if (!anyData) {
    await backfill()
    return
  }
  if (!metadataVerified) await verifyMetadata()

  for (const def of SERIES) {
    const obs = await fetchSeries(def, { lastNObservations: '6' })
    const n = storeAbsObservations(def.code, def.unit, def.freq, obs)
    if (n > 0) console.log(`[ABS] sync ${def.code}: ${n} rows upserted`)
    await sleep(THROTTLE_MS)
  }
}
