// Generic Eurostat collector for the DE/FR/IT economic models (Phase 2,
// docs/eu3-models-mapping.md). SDMX-CSV format — same parse-by-header shape as
// the ECB collector, and multi-geo keys (`…DE+FR+IT`) batch three countries per
// request. No auth.
//
// Eurostat specifics baked in (verified live 2026-07):
// • Dimension ORDER differs per dataset (gov_10q_ggdebt puts unit after sector,
//   unlike ggnfa) — each dataset entry records its `dimOrder`, and the startup
//   health check asserts it against the live JSON-stat dimension `id` array,
//   failing LOUDLY on silent reordering (the Eurostat analog of vector
//   renumbering).
// • s_adj codes are per COUNTRY for some concepts (FR national-accounts
//   employment is SA where DE/IT are SCA; D1 compensation likewise) — defs may
//   carry `keyByGeo` overrides instead of one shared key.
// • OBS_FLAG is CAPTURED into the schema (`b` break-in-series, `p` provisional,
//   `e` estimate, `d` definition-differs, `u` low reliability) — Germany's
//   permits e-flags and the unemployment break markers surface in the UI.
// • History floors differ per country (FR GDP 1980Q1 / DE 1991Q1 / IT 1996Q1);
//   full-history fetch per series, no assumed shared floor.
// • Frozen-feed staleness warnings per series (Japan precedent).
// • Throttle ~2 req/s.

import { storeEurostatObservations, getEurostatLatestDate } from './db'

const BASE = 'https://ec.europa.eu/eurostat/api/dissemination'
const THROTTLE_MS = 500
const GEOS = ['DE', 'FR', 'IT'] as const
type Geo = (typeof GEOS)[number]

export interface EurostatSeriesDef {
  /** Dashboard series_code per geo, e.g. { DE: 'DE_GDP_R', FR: 'FR_GDP_R', IT: 'IT_GDP_R' } */
  codes: Record<Geo, string>
  dataset: string
  /** SDMX key with `{geo}` placeholder (geo dim position per dimOrder) */
  key: string
  /** Per-geo key override when dimension codes differ by country (e.g. s_adj) */
  keyByGeo?: Partial<Record<Geo, string>>
  unit: string
  freq: 'M' | 'Q' | 'A'
  staleDays: number
}

/** Dataset-level metadata assertions for the health check. */
interface DatasetCheck {
  dataset: string
  titleIncludes: string
  /** Expected dimension id order (minus time), from docs/eu3-models-mapping.md */
  dimOrder: string[]
}

