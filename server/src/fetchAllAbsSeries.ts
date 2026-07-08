// Generic ABS Data API collector for the Australia Economic Data Models
// (Phase 2, docs/au-models-mapping.md). Sibling of collectors/absCollector.ts
// (the rates-side AUD model): same `au_macro_series` table (its `frequency`
// column makes the dual-frequency CPI discipline schema-native), same
// DSD-codelist health-check pattern, same URL conventions — and it SKIPS the
// eight rates-side codes (AU_CPI_M_HEADLINE/TRIMMED/WGTMED, AU_CPI_Q_*,
// AU_UNRATE_SA/TREND), which that untouched module keeps owning.
//
// ABS specifics (verified live, 2026-07 — see the mapping doc):
// • OMIT the dataflow version from data URLs (ABS rejects the literal
//   `latest`; omission resolves to the latest version).
// • `NoRecordsFound` (200 or 404) = valid empty result.
// • Dimension order varies per dataflow — each series carries DSD label
//   assertions; the health check fetches each flow's DSD (?references=
//   children) and THROWS on any label mismatch (rebase/recode defense).
//   Quirk: LF_UNDER's DSD id is DS_LF_UNDER (data URLs still use LF_UNDER).
// • OBS_STATUS captured (TVD p/r, JV q); JV's 2008-09 suspension appears as
//   null-value rows the parser must tolerate.
// • ITGS imports and the goods balance are stored NEGATIVE as published
//   (debits convention) — the frontend takes Math.abs where appropriate.
// • Frozen-feed staleness warnings per series (three ABS discontinuations
//   were caught in Phase 1 — this check is non-optional here).
// • Bases differ per flow (monthly CPI ~2023-24=100 vs CPI_Q 2011-12=100) —
//   raw indices stored; rates computed at the view layer (base-invariant).

import { parse } from 'csv-parse/sync'
import { parseTimePeriod } from './collectors/absCollector'
import { storeAbsObservations, getAbsLatestDate } from './db'

const ABS_BASE = 'https://data.api.abs.gov.au/rest'
const CSV_ACCEPT = 'application/vnd.sdmx.data+csv'
const THROTTLE_MS = 300

type Freq = 'M' | 'Q'

export interface AbsEconSeriesDef {
  code: string
  flow: string
  /** DSD lookup id when it differs from the flow id (LF_UNDER → DS_LF_UNDER) */
  dsdId?: string
  key: string
  freq: Freq
  unit: string
  verify: Array<{ dim: string; code: string; labelIncludes: string }>
  staleDays: number
}

// Rates-side codes owned by collectors/absCollector.ts — never configured here.
const RATES_SIDE_CODES = new Set([
  'AU_CPI_M_HEADLINE', 'AU_CPI_M_TRIMMED', 'AU_CPI_M_WGTMED',
  'AU_CPI_Q_HEADLINE', 'AU_CPI_Q_TRIMMED', 'AU_CPI_Q_WGTMED',
  'AU_UNRATE_SA', 'AU_UNRATE_TREND',
])

// ── Shorthand builders ───────────────────────────────────────────────────────

const cpiM = (code: string, index: string, label: string, tsest = '10'): AbsEconSeriesDef => ({
  code, flow: 'CPI', key: `1.${index}.${tsest}.50.M`, freq: 'M', unit: 'index',
  verify: [{ dim: 'INDEX', code: index, labelIncludes: label }],
  staleDays: 70,
})
const cpiQ = (code: string, index: string, label: string): AbsEconSeriesDef => ({
  code, flow: 'CPI', key: `1.${index}.10.50.Q`, freq: 'Q', unit: 'index',
  verify: [{ dim: 'INDEX', code: index, labelIncludes: label }],
  staleDays: 230, // quarter-start dating + publication lag
})
const lf = (code: string, flow: string, key: string, label: string, unit: string, dsdId?: string): AbsEconSeriesDef => ({
  code, flow, dsdId, key, freq: 'M', unit,
  // LF_UNDER's first dimension is named PARM_ITEM in its DSD (same M-codes).
  verify: [{ dim: flow === 'LF_UNDER' ? 'PARM_ITEM' : 'MEASURE', code: key.split('.')[0], labelIncludes: label }],
  staleDays: 70,
})
const ana = (code: string, flow: string, key: string, dim: string, dimCode: string, label: string, unit: string): AbsEconSeriesDef => ({
  code, flow, key, freq: 'Q', unit,
  verify: [{ dim, code: dimCode, labelIncludes: label }],
  staleDays: 230, // quarter-start dating + publication lag
})

