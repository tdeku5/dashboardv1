// Series catalog generator (AI Chart Agent, Phase 0/B).
// Enumerates every series the terminal holds and populates `series_catalog`
// (full refresh, one transaction — the ONLY write path in this script), plus
// exports docs/series-catalog.md. Re-runnable/idempotent at any time.
// Run:  npm run build-catalog   (or: npx tsx src/scripts/build-series-catalog.ts)
//
// Description discipline: every description is traceable to an in-DB metadata
// table, an imported collector config, an explicit mapping list
// (seriesCatalogMappings.ts), or a documented deterministic composition —
// nothing is guessed from ticker strings. Unmapped tv symbols are cataloged
// with NULL descriptions and description_source='unresolved' per the Phase A
// gate (manual follow-up session).
//
// Exclusions: metadata/operational tables are structurally excluded; tables
// with 0 rows are skipped at generation time and auto-included once populated
// (gate decision 5); news_articles is a named exclusion (document store, not
// chartable — gate decision 6).

import { db } from '../db'
import fs from 'fs'
import path from 'path'
import { ALL_STATCAN_SERIES } from '../fetchAllStatcanSeries'
import { ALL_ESTAT_SERIES } from '../fetchAllEstatSeries'
import { ALL_EUROSTAT_SERIES } from '../fetchAllEurostatSeries'
import { ALL_ABS_SERIES } from '../fetchAllAbsSeries'
import { ALL_BOJ_SERIES } from '../bojTsCollector'
import {
  buildTvContinuousMap, TV_FAMILIES, TV_OHLCV_MAP, buildEcbMap,
  COLLECTOR_STEM_CATEGORY, FRED_CATEGORY_RULES, FRED_COUNTRY_EXCEPTIONS,
  OVERNIGHT_MAP, censusDescription, UK_HPI_METRICS, TREASURY_FAMILY_DESCRIPTIONS,
} from './seriesCatalogMappings'

const SOURCE_DB = 'fred_data.db'
const NOW = new Date().toISOString()

interface CatalogEntry {
  series_id: string
  series_kind: 'single' | 'contract_family' | 'parameterized'
  source_table: string
  description: string | null
  units: string | null
  frequency: string | null
  seasonal_adjustment?: string | null
  data_source: string
  country: string | null
  category: string
  first_date: string | null
  last_date: string | null
  obs_count: number
  member_count: number | null
  description_source: string
}

const entries: CatalogEntry[] = []