export const EUROSTAT_DATASET_CHECKS: DatasetCheck[] = [
  { dataset: 'namq_10_gdp', titleIncludes: 'Gross domestic product', dimOrder: ['freq', 'unit', 's_adj', 'na_item', 'geo'] },
  { dataset: 'gov_10q_ggnfa', titleIncludes: 'non-financial accounts for general government', dimOrder: ['freq', 'unit', 's_adj', 'sector', 'na_item', 'geo'] },
  { dataset: 'gov_10q_ggdebt', titleIncludes: 'government debt', dimOrder: ['freq', 'na_item', 'sector', 'unit', 'geo'] },
  { dataset: 'une_rt_m', titleIncludes: 'Unemployment by sex and age', dimOrder: ['freq', 's_adj', 'age', 'unit', 'sex', 'geo'] },
  { dataset: 'namq_10_a10_e', titleIncludes: 'Employment', dimOrder: ['freq', 'unit', 'nace_r2', 's_adj', 'na_item', 'geo'] },
  { dataset: 'jvs_q_nace2', titleIncludes: 'Job vacancy', dimOrder: ['freq', 's_adj', 'nace_r2', 'sizeclas', 'indic_em', 'geo'] },
  { dataset: 'lc_lci_r2_q', titleIncludes: 'Labour cost index', dimOrder: ['freq', 's_adj', 'unit', 'nace_r2', 'lcstruct', 'geo'] },
  { dataset: 'sts_inpr_m', titleIncludes: 'Production in industry', dimOrder: ['freq', 'indic_bt', 'nace_r2', 's_adj', 'unit', 'geo'] },
  { dataset: 'sts_copr_m', titleIncludes: 'Production in construction', dimOrder: ['freq', 'indic_bt', 'nace_r2', 's_adj', 'unit', 'geo'] },
  { dataset: 'sts_trtu_m', titleIncludes: 'Turnover and volume of sales', dimOrder: ['freq', 'indic_bt', 'nace_r2', 's_adj', 'unit', 'geo'] },
  { dataset: 'ei_eteu27_2020_m', titleIncludes: 'trade', dimOrder: ['freq', 'stk_flow', 'unit', 'partner', 'indic', 'geo'] },
  { dataset: 'ei_bsco_m', titleIncludes: 'Consumer', dimOrder: ['freq', 'indic', 's_adj', 'unit', 'geo'] },
  { dataset: 'ei_bssi_m_r2', titleIncludes: 'sentiment', dimOrder: ['freq', 'indic', 's_adj', 'geo'] },
  { dataset: 'nasq_10_ki', titleIncludes: 'Key indicators', dimOrder: ['freq', 'unit', 's_adj', 'na_item', 'sector', 'geo'] },
  { dataset: 'prc_hpi_q', titleIncludes: 'House price index', dimOrder: ['freq', 'purchase', 'unit', 'geo'] },
  { dataset: 'sts_cobp_q', titleIncludes: 'Building permits', dimOrder: ['freq', 'indic_bt', 'cpa2_1', 's_adj', 'unit', 'geo'] },
  { dataset: 'prc_hicp_inw', titleIncludes: 'HICP', dimOrder: ['freq', 'coicop', 'geo'] },
]

// Shorthand: geo-suffixed codes from one stem.
const c = (stem: string): Record<Geo, string> =>
  ({ DE: `DE_${stem}`, FR: `FR_${stem}`, IT: `IT_${stem}` })

