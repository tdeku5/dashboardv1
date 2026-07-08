// Generic e-Stat collector for the Japan Economic Data Models (Phase 2,
// docs/jp-models-mapping.md). Sibling of collectors/estatCollector.ts (decision
// f): writes to the same `estat_observations` table, deliberately SKIPS the four
// rates-side codes (CPI_HEADLINE_JP / CPI_CORE_JP / CPI_CORECORE_JP / UNRATE_JP
// — that module stays untouched and keeps owning them), and imports its
// decodeTimeCode (verified to handle both monthly `YYYY000M0M` and SNA
// quarterly `YYYY000103|000406|000709|001012` codes).
//
// e-Stat specifics baked in (all verified live, 2026-07):
// • appId comes from ESTAT_APP_ID and is NEVER logged.
// • `lang` is PER TABLE: Statistics Bureau CPI/LFS tables carry English, but
//   the 2020-base SNA / IIP / FIES tables exist ONLY under lang=J — a lang=E
//   request 404s ("does not exist") even though the table is alive. The health
//   check therefore re-probes a failed lang=E table under lang=J and reports
//   "alive under J (config wrong)" separately from "actually dead".
// • Category codes are not stable across base-year revisions: the health check
//   runs getMetaInfo per (statsDataId, lang), matches the table title AND each
//   configured verify class label, and THROWS on any mismatch (frozen-feed /
//   renumbering defense).
// • Frozen-feed defense (Phase 1 found three ministries that stopped loading
//   the DB): after each sync, any series whose latest observation is older
//   than its `staleDays` threshold logs a LOUD warning.
// • IIP tables use pseudo-time codes (0500100 = 2018-01, +200/month, weight
//   row 0100100 to exclude) — `timeDecoder: 'iip'`.
// • Throttle ~2 req/s (500ms between requests).

import { decodeTimeCode } from './collectors/estatCollector'
import { storeEstatObservations, getEstatLatestDate } from './db'

const BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json'
const THROTTLE_MS = 500

function getAppId(): string {
  const id = process.env.ESTAT_APP_ID
  if (!id) {
    throw new Error('[eStatAll] ESTAT_APP_ID is missing from the environment — set it in .env')
  }
  return id
}

export interface EstatSeriesDef {
  code: string
  statsDataId: string
  /** e-Stat metadata/data language for this table — 2020-base SNA/IIP/FIES are 'J'-only */
  lang: 'E' | 'J'
  /** Substring of the table title (in `lang`) — health check */
  tableTitleIncludes: string
  /** getStatsData category filters, e.g. { cdTab: '1', cdCat01: '0001', cdArea: '00000' } */
  params: Record<string, string>
  /** Per-dim class label checks (in `lang`) — health check */
  verify: Array<{ dim: string; code: string; labelIncludes: string }>
  unit: string
  timeDecoder?: 'standard' | 'iip'
  /** Loud staleness warning when the latest observation is older than this */
  staleDays: number
}