// The 11 CPI groups (INDEX code, label fragment) — exist at BOTH frequencies.
const CPI_GROUPS: ReadonlyArray<[idx: string, stem: string, label: string]> = [
  ['20001', 'FOOD', 'Food and non-alcoholic beverages'],
  ['20006', 'ALCTOB', 'Alcohol and tobacco'],
  ['20002', 'CLOTHING', 'Clothing and footwear'],
  ['20003', 'HOUSING', 'Housing'],
  ['20004', 'FURNISH', 'Furnishings'],
  ['115486', 'HEALTH', 'Health'],
  ['20005', 'TRANSPORT', 'Transport'],
  ['115488', 'COMMS', 'Communication'],
  ['115489', 'RECREATION', 'Recreation and culture'],
  ['115493', 'EDUCATION', 'Education'],
  ['126670', 'INSURFIN', 'Insurance and financial services'],
]

// Quarterly distribution sub-items (long history — the distribution/explorer basis).
const CPI_SUBITEMS: ReadonlyArray<[idx: string, stem: string, label: string]> = [
  ['30014', 'RENTS', 'Rents'],
  ['97559', 'NEWDWELL', 'New dwelling purchase'],
  ['40055', 'ELECTRICITY', 'Electricity'],
  ['115524', 'GASFUELS', 'Gas and other household fuels'],
  ['40081', 'AUTOFUEL', 'Automotive fuel'],
  ['40091', 'MEDSVCS', 'Medical and hospital services'],
  ['40080', 'MOTORVEH', 'Motor vehicles'],
  ['115529', 'INSURANCE', 'Insurance'],
  ['40090', 'TOBACCO', 'Tobacco'],
  ['114121', 'FRUIT', 'Fruit'],
  ['114122', 'VEGETABLES', 'Vegetables'],
  ['40101', 'DOMHOLIDAY', 'Domestic holiday travel'],
  ['40102', 'INTHOLIDAY', 'International holiday travel'],
]

// Monthly-only special aggregates (no quarterly variant exists in any flow).
const CPI_M_AGGREGATES: ReadonlyArray<[idx: string, stem: string, label: string]> = [
  ['102675', 'TRADABLES', 'Tradables'],
  ['102676', 'NONTRADABLES', 'Non-tradables'],
  ['104101', 'GOODS', 'goods component'],
  ['104104', 'SERVICES', 'services component'],
  ['104122', 'EXVOLATILE', "excluding 'volatile items'"],
  ['131197', 'XFE', 'excluding food and energy'],
  ['999904', 'EXVOLHOL', 'holiday travel'],
  ['132304', 'DISCRETIONARY', 'Discretionary'],
  ['132305', 'NONDISCRETIONARY', 'Non-Discretionary'],
]

// Published contributions to GDP growth (TCH, ppt) — verified live incl. the
// enumerated public-GFCF (GFC.GSS) and inventories (IST.SSS) items. GPM.SSS is
// GDP's own TCH row: it must equal the published QoQ — verifyAuIngest asserts
// the component sum against it (decision f, permanent assertion).
const GDP_CONTRIBS: ReadonlyArray<[item: string, stem: string]> = [
  ['FCE.PHS', 'CTB_CONS'],
  ['FCE.GGS', 'CTB_GOV'],
  ['GFC_PBI.PSS', 'CTB_BUSINV'],
  ['GFC_DWL.PSS', 'CTB_DWELL'],
  ['GFC.GSS', 'CTB_PUBINV'],
  ['IST.SSS', 'CTB_INVENT'],
  ['XGS.SSS', 'CTB_EXPORTS'],
  ['MGS.SSS', 'CTB_IMPORTS'],
  ['SDE.SSS', 'CTB_SDE'],   // statistical discrepancy — needed for the sum assertion
  ['GPM.SSS', 'CTB_GDP'],
]