export const ALL_EUROSTAT_SERIES: EurostatSeriesDef[] = [
  // ═══ Quarterly GDP (namq_10_gdp; SCA; €M chain-linked 2020) ═══
  ...([
    ['GDP_R', 'B1GQ'], ['CONS_R', 'P31_S14_S15'], ['GFCF_R', 'P51G'],
    ['GOV_R', 'P3_S13'], ['EXPORTS_R', 'P6'], ['IMPORTS_R', 'P7'],
  ] as const).map(([stem, item]): EurostatSeriesDef => ({
    codes: c(stem), dataset: 'namq_10_gdp', key: `Q.CLV20_MEUR.SCA.${item}.{geo}`,
    unit: 'mio_eur_clv', freq: 'Q', staleDays: 230,
  })),
  // Published growth (QoQ / YoY / annualized) — headline GDP
  { codes: c('GDP_QOQ'), dataset: 'namq_10_gdp', key: 'Q.CLV_PCH_PRE.SCA.B1GQ.{geo}', unit: 'percent', freq: 'Q', staleDays: 230 },
  { codes: c('GDP_YOY'), dataset: 'namq_10_gdp', key: 'Q.CLV_PCH_SM.SCA.B1GQ.{geo}', unit: 'percent', freq: 'Q', staleDays: 230 },
  { codes: c('GDP_QOQA'), dataset: 'namq_10_gdp', key: 'Q.CLV_PCH_ANN.SCA.B1GQ.{geo}', unit: 'percent', freq: 'Q', staleDays: 230 },
  // Published QoQ contributions (pp) — 5 expenditure components
  ...([
    ['CTB_CONS', 'P31_S14_S15'], ['CTB_GFCF', 'P51G'], ['CTB_GOV', 'P3_S13'],
    ['CTB_EXPORTS', 'P6'], ['CTB_IMPORTS', 'P7'],
  ] as const).map(([stem, item]): EurostatSeriesDef => ({
    codes: c(stem), dataset: 'namq_10_gdp', key: `Q.CON_PPCH_PRE.SCA.${item}.{geo}`,
    unit: 'percent', freq: 'Q', staleDays: 230,
  })),
  { codes: c('GDP_N'), dataset: 'namq_10_gdp', key: 'Q.CP_MEUR.SCA.B1GQ.{geo}', unit: 'mio_eur', freq: 'Q', staleDays: 230 },
  { codes: c('GDP_DEFLATOR'), dataset: 'namq_10_gdp', key: 'Q.PD20_EUR.SCA.B1GQ.{geo}', unit: 'index', freq: 'Q', staleDays: 230 },
  // Compensation of employees — s_adj is per country (DE/FR: SA; IT: SCA)
  {
    codes: c('COMP'), dataset: 'namq_10_gdp', key: 'Q.CP_MEUR.SA.D1.{geo}',
    keyByGeo: { IT: 'Q.CP_MEUR.SCA.D1.IT' },
    unit: 'mio_eur', freq: 'Q', staleDays: 230,
  },

  // ═══ Fiscal (gov_10q_ggnfa NSA — the only common denominator (IT is NSA-only); ggdebt) ═══
  ...([
    ['FISC_B9', 'B9'], ['FISC_REV', 'TR'], ['FISC_EXP', 'TE'],
  ] as const).flatMap(([stem, item]): EurostatSeriesDef[] => ([
    { codes: c(stem), dataset: 'gov_10q_ggnfa', key: `Q.MIO_EUR.NSA.S13.${item}.{geo}`, unit: 'mio_eur', freq: 'Q', staleDays: 240 },
    { codes: c(`${stem}_PCGDP`), dataset: 'gov_10q_ggnfa', key: `Q.PC_GDP.NSA.S13.${item}.{geo}`, unit: 'percent', freq: 'Q', staleDays: 240 },
  ])),
  { codes: c('DEBT'), dataset: 'gov_10q_ggdebt', key: 'Q.GD.S13.MIO_EUR.{geo}', unit: 'mio_eur', freq: 'Q', staleDays: 240 },
  { codes: c('DEBT_PCGDP'), dataset: 'gov_10q_ggdebt', key: 'Q.GD.S13.PC_GDP.{geo}', unit: 'percent', freq: 'Q', staleDays: 240 },

  // ═══ Labor detail (headline SA u-rate comes from the ECB LFSI extension) ═══
  { codes: c('UR_YOUTH'), dataset: 'une_rt_m', key: 'M.SA.Y_LT25.PC_ACT.T.{geo}', unit: 'percent', freq: 'M', staleDays: 75 },
  { codes: c('UNEMP_LEVEL'), dataset: 'une_rt_m', key: 'M.SA.TOTAL.THS_PER.T.{geo}', unit: 'ths_persons', freq: 'M', staleDays: 75 },
  // Payrolls proxy (decision d): national-accounts employees; s_adj per country (FR persons are SA-only)
  {
    codes: c('EMPLOYEES'), dataset: 'namq_10_a10_e', key: 'Q.THS_PER.TOTAL.SCA.SAL_DC.{geo}',
    keyByGeo: { FR: 'Q.THS_PER.TOTAL.SA.SAL_DC.FR' },
    unit: 'ths_persons', freq: 'Q', staleDays: 230,
  },
  {
    codes: c('EMPLOYMENT'), dataset: 'namq_10_a10_e', key: 'Q.THS_PER.TOTAL.SCA.EMP_DC.{geo}',
    keyByGeo: { FR: 'Q.THS_PER.TOTAL.SA.EMP_DC.FR' },
    unit: 'ths_persons', freq: 'Q', staleDays: 230,
  },
  { codes: c('HOURS'), dataset: 'namq_10_a10_e', key: 'Q.THS_HW.TOTAL.SCA.EMP_DC.{geo}', unit: 'ths_hours', freq: 'Q', staleDays: 230 },
  // Vacancy rate (SA; FR carries d-flags + 2011 start; IT rate-only — captured in caveats)
  { codes: c('VACRATE'), dataset: 'jvs_q_nace2', key: 'Q.SA.B-S.TOTAL.JVR.{geo}', unit: 'percent', freq: 'Q', staleDays: 300 },
  // Labour cost index + published YoY
  { codes: c('LCI'), dataset: 'lc_lci_r2_q', key: 'Q.SCA.I20.B-S.D1_D4_MD5.{geo}', unit: 'index', freq: 'Q', staleDays: 230 },
  { codes: c('LCI_YOY'), dataset: 'lc_lci_r2_q', key: 'Q.CA.PCH_SM.B-S.D1_D4_MD5.{geo}', unit: 'percent', freq: 'Q', staleDays: 230 },

  // ═══ Industry / retail / construction (SCA, 2021=100; IT lags one month) ═══
  ...([
    ['IP', 'B-D'], ['IP_MFG', 'C'], ['IP_INTERMED', 'MIG_ING'],
    ['IP_CAPITAL', 'MIG_CAG'], ['IP_CONSUMER', 'MIG_COG'],
  ] as const).map(([stem, nace]): EurostatSeriesDef => ({
    codes: c(stem), dataset: 'sts_inpr_m', key: `M.PRD.${nace}.SCA.I21.{geo}`,
    unit: 'index', freq: 'M', staleDays: 100,
  })),
  { codes: c('CONSTRUCTION'), dataset: 'sts_copr_m', key: 'M.PRD.F.SCA.I21.{geo}', unit: 'index', freq: 'M', staleDays: 100 },
  { codes: c('RETAIL'), dataset: 'sts_trtu_m', key: 'M.VOL_SLS.G47.SCA.I21.{geo}', unit: 'index', freq: 'M', staleDays: 100 },
  { codes: c('RETAIL_XFUEL'), dataset: 'sts_trtu_m', key: 'M.VOL_SLS.G47_X_G473.SCA.I21.{geo}', unit: 'index', freq: 'M', staleDays: 100 },

  // ═══ Trade (SA €M, world, 2002→; lags IP by ~1 month) ═══
  { codes: c('TRADE_BAL'), dataset: 'ei_eteu27_2020_m', key: 'M.BAL_RT.MIO-EUR-SA.WORLD.ET-T.{geo}', unit: 'mio_eur', freq: 'M', staleDays: 100 },
  { codes: c('TRADE_EXP'), dataset: 'ei_eteu27_2020_m', key: 'M.EXP.MIO-EUR-SA.WORLD.ET-T.{geo}', unit: 'mio_eur', freq: 'M', staleDays: 100 },
  { codes: c('TRADE_IMP'), dataset: 'ei_eteu27_2020_m', key: 'M.IMP.MIO-EUR-SA.WORLD.ET-T.{geo}', unit: 'mio_eur', freq: 'M', staleDays: 100 },

  // ═══ Sentiment (DG-ECFIN harmonized surveys; decision e) + household ═══
  { codes: c('CONS_CONF'), dataset: 'ei_bsco_m', key: 'M.BS-CSMCI.SA.BAL.{geo}', unit: 'balance', freq: 'M', staleDays: 75 },
  { codes: c('ESI'), dataset: 'ei_bssi_m_r2', key: 'M.BS-ESI-I.SA.{geo}', unit: 'index', freq: 'M', staleDays: 75 },
  { codes: c('IND_CONF'), dataset: 'ei_bssi_m_r2', key: 'M.BS-ICI-BAL.SA.{geo}', unit: 'balance', freq: 'M', staleDays: 75 },
  { codes: c('SAVING_RATE'), dataset: 'nasq_10_ki', key: 'Q.PC.SCA.SRG_S14_S15.S14_S15.{geo}', unit: 'percent', freq: 'Q', staleDays: 300 },

  // ═══ Housing (decision c: prices + permits, index form) ═══
  { codes: c('HPI'), dataset: 'prc_hpi_q', key: 'Q.TOTAL.I15_Q.{geo}', unit: 'index', freq: 'Q', staleDays: 240 },
  { codes: c('HPI_YOY'), dataset: 'prc_hpi_q', key: 'Q.TOTAL.RCH_A.{geo}', unit: 'percent', freq: 'Q', staleDays: 240 },
  { codes: c('PERMITS'), dataset: 'sts_cobp_q', key: 'Q.BPRM_DW.CPA_F41001_X_410014.SCA.I21.{geo}', unit: 'index', freq: 'Q', staleDays: 300 },
  { codes: c('PERMITS_NSA'), dataset: 'sts_cobp_q', key: 'Q.BPRM_DW.CPA_F41001_X_410014.NSA.I21.{geo}', unit: 'index', freq: 'Q', staleDays: 300 },

  // ═══ HICP division weights (annual per-mille; contribution panels) ═══
  ...Array.from({ length: 12 }, (_, i) => {
    const div = `CP${String(i + 1).padStart(2, '0')}`
    return {
      codes: c(`HICPW_${div}`), dataset: 'prc_hicp_inw', key: `A.${div}.{geo}`,
      unit: 'per_mille', freq: 'A' as const, staleDays: 600, // annual, stamped Jan-1; next-year weights land ~Feb
    }
  }),
]

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Health check: dataset title + dimension-order assertions ────────────────