// Shorthand builders keep the 60-entry config readable.
const CPI = (code: string, cat01: string, label: string): EstatSeriesDef => ({
  code, statsDataId: '0003427113', lang: 'E',
  tableTitleIncludes: 'Consumer Price Index',
  params: { cdTab: '1', cdCat01: cat01, cdArea: '00000' },
  verify: [{ dim: 'cat01', code: cat01, labelIncludes: label }],
  unit: 'index', staleDays: 70,
})
const CPI_TOKYO = (code: string, cat01: string, label: string): EstatSeriesDef => ({
  ...CPI(code, cat01, label),
  params: { cdTab: '1', cdCat01: cat01, cdArea: '13A01' },
  verify: [
    { dim: 'cat01', code: cat01, labelIncludes: label },
    { dim: 'area', code: '13A01', labelIncludes: 'Ku-area of Tokyo' },
  ],
  staleDays: 45, // the Tokyo advance leads the national print
})
const GDP = (code: string, statsDataId: string, tab: string, cat01: string, label: string, unit: string): EstatSeriesDef => ({
  code, statsDataId, lang: 'J',
  tableTitleIncludes: '国内総生産',
  params: { cdTab: tab, cdCat01: cat01 },
  verify: [{ dim: 'cat01', code: cat01, labelIncludes: label }],
  unit, staleDays: 230, // quarter-START dating + ~70d publication lag ⇒ ~160-190d is normal
})
const IIP = (code: string, statsDataId: string, title: string, cat01: string, label: string): EstatSeriesDef => ({
  code, statsDataId, lang: 'J',
  tableTitleIncludes: title,
  params: { cdCat01: cat01 },
  verify: [{ dim: 'cat01', code: cat01, labelIncludes: label }],
  unit: 'index', timeDecoder: 'iip', staleDays: 170, // month-start dating + ~3-month by-industry lag
})
const BIZ = (code: string, cat01: string, label: string, unit: string): EstatSeriesDef => ({
  code, statsDataId: '0003446462', lang: 'E',
  tableTitleIncludes: 'Individual Indicator',
  params: { cdTab: '200', cdCat01: cat01 },
  verify: [{ dim: 'cat01', code: cat01, labelIncludes: label }],
  unit, staleDays: 70,
})