export const ALL_ABS_SERIES: AbsEconSeriesDef[] = [
  // ═══ CPI monthly (flow CPI, FREQ=M, ~2023-24=100, from 2024-04) ═══
  cpiM('AU_CPI_M_SA', '999901', 'All groups CPI, seasonally adjusted', '20'),
  ...CPI_GROUPS.map(([idx, stem, label]) => cpiM(`AU_CPIM_${stem}`, idx, label)),
  ...CPI_M_AGGREGATES.map(([idx, stem, label]) => cpiM(`AU_CPIM_${stem}`, idx, label)),
  // ═══ CPI quarterly (flow CPI FREQ=Q — long history; groups from ~1972, headline rates-side) ═══
  ...CPI_GROUPS.map(([idx, stem, label]) => cpiQ(`AU_CPIQ_${stem}`, idx, label)),
  ...CPI_SUBITEMS.map(([idx, stem, label]) => cpiQ(`AU_CPIQ_${stem}`, idx, label)),
  // Quarterly SA all-groups (CPI_Q flow — the projection basis)
  {
    code: 'AU_CPI_Q_SA', flow: 'CPI_Q', key: '1.999901.20.50.Q', freq: 'Q', unit: 'index',
    verify: [{ dim: 'INDEX', code: '999901', labelIncludes: 'All groups CPI, seasonally adjusted' }],
    staleDays: 230, // quarter-start dating + publication lag
  },

  // ═══ PPI Final Demand (2005-Q2→; published rates) ═══
  {
    code: 'AU_PPI', flow: 'PPI_FD', key: '1.TOT.TOT.TOTXE.Q', freq: 'Q', unit: 'index',
    verify: [{ dim: 'INDEX', code: 'TOT', labelIncludes: 'Total' }],
    staleDays: 230, // quarter-start dating + publication lag
  },
  { code: 'AU_PPI_YOY', flow: 'PPI_FD', key: '3.TOT.TOT.TOTXE.Q', freq: 'Q', unit: 'percent', verify: [], staleDays: 230 },
  { code: 'AU_PPI_QOQ', flow: 'PPI_FD', key: '2.TOT.TOT.TOTXE.Q', freq: 'Q', unit: 'percent', verify: [], staleDays: 230 },

  // ═══ GDP (ANA_AGG / ANA_EXP / ANA_INC — quarterly SA, A$M, 1959-Q3→) ═══
  ana('AU_GDP_R', 'ANA_AGG', 'M1.GPM.20.AUS.Q', 'DATA_ITEM', 'GPM', 'Gross domestic product', 'aud_m'),
  ana('AU_GDP_QOQ', 'ANA_AGG', 'M2.GPM.20.AUS.Q', 'DATA_ITEM', 'GPM', 'Gross domestic product', 'percent'),
  ana('AU_GDP_N', 'ANA_AGG', 'M3.GPM.20.AUS.Q', 'DATA_ITEM', 'GPM', 'Gross domestic product', 'aud_m'),
  ana('AU_SAVING_RATE', 'ANA_AGG', 'M7.HSR.20.AUS.Q', 'DATA_ITEM', 'HSR', 'saving', 'percent'),
  ana('AU_CONS_R', 'ANA_EXP', 'VCH.FCE.PHS.20.AUS.Q', 'SECTOR', 'PHS', 'household', 'aud_m'),
  ana('AU_GOV_R', 'ANA_EXP', 'VCH.FCE.GGS.20.AUS.Q', 'SECTOR', 'GGS', 'general government', 'aud_m'),
  ana('AU_DWELLINV_R', 'ANA_EXP', 'VCH.GFC_DWL.PSS.20.AUS.Q', 'DATA_ITEM', 'GFC_DWL', 'Dwellings', 'aud_m'),
  ana('AU_BUSINV_R', 'ANA_EXP', 'VCH.GFC_PBI.PSS.20.AUS.Q', 'DATA_ITEM', 'GFC_PBI', 'business investment', 'aud_m'),
  ana('AU_EXPORTS_R', 'ANA_EXP', 'VCH.XGS.SSS.20.AUS.Q', 'DATA_ITEM', 'XGS', 'Exports', 'aud_m'),
  ana('AU_IMPORTS_R', 'ANA_EXP', 'VCH.MGS.SSS.20.AUS.Q', 'DATA_ITEM', 'MGS', 'Imports', 'aud_m'),
  ana('AU_GDP_DEFLATOR', 'ANA_EXP', 'DCH.GPM.SSS.20.AUS.Q', 'MEASURE', 'DCH', 'deflator', 'index'),
  ...GDP_CONTRIBS.map(([item, stem]): AbsEconSeriesDef => ({
    code: `AU_${stem}`, flow: 'ANA_EXP', key: `TCH.${item}.20.AUS.Q`, freq: 'Q', unit: 'percent',
    verify: [{ dim: 'MEASURE', code: 'TCH', labelIncludes: 'Contribution' }],
    staleDays: 230, // quarter-start dating + publication lag
  })),
  ana('AU_COE', 'ANA_INC', 'C.COE.SSS.20.AUS.Q', 'DATA_ITEM', 'COE', 'Compensation of employees', 'aud_m'), // CSV metadata says UNIT NA; scale is A$M (verified)

  // ═══ Household spending (HSI — the Retail Trade successor) ═══
  {
    code: 'AU_HH_SPENDING', flow: 'HSI_M', key: '7.TOT.CUR.20.AUS.M', freq: 'M', unit: 'aud_m',
    verify: [{ dim: 'CATEGORY', code: 'TOT', labelIncludes: 'Total' }],
    staleDays: 75,
  },
  { code: 'AU_HH_SPENDING_YOY', flow: 'HSI_M', key: '9.TOT.CUR.20.AUS.M', freq: 'M', unit: 'percent', verify: [], staleDays: 75 },
  {
    code: 'AU_HH_SPENDING_RQ', flow: 'HSI_Q', key: '7.TOT.CVM.20.AUS.Q', freq: 'Q', unit: 'aud_m',
    verify: [{ dim: 'PRICE_ADJUSTMENT', code: 'CVM', labelIncludes: 'Chain' }],
    staleDays: 230, // quarter-start dating + publication lag
  },

  // ═══ Trade in goods (ITGS, MONTHLY SA, A$M, 1971-07→; imports/balance stored NEGATIVE) ═══
  // NB: explicit defs — the ana() shorthand hardcodes freq 'Q', which silently
  // dropped every monthly period on first bring-up (caught by the zero-row check).
  {
    code: 'AU_TRADE_EXP', flow: 'ITGS', key: 'M1.1000.20.AUS.M', freq: 'M', unit: 'aud_m',
    verify: [{ dim: 'DATA_ITEM', code: '1000', labelIncludes: 'Goods Credit' }], staleDays: 100,
  },
  {
    code: 'AU_TRADE_IMP', flow: 'ITGS', key: 'M1.2000.20.AUS.M', freq: 'M', unit: 'aud_m',
    verify: [{ dim: 'DATA_ITEM', code: '2000', labelIncludes: 'Goods Debit' }], staleDays: 100,
  },
  {
    code: 'AU_TRADE_BAL', flow: 'ITGS', key: 'M1.170.20.AUS.M', freq: 'M', unit: 'aud_m',
    verify: [{ dim: 'DATA_ITEM', code: '170', labelIncludes: 'Balance' }], staleDays: 100,
  },

  // ═══ Business indicators (QBIS, quarterly SA, A$M) ═══
  ana('AU_PROFITS', 'QBIS', 'M7.CUR.TOT.TOT.20.AUS.Q', 'MEASURE', 'M7', 'profits', 'aud_m'),
  ana('AU_INVENTORIES', 'QBIS', 'M3.CUR.TOT.TOT.20.AUS.Q', 'MEASURE', 'M3', 'Inventories', 'aud_m'),

  // ═══ Labour force (LF family, monthly, 1978→; SA=TSEST 20, trend=30) ═══
  lf('AU_EMPLOYED', 'LF', 'M3.3.1599.20.AUS.M', 'Employed persons', 'ths_persons'),
  lf('AU_EMPLOYED_TREND', 'LF', 'M3.3.1599.30.AUS.M', 'Employed persons', 'ths_persons'),
  lf('AU_EMP_FT', 'LF', 'M1.3.1599.20.AUS.M', 'full-time', 'ths_persons'),
  lf('AU_EMP_PT', 'LF', 'M2.3.1599.20.AUS.M', 'part-time', 'ths_persons'),
  lf('AU_UNEMPLOYED', 'LF', 'M6.3.1599.20.AUS.M', 'Unemployed persons', 'ths_persons'),
  lf('AU_LABOUR_FORCE', 'LF', 'M9.3.1599.20.AUS.M', 'Labour force', 'ths_persons'),
  lf('AU_PART_RATE', 'LF', 'M12.3.1599.20.AUS.M', 'Participation rate', 'percent'),
  lf('AU_PART_RATE_TREND', 'LF', 'M12.3.1599.30.AUS.M', 'Participation rate', 'percent'),
  lf('AU_EMP_POP', 'LF', 'M16.3.1599.20.AUS.M', 'Employment to population', 'percent'),
  lf('AU_EMP_POP_TREND', 'LF', 'M16.3.1599.30.AUS.M', 'Employment to population', 'percent'),
  lf('AU_UNDEREMP_RATE', 'LF_UNDER', 'M23.3.1599.20.AUS.M', 'Underemployment rate', 'percent', 'DS_LF_UNDER'),
  lf('AU_UNDEREMP_RATE_TREND', 'LF_UNDER', 'M23.3.1599.30.AUS.M', 'Underemployment rate', 'percent', 'DS_LF_UNDER'),
  lf('AU_UNDERUTIL_RATE', 'LF_UNDER', 'M24.3.1599.20.AUS.M', 'Underutilisation rate', 'percent', 'DS_LF_UNDER'),
  lf('AU_UNDERUTIL_RATE_TREND', 'LF_UNDER', 'M24.3.1599.30.AUS.M', 'Underutilisation rate', 'percent', 'DS_LF_UNDER'),
  lf('AU_UNDEREMPLOYED', 'LF_UNDER', 'M21.3.1599.20.AUS.M', 'Underemployed', 'ths_persons', 'DS_LF_UNDER'),
  {
    code: 'AU_HOURS', flow: 'LF_HOURS', key: 'M18.3.1599.TOT.20.AUS.M', freq: 'M', unit: 'ths_hours',
    verify: [{ dim: 'MEASURE', code: 'M18', labelIncludes: 'hours' }],
    staleDays: 70,
  },
  lf('AU_UR_YOUTH', 'LF_AGES', 'M13.3.1524.20.AUS.M', 'Unemployment rate', 'percent'),
  lf('AU_UR_YOUTH_TREND', 'LF_AGES', 'M13.3.1524.30.AUS.M', 'Unemployment rate', 'percent'),

  // ═══ Job vacancies (JV, quarterly, 1979-Q2→; 2008-09 suspension = null rows) ═══
  {
    code: 'AU_VACANCIES', flow: 'JV', key: 'M1.7.TOT.20.AUS.Q', freq: 'Q', unit: 'ths_vacancies',
    verify: [{ dim: 'MEASURE', code: 'M1', labelIncludes: 'Job Vacancies' }],
    staleDays: 200,
  },

  // ═══ Wage Price Index (WPI, quarterly SA, 1997-Q3→; published rates) ═══
  {
    code: 'AU_WPI', flow: 'WPI', key: '1.THRPEB.7.TOT.20.AUS.Q', freq: 'Q', unit: 'index',
    verify: [{ dim: 'INDEX', code: 'THRPEB', labelIncludes: 'excluding bonuses' }],
    staleDays: 230, // quarter-start dating + publication lag
  },
  { code: 'AU_WPI_YOY', flow: 'WPI', key: '3.THRPEB.7.TOT.20.AUS.Q', freq: 'Q', unit: 'percent', verify: [], staleDays: 230 },
  { code: 'AU_WPI_QOQ', flow: 'WPI', key: '2.THRPEB.7.TOT.20.AUS.Q', freq: 'Q', unit: 'percent', verify: [], staleDays: 230 },

  // ═══ Housing (approvals NSA-ONLY on the API; TVD quarterly p/r flags; lending quarterly) ═══
  {
    code: 'AU_APPROVALS', flow: 'BA_GCCSA', key: '1.1.9.TOT.100.10.AUS.M', freq: 'M', unit: 'dwellings',
    verify: [{ dim: 'BUILDING_TYPE', code: '100', labelIncludes: 'Total' }],
    staleDays: 100,
  },
  {
    code: 'AU_APPROVALS_HOUSES', flow: 'BA_GCCSA', key: '1.1.1.TOT.110.10.AUS.M', freq: 'M', unit: 'dwellings',
    verify: [{ dim: 'BUILDING_TYPE', code: '110', labelIncludes: 'House' }],
    staleDays: 100,
  },
  {
    code: 'AU_APPROVALS_OTHER', flow: 'BA_GCCSA', key: '1.1.1.TOT.850.10.AUS.M', freq: 'M', unit: 'dwellings',
    verify: [{ dim: 'BUILDING_TYPE', code: '850', labelIncludes: 'Dwellings' }],
    staleDays: 100,
  },
  {
    code: 'AU_MEAN_PRICE', flow: 'RES_DWELL_ST', key: '5.AUS.Q', freq: 'Q', unit: 'aud_k',
    verify: [{ dim: 'MEASURE', code: '5', labelIncludes: 'Mean' }],
    staleDays: 200,
  },
  {
    code: 'AU_DWELL_STOCK_VALUE', flow: 'RES_DWELL_ST', key: '1.AUS.Q', freq: 'Q', unit: 'aud_m',
    verify: [{ dim: 'MEASURE', code: '1', labelIncludes: 'Value' }],
    staleDays: 200,
  },
  {
    code: 'AU_LEND_OO', flow: 'LEND_HOUSING', key: 'FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.DV5167.20.AUS.Q', freq: 'Q', unit: 'aud_m',
    verify: [{ dim: 'HOUSING_PURPOSE', code: 'DV5167', labelIncludes: 'Owner occupier' }],
    staleDays: 200,
  },
  {
    code: 'AU_LEND_INV', flow: 'LEND_HOUSING', key: 'FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.DV5168.20.AUS.Q', freq: 'Q', unit: 'aud_m',
    verify: [{ dim: 'HOUSING_PURPOSE', code: 'DV5168', labelIncludes: 'Investor' }],
    staleDays: 200,
  },
]