interface JsonStatResponse {
  label?: string
  id?: string[]
  dimension?: Record<string, unknown>
}

/**
 * One JSON-stat call per dataset (filtered to a single obs): asserts the
 * dataset resolves, its label contains the expected title, and its dimension
 * id order matches the order our SDMX keys were written in. THROWS on any
 * mismatch — a silent dimension reorder would otherwise misassign every code.
 */
export async function verifyEurostatMetadata(): Promise<void> {
  const failures: string[] = []
  for (const check of EUROSTAT_DATASET_CHECKS) {
    await sleep(THROTTLE_MS)
    const url = `${BASE}/statistics/1.0/data/${check.dataset}?format=JSON&lang=EN&geo=DE&lastTimePeriod=1`
    let body: JsonStatResponse
    try {
      const res = await fetch(url)
      if (!res.ok) { failures.push(`${check.dataset}: HTTP ${res.status}`); continue }
      body = await res.json() as JsonStatResponse
    } catch (err) {
      failures.push(`${check.dataset}: fetch failed — ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const label = String(body.label ?? '')
    if (!label.toLowerCase().includes(check.titleIncludes.toLowerCase())) {
      failures.push(`${check.dataset}: label "${label.slice(0, 70)}" lacks "${check.titleIncludes}"`)
    }
    const ids = (body.id ?? []).filter(d => d !== 'time')
    const expected = check.dimOrder
    if (ids.join('.') !== expected.join('.')) {
      failures.push(`${check.dataset}: dimension order changed — live [${ids.join(',')}] vs config [${expected.join(',')}]`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`[Eurostat] metadata verification FAILED for ${failures.length} dataset(s):\n  ${failures.join('\n  ')}`)
  }
  console.log(`[Eurostat] metadata verified: ${EUROSTAT_DATASET_CHECKS.length} datasets, dimension orders intact.`)
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/** TIME_PERIOD → ISO date. Monthly '2026-05', quarterly '2026-Q1', annual '2025'. */
function decodePeriod(period: string): string | null {
  let m = /^(\d{4})-(\d{2})$/.exec(period)
  if (m) return `${m[1]}-${m[2]}-01`
  m = /^(\d{4})-Q([1-4])$/.exec(period)
  if (m) return `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`
  m = /^(\d{4})$/.exec(period)
  if (m) return `${m[1]}-01-01`
  return null
}

function parseCsvLine(line: string): string[] {
  // Eurostat SDMX-CSV values/flags carry no embedded commas in these datasets;
  // header-keyed split is sufficient (quotes stripped defensively).
  return line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
}

/**
 * Full-history refetch per def (idempotent upserts; histories are small).
 * Batched geos (`DE+FR+IT`) unless keyByGeo splits a country out.
 */
export async function syncAllEurostatSeries(): Promise<void> {
  console.log(`[Eurostat] syncing ${ALL_EUROSTAT_SERIES.length} defs (${ALL_EUROSTAT_SERIES.length * GEOS.length} series)…`)
  let totalRows = 0
  const stale: string[] = []

  for (const def of ALL_EUROSTAT_SERIES) {
    // Group geos by resolved key: batched default + per-geo overrides.
    const fetchGroups = new Map<string, Geo[]>()
    for (const geo of GEOS) {
      const key = def.keyByGeo?.[geo] ?? def.key.replace('{geo}', '{GEO_BATCH}')
      fetchGroups.set(key, [...(fetchGroups.get(key) ?? []), geo])
    }

    for (const [keyTemplate, geos] of fetchGroups) {
      const key = keyTemplate.includes('{GEO_BATCH}')
        ? keyTemplate.replace('{GEO_BATCH}', geos.join('+'))
        : keyTemplate
      await sleep(THROTTLE_MS)
      const url = `${BASE}/sdmx/2.1/data/${def.dataset}/${key}?format=SDMX-CSV`
      let text: string
      try {
        const res = await fetch(url)
        if (!res.ok) {
          console.error(`[Eurostat] ${def.dataset}/${key}: HTTP ${res.status}`)
          continue
        }
        text = await res.text()
      } catch (err) {
        console.error(`[Eurostat] ${def.dataset}/${key}: fetch failed —`, err instanceof Error ? err.message : String(err))
        continue
      }

      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
      if (lines.length < 2) {
        console.error(`[Eurostat] ${def.dataset}/${key}: EMPTY response — investigate`)
        continue
      }
      const header = parseCsvLine(lines[0])
      const geoCol = header.findIndex(h => h.toLowerCase() === 'geo')
      const timeCol = header.indexOf('TIME_PERIOD')
      const valCol = header.indexOf('OBS_VALUE')
      const flagCol = header.indexOf('OBS_FLAG')
      if (geoCol < 0 || timeCol < 0 || valCol < 0) {
        console.error(`[Eurostat] ${def.dataset}/${key}: unexpected CSV header [${header.slice(0, 10).join('|')}]`)
        continue
      }

      const byGeo = new Map<string, Array<{ date: string; value: number | null; obsFlag: string | null }>>()
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        const geo = cols[geoCol]
        const date = decodePeriod(cols[timeCol] ?? '')
        if (!date || !geo) continue
        const num = parseFloat(cols[valCol] ?? '')
        byGeo.set(geo, [...(byGeo.get(geo) ?? []), {
          date,
          value: Number.isFinite(num) ? num : null,
          obsFlag: (flagCol >= 0 && cols[flagCol]) ? cols[flagCol] : null,
        }])
      }

      for (const geo of geos) {
        const code = def.codes[geo]
        const obs = byGeo.get(geo) ?? []
        const n = storeEurostatObservations(code, def.unit, obs)
        if (n === 0) {
          console.error(`[Eurostat] ${code}: ZERO rows stored (${def.dataset}/${key}) — investigate`)
          continue
        }
        totalRows += n
        const latest = getEurostatLatestDate(code)
        console.log(`[Eurostat] ${code}: ${n} rows (latest ${latest})`)
        if (latest) {
          const ageDays = (Date.now() - new Date(latest).getTime()) / 86_400_000
          if (ageDays > def.staleDays) {
            stale.push(`${code}: latest ${latest} is ${Math.round(ageDays)}d old (threshold ${def.staleDays}d)`)
          }
        }
      }
    }
  }

  if (stale.length > 0) {
    console.warn(`[Eurostat] ⚠ FROZEN-FEED WARNING — ${stale.length} series stale:\n  ${stale.join('\n  ')}`)
  }
  console.log(`[Eurostat] sync done (${totalRows} rows upserted).`)
}