export const ALL_ESTAT_SERIES: EstatSeriesDef[] = [
  // ═══ CPI — 0003427113 (2020=100, monthly NSA, area 00000; national headline
  //     trio 0001/0161/0178 lives in the rates-side collector) ═══
  // Divisions (10)
  CPI('JP_CPI_FOOD', '0002', 'Food'),
  CPI('JP_CPI_HOUSING', '0045', 'Housing'),
  CPI('JP_CPI_FUEL', '0054', 'Fuel, light & water charges'),
  CPI('JP_CPI_FURNITURE', '0060', 'Furniture & household utensils'),
  CPI('JP_CPI_CLOTHES', '0082', 'Clothes & footwear'),
  CPI('JP_CPI_MEDICAL', '0107', 'Medical care'),
  CPI('JP_CPI_TRANSPORT', '0111', 'Transportation & communication'),
  CPI('JP_CPI_EDUCATION', '0118', 'Education'),
  CPI('JP_CPI_CULTURE', '0122', 'Culture & recreation'),
  CPI('JP_CPI_MISC', '0145', 'Miscellaneous'),
  // Special aggregates
  CPI('JP_CPI_FRESHFOOD', '0157', 'Fresh food'),
  CPI('JP_CPI_ENERGY', '0167', 'Energy'),
  CPI('JP_CPI_EXIMPRENT', '0163', 'less imputed rent'),
  CPI('JP_CPI_GOODS', '0202', 'Goods'),
  CPI('JP_CPI_SERVICES', '0220', 'Services'),
  CPI('JP_CPI_DUR', '0237', 'Durable goods'),
  CPI('JP_CPI_SEMIDUR', '0238', 'Semi-durable goods'),
  CPI('JP_CPI_NONDUR', '0239', 'Non-durable goods'),
  CPI('JP_CPI_PUBUTIL', '0240', 'Public utilities'),
  // SA variants (in-table)
  CPI('JP_CPI_ALL_SA', '0901', 'All items, seasonally adjusted'),
  CPI('JP_CPI_CORE_SA', '0902', 'less fresh food, seasonally adjusted'),
  CPI('JP_CPI_CORECORE_SA', '0906', 'less fresh food and energy, seasonally adjusted'),
  CPI('JP_CPI_GOODS_SA', '0921', 'Goods, seasonally adjusted'),
  CPI('JP_CPI_SERVICES_SA', '0924', 'Services, seasonally adjusted'),
  // Distribution items (31, L2/L3 selections)
  CPI('JP_CPI_CEREALS', '0003', 'Cereals'),
  CPI('JP_CPI_FISH', '0008', 'Fish & seafood'),
  CPI('JP_CPI_MEATS', '0013', 'Meats'),
  CPI('JP_CPI_DAIRY', '0016', 'Dairy products & eggs'),
  CPI('JP_CPI_VEGETABLES', '0021', 'Vegetables & seaweeds'),
  CPI('JP_CPI_FRUITS', '0027', 'Fruits'),
  CPI('JP_CPI_CAKES', '0033', 'Cakes & candies'),
  CPI('JP_CPI_BEVERAGES', '0037', 'Beverages'),
  CPI('JP_CPI_ALCOHOL', '0041', 'Alcoholic beverages'),
  CPI('JP_CPI_EATINGOUT', '0043', 'Eating out'),
  CPI('JP_CPI_RENT', '0046', 'Rent'),
  CPI('JP_CPI_REPAIRS', '0051', 'Repairs & maintenance'),
  CPI('JP_CPI_ELECTRICITY', '0056', 'Electricity'),
  CPI('JP_CPI_GAS', '3600', 'Gas, manufactured & piped'),
  CPI('JP_CPI_WATER', '0059', 'Water & sewerage'),
  CPI('JP_CPI_HHDURABLES', '0061', 'Household durable goods'),
  CPI('JP_CPI_CLOTHING', '0085', 'Clothing'),
  CPI('JP_CPI_FOOTWEAR', '0098', 'Footwear'),
  CPI('JP_CPI_MEDICINES', '0108', 'Medicines & health fortification'),
  CPI('JP_CPI_MEDSERVICES', '0110', 'Medical services'),
  CPI('JP_CPI_PUBTRANSPORT', '0112', 'Public transportation'),
  CPI('JP_CPI_PRIVTRANSPORT', '0113', 'Private transportation'),
  CPI('JP_CPI_GASOLINE', '7301', 'Gasoline'),
  CPI('JP_CPI_COMMUNICATION', '0117', 'Communication'),
  CPI('JP_CPI_SCHOOLFEES', '0119', 'School fees'),
  CPI('JP_CPI_TUTORIAL', '0121', 'Tutorial fees'),
  CPI('JP_CPI_BOOKS', '0134', 'Books & other reading'),
  CPI('JP_CPI_RECSERVICES', '0138', 'Recreational services'),
  CPI('JP_CPI_HOTELS', '0139', 'Hotel charges'),
  CPI('JP_CPI_PERSONALCARE', '0146', 'Personal care services'),
  CPI('JP_CPI_EFFECTS', '0151', 'Personal effects'),
  // Tokyo advance (decision a — same table, cdArea=13A01, ~1 month ahead)
  CPI_TOKYO('JP_TOKYO_CPI_ALL', '0001', 'All items'),
  CPI_TOKYO('JP_TOKYO_CPI_CORE', '0161', 'less fresh food'),
  CPI_TOKYO('JP_TOKYO_CPI_CORECORE', '0178', 'less fresh food and energy'),

  // ═══ LFS — English tables, monthly NSA ═══
  {
    code: 'JP_PART_RATE', statsDataId: '0003005865', lang: 'E',
    tableTitleIncludes: 'unemployment rate',
    // tab=02 (Rate) × cat02=01 (Labour force) = participation rate — the class
    // name is the bare characteristic; the rate meaning comes from the tab.
    params: { cdTab: '02', cdCat01: '000', cdCat02: '01', cdCat03: '0' },
    verify: [{ dim: 'cat02', code: '01', labelIncludes: 'Labour force' }],
    unit: 'percent', staleDays: 70,
  },
  {
    code: 'JP_EMP_RATE', statsDataId: '0003005865', lang: 'E',
    tableTitleIncludes: 'unemployment rate',
    params: { cdTab: '02', cdCat01: '000', cdCat02: '13', cdCat03: '0' },
    verify: [{ dim: 'cat02', code: '13', labelIncludes: 'Employment' }],
    unit: 'percent', staleDays: 70,
  },
  {
    code: 'JP_EMPLOYED', statsDataId: '0002060001', lang: 'E',
    tableTitleIncludes: 'Employed person',
    params: { cdTab: '01', cdCat01: '000', cdCat02: '00', cdCat03: '0' },
    verify: [{ dim: 'cat02', code: '00', labelIncludes: 'Total' }],
    unit: 'ten-thousand persons', staleDays: 70,
  },
  // By-age unemployment rates — 0002060004 (NOTE: cat02=Sex, cat03=rate type — swapped vs 0003005865)
  ...[
    ['JP_UR_15_24', '01', '15 to 24'],
    ['JP_UR_25_34', '06', '25 to 34'],
    ['JP_UR_35_44', '09', '35 to 44'],
    ['JP_UR_45_54', '12', '45 to 54'],
    ['JP_UR_55_64', '15', '55 to 64'],
  ].map(([code, age, label]): EstatSeriesDef => ({
    code, statsDataId: '0002060004', lang: 'E',
    tableTitleIncludes: 'unemployment rate',
    params: { cdTab: '02', cdCat02: '0', cdCat03: '08', cdCat04: age },
    verify: [{ dim: 'cat04', code: age, labelIncludes: label }],
    unit: 'percent', staleDays: 70,
  })),

  // ═══ Business-conditions individual indicators — 0003446462 (monthly, 1975→, English) ═══
  BIZ('JP_UNRATE_SA', '3060', 'Unemployment Rate', 'percent'),          // the only API-native SA unemployment
  BIZ('JP_JOBOFFER_RATIO', '2090', 'Effective Job Offer Rate', 'ratio'), // SA, the JOLTS-analog headline
  BIZ('JP_NEWOFFERS', '1030', 'New Job Offers', 'persons'),
  BIZ('JP_MFG_EARNINGS', '3070', 'Contractual Cash Earnings', 'index'),  // manufacturing only (2020=100)
  BIZ('JP_REGEMP_YOY', '3020', 'Regular Workers Employment', 'percent'), // MLS-derived, YoY %

  // ═══ Quarterly GDP (SNA, 2020-base, lang=J ONLY; unit 10億円 = ¥bn annualized; 1994Q1→) ═══
  // Real SA levels — 0003109750 (tab 11 = 金額)
  GDP('JP_GDP_R', '0003109750', '11', '11', '国内総生産(支出側)', 'billion yen'),
  GDP('JP_CONS_R', '0003109750', '11', '12', '民間最終消費支出', 'billion yen'),
  GDP('JP_RESINV_R', '0003109750', '11', '15', '民間住宅', 'billion yen'),
  GDP('JP_CAPEX_R', '0003109750', '11', '16', '民間企業設備', 'billion yen'),
  GDP('JP_INVENT_R', '0003109750', '11', '17', '民間在庫', 'billion yen'),
  GDP('JP_GOV_R', '0003109750', '11', '18', '政府最終消費支出', 'billion yen'),
  GDP('JP_PUBINV_R', '0003109750', '11', '19', '公的固定資本形成', 'billion yen'),
  GDP('JP_EXPORTS_R', '0003109750', '11', '22', '輸出', 'billion yen'),
  GDP('JP_IMPORTS_R', '0003109750', '11', '23', '輸入', 'billion yen'),
  // Published growth/contributions — 0003113542 (tab 14 QoQ, 15 QoQ-annualized, 16 contribution-annualized)
  GDP('JP_GDP_QOQ', '0003113542', '14', '11', '国内総生産(支出側)', 'percent'),
  GDP('JP_GDP_QOQA', '0003113542', '15', '11', '国内総生産(支出側)', 'percent'),
  GDP('JP_CTB_CONS', '0003113542', '16', '12', '民間最終消費支出', 'percent'),
  GDP('JP_CTB_RESINV', '0003113542', '16', '15', '民間住宅', 'percent'),
  GDP('JP_CTB_CAPEX', '0003113542', '16', '16', '民間企業設備', 'percent'),
  GDP('JP_CTB_INVENT', '0003113542', '16', '17', '民間在庫', 'percent'),
  GDP('JP_CTB_GOV', '0003113542', '16', '18', '政府最終消費支出', 'percent'),
  GDP('JP_CTB_PUBINV', '0003113542', '16', '19', '公的固定資本形成', 'percent'),
  GDP('JP_CTB_EXPORTS', '0003113542', '16', '22', '輸出', 'percent'),
  GDP('JP_CTB_IMPORTS', '0003113542', '16', '23', '輸入', 'percent'),
  // Nominal SA levels — 0003109785 (tab 11)
  GDP('JP_GDP_N', '0003109785', '11', '11', '国内総生産(支出側)', 'billion yen'),
  GDP('JP_CONS_N', '0003109785', '11', '12', '民間最終消費支出', 'billion yen'),
  GDP('JP_CAPEX_N', '0003109785', '11', '16', '民間企業設備', 'billion yen'),
  GDP('JP_GOV_N', '0003109785', '11', '18', '政府最終消費支出', 'billion yen'),
  GDP('JP_EXPORTS_N', '0003109785', '11', '22', '輸出', 'billion yen'),
  GDP('JP_IMPORTS_N', '0003109785', '11', '23', '輸入', 'billion yen'),
  // Deflator SA — 0003109787 (tab 19 = 指数)
  GDP('JP_GDP_DEFLATOR', '0003109787', '19', '11', '国内総生産(支出側)', 'index'),

  // ═══ FIES household consumption — 0002070001 (lang=J ONLY; monthly NSA; ¥/household; 2000→ on cat02=03) ═══
  {
    code: 'JP_HH_SPENDING', statsDataId: '0002070001', lang: 'J',
    tableTitleIncludes: '用途分類',
    params: { cdTab: '01', cdCat01: '059', cdCat02: '03', cdArea: '00000' },
    verify: [
      { dim: 'cat01', code: '059', labelIncludes: '消費支出' },
      { dim: 'cat02', code: '03', labelIncludes: '二人以上の世帯' },
    ],
    unit: 'yen', staleDays: 75,
  },

  // ═══ IIP — 2020=100 monthly SA, 2018-01→ (lang=J ONLY; pseudo-time codes) ═══
  IIP('JP_IIP_PROD', '0004052177', '生産', '0001000', '鉱工業'),
  IIP('JP_IIP_PROD_MFG', '0004052177', '生産', '0002000', '製造工業'),
  IIP('JP_IIP_SHIP', '0004052178', '出荷', '0001000', '鉱工業'),
  IIP('JP_IIP_INV', '0004052179', '在庫', '0001000', '鉱工業'),
  IIP('JP_IIP_INVRATIO', '0004052180', '在庫率', '0001000', '鉱工業'),
]