for (const s of ALL_ABS_SERIES) {
  if (RATES_SIDE_CODES.has(s.code)) throw new Error(`[ABS-econ] ${s.code} belongs to collectors/absCollector.ts`)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── DSD health check ─────────────────────────────────────────────────────────
// Duplicated (small) from collectors/absCollector.ts rather than exported —
// keeping the rates-side module byte-identical outweighs DRY here.

async function fetchDimensionLabels(dsdId: string): Promise<Map<string, Map<string, string>>> {
  const url = `${ABS_BASE}/datastructure/ABS/${dsdId}?references=children`
  const res = await fetch(url, { headers: { Accept: 'application/vnd.sdmx.structure+json' } })
  if (!res.ok) throw new Error(`[ABS-econ] datastructure ${dsdId} HTTP ${res.status}`)
  const json = await res.json() as {
    data?: {
      dataStructures?: Array<{ dataStructureComponents?: { dimensionList?: { dimensions?: Array<{ id: string; localRepresentation?: { enumeration?: string } }> } } }>
      codelists?: Array<{ id: string; codes?: Array<{ id: string; name?: string }> }>
    }
  }
  const clMap = new Map<string, Map<string, string>>()
  for (const cl of json.data?.codelists ?? []) {
    const codes = new Map<string, string>()
    for (const c of cl.codes ?? []) codes.set(String(c.id), String(c.name ?? ''))
    clMap.set(String(cl.id), codes)
  }
  const dimToCodes = new Map<string, Map<string, string>>()
  for (const dsd of json.data?.dataStructures ?? []) {
    for (const dim of dsd.dataStructureComponents?.dimensionList?.dimensions ?? []) {
      const enumRef = dim.localRepresentation?.enumeration ?? ''
      const m = /([A-Z0-9_]+)\(/.exec(enumRef) || /:([A-Za-z0-9_]+)$/.exec(enumRef)
      const codes = clMap.get(m ? m[1] : '')
      if (codes) dimToCodes.set(String(dim.id), codes)
    }
  }
  return dimToCodes
}

export async function verifyAbsEconMetadata(): Promise<void> {
  const failures: string[] = []
  const byDsd = new Map<string, AbsEconSeriesDef[]>()
  for (const s of ALL_ABS_SERIES) {
    const id = s.dsdId ?? s.flow
    byDsd.set(id, [...(byDsd.get(id) ?? []), s])
  }
  for (const [dsdId, defs] of byDsd) {
    await sleep(THROTTLE_MS)
    let dims: Map<string, Map<string, string>>
    try {
      dims = await fetchDimensionLabels(dsdId)
    } catch (err) {
      failures.push(`${dsdId}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    for (const def of defs) {
      for (const v of def.verify) {
        const codes = dims.get(v.dim)
        if (!codes) { failures.push(`${def.code}: dimension "${v.dim}" not in ${dsdId} DSD`); continue }
        const label = codes.get(v.code)
        if (label == null) {
          failures.push(`${def.code}: ${v.dim} code ${v.code} no longer exists in ${dsdId} (rebase/recode?)`)
        } else if (!label.toLowerCase().includes(v.labelIncludes.toLowerCase())) {
          failures.push(`${def.code}: ${v.dim} ${v.code} label "${label.slice(0, 60)}" lacks "${v.labelIncludes}"`)
        }
      }
    }
    console.log(`[ABS-econ] DSD ${dsdId}: ${defs.length} series checked.`)
  }
  if (failures.length > 0) {
    throw new Error(`[ABS-econ] metadata verification FAILED for ${failures.length} item(s):\n  ${failures.join('\n  ')}`)
  }
  console.log(`[ABS-econ] metadata verified: ${ALL_ABS_SERIES.length} series across ${byDsd.size} DSDs.`)
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function fetchSeries(def: AbsEconSeriesDef, extra: Record<string, string>): Promise<Array<{ date: string; value: number | null; obsStatus?: string | null }>> {
  const qs = new URLSearchParams({ dimensionAtObservation: 'TIME_PERIOD', ...extra })
  const url = `${ABS_BASE}/data/ABS,${def.flow}/${def.key}?${qs.toString()}`
  const res = await fetch(url, { headers: { Accept: CSV_ACCEPT } })
  const text = await res.text()
  if (/^\s*NoRecordsFound/i.test(text)) return []
  if (!res.ok) throw new Error(`[ABS-econ] ${def.code} HTTP ${res.status}: ${text.slice(0, 120)}`)

  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true })
  const out: Array<{ date: string; value: number | null; obsStatus?: string | null }> = []
  for (const row of records) {
    const date = row.TIME_PERIOD ? parseTimePeriod(row.TIME_PERIOD, def.freq) : null
    if (!date) continue
    const raw = row.OBS_VALUE
    // JV's 2008-09 suspension publishes rows with empty OBS_VALUE (status q) —
    // tolerated here; store skips null values.
    const num = raw != null && raw.trim() !== '' ? Number(raw) : NaN
    out.push({
      date,
      value: Number.isFinite(num) ? num : null,
      obsStatus: (row.OBS_STATUS || '').trim() || null,
    })
  }
  return out
}

export async function syncAllAbsSeries(): Promise<void> {
  console.log(`[ABS-econ] syncing ${ALL_ABS_SERIES.length} series…`)
  let totalRows = 0
  const stale: string[] = []

  for (const def of ALL_ABS_SERIES) {
    await sleep(THROTTLE_MS)
    const latest = getAbsLatestDate(def.code)
    let obs: Array<{ date: string; value: number | null; obsStatus?: string | null }>
    try {
      // Incremental: overlap window via lastNObservations; full history on empty.
      obs = await fetchSeries(def, latest ? { lastNObservations: '6' } : {})
    } catch (err) {
      console.error(`[ABS-econ] ${def.code}: fetch failed —`, err instanceof Error ? err.message : String(err))
      continue
    }
    const n = storeAbsObservations(def.code, def.unit, def.freq, obs)
    if (n === 0 && !latest) {
      console.error(`[ABS-econ] ${def.code}: ZERO rows stored on backfill — investigate`)
      continue
    }
    totalRows += n
    if (!latest) console.log(`[ABS-econ] backfill ${def.code} (${def.freq}): ${n} rows (latest ${getAbsLatestDate(def.code)})`)

    const nowLatest = getAbsLatestDate(def.code)
    if (nowLatest) {
      const ageDays = (Date.now() - new Date(nowLatest).getTime()) / 86_400_000
      if (ageDays > def.staleDays) {
        stale.push(`${def.code}: latest ${nowLatest} is ${Math.round(ageDays)}d old (threshold ${def.staleDays}d)`)
      }
    }
  }

  if (stale.length > 0) {
    console.warn(`[ABS-econ] ⚠ FROZEN-FEED WARNING — ${stale.length} series stale:\n  ${stale.join('\n  ')}`)
  }
  console.log(`[ABS-econ] sync done (${totalRows} rows upserted).`)
}