function rowCount(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

function inferFrequency(dates: string[]): string | null {
  const ds = [...new Set(dates.map(d => d.slice(0, 10)))].sort()
  if (ds.length < 3) return null
  const gaps: number[] = []
  for (let i = 1; i < ds.length; i++) {
    const a = Date.parse(ds[i - 1])
    const b = Date.parse(ds[i])
    if (Number.isFinite(a) && Number.isFinite(b)) gaps.push((b - a) / 86_400_000)
  }
  if (gaps.length < 2) return null
  gaps.sort((x, y) => x - y)
  const m = gaps[Math.floor(gaps.length / 2)]
  return m <= 3 ? 'daily' : m <= 10 ? 'weekly' : m <= 45 ? 'monthly' : m <= 135 ? 'quarterly' : 'annual'
}

interface SeriesStat { sid: string; n: number; first: string; last: string; freq: string | null; unit: string | null }

/** Enumerate distinct series in a standard obs table (read-only).
 *  epochDates: tv_series/tv_ohlcv store `time` as UNIX epoch seconds — min/max
 *  must compare numerically and convert to ISO dates. */
function enumerate(table: string, key: string, dateCol: string, unitCol?: string, epochDates = false): SeriesStat[] {
  const dexpr = epochDates ? `CAST(t.${dateCol} AS INTEGER)` : `t.${dateCol}`
  const unitSel = unitCol ? `, (SELECT ${unitCol} FROM ${table} u WHERE u.${key} = t.${key} AND u.${unitCol} IS NOT NULL LIMIT 1)` : ", NULL"
  const rows = db.prepare(
    `SELECT t.${key} AS sid, COUNT(*) AS n, MIN(${dexpr}) AS f, MAX(${dexpr}) AS l${unitSel}
     FROM ${table} t GROUP BY t.${key} ORDER BY t.${key}`
  ).all() as Array<{ sid: string; n: number; f: string | number; l: string | number; [k: string]: unknown }>
  const dateStmt = db.prepare(`SELECT DISTINCT ${epochDates ? `CAST(${dateCol} AS INTEGER)` : dateCol} AS d FROM ${table} WHERE ${key} = ? ORDER BY d LIMIT 400`)
  const toIso = (v: string | number): string => epochDates
    ? new Date(Number(v) * 1000).toISOString().slice(0, 10)
    : String(v).slice(0, 10)
  return rows.map(r => {
    const dates = (dateStmt.all(r.sid) as Array<{ d: string | number }>).map(x => toIso(x.d))
    const unitVal = Object.values(r)[4]
    return {
      sid: String(r.sid), n: r.n, first: toIso(r.f), last: toIso(r.l),
      freq: inferFrequency(dates), unit: unitVal != null ? String(unitVal) : null,
    }
  })
}

function stemCategory(code: string): string {
  for (const [re, cat] of COLLECTOR_STEM_CATEGORY) if (re.test(code)) return cat
  return 'uncategorized'
}

function push(p: Omit<CatalogEntry, 'series_kind' | 'member_count'> & { series_kind?: CatalogEntry['series_kind']; member_count?: number | null }): void {
  entries.push({ series_kind: 'single', member_count: null, ...p })
}

// ═══ 1. FRED + BEA (series_observations) ═══
// series_metadata titles are populated for the BEA_* ids (cached BEA NIPA
// lines) but mostly NULL for native FRED ids — for those, labels are
// harvested from the client series-config registries with strict regexes
// (deterministic extraction of existing registry text, not fuzzy matching).
{
  const meta = new Map<string, { title: string | null; units: string | null; frequency: string | null; seasonal_adjustment: string | null }>()
  for (const r of db.prepare('SELECT series_id, title, units, frequency, seasonal_adjustment FROM series_metadata').all() as Array<{ series_id: string; title: string | null; units: string | null; frequency: string | null; seasonal_adjustment: string | null }>) {
    meta.set(r.series_id, r)
  }
  const clientData = path.resolve(__dirname, '..', '..', '..', 'client', 'src', 'data')
  const configLabels = new Map<string, { label: string; file: string }>()
  for (const file of ['cpiSeriesConfig.ts', 'ppiSeriesConfig.ts']) {
    const text = fs.readFileSync(path.join(clientData, file), 'utf-8')
    for (const m of text.matchAll(/\{ *id: *'([^']+)', *label: *'([^']+)'/g)) {
      if (!configLabels.has(m[1])) configLabels.set(m[1], { label: m[2], file: `client/src/data/${file}` })
    }
  }
  {
    const text = fs.readFileSync(path.join(clientData, 'seriesConfig.ts'), 'utf-8')
    for (const m of text.matchAll(/fredId: *'([^']+)',[\s\S]{0,200}?label: *'([^']+)'/g)) {
      if (!configLabels.has(m[1])) configLabels.set(m[1], { label: m[2], file: 'client/src/data/seriesConfig.ts' })
    }
  }
  const fredCategory = (sid: string): string => {
    for (const [re, cat] of FRED_CATEGORY_RULES) if (re.test(sid)) return cat
    return 'uncategorized'
  }
  // BEA table-number → category (per the US hub placement of each page).
  const beaCategory = (sid: string): string =>
    sid.startsWith('BEA_U20304') ? 'inflation' /* 2.3.4U — PCE page */ : 'growth' /* 1.5.2 contributions, 2.8.x nPCE/rPCE */
  for (const s of enumerate('series_observations', 'series_id', 'date')) {
    const m = meta.get(s.sid)
    const isBea = s.sid.startsWith('BEA_')
    const cfg = configLabels.get(s.sid)
    const description = m?.title || cfg?.label || null
    push({
      series_id: s.sid, source_table: 'series_observations',
      description, units: m?.units ?? null,
      frequency: (m?.frequency ?? '').toLowerCase() || s.freq,
      seasonal_adjustment: m?.seasonal_adjustment ?? null,
      data_source: isBea ? 'BEA' : 'FRED', country: FRED_COUNTRY_EXCEPTIONS[s.sid] ?? 'US',
      category: isBea ? beaCategory(s.sid) : fredCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: m?.title ? 'series_metadata title' : cfg ? cfg.file : 'unresolved',
    })
  }
}

// ═══ 2. BoE ═══
// boe_series_meta.description is entirely NULL in-DB; the real registry is
// fetchAllBoeSeries.ts, where every code carries a same-line comment label
// inside a named group — harvested here with a strict line parser.
{
  const boeText = fs.readFileSync(path.resolve(__dirname, '..', 'fetchAllBoeSeries.ts'), 'utf-8')
  const boeLabels = new Map<string, { label: string; group: string }>()
  let group = ''
  for (const line of boeText.split('\n')) {
    const g = /^ *([a-z_]+): *\[/.exec(line)
    if (g) group = g[1]
    const m = /^ *'([A-Z0-9]+)', *\/\/ *(.+?) *$/.exec(line)
    if (m && group) boeLabels.set(m[1], { label: m[2], group })
  }
  const groupCat: Record<string, string> = {
    rates: 'rates', gilts: 'rates', fx: 'fx', money: 'credit', mortgages: 'housing',
    consumer_credit: 'credit', mortgage_rates: 'housing', effective_rates: 'rates',
  }
  const boeCategory = (c: string): string =>
    /^(IUD|IUM)/.test(c) ? 'rates' : /^(LPM|LPQ)/.test(c) ? 'credit' : /^CFM/.test(c) ? 'housing' : /^XUDL/.test(c) ? 'fx' : 'uncategorized'
  for (const s of enumerate('boe_observations', 'series_code', 'date')) {
    const h = boeLabels.get(s.sid)
    push({
      series_id: s.sid, source_table: 'boe_observations',
      description: h?.label ?? null, units: null,
      frequency: s.freq,
      data_source: 'BoE', country: 'UK',
      category: (h && groupCat[h.group]) || boeCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: h ? 'fetchAllBoeSeries.ts (inline comment label)' : 'unresolved',
    })
  }
}

// ═══ 3. ONS ═══
// ons_series_meta.title merely echoes the CDID (all 306 rows) — the real
// registry is fetchAllOnsSeries.ts, where every CDID carries a same-line
// comment label. Harvested with a strict line regex (BoE pattern).
{
  const onsText = fs.readFileSync(path.resolve(__dirname, '..', 'fetchAllOnsSeries.ts'), 'utf-8')
  const onsLabels = new Map<string, string>()
  for (const m of onsText.matchAll(/\{ *cdid: *'([A-Z0-9]+)'[^}]*\}, *\/\/ *(.+?) *$/gm)) {
    if (!onsLabels.has(m[1])) onsLabels.set(m[1], m[2])
  }
  const meta = new Map<string, { title: string | null; units: string | null; frequency: string | null }>()
  for (const r of db.prepare('SELECT cdid, title, units, frequency FROM ons_series_meta').all() as Array<{ cdid: string; title: string | null; units: string | null; frequency: string | null }>) {
    meta.set(r.cdid, r)
  }
  const dsCat: Record<string, string> = {
    mm23: 'inflation', ppi: 'inflation', lms: 'labor', unem: 'labor', emp: 'labor', prdy: 'labor',
    ukea: 'growth', qna: 'growth', pn2: 'growth', mgdp: 'growth', drsi: 'growth', mret: 'growth',
    pnbp: 'growth', ct: 'growth', cxnv: 'growth', ucst: 'growth', pusf: 'fiscal', diop: 'industrial',
  }
  const dsOf = new Map<string, string>()
  for (const r of db.prepare('SELECT DISTINCT cdid, dataset_id FROM ons_observations').all() as Array<{ cdid: string; dataset_id: string }>) {
    dsOf.set(r.cdid, r.dataset_id)
  }
  for (const s of enumerate('ons_observations', 'cdid', 'date')) {
    const m = meta.get(s.sid)
    const ds = dsOf.get(s.sid) ?? ''
    const label = onsLabels.get(s.sid)
    push({
      series_id: s.sid, source_table: 'ons_observations',
      description: label ?? null, units: m?.units ?? null,
      frequency: (m?.frequency ?? '').toLowerCase() || s.freq,
      data_source: 'ONS', country: 'UK', category: dsCat[ds] ?? 'uncategorized',
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: label ? 'fetchAllOnsSeries.ts (inline comment label)' : 'unresolved',
    })
  }
}

// ═══ 4. Collector-config tables (imported configs = the description source) ═══

// StatCan: ALL_STATCAN_SERIES titleIncludes + rates-side codes mirrored from
// collectors/statcanCollector.ts (documented there).
{
  const cfg = new Map(ALL_STATCAN_SERIES.map(s => [s.code, s]))
  const ratesSide: Record<string, string> = {
    CPI_HEADLINE: 'Canada CPI — all-items (index, 2002=100, NSA)',
    CPI_XFE: 'Canada CPI — all-items ex food & energy (index)',
    CPI_TRIM: 'Canada CPI-trim — BoC preferred core (YoY %, published rate)',
    CPI_MEDIAN: 'Canada CPI-median — BoC preferred core (YoY %, published rate)',
    CPI_COMMON: 'Canada CPI-common — BoC preferred core (YoY %, published rate)',
    UNRATE_CA: 'Canada unemployment rate (SA, LFS)',
  }
  for (const s of enumerate('statcan_observations', 'series_code', 'date', 'unit')) {
    const c = cfg.get(s.sid)
    const rs = ratesSide[s.sid]
    push({
      series_id: s.sid, source_table: 'statcan_observations',
      description: c ? `Canada — ${c.titleIncludes}` : rs ?? null,
      units: s.unit, frequency: s.freq, data_source: 'StatCan', country: 'CA',
      category: stemCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: c ? 'fetchAllStatcanSeries.ts (titleIncludes)' : rs ? 'collectors/statcanCollector.ts (mirrored)' : 'unresolved',
    })
  }
}

// Japan (estat_observations): explicit description overrides for JP-native
// labels (docs/jp-models-mapping.md + fetchAllEstatSeries.ts config), plus
// customs trade codes and rates-side estatCollector codes.
{
  const JP: Record<string, string> = {
    JP_GDP_R: 'Japan real GDP (SNA quarterly, ¥bn annualized, SA)',
    JP_CONS_R: 'Japan private consumption (real SNA, ¥bn ann., SA)', JP_RESINV_R: 'Japan private residential investment (real, ¥bn ann.)',
    JP_CAPEX_R: 'Japan private non-residential investment (real, ¥bn ann.)', JP_INVENT_R: 'Japan private inventories (real, ¥bn ann.)',
    JP_GOV_R: 'Japan government consumption (real, ¥bn ann.)', JP_PUBINV_R: 'Japan public investment (real, ¥bn ann.)',
    JP_EXPORTS_R: 'Japan exports (real SNA, ¥bn ann.)', JP_IMPORTS_R: 'Japan imports (real SNA, ¥bn ann.)',
    JP_GDP_QOQ: 'Japan real GDP QoQ % (published)', JP_GDP_QOQA: 'Japan real GDP QoQ annualized % (published)',
    JP_CTB_CONS: 'Japan GDP contribution — private consumption (published, ann. pp)', JP_CTB_RESINV: 'Japan GDP contribution — residential investment (pp)',
    JP_CTB_CAPEX: 'Japan GDP contribution — business investment (pp)', JP_CTB_INVENT: 'Japan GDP contribution — inventories (pp)',
    JP_CTB_GOV: 'Japan GDP contribution — government consumption (pp)', JP_CTB_PUBINV: 'Japan GDP contribution — public investment (pp)',
    JP_CTB_EXPORTS: 'Japan GDP contribution — exports (pp)', JP_CTB_IMPORTS: 'Japan GDP contribution — imports (pp)',
    JP_GDP_N: 'Japan nominal GDP (SNA quarterly, ¥bn ann., SA)', JP_CONS_N: 'Japan private consumption (nominal, ¥bn ann.)',
    JP_CAPEX_N: 'Japan business investment (nominal, ¥bn ann.)', JP_GOV_N: 'Japan government consumption (nominal, ¥bn ann.)',
    JP_EXPORTS_N: 'Japan exports (nominal, ¥bn ann.)', JP_IMPORTS_N: 'Japan imports (nominal, ¥bn ann.)',
    JP_GDP_DEFLATOR: 'Japan GDP deflator (2020=100, SA)',
    JP_HH_SPENDING: 'Japan FIES household consumption expenditure (¥/household/month, NSA)',
    JP_TRADE_EXP: 'Japan goods exports — customs basis (¥ thousand, NSA)', JP_TRADE_IMP: 'Japan goods imports — customs basis (¥ thousand, NSA)',
    JP_TRADE_BAL: 'Japan goods trade balance — customs basis (¥ thousand, NSA)',
    JP_IIP_PROD: 'Japan IIP — mining & manufacturing production (2020=100, SA)', JP_IIP_PROD_MFG: 'Japan IIP — manufacturing production (SA)',
    JP_IIP_SHIP: 'Japan IIP — shipments (SA)', JP_IIP_INV: 'Japan IIP — inventories (SA)', JP_IIP_INVRATIO: 'Japan IIP — inventory ratio (SA)',
    CPI_HEADLINE_JP: 'Japan CPI — all items (2020=100, NSA)', CPI_CORE_JP: 'Japan CPI — ex fresh food ("core", energy included; 2020=100)',
    CPI_CORECORE_JP: 'Japan CPI — ex fresh food & energy ("core-core"; 2020=100)', UNRATE_JP: 'Japan unemployment rate (NSA, LFS)',
    JP_UNRATE_SA: 'Japan unemployment rate (SA, Cabinet Office composite table)',
    JP_JOBOFFER_RATIO: 'Japan active job-offers-to-applicants ratio (SA)', JP_NEWOFFERS: 'Japan new job offers ex new graduates (SA, persons)',
    JP_MFG_EARNINGS: 'Japan contractual cash earnings — manufacturing (2020=100)', JP_REGEMP_YOY: 'Japan regular workers employment (MLS-derived, YoY %)',
    JP_EMPLOYED: 'Japan employed persons (LFS, ten-thousand persons, NSA)', JP_PART_RATE: 'Japan labour force participation rate (NSA)',
    JP_EMP_RATE: 'Japan employment rate (NSA)',
    JP_UR_15_24: 'Japan unemployment rate, 15–24 (NSA)', JP_UR_25_34: 'Japan unemployment rate, 25–34 (NSA)',
    JP_UR_35_44: 'Japan unemployment rate, 35–44 (NSA)', JP_UR_45_54: 'Japan unemployment rate, 45–54 (NSA)',
    JP_UR_55_64: 'Japan unemployment rate, 55–64 (NSA)',
  }
  const cfg = new Map(ALL_ESTAT_SERIES.map(s => [s.code, s]))
  for (const s of enumerate('estat_observations', 'series_code', 'date', 'unit')) {
    const c = cfg.get(s.sid)
    const override = JP[s.sid]
    // CPI item codes carry English labels in the collector config verify list.
    const cfgLabel = c?.verify.find(v => /^[A-Za-z]/.test(v.labelIncludes))?.labelIncludes
    const desc = override ?? (cfgLabel ? `Japan CPI — ${cfgLabel}` : null)
    push({
      series_id: s.sid, source_table: 'estat_observations',
      description: desc, units: s.unit, frequency: s.freq,
      data_source: s.sid.startsWith('JP_TRADE') ? 'Customs (Japan)' : 'e-Stat',
      country: 'JP', category: stemCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: override ? 'docs/jp-models-mapping.md + fetchAllEstatSeries.ts'
        : cfgLabel ? 'fetchAllEstatSeries.ts (verify label)' : 'unresolved',
    })
  }
}

// EU3 (eurostat_observations): explicit stem→description map, attributed to
// fetchAllEurostatSeries.ts + docs/eu3-models-mapping.md.
{
  const STEM: Record<string, string> = {
    GDP_R: 'real GDP (chain-linked €M/quarter, SCA)', CONS_R: 'household consumption (real, €M/q)',
    GFCF_R: 'gross fixed capital formation (real, €M/q)', GOV_R: 'government consumption (real, €M/q)',
    EXPORTS_R: 'exports (real, €M/q)', IMPORTS_R: 'imports (real, €M/q)',
    GDP_QOQ: 'real GDP QoQ % (published)', GDP_YOY: 'real GDP YoY % (published)', GDP_QOQA: 'real GDP QoQ annualized % (published)',
    CTB_CONS: 'GDP contribution — consumption (published, pp)', CTB_GFCF: 'GDP contribution — investment (pp)',
    CTB_GOV: 'GDP contribution — government (pp)', CTB_EXPORTS: 'GDP contribution — exports (pp)', CTB_IMPORTS: 'GDP contribution — imports (pp)',
    GDP_N: 'nominal GDP (€M/quarter, SCA)', GDP_DEFLATOR: 'GDP implicit deflator (2020=100)', COMP: 'compensation of employees (€M/q)',
    FISC_B9: 'general government net lending/borrowing (€M/q, NSA)', FISC_REV: 'general government revenue (€M/q, NSA)',
    FISC_EXP: 'general government expenditure (€M/q, NSA)', FISC_B9_PCGDP: 'government net lending (% of GDP)',
    FISC_REV_PCGDP: 'government revenue (% of GDP)', FISC_EXP_PCGDP: 'government expenditure (% of GDP)',
    DEBT: 'Maastricht general government debt (€M)', DEBT_PCGDP: 'Maastricht debt (% of GDP)',
    UR_YOUTH: 'youth (under-25) unemployment rate (SA)', UNEMP_LEVEL: 'unemployed persons (SA, thousands)',
    EMPLOYEES: 'national-accounts employees (SAL_DC, thousands)', EMPLOYMENT: 'total employment (EMP_DC, thousands)',
    HOURS: 'hours worked (national accounts, thousand hours/q)', VACRATE: 'job vacancy rate (SA, NACE B-S)',
    LCI: 'labour cost index (2020=100, SCA)', LCI_YOY: 'labour cost index YoY % (published, CA)',
    IP: 'industrial production, B-D (2021=100, SCA)', IP_MFG: 'manufacturing production (2021=100, SCA)',
    IP_INTERMED: 'IP — intermediate goods (MIG)', IP_CAPITAL: 'IP — capital goods (MIG)', IP_CONSUMER: 'IP — consumer goods (MIG)',
    CONSTRUCTION: 'construction production (2021=100, SCA)', RETAIL: 'retail sales volume, G47 (2021=100, SCA)',
    RETAIL_XFUEL: 'retail sales volume ex fuel (2021=100, SCA)',
    TRADE_BAL: 'goods trade balance (€M, SA, world)', TRADE_EXP: 'goods exports (€M, SA)', TRADE_IMP: 'goods imports (€M, SA)',
    CONS_CONF: 'consumer confidence (DG-ECFIN, SA, balance)', ESI: 'economic sentiment indicator (DG-ECFIN)',
    IND_CONF: 'industry confidence (DG-ECFIN, balance)', SAVING_RATE: 'household saving rate (SCA, %)',
    HPI: 'house price index (2015=100, NSA)', HPI_YOY: 'house price index YoY % (published)',
    PERMITS: 'building permits — dwellings index (2021=100, SCA)', PERMITS_NSA: 'building permits — dwellings index (NSA)',
  }
  for (let i = 1; i <= 12; i++) STEM[`HICPW_CP${String(i).padStart(2, '0')}`] = `HICP division weight CP${String(i).padStart(2, '0')} (per-mille, annual)`
  const CN: Record<string, string> = { DE: 'Germany', FR: 'France', IT: 'Italy' }
  void ALL_EUROSTAT_SERIES // config import retained as the traceability anchor
  for (const s of enumerate('eurostat_observations', 'series_code', 'date', 'unit')) {
    const [cc, ...rest] = s.sid.split('_')
    const stem = rest.join('_')
    const d = CN[cc] && STEM[stem] ? `${CN[cc]} ${STEM[stem]}` : null
    push({
      series_id: s.sid, source_table: 'eurostat_observations',
      description: d, units: s.unit, frequency: s.freq,
      data_source: 'Eurostat', country: CN[cc] ? cc : null, category: stemCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: d ? 'fetchAllEurostatSeries.ts + docs/eu3-models-mapping.md (stem map)' : 'unresolved',
    })
  }
}

// ECB (mirrored code map)
{
  const map = buildEcbMap()
  for (const s of enumerate('ecb_observations', 'series_code', 'date', 'unit')) {
    const m = map[s.sid]
    push({
      series_id: s.sid, source_table: 'ecb_observations',
      description: m?.description ?? null, units: s.unit, frequency: s.freq,
      data_source: 'ECB', country: m?.country ?? null, category: m?.category ?? stemCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: m ? m.src : 'unresolved',
    })
  }
}

// Australia (au_macro_series): compose from ALL_ABS_SERIES verify labels with
// documented prefix templates; explicit overrides for label-less codes.
{
  const cfg = new Map(ALL_ABS_SERIES.map(s => [s.code, s]))
  const AU: Record<string, string> = {
    AU_CPI_M_HEADLINE: 'Australia Monthly CPI — all groups (NSA, ~2023-24=100)',
    AU_CPI_M_TRIMMED: 'Australia Monthly CPI — trimmed mean (SA, interim)', AU_CPI_M_WGTMED: 'Australia Monthly CPI — weighted median (SA, interim)',
    AU_CPI_Q_HEADLINE: 'Australia quarterly CPI — all groups (1948→)', AU_CPI_Q_TRIMMED: 'Australia quarterly CPI — trimmed mean (RBA reference, 2011-12=100)',
    AU_CPI_Q_WGTMED: 'Australia quarterly CPI — weighted median', AU_UNRATE_SA: 'Australia unemployment rate (SA)', AU_UNRATE_TREND: 'Australia unemployment rate (trend, ABS-recommended)',
    AU_PPI_YOY: 'Australia PPI Final Demand YoY % (published)', AU_PPI_QOQ: 'Australia PPI Final Demand QoQ % (published)',
    AU_WPI_YOY: 'Australia Wage Price Index YoY % (published)', AU_WPI_QOQ: 'Australia Wage Price Index QoQ % (published)',
    AU_HH_SPENDING_YOY: 'Australia Monthly Household Spending Indicator YoY % (published)',
    AU_GDP_QOQ: 'Australia real GDP QoQ % (published)', AU_CTB_GDP: 'Australia GDP growth — own TCH row (published QoQ, pp)',
    AU_CTB_SDE: 'Australia GDP contribution — statistical discrepancy (pp)',
  }
  const prefixTemplate = (code: string, label: string): string => {
    if (code.startsWith('AU_CPIM_')) return `Australia Monthly CPI — ${label}`
    if (code.startsWith('AU_CPIQ_')) return `Australia quarterly CPI — ${label}`
    if (code.startsWith('AU_CTB_')) return `Australia GDP contribution — ${label} (published TCH, pp)`
    return `Australia — ${label}`
  }
  for (const s of enumerate('au_macro_series', 'series_code', 'date', 'unit')) {
    const c = cfg.get(s.sid)
    const label = c?.verify[0]?.labelIncludes
    const desc = AU[s.sid] ?? (label ? prefixTemplate(s.sid, label) : null)
    const freqCol = (db.prepare('SELECT frequency FROM au_macro_series WHERE series_code = ? LIMIT 1').get(s.sid) as { frequency: string | null } | undefined)?.frequency
    push({
      series_id: s.sid, source_table: 'au_macro_series',
      description: desc, units: s.unit,
      frequency: freqCol === 'M' ? 'monthly' : freqCol === 'Q' ? 'quarterly' : s.freq,
      data_source: 'ABS', country: 'AU', category: stemCategory(s.sid),
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: AU[s.sid] ? 'docs/au-models-mapping.md + collectors/absCollector.ts'
        : label ? 'fetchAllAbsSeries.ts (verify label)' : 'unresolved',
    })
  }
}

// BoJ Time-Series
{
  const cfg = new Map(ALL_BOJ_SERIES.map(s => [s.code, s]))
  const D: Record<string, string> = {
    JP_PPI: 'Japan Producer Price Index — all commodities (BoJ, CY2020=100)',
    JP_LOANS: 'Japan bank loans & discounts outstanding (major+regional+shinkin, ¥100M)',
    JP_LOANS_YOY: 'Japan bank lending YoY % (BoJ published)',
    JP_DEPOSITS: 'Japan bank deposits + CDs outstanding (¥100M)',
  }
  for (const s of enumerate('bojts_observations', 'series_code', 'date', 'unit')) {
    push({
      series_id: s.sid, source_table: 'bojts_observations',
      description: D[s.sid] ?? cfg.get(s.sid)?.nameIncludes ?? null,
      units: s.unit, frequency: s.freq, data_source: 'BoJ', country: 'JP',
      category: s.sid === 'JP_PPI' ? 'inflation' : 'credit',
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: D[s.sid] ? 'bojTsCollector.ts + docs/jp-models-mapping.md' : 'unresolved',
    })
  }
}

// Overnight rates
for (const s of enumerate('overnight_rates', 'series_code', 'date')) {
  const m = OVERNIGHT_MAP[s.sid]
  push({
    series_id: s.sid, source_table: 'overnight_rates',
    description: m?.description ?? null, units: '%', frequency: s.freq,
    data_source: 'central banks', country: m?.country ?? null, category: 'rates',
    first_date: s.first, last_date: s.last, obs_count: s.n,
    description_source: m ? 'seriesCatalogMappings.ts (overnight map, per overnight*.ts)' : 'unresolved',
  })
}

// Census trade (deterministic ID composition documented in the mappings file)
for (const s of enumerate('census_trade_observations', 'series_id', 'date')) {
  const d = censusDescription(s.sid)
  push({
    series_id: s.sid, source_table: 'census_trade_observations',
    description: d, units: 'USD M', frequency: s.freq,
    data_source: 'Census', country: 'US', category: 'growth',
    first_date: s.first, last_date: s.last, obs_count: s.n,
    description_source: d ? 'seriesCatalogMappings.ts (census end-use map)' : 'unresolved',
  })
}

// Self-describing-key tables
const SELF: ReadonlyArray<[table: string, key: string, dateCol: string, tmpl: (k: string) => string, src: string, country: string, category: string, units: string | null]> = [
  ['hmrc_receipts', 'tax_head', 'date', k => `UK HMRC cash receipts — ${k}`, 'HMRC', 'UK', 'fiscal', 'GBP M'],
  ['paye_rti', 'metric', 'date', k => `UK PAYE RTI — ${k.replace(/_/g, ' ')}`, 'HMRC/ONS', 'UK', 'labor', null],
  ['dts_tax_deposits', 'deposit_type', 'record_date', k => `US DTS withheld tax deposits — ${k}`, 'Treasury DTS', 'US', 'fiscal', 'USD M'],
  ['sce_inflation_expectations', 'horizon', 'date', k => `US NY Fed SCE inflation expectations — ${k} horizon (median)`, 'NY Fed', 'US', 'inflation', '%'],
]
for (const [table, key, dateCol, tmpl, src, country, category, units] of SELF) {
  if (rowCount(table) === 0) continue
  for (const s of enumerate(table, key, dateCol)) {
    push({
      series_id: s.sid, source_table: table, description: tmpl(s.sid), units,
      frequency: s.freq, data_source: src, country, category,
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: 'self-describing key',
    })
  }
}

// ONS monthly GDP contributions (sector × period_type)
for (const s of enumerate('ons_gdp_contributions', "sector || ' [' || period_type || ']'", 'date')) {
  push({
    series_id: s.sid, source_table: 'ons_gdp_contributions',
    description: `UK monthly GDP contribution — ${s.sid.replace(/\[/, '(').replace(/\]/, ' basis)')}`,
    units: 'pp', frequency: s.freq, data_source: 'ONS (Excel scrape)', country: 'UK', category: 'growth',
    first_date: s.first, last_date: s.last, obs_count: s.n,
    description_source: 'self-describing key',
  })
}

// ═══ 5. TradingView (tv_series: continuous + contract families; tv_ohlcv) ═══
{
  const tvMap = buildTvContinuousMap()
  const MONTHS = new Set('FGHJKMNQUVXZ'.split(''))
  const all = enumerate('tv_series', 'symbol', 'time', undefined, true)
  const famMembers = new Map<string, SeriesStat[]>()
  const continuous: SeriesStat[] = []
  const isDated = (sym: string): { root: string } | null => {
    const core = sym.includes(':') ? sym.split(':').pop() ?? sym : sym
    const m = /^([A-Z0-9]{1,6}?)([FGHJKMNQUVXZ])(\d{1,2})$/.exec(core)
    if (!m || !MONTHS.has(m[2])) return null
    if (m[3].length === 2 && !(parseInt(m[3], 10) >= 24 && parseInt(m[3], 10) <= 29)) return null
    return { root: m[1] }
  }
  // First pass: group candidates; only roots with >=3 members are families
  const cand = new Map<string, SeriesStat[]>()
  for (const s of all) {
    const d = isDated(s.sid)
    if (d) cand.set(d.root, [...(cand.get(d.root) ?? []), s])
  }
  const familyRoots = new Set([...cand.keys()].filter(r => (cand.get(r) ?? []).length >= 3))
  for (const s of all) {
    const d = isDated(s.sid)
    if (d && familyRoots.has(d.root)) famMembers.set(d.root, [...(famMembers.get(d.root) ?? []), s])
    else continuous.push(s)
  }
  for (const s of continuous) {
    const m = tvMap[s.sid]
    push({
      series_id: s.sid, source_table: 'tv_series',
      description: m?.description ?? null, units: m?.units ?? null, frequency: s.freq,
      data_source: 'TradingView', country: m?.country ?? null,
      category: m?.category ?? 'uncategorized',
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: m ? m.src : 'unresolved',
    })
  }
  for (const root of [...famMembers.keys()].sort()) {
    const members = famMembers.get(root) ?? []
    const fam = TV_FAMILIES[root]
    // `{root}:contracts` — several roots (BRN/CL/GC/HG/SI) also exist as
    // CONTINUOUS front-month symbols; the family entry is a distinct object.
    push({
      series_id: `${root}:contracts`, series_kind: 'contract_family', source_table: 'tv_series',
      description: fam?.description ?? null, units: fam?.units ?? null, frequency: 'daily',
      data_source: 'TradingView', country: fam?.country ?? null,
      category: fam?.category ?? 'uncategorized',
      first_date: members.map(m => m.first).sort()[0] ?? null,
      last_date: members.map(m => m.last).sort().pop() ?? null,
      obs_count: members.reduce((a, m) => a + m.n, 0),
      member_count: members.length,
      description_source: fam ? fam.src : 'unresolved',
    })
  }
  for (const s of enumerate('tv_ohlcv', 'symbol', 'time', undefined, true)) {
    const m = TV_OHLCV_MAP[s.sid]
    push({
      series_id: s.sid, source_table: 'tv_ohlcv',
      description: m?.description ?? null, units: m?.units ?? null, frequency: s.freq,
      data_source: 'TradingView', country: m?.country ?? null, category: m?.category ?? 'uncategorized',
      first_date: s.first, last_date: s.last, obs_count: s.n,
      description_source: m ? m.src : 'unresolved',
    })
  }
}

// ═══ 6. Special-shape tables (gate decision 3) ═══
if (rowCount('mts_fiscal_balance') > 0) {
  const r = db.prepare('SELECT COUNT(*) AS n, MIN(record_date) AS f, MAX(record_date) AS l FROM mts_fiscal_balance').get() as { n: number; f: string; l: string }
  push({
    series_id: 'MTS_MONTHLY_BALANCE', source_table: 'mts_fiscal_balance',
    description: 'US federal budget surplus/deficit — monthly (MTS), with FY cumulative',
    units: 'USD M', frequency: 'monthly', data_source: 'Treasury MTS', country: 'US', category: 'fiscal',
    first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
    description_source: 'self-describing table (mts_fiscal_balance)',
  })
}
if (rowCount('umich_inflation_expectations') > 0) {
  const r = db.prepare('SELECT COUNT(*) AS n, MIN(date) AS f, MAX(date) AS l FROM umich_inflation_expectations').get() as { n: number; f: string; l: string }
  push({
    series_id: 'UMICH_PX5', source_table: 'umich_inflation_expectations',
    description: 'US UMich 5-year inflation expectations (median)',
    units: '%', frequency: 'monthly', data_source: 'UMich', country: 'US', category: 'inflation',
    first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
    description_source: 'self-describing table (umich_inflation_expectations)',
  })
}
if (rowCount('uk_hpi') > 0) {
  const regions = (db.prepare('SELECT DISTINCT region FROM uk_hpi ORDER BY region').all() as Array<{ region: string }>).map(r => r.region)
  for (const region of regions) {
    const r = db.prepare('SELECT COUNT(*) AS n, MIN(date) AS f, MAX(date) AS l FROM uk_hpi WHERE region = ?').get(region) as { n: number; f: string; l: string }
    for (const [col, label, units] of UK_HPI_METRICS) {
      const nn = (db.prepare(`SELECT COUNT(*) AS n FROM uk_hpi WHERE region = ? AND ${col} IS NOT NULL`).get(region) as { n: number }).n
      if (nn === 0) continue
      push({
        series_id: `UKHPI:${region}:${col}`, source_table: 'uk_hpi',
        description: `UK HPI (${region}) — ${label}`,
        units, frequency: 'monthly', data_source: 'Land Registry', country: 'UK', category: 'housing',
        first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: nn,
        description_source: 'ukHpi.ts columns (per region × metric, gate decision 3)',
      })
    }
  }
}
if (rowCount('gilt_yield_curve') > 0) {
  const curves = db.prepare('SELECT curve_type, COUNT(DISTINCT maturity) AS mats, COUNT(*) AS n, MIN(date) AS f, MAX(date) AS l FROM gilt_yield_curve GROUP BY curve_type').all() as Array<{ curve_type: string; mats: number; n: number; f: string; l: string }>
  const CURVE_LABEL: Record<string, string> = {
    nominal_spot: 'UK gilt nominal spot yield curve', real_spot: 'UK gilt real (index-linked) spot yield curve',
    inflation_spot: 'UK implied inflation spot curve', ois_spot: 'UK OIS spot curve',
  }
  for (const c of curves) {
    push({
      series_id: `GILT_CURVE:${c.curve_type}`, series_kind: 'parameterized', source_table: 'gilt_yield_curve',
      description: `${CURVE_LABEL[c.curve_type] ?? c.curve_type} (maturity is a fetch-time parameter)`,
      units: '%', frequency: 'daily', data_source: 'BoE', country: 'UK', category: 'rates',
      first_date: c.f?.slice(0, 10) ?? null, last_date: c.l?.slice(0, 10) ?? null, obs_count: c.n,
      member_count: c.mats,
      description_source: 'gilt_yield_curve curve_type (gate decision 3: parameterized)',
    })
  }
}
if (rowCount('gdpnow_forecasts') > 0) {
  const r = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT quarter) AS q, MIN(forecast_date) AS f, MAX(forecast_date) AS l FROM gdpnow_forecasts').get() as { n: number; q: number; f: string; l: string }
  push({
    series_id: 'GDPNOW', series_kind: 'parameterized', source_table: 'gdpnow_forecasts',
    description: 'Atlanta Fed GDPNow nowcast vintages (quarter is a fetch-time parameter)',
    units: '% (SAAR)', frequency: 'daily', data_source: 'Atlanta Fed', country: 'US', category: 'growth',
    first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
    member_count: r.q, description_source: 'gdpnow_forecasts (gate decision 3)',
  })
}
if (rowCount('gdpnow_contributions') > 0) {
  const r = db.prepare('SELECT COUNT(*) AS n, MIN(forecast_date) AS f, MAX(forecast_date) AS l FROM gdpnow_contributions').get() as { n: number; f: string; l: string }
  push({
    series_id: 'GDPNOW_CONTRIBUTIONS', series_kind: 'parameterized', source_table: 'gdpnow_contributions',
    description: 'Atlanta Fed GDPNow contribution vintages (component is a fetch-time parameter: pce/equipment/…)',
    units: 'pp (SAAR)', frequency: 'daily', data_source: 'Atlanta Fed', country: 'US', category: 'growth',
    first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
    member_count: 8, description_source: 'gdpnow_contributions columns (gate decision 3)',
  })
}

// ═══ 7. Event families (gate decision 4) ═══
if (rowCount('economic_releases') > 0) {
  const rows = db.prepare(`
    SELECT country, event, COUNT(*) AS n, MIN(release_date) AS f, MAX(release_date) AS l
    FROM economic_releases GROUP BY country, event ORDER BY country, event
  `).all() as Array<{ country: string; event: string; n: number; f: string; l: string }>
  for (const r of rows) {
    push({
      series_id: `CAL:${r.country}:${r.event}`, series_kind: 'parameterized', source_table: 'economic_releases',
      description: `Economic calendar — ${r.country}: ${r.event} (field is a fetch-time parameter: actual/expected/previous/surprise)`,
      units: null, frequency: null, data_source: 'TradingEconomics', country: r.country, category: 'calendar',
      first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
      member_count: r.n, description_source: 'economic_releases (country, event) key',
    })
  }
}
for (const table of ['treasury_auctions', 'treasury_investor_class'] as const) {
  if (rowCount(table) === 0) continue
  const dateCol = table === 'treasury_auctions' ? 'auction_date' : 'issue_date'
  const rows = db.prepare(`SELECT security_type, COUNT(*) AS n, MIN(${dateCol}) AS f, MAX(${dateCol}) AS l FROM ${table} GROUP BY security_type`).all() as Array<{ security_type: string; n: number; f: string; l: string }>
  for (const r of rows) {
    push({
      series_id: `${table === 'treasury_auctions' ? 'AUCTION' : 'ALLOT'}:${r.security_type}`,
      series_kind: 'parameterized', source_table: table,
      description: `${TREASURY_FAMILY_DESCRIPTIONS[table]} — ${r.security_type} (metric is a fetch-time parameter)`,
      units: null, frequency: null, data_source: 'TreasuryDirect', country: 'US', category: 'fiscal',
      first_date: r.f?.slice(0, 10) ?? null, last_date: r.l?.slice(0, 10) ?? null, obs_count: r.n,
      member_count: r.n, description_source: `${table} security_type key (gate decision 4)`,
    })
  }
}
// NOTE: news_articles intentionally excluded — document store, not chartable
// (gate decision 6). Empty tables (dts_fiscal_flows, rde_estimates, …) are
// skipped by the rowCount guards above and auto-included once populated.

// ═══ Write: full refresh in one transaction ═══
const insert = db.prepare(`
  INSERT INTO series_catalog (
    series_id, series_kind, source_table, source_db, description, units, frequency,
    seasonal_adjustment, data_source, country, category, first_date, last_date,
    obs_count, member_count, description_source, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
db.transaction(() => {
  db.prepare('DELETE FROM series_catalog').run()
  for (const en of entries) {
    insert.run(
      en.series_id, en.series_kind, en.source_table, SOURCE_DB, en.description, en.units,
      en.frequency, en.seasonal_adjustment ?? null, en.data_source, en.country, en.category,
      en.first_date, en.last_date, en.obs_count, en.member_count, en.description_source, NOW,
    )
  }
})()

// ═══ docs/series-catalog.md export ═══
{
  const lines: string[] = []
  lines.push('# Series Catalog — What the Terminal Holds')
  lines.push('')
  lines.push(`Generated by \`server/src/scripts/build-series-catalog.ts\` on ${NOW.slice(0, 10)}. ${entries.length} entries.`)
  lines.push('Grouped by category, then data source. Format: `series_id — description — units — freq — first→last`.')
  lines.push('Kinds: [F] contract family (member_count contracts), [P] parameterized. Unresolved descriptions are marked.')
  const byCat = new Map<string, CatalogEntry[]>()
  for (const en of entries) byCat.set(en.category, [...(byCat.get(en.category) ?? []), en])
  for (const cat of [...byCat.keys()].sort()) {
    lines.push('', `## ${cat}`, '')
    const bySrc = new Map<string, CatalogEntry[]>()
    for (const en of byCat.get(cat) ?? []) bySrc.set(en.data_source, [...(bySrc.get(en.data_source) ?? []), en])
    for (const src of [...bySrc.keys()].sort()) {
      lines.push(`### ${src}`, '')
      for (const en of (bySrc.get(src) ?? []).sort((a, b) => a.series_id.localeCompare(b.series_id))) {
        const kind = en.series_kind === 'contract_family' ? ` [F×${en.member_count}]` : en.series_kind === 'parameterized' ? ` [P×${en.member_count}]` : ''
        lines.push(`- \`${en.series_id}\`${kind} — ${en.description ?? '*(unresolved)*'} — ${en.units ?? '—'} — ${en.frequency ?? '—'} — ${en.first_date}→${en.last_date}`)
      }
      lines.push('')
    }
  }
  fs.writeFileSync(path.resolve(__dirname, '..', '..', '..', 'docs', 'series-catalog.md'), lines.join('\n'))
}

// ═══ Completion summary ═══
{
  const unresolved = entries.filter(en => en.description_source === 'unresolved')
  const bySrc = new Map<string, number>()
  for (const en of entries) bySrc.set(en.data_source, (bySrc.get(en.data_source) ?? 0) + 1)
  console.log(`[catalog] ${entries.length} entries cataloged (${entries.filter(e2 => e2.series_kind === 'contract_family').length} contract families, ${entries.filter(e2 => e2.series_kind === 'parameterized').length} parameterized)`)
  console.log('[catalog] per source: ' + [...bySrc.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join(' '))
  console.log(`[catalog] unresolved descriptions: ${unresolved.length}`)
  console.log('[catalog] docs/series-catalog.md written')
}