// Codes owned by the rates-side collector — never configured here.
const RATES_SIDE_CODES = new Set(['CPI_HEADLINE_JP', 'CPI_CORE_JP', 'CPI_CORECORE_JP', 'UNRATE_JP'])
for (const s of ALL_ESTAT_SERIES) {
  if (RATES_SIDE_CODES.has(s.code)) throw new Error(`[eStatAll] ${s.code} belongs to collectors/estatCollector.ts`)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function apiGet(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ appId: getAppId(), ...params })
  const res = await fetch(`${BASE}/${endpoint}?${qs}`)
  await sleep(THROTTLE_MS)
  if (!res.ok) throw new Error(`[eStatAll] ${endpoint} HTTP ${res.status}`)
  return res.json() as Promise<Record<string, unknown>>
}

// ── time decoding ────────────────────────────────────────────────────────────

/** IIP pseudo-time: 0500100 = 2018-01, +200 per month; 0100100 is a weight row. */
export function decodeIipTimeCode(code: string): string | null {
  const n = parseInt(code, 10)
  if (!Number.isFinite(n) || n < 500100) return null // excludes the 0100100 weight row
  const idx = (n - 500100) / 200
  if (!Number.isInteger(idx) || idx < 0) return null
  const year = 2018 + Math.floor(idx / 12)
  const month = (idx % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function decode(def: EstatSeriesDef, timeCode: string): string | null {
  return def.timeDecoder === 'iip' ? decodeIipTimeCode(timeCode) : decodeTimeCode(timeCode)
}

// ── metadata health check ────────────────────────────────────────────────────

interface MetaClass { '@code': string; '@name': string }
interface MetaClassObj { '@id': string; CLASS: MetaClass | MetaClass[] }

function asArray<T>(x: T | T[] | undefined): T[] {
  return x === undefined ? [] : Array.isArray(x) ? x : [x]
}

/**
 * getMetaInfo per unique (statsDataId, lang): verify table title + every
 * configured class label. Distinguishes "404 under lang=E but alive under
 * lang=J" (config error) from an actually-dead table. THROWS on any failure.
 */
export async function verifyEstatMetadata(): Promise<void> {
  const failures: string[] = []
  const tables = new Map<string, EstatSeriesDef[]>()
  for (const s of ALL_ESTAT_SERIES) {
    const key = `${s.statsDataId}:${s.lang}`
    tables.set(key, [...(tables.get(key) ?? []), s])
  }

  for (const [key, defs] of tables) {
    const [statsDataId, lang] = key.split(':')
    const body = await apiGet('getMetaInfo', { statsDataId, lang })
    const root = (body as { GET_META_INFO?: { RESULT?: { STATUS?: number; ERROR_MSG?: string }; METADATA_INF?: { TABLE_INF?: Record<string, unknown>; CLASS_INF?: { CLASS_OBJ?: MetaClassObj | MetaClassObj[] } } } }).GET_META_INFO
    if (!root || root.RESULT?.STATUS !== 0) {
      // Is it dead, or just hidden by the language? (2020-base ministry tables 404 under lang=E.)
      if (lang === 'E') {
        const retry = await apiGet('getMetaInfo', { statsDataId, lang: 'J' })
        const retryRoot = (retry as { GET_META_INFO?: { RESULT?: { STATUS?: number } } }).GET_META_INFO
        if (retryRoot?.RESULT?.STATUS === 0) {
          failures.push(`${statsDataId}: alive under lang=J but configured lang=E — fix the config, do not treat as dead`)
          continue
        }
      }
      failures.push(`${statsDataId} (lang=${lang}): getMetaInfo failed — ${root?.RESULT?.ERROR_MSG ?? 'no response'}`)
      continue
    }

    const tableTitleRaw = root.METADATA_INF?.TABLE_INF?.TITLE
    const tableTitle = typeof tableTitleRaw === 'object' && tableTitleRaw !== null
      ? String((tableTitleRaw as { $?: string }).$ ?? '')
      : String(tableTitleRaw ?? '')
    const statNameRaw = root.METADATA_INF?.TABLE_INF?.STAT_NAME
    const statName = typeof statNameRaw === 'object' && statNameRaw !== null
      ? String((statNameRaw as { $?: string }).$ ?? '')
      : String(statNameRaw ?? '')

    const classByDim = new Map<string, MetaClass[]>()
    for (const obj of asArray(root.METADATA_INF?.CLASS_INF?.CLASS_OBJ)) {
      classByDim.set(obj['@id'], asArray(obj.CLASS))
    }

    for (const def of defs) {
      if (!tableTitle.includes(def.tableTitleIncludes) && !statName.includes(def.tableTitleIncludes)) {
        failures.push(`${def.code}: table ${statsDataId} title "${tableTitle.slice(0, 60)}" lacks "${def.tableTitleIncludes}"`)
        continue
      }
      for (const v of def.verify) {
        const cls = classByDim.get(v.dim)
        const hit = cls?.find(c => c['@code'] === v.code)
        if (!hit) {
          failures.push(`${def.code}: dim ${v.dim} has no class ${v.code} in ${statsDataId} (base-year renumbering?)`)
        } else if (!hit['@name'].includes(v.labelIncludes)) {
          failures.push(`${def.code}: class ${v.code} is "${hit['@name'].slice(0, 60)}", expected to include "${v.labelIncludes}"`)
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`[eStatAll] metadata verification FAILED for ${failures.length} item(s):\n  ${failures.join('\n  ')}`)
  }
  console.log(`[eStatAll] metadata verified: ${ALL_ESTAT_SERIES.length} series across ${tables.size} table/lang combinations.`)
}

// ── sync ─────────────────────────────────────────────────────────────────────

interface EstatValue { '@time'?: string; '$'?: string }

/** Full refetch per series (e-Stat has no incremental endpoint); upserts are idempotent. */
export async function syncAllEstatSeries(): Promise<void> {
  console.log(`[eStatAll] syncing ${ALL_ESTAT_SERIES.length} series…`)
  let totalRows = 0
  const stale: string[] = []

  for (const def of ALL_ESTAT_SERIES) {
    let body: Record<string, unknown>
    try {
      body = await apiGet('getStatsData', {
        statsDataId: def.statsDataId,
        lang: def.lang,
        metaGetFlg: 'N',
        ...def.params,
      })
    } catch (err) {
      console.error(`[eStatAll] ${def.code}: fetch failed —`, err instanceof Error ? err.message : String(err))
      continue
    }
    const root = (body as {
      GET_STATS_DATA?: {
        RESULT?: { STATUS?: number; ERROR_MSG?: string }
        STATISTICAL_DATA?: { DATA_INF?: { VALUE?: EstatValue | EstatValue[] } }
      }
    }).GET_STATS_DATA
    if (!root || root.RESULT?.STATUS !== 0) {
      console.error(`[eStatAll] ${def.code}: getStatsData status ${root?.RESULT?.STATUS} — ${root?.RESULT?.ERROR_MSG ?? ''}`)
      continue
    }
    const values = asArray(root.STATISTICAL_DATA?.DATA_INF?.VALUE)
    const obs: Array<{ date: string; value: number | null }> = []
    for (const v of values) {
      const date = v['@time'] ? decode(def, v['@time']) : null
      if (!date) continue
      const raw = v.$
      const num = raw !== undefined && raw !== null && String(raw).trim() !== '' ? Number(raw) : NaN
      obs.push({ date, value: Number.isFinite(num) ? num : null })
    }
    const n = storeEstatObservations(def.code, def.unit, obs)
    if (n === 0) {
      console.error(`[eStatAll] ${def.code}: ZERO rows stored (${values.length} raw values) — investigate`)
      continue
    }
    totalRows += n
    console.log(`[eStatAll] ${def.code}: ${n} rows (latest ${getEstatLatestDate(def.code)})`)

    // Frozen-feed defense: loud warning when the feed has gone quiet.
    const latest = getEstatLatestDate(def.code)
    if (latest) {
      const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000
      if (ageDays > def.staleDays) {
        stale.push(`${def.code}: latest ${latest} is ${Math.round(ageDays)}d old (threshold ${def.staleDays}d)`)
      }
    }
  }

  if (stale.length > 0) {
    console.warn(`[eStatAll] ⚠ FROZEN-FEED WARNING — ${stale.length} series stale:\n  ${stale.join('\n  ')}`)
  }
  console.log(`[eStatAll] sync done (${totalRows} rows upserted).`)
}
