// Generic StatCan WDS collector for the Canada Economic Data Models (Phase 2,
// docs/ca-models-mapping.md). Mirrors the ALL_ONS_SERIES config-first pattern:
// adding a series = appending a verified entry to ALL_STATCAN_SERIES.
//
// Writes to the existing `statcan_observations` table (same shape as the
// rates-side collectors/statcanCollector.ts, which stays untouched and keeps
// owning its six codes: CPI_HEADLINE, CPI_XFE, CPI_TRIM, CPI_MEDIAN,
// CPI_COMMON, UNRATE_CA — those vectors are deliberately NOT duplicated here;
// Canada pages read both code sets from the shared table).
//
// Every vectorId below was verified live on 2026-07-07 via
// getSeriesInfoFromVector / getSeriesInfoFromCubePidCoord (PID + exact English
// title recorded). StatCan renumbers vectors during table restructurings (four
// dead/stale tables were caught during Phase 1 verification), so
// verifyStatcanMetadata() re-checks PID + title per vector and FAILS LOUDLY on
// mismatch — run at startup before any sync.
//
// Backfill uses getBulkVectorDataByRange with a release-date range (repo
// precedent from statcanCollector.ts: for named vectors this is far leaner
// than the playbook's full-table CSV path — those cubes are multi-hundred-MB
// all-geography dumps). Incremental uses getDataFromVectorsAndLatestNPeriods.
// Requests are batched and throttled well under the 25 req/sec/IP cap.

import { storeStatcanObservations, getStatcanLatestDate } from './db'

const WDS_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest'

export interface StatcanSeriesDef {
  code: string
  vectorId: number
  unit: 'index' | 'percent' | 'thousands' | 'dollars' | 'ratio'
  pid: number            // expected productId (health check)
  titleIncludes: string  // substring of SeriesTitleEn (health check)
}

export const ALL_STATCAN_SERIES: StatcanSeriesDef[] = [
  // ═══ CPI — table 18-10-0004 (monthly, NSA, 2002=100) ═══
  // Headline + ex-food-energy live in collectors/statcanCollector.ts as
  // CPI_HEADLINE (v41690973) / CPI_XFE (v41691233); BoC trio as CPI_TRIM/
  // CPI_MEDIAN/CPI_COMMON. Not repeated here.
  { code: 'CA_CPI_SA',            vectorId: 41690914,   unit: 'index', pid: 18100006, titleIncludes: 'All-items' }, // SA all-items
  // Major components
  { code: 'CA_CPI_FOOD',          vectorId: 41690974,   unit: 'index', pid: 18100004, titleIncludes: 'Food' },
  { code: 'CA_CPI_SHELTER',       vectorId: 41691050,   unit: 'index', pid: 18100004, titleIncludes: 'Shelter' },
  { code: 'CA_CPI_HHOPS',         vectorId: 41691067,   unit: 'index', pid: 18100004, titleIncludes: 'Household operations' },
  { code: 'CA_CPI_CLOTHING',      vectorId: 41691108,   unit: 'index', pid: 18100004, titleIncludes: 'Clothing and footwear' },
  { code: 'CA_CPI_TRANSPORT',     vectorId: 41691128,   unit: 'index', pid: 18100004, titleIncludes: 'Transportation' },
  { code: 'CA_CPI_HEALTH',        vectorId: 41691153,   unit: 'index', pid: 18100004, titleIncludes: 'Health and personal care' },
  { code: 'CA_CPI_RECREATION',    vectorId: 41691170,   unit: 'index', pid: 18100004, titleIncludes: 'Recreation, education and reading' },
  { code: 'CA_CPI_ALCTOB',        vectorId: 41691206,   unit: 'index', pid: 18100004, titleIncludes: 'Alcoholic beverages, tobacco' },
  // Special aggregates
  { code: 'CA_CPI_GOODS',         vectorId: 41691222,   unit: 'index', pid: 18100004, titleIncludes: 'Goods' },
  { code: 'CA_CPI_SERVICES',      vectorId: 41691230,   unit: 'index', pid: 18100004, titleIncludes: 'Services' },
  { code: 'CA_CPI_SVC_EXSHELTER', vectorId: 41691231,   unit: 'index', pid: 18100004, titleIncludes: 'Services excluding shelter' },
  { code: 'CA_CPI_ENERGY',        vectorId: 41691239,   unit: 'index', pid: 18100004, titleIncludes: 'Energy' },
  { code: 'CA_CPI_EXFOOD',        vectorId: 41691232,   unit: 'index', pid: 18100004, titleIncludes: 'excluding food' },
  { code: 'CA_CPI_EXENERGY',      vectorId: 41691238,   unit: 'index', pid: 18100004, titleIncludes: 'excluding energy' },
  { code: 'CA_CPI_DUR',           vectorId: 41691223,   unit: 'index', pid: 18100004, titleIncludes: 'Durable goods' },
  { code: 'CA_CPI_SEMIDUR',       vectorId: 41691224,   unit: 'index', pid: 18100004, titleIncludes: 'Semi-durable goods' },
  { code: 'CA_CPI_NONDUR',        vectorId: 41691225,   unit: 'index', pid: 18100004, titleIncludes: 'Non-durable goods' },
  // Canada-specific detail
  { code: 'CA_CPI_MIC',           vectorId: 41691056,   unit: 'index', pid: 18100004, titleIncludes: 'Mortgage interest cost' },
  { code: 'CA_CPI_RENTED',        vectorId: 41691051,   unit: 'index', pid: 18100004, titleIncludes: 'Rented accommodation' },
  { code: 'CA_CPI_GASOLINE',      vectorId: 41691136,   unit: 'index', pid: 18100004, titleIncludes: 'Gasoline' },
  // Distribution-panel items (32)
  { code: 'CA_CPI_MEAT',          vectorId: 41690976,   unit: 'index', pid: 18100004, titleIncludes: 'Meat' },
  { code: 'CA_CPI_DAIRY',         vectorId: 41690992,   unit: 'index', pid: 18100004, titleIncludes: 'Dairy products' },
  { code: 'CA_CPI_BAKERY',        vectorId: 41691000,   unit: 'index', pid: 18100004, titleIncludes: 'Bakery and cereal' },
  { code: 'CA_CPI_FRUIT',         vectorId: 41691010,   unit: 'index', pid: 18100004, titleIncludes: 'Fruit' },
  { code: 'CA_CPI_VEG',           vectorId: 41691020,   unit: 'index', pid: 18100004, titleIncludes: 'Vegetables' },
  { code: 'CA_CPI_RESTAURANTS',   vectorId: 41691046,   unit: 'index', pid: 18100004, titleIncludes: 'Food purchased from restaurants' },
  { code: 'CA_CPI_RENT',          vectorId: 41691052,   unit: 'index', pid: 18100004, titleIncludes: 'Rent' },
  { code: 'CA_CPI_HOMEREPL',      vectorId: 41691057,   unit: 'index', pid: 18100004, titleIncludes: "Homeowners' replacement cost" },
  { code: 'CA_CPI_PROPTAX',       vectorId: 41691058,   unit: 'index', pid: 18100004, titleIncludes: 'Property taxes' },
  { code: 'CA_CPI_HOMEINS',       vectorId: 41691059,   unit: 'index', pid: 18100004, titleIncludes: 'mortgage insurance' },
  { code: 'CA_CPI_HOMEMAINT',     vectorId: 41691060,   unit: 'index', pid: 18100004, titleIncludes: 'maintenance and repairs' },
  { code: 'CA_CPI_ELECTRICITY',   vectorId: 41691063,   unit: 'index', pid: 18100004, titleIncludes: 'Electricity' },
  { code: 'CA_CPI_WATER',         vectorId: 41691064,   unit: 'index', pid: 18100004, titleIncludes: 'Water' },
  { code: 'CA_CPI_NATGAS',        vectorId: 41691065,   unit: 'index', pid: 18100004, titleIncludes: 'Natural gas' },
  { code: 'CA_CPI_TELEPHONE',     vectorId: 41691070,   unit: 'index', pid: 18100004, titleIncludes: 'Telephone services' },
  { code: 'CA_CPI_FURNITURE',     vectorId: 41691089,   unit: 'index', pid: 18100004, titleIncludes: 'Furniture' },
  { code: 'CA_CPI_APPLIANCES',    vectorId: 41691098,   unit: 'index', pid: 18100004, titleIncludes: 'Household appliances' },
  { code: 'CA_CPI_WCLOTHING',     vectorId: 41691110,   unit: 'index', pid: 18100004, titleIncludes: "Women's clothing" },
  { code: 'CA_CPI_MCLOTHING',     vectorId: 41691111,   unit: 'index', pid: 18100004, titleIncludes: "Men's clothing" },
  { code: 'CA_CPI_FOOTWEAR',      vectorId: 41691113,   unit: 'index', pid: 18100004, titleIncludes: 'Footwear' },
  { code: 'CA_CPI_VEHICLES',      vectorId: 41691132,   unit: 'index', pid: 18100004, titleIncludes: 'Purchase of passenger vehicles' },
  { code: 'CA_CPI_PUBTRANSIT',    vectorId: 41691146,   unit: 'index', pid: 18100004, titleIncludes: 'Public transportation' },
  { code: 'CA_CPI_MEDICINES',     vectorId: 41691157,   unit: 'index', pid: 18100004, titleIncludes: 'Prescribed medicines' },
  { code: 'CA_CPI_PERSONALCARE',  vectorId: 41691163,   unit: 'index', pid: 18100004, titleIncludes: 'Personal care' },
  { code: 'CA_CPI_RECEQUIP',      vectorId: 41691172,   unit: 'index', pid: 18100004, titleIncludes: 'Recreational equipment' },
  { code: 'CA_CPI_TRAVELSVCS',    vectorId: 41691190,   unit: 'index', pid: 18100004, titleIncludes: 'Travel services' },
  { code: 'CA_CPI_TRAVELACCOM',   vectorId: 41691191,   unit: 'index', pid: 18100004, titleIncludes: 'Traveller accommodation' },
  { code: 'CA_CPI_EDUCATION',     vectorId: 41691198,   unit: 'index', pid: 18100004, titleIncludes: 'Education' },
  { code: 'CA_CPI_ALCOHOL',       vectorId: 41691207,   unit: 'index', pid: 18100004, titleIncludes: 'Alcoholic beverages' },
  { code: 'CA_CPI_TOBACCO',       vectorId: 41691216,   unit: 'index', pid: 18100004, titleIncludes: 'Tobacco products' },
  { code: 'CA_CPI_INTERNET',      vectorId: 41693216,   unit: 'index', pid: 18100004, titleIncludes: 'Internet access services' },
  { code: 'CA_CPI_FINSVCS',       vectorId: 41693229,   unit: 'index', pid: 18100004, titleIncludes: 'Financial services' },

  // ═══ CPI basket weights — table 18-10-0007 (occasional, % of basket, link-month prices) ═══
  { code: 'CA_CPIW_FOOD',        vectorId: 91858740, unit: 'percent', pid: 18100007, titleIncludes: 'Food' },
  { code: 'CA_CPIW_SHELTER',     vectorId: 91858892, unit: 'percent', pid: 18100007, titleIncludes: 'Shelter' },
  { code: 'CA_CPIW_HHOPS',       vectorId: 91858926, unit: 'percent', pid: 18100007, titleIncludes: 'Household operations' },
  { code: 'CA_CPIW_CLOTHING',    vectorId: 91859016, unit: 'percent', pid: 18100007, titleIncludes: 'Clothing and footwear' },
  { code: 'CA_CPIW_TRANSPORT',   vectorId: 91859056, unit: 'percent', pid: 18100007, titleIncludes: 'Transportation' },
  { code: 'CA_CPIW_HEALTH',      vectorId: 91859106, unit: 'percent', pid: 18100007, titleIncludes: 'Health and personal care' },
  { code: 'CA_CPIW_RECREATION',  vectorId: 91859144, unit: 'percent', pid: 18100007, titleIncludes: 'Recreation, education and reading' },
  { code: 'CA_CPIW_ALCTOB',      vectorId: 91859220, unit: 'percent', pid: 18100007, titleIncludes: 'Alcoholic beverages, tobacco' },
  { code: 'CA_CPIW_ENERGY',      vectorId: 91859272, unit: 'percent', pid: 18100007, titleIncludes: 'Energy' },
  { code: 'CA_CPIW_GOODS',       vectorId: 91859278, unit: 'percent', pid: 18100007, titleIncludes: 'Goods' },
  { code: 'CA_CPIW_SERVICES',    vectorId: 91873252, unit: 'percent', pid: 18100007, titleIncludes: 'Services' },

  // ═══ IPPI — table 18-10-0265 (monthly, NSA) ═══
  { code: 'CA_IPPI',      vectorId: 1230995983, unit: 'index', pid: 18100265, titleIncludes: 'Total, Industrial product price index' },
  { code: 'CA_IPPI_CORE', vectorId: 1230995984, unit: 'index', pid: 18100265, titleIncludes: 'excluding energy and petroleum' },

  // ═══ LFS — table 14-10-0287 (monthly, SA, 1976→) ═══
  // UNRATE_CA (v2062815) owned by the rates-side collector.
  { code: 'CA_LABOUR_FORCE', vectorId: 2062810, unit: 'thousands', pid: 14100287, titleIncludes: 'Labour force' },
  { code: 'CA_EMPLOYMENT',   vectorId: 2062811, unit: 'thousands', pid: 14100287, titleIncludes: 'Employment' },
  { code: 'CA_EMP_FT',       vectorId: 2062812, unit: 'thousands', pid: 14100287, titleIncludes: 'Full-time employment' },
  { code: 'CA_EMP_PT',       vectorId: 2062813, unit: 'thousands', pid: 14100287, titleIncludes: 'Part-time employment' },
  { code: 'CA_UNEMPLOYMENT', vectorId: 2062814, unit: 'thousands', pid: 14100287, titleIncludes: 'Unemployment' },
  { code: 'CA_PART_RATE',    vectorId: 2062816, unit: 'percent',   pid: 14100287, titleIncludes: 'Participation rate' },
  { code: 'CA_EMP_RATE',     vectorId: 2062817, unit: 'percent',   pid: 14100287, titleIncludes: 'Employment rate' },
  { code: 'CA_UR_15_24',     vectorId: 2062842, unit: 'percent',   pid: 14100287, titleIncludes: '15 to 24' },
  { code: 'CA_UR_25_54',     vectorId: 2062950, unit: 'percent',   pid: 14100287, titleIncludes: '25 to 54' },
  { code: 'CA_UR_55PLUS',    vectorId: 2062977, unit: 'percent',   pid: 14100287, titleIncludes: '55 years and over' },

  // ═══ SEPH — table 14-10-0223 (monthly, 2001→) ═══
  { code: 'CA_SEPH_EMP',    vectorId: 79310776, unit: 'thousands', pid: 14100223, titleIncludes: 'Employment for all employees;Industrial aggregate excluding' },
  { code: 'CA_SEPH_AWE',    vectorId: 79311153, unit: 'dollars',   pid: 14100223, titleIncludes: 'Average weekly earnings' },
  { code: 'CA_SEPH_GOODS',  vectorId: 79310775, unit: 'thousands', pid: 14100223, titleIncludes: 'Goods producing industries' },
  { code: 'CA_SEPH_CONSTR', vectorId: 79310779, unit: 'thousands', pid: 14100223, titleIncludes: 'Construction' },
  { code: 'CA_SEPH_MFG',    vectorId: 79310780, unit: 'thousands', pid: 14100223, titleIncludes: 'Manufacturing' },

  // ═══ Job vacancies — table 14-10-0432 (monthly SA, 2015-04→) ═══
  { code: 'CA_JOBVAC',      vectorId: 1481212145, unit: 'thousands', pid: 14100432, titleIncludes: 'Job vacancies' },
  { code: 'CA_JOBVAC_RATE', vectorId: 1481212147, unit: 'percent',   pid: 14100432, titleIncludes: 'Job vacancy rate' },

  // ═══ EI beneficiaries — table 14-10-0011 (monthly SA, 1997→) ═══
  { code: 'CA_EI_BENEFICIARIES', vectorId: 64549353, unit: 'thousands', pid: 14100011, titleIncludes: 'Regular benefits' },

  // ═══ Productivity — table 36-10-0206 (quarterly SA, 1981→) ═══
  { code: 'CA_PRODUCTIVITY', vectorId: 1409153, unit: 'index', pid: 36100206, titleIncludes: 'Labour productivity' },
  { code: 'CA_ULC',          vectorId: 1409159, unit: 'index', pid: 36100206, titleIncludes: 'Unit labour cost' },
  { code: 'CA_COMP_HOUR',    vectorId: 1409158, unit: 'index', pid: 36100206, titleIncludes: 'compensation per hour' },

  // ═══ Quarterly GDP, expenditure-based — table 36-10-0104 (SAAR, 1961→) ═══
  // Real, chained 2017$
  { code: 'CA_GDP_R',       vectorId: 62305752, unit: 'dollars', pid: 36100104, titleIncludes: 'Gross domestic product at market prices' },
  { code: 'CA_HHCONS_R',    vectorId: 62305724, unit: 'dollars', pid: 36100104, titleIncludes: 'Household final consumption' },
  { code: 'CA_GOV_R',       vectorId: 62305731, unit: 'dollars', pid: 36100104, titleIncludes: 'General governments final consumption' },
  { code: 'CA_GFCF_R',      vectorId: 62305732, unit: 'dollars', pid: 36100104, titleIncludes: 'Gross fixed capital formation' },
  { code: 'CA_BUSGFCF_R',   vectorId: 62305733, unit: 'dollars', pid: 36100104, titleIncludes: 'Business gross fixed capital formation' },
  { code: 'CA_RESID_R',     vectorId: 62305734, unit: 'dollars', pid: 36100104, titleIncludes: 'Residential structures' },
  { code: 'CA_INVENT_R',    vectorId: 62305741, unit: 'dollars', pid: 36100104, titleIncludes: 'Investment in inventories' },
  { code: 'CA_EXPORTS_R',   vectorId: 62305745, unit: 'dollars', pid: 36100104, titleIncludes: 'Exports of goods and services' },
  { code: 'CA_IMPORTS_R',   vectorId: 62305748, unit: 'dollars', pid: 36100104, titleIncludes: 'imports of goods and services' },
  { code: 'CA_CONSGOODS_R', vectorId: 62305725, unit: 'dollars', pid: 36100104, titleIncludes: 'Goods' },
  { code: 'CA_CONSSVCS_R',  vectorId: 62305729, unit: 'dollars', pid: 36100104, titleIncludes: 'Services' },
  { code: 'CA_CONSDUR_R',   vectorId: 62305726, unit: 'dollars', pid: 36100104, titleIncludes: 'Durable goods' },
  { code: 'CA_CONSSEMI_R',  vectorId: 62305727, unit: 'dollars', pid: 36100104, titleIncludes: 'Semi-durable goods' },
  { code: 'CA_CONSNONDUR_R', vectorId: 62305728, unit: 'dollars', pid: 36100104, titleIncludes: 'Non-durable goods' },
  { code: 'CA_NPISH_R',     vectorId: 62305730, unit: 'dollars', pid: 36100104, titleIncludes: 'Non-profit institutions' },
  // Nominal, current prices
  { code: 'CA_GDP_N',     vectorId: 62305783, unit: 'dollars', pid: 36100104, titleIncludes: 'Gross domestic product at market prices' },
  { code: 'CA_HHCONS_N',  vectorId: 62305755, unit: 'dollars', pid: 36100104, titleIncludes: 'Household final consumption' },
  { code: 'CA_GOV_N',     vectorId: 62305762, unit: 'dollars', pid: 36100104, titleIncludes: 'General governments final consumption' },
  { code: 'CA_GFCF_N',    vectorId: 62305763, unit: 'dollars', pid: 36100104, titleIncludes: 'Gross fixed capital formation' },
  { code: 'CA_EXPORTS_N', vectorId: 62305776, unit: 'dollars', pid: 36100104, titleIncludes: 'Exports of goods and services' },
  { code: 'CA_IMPORTS_N', vectorId: 62305779, unit: 'dollars', pid: 36100104, titleIncludes: 'imports of goods and services' },
  // Published contributions to percent change, annualized
  { code: 'CA_CTB_HHCONS',  vectorId: 79448555, unit: 'percent', pid: 36100104, titleIncludes: 'Household final consumption' },
  { code: 'CA_CTB_GOV',     vectorId: 79448562, unit: 'percent', pid: 36100104, titleIncludes: 'General governments final consumption' },
  { code: 'CA_CTB_GFCF',    vectorId: 79448563, unit: 'percent', pid: 36100104, titleIncludes: 'Gross fixed capital formation' },
  { code: 'CA_CTB_INVENT',  vectorId: 79448572, unit: 'percent', pid: 36100104, titleIncludes: 'Investment in inventories' },
  { code: 'CA_CTB_EXPORTS', vectorId: 79448573, unit: 'percent', pid: 36100104, titleIncludes: 'Exports of goods and services' },
  { code: 'CA_CTB_IMPORTS', vectorId: 79448576, unit: 'percent', pid: 36100104, titleIncludes: 'imports of goods and services' },
  // Published real GDP QoQ % (SAAR basis)
  { code: 'CA_GDP_QOQ', vectorId: 1594571783, unit: 'percent', pid: 36100104, titleIncludes: 'percentage change' },

  // ═══ GDP income-based — table 36-10-0103 (quarterly SAAR, 1961→; decision f verified) ═══
  { code: 'CA_GDI_COMP',        vectorId: 62295549, unit: 'dollars', pid: 36100103, titleIncludes: 'Compensation of employees' },
  { code: 'CA_GDI_GOS',         vectorId: 62295552, unit: 'dollars', pid: 36100103, titleIncludes: 'Gross operating surplus' },
  { code: 'CA_GDI_GMI',         vectorId: 62295556, unit: 'dollars', pid: 36100103, titleIncludes: 'Gross mixed income' },
  { code: 'CA_GDI_TAXPROD',     vectorId: 62295559, unit: 'dollars', pid: 36100103, titleIncludes: 'Taxes less subsidies on production' },
  { code: 'CA_GDI_TAXPRODUCTS', vectorId: 62295560, unit: 'dollars', pid: 36100103, titleIncludes: 'Taxes less subsidies on products' },
  { code: 'CA_GDI_GDP',         vectorId: 62295562, unit: 'dollars', pid: 36100103, titleIncludes: 'Gross domestic product at market prices' },

  // ═══ Household accounts — table 36-10-0112 (quarterly SAAR, 1961→; decision f verified) ═══
  { code: 'CA_HH_COMP',      vectorId: 62305952, unit: 'dollars', pid: 36100112, titleIncludes: 'Compensation of employees' },
  { code: 'CA_HH_DISPINC',   vectorId: 62305981, unit: 'dollars', pid: 36100112, titleIncludes: 'Household disposable income' },
  { code: 'CA_HH_SAVERATE',  vectorId: 62305984, unit: 'percent', pid: 36100112, titleIncludes: 'Household saving rate' },

  // ═══ Monthly GDP by industry — table 36-10-0434 (chained 2017$, 1997→) ═══
  { code: 'CA_MGDP_ALL',    vectorId: 65201210, unit: 'dollars', pid: 36100434, titleIncludes: 'All industries' },
  { code: 'CA_MGDP_GOODS',  vectorId: 65201211, unit: 'dollars', pid: 36100434, titleIncludes: 'Goods-producing industries' },
  { code: 'CA_MGDP_SVCS',   vectorId: 65201212, unit: 'dollars', pid: 36100434, titleIncludes: 'Services-producing industries' },
  { code: 'CA_MGDP_MFG',    vectorId: 65201263, unit: 'dollars', pid: 36100434, titleIncludes: 'Manufacturing' },
  { code: 'CA_MGDP_CONSTR', vectorId: 65201258, unit: 'dollars', pid: 36100434, titleIncludes: 'Construction' },
  { code: 'CA_MGDP_MINING', vectorId: 65201236, unit: 'dollars', pid: 36100434, titleIncludes: 'Mining, quarrying' },
  { code: 'CA_MGDP_RETAIL', vectorId: 65201368, unit: 'dollars', pid: 36100434, titleIncludes: 'Retail trade' },

  // ═══ Retail — table 20-10-0056 (monthly SA, current $, 2017→ per decision e) ═══
  { code: 'CA_RETAIL_SALES', vectorId: 1446859483, unit: 'dollars', pid: 20100056, titleIncludes: 'Total retail sales' },

  // ═══ Real manufacturing sales — table 16-10-0013 (monthly SA, 2017$, 2002→) ═══
  { code: 'CA_MFG_SALES_R', vectorId: 123263908, unit: 'dollars', pid: 16100013, titleIncludes: 'Sales of goods manufactured' },

  // ═══ Merchandise trade — table 12-10-0011 (monthly, BoP basis, SA, 1997→) ═══
  { code: 'CA_TRADE_BAL', vectorId: 87008984, unit: 'dollars', pid: 12100011, titleIncludes: 'Trade Balance' },
  { code: 'CA_TRADE_EXP', vectorId: 87008955, unit: 'dollars', pid: 12100011, titleIncludes: 'Export' },
  { code: 'CA_TRADE_IMP', vectorId: 87008839, unit: 'dollars', pid: 12100011, titleIncludes: 'Import' },

  // ═══ Housing ═══
  { code: 'CA_HOUSING_STARTS',    vectorId: 52300157,   unit: 'thousands', pid: 34100158, titleIncludes: 'Canada' }, // CMHC starts, all areas, SAAR
  { code: 'CA_PERMITS_TOTAL_VAL', vectorId: 1675119645, unit: 'dollars',   pid: 34100292, titleIncludes: 'Total residential and non-residential' },
  { code: 'CA_PERMITS_RES_VAL',   vectorId: 1675119646, unit: 'dollars',   pid: 34100292, titleIncludes: 'Total residential' },
  { code: 'CA_PERMITS_RES_UNITS', vectorId: 1675217265, unit: 'thousands', pid: 34100292, titleIncludes: 'dwelling-units created' },
  { code: 'CA_NHPI',              vectorId: 111955442,  unit: 'index',     pid: 18100205, titleIncludes: 'Total (house and land)' },
  { code: 'CA_NHPI_HOUSE',        vectorId: 111955443,  unit: 'index',     pid: 18100205, titleIncludes: 'House only' },
  { code: 'CA_NHPI_LAND',         vectorId: 111955444,  unit: 'index',     pid: 18100205, titleIncludes: 'Land only' },

  // ═══ Household credit — table 36-10-0639 (monthly SA, 1990→) ═══
  { code: 'CA_HHCRED_TOTAL',   vectorId: 1231415625, unit: 'dollars', pid: 36100639, titleIncludes: 'Total credit liabilities' },
  { code: 'CA_HHCRED_MORT',    vectorId: 1231415620, unit: 'dollars', pid: 36100639, titleIncludes: 'Mortgage loans' },
  { code: 'CA_HHCRED_NONMORT', vectorId: 1231415611, unit: 'dollars', pid: 36100639, titleIncludes: 'Non-mortgage loans' },
  { code: 'CA_HHCRED_CARDS',   vectorId: 1231415614, unit: 'dollars', pid: 36100639, titleIncludes: 'Credit cards' },

  // ═══ Consumer health — tables 11-10-0065 / 38-10-0235 (quarterly, 1990→) ═══
  { code: 'CA_DSR',         vectorId: 1001696813, unit: 'percent', pid: 11100065, titleIncludes: 'Debt service ratio' },
  { code: 'CA_DSR_MORT',    vectorId: 1001696814, unit: 'percent', pid: 11100065, titleIncludes: 'Mortgage debt service ratio' },
  { code: 'CA_DSR_NONMORT', vectorId: 1001696815, unit: 'percent', pid: 11100065, titleIncludes: 'Non-mortgage debt service ratio' },
  { code: 'CA_DEBT_TO_DI',  vectorId: 62698064,   unit: 'percent', pid: 38100235, titleIncludes: 'Credit market debt to disposable income' },
  { code: 'CA_NW_TO_DI',    vectorId: 62698066,   unit: 'percent', pid: 38100235, titleIncludes: 'Net worth as a percentage' },

  // ═══ Fiscal — GFS quarterly 10-10-0015 (1990→) + central gov debt monthly 10-10-0002 (2009-04→) ═══
  { code: 'CA_GFS_FED_REV', vectorId: 52531053, unit: 'dollars', pid: 10100015, titleIncludes: 'Revenue' },
  { code: 'CA_GFS_FED_EXP', vectorId: 52531064, unit: 'dollars', pid: 10100015, titleIncludes: 'Expense' },
  { code: 'CA_GFS_FED_NOB', vectorId: 52531074, unit: 'dollars', pid: 10100015, titleIncludes: 'Net operating balance' },
  { code: 'CA_GFS_FED_NLB', vectorId: 52531076, unit: 'dollars', pid: 10100015, titleIncludes: 'Net lending or borrowing' },
  { code: 'CA_GFS_CONS_NOB', vectorId: 52531017, unit: 'dollars', pid: 10100015, titleIncludes: 'Net operating balance' },
  { code: 'CA_FED_DEBT',    vectorId: 86822802, unit: 'dollars', pid: 10100002, titleIncludes: 'Federal debt' },
  { code: 'CA_FED_MKTDEBT', vectorId: 86822808, unit: 'dollars', pid: 10100002, titleIncludes: 'Market debt payable' },
]

const BY_VECTOR = new Map<number, StatcanSeriesDef>(ALL_STATCAN_SERIES.map(s => [s.vectorId, s]))

// Release-date floor for bulk backfill; matches the rates-side collector's
// empirically-safe value (all historical points carry modern release times).
const BACKFILL_RELEASE_START = '1990-01-01T00:00'
const BATCH = 40           // vectors per WDS request (well under limits)
const THROTTLE_MS = 400    // ~2.5 req/s, far below the 25 req/s/IP cap

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface RawObs { date: string; value: number | null }

function mapDataPoints(points: Array<{ refPer?: string; value?: unknown }>): RawObs[] {
  const out: RawObs[] = []
  for (const p of points) {
    const refPer = p.refPer
    if (!refPer || !/^\d{4}-\d{2}-\d{2}$/.test(refPer)) continue
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

interface WdsSeriesInfo {
  status: string
  object?: { vectorId?: number; productId?: number; SeriesTitleEn?: string | null }
}

interface WdsDataEnvelope {
  status: string
  object: { vectorId: number; vectorDataPoint?: Array<{ refPer?: string; value?: unknown }> }
}

async function post<T>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`${WDS_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`[StatCanWDS] ${method} HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/**
 * Startup health check: re-verify PID + title for every configured vector.
 * StatCan renumbers vectors during table restructurings — a mismatch means the
 * vector no longer measures what the config says, so THROW rather than sync.
 */
export async function verifyStatcanMetadata(): Promise<void> {
  const failures: string[] = []
  for (let i = 0; i < ALL_STATCAN_SERIES.length; i += BATCH) {
    const batch = ALL_STATCAN_SERIES.slice(i, i + BATCH)
    const res = await post<WdsSeriesInfo[]>(
      'getSeriesInfoFromVector',
      batch.map(s => ({ vectorId: s.vectorId })),
    )
    for (const item of res) {
      const vid = item.object?.vectorId
      const def = vid != null ? BY_VECTOR.get(vid) : undefined
      if (!def) continue
      const pid = item.object?.productId
      const title = String(item.object?.SeriesTitleEn ?? '')
      if (item.status !== 'SUCCESS' || pid !== def.pid) {
        failures.push(`${def.code} (v${def.vectorId}): expected PID ${def.pid}, got ${pid ?? 'FAILURE'}`)
      } else if (!title.toLowerCase().includes(def.titleIncludes.toLowerCase().split(';')[0])) {
        failures.push(`${def.code} (v${def.vectorId}): title "${title.slice(0, 80)}" lacks "${def.titleIncludes}"`)
      }
    }
    // Envelopes come back without request order guarantees; detect entirely
    // missing vectors too.
    const returned = new Set(res.map(r => r.object?.vectorId))
    for (const def of batch) {
      if (!returned.has(def.vectorId)) failures.push(`${def.code} (v${def.vectorId}): no envelope returned`)
    }
    await sleep(THROTTLE_MS)
  }
  if (failures.length > 0) {
    throw new Error(`[StatCanWDS] metadata verification FAILED for ${failures.length} vector(s):\n  ${failures.join('\n  ')}`)
  }
  console.log(`[StatCanWDS] metadata verified for ${ALL_STATCAN_SERIES.length} vectors.`)
}

/** Full-history backfill via getBulkVectorDataByRange, batched. */
export async function backfillStatcanSeries(): Promise<void> {
  console.log(`[StatCanWDS] backfill starting (${ALL_STATCAN_SERIES.length} vectors)…`)
  const end = new Date().toISOString().slice(0, 16)
  for (let i = 0; i < ALL_STATCAN_SERIES.length; i += BATCH) {
    const batch = ALL_STATCAN_SERIES.slice(i, i + BATCH)
    let body: WdsDataEnvelope[]
    try {
      body = await post<WdsDataEnvelope[]>('getBulkVectorDataByRange', {
        vectorIds: batch.map(s => String(s.vectorId)),
        startDataPointReleaseDate: BACKFILL_RELEASE_START,
        endDataPointReleaseDate: end,
      })
    } catch (err) {
      console.error(`[StatCanWDS] backfill batch ${i / BATCH + 1} failed:`, err)
      continue
    }
    for (const env of body) {
      const def = BY_VECTOR.get(env.object?.vectorId)
      if (!def) continue
      if (env.status !== 'SUCCESS' || !Array.isArray(env.object.vectorDataPoint)) {
        console.error(`[StatCanWDS] backfill ${def.code} (v${def.vectorId}): status ${env.status}`)
        continue
      }
      const obs = mapDataPoints(env.object.vectorDataPoint)
      const n = storeStatcanObservations(def.code, def.unit, obs)
      const stored = obs.filter(o => o.value != null)
      if (n === 0) {
        console.error(`[StatCanWDS] backfill ${def.code}: ZERO rows stored — investigate`)
      } else {
        console.log(`[StatCanWDS] backfill ${def.code} (v${def.vectorId}): ${n} rows (${stored[0]?.date ?? '—'} → ${stored[stored.length - 1]?.date ?? '—'})`)
      }
    }
    await sleep(THROTTLE_MS)
  }
  console.log('[StatCanWDS] backfill done.')
}

/**
 * Incremental sync (startup + cron): latest 6 periods per vector; falls back
 * to full backfill when the table has no rows for any configured code.
 */
export async function syncAllStatcanSeries(): Promise<void> {
  const anyData = ALL_STATCAN_SERIES.some(s => getStatcanLatestDate(s.code) != null)
  if (!anyData) {
    await backfillStatcanSeries()
    return
  }
  let upserts = 0
  for (let i = 0; i < ALL_STATCAN_SERIES.length; i += BATCH) {
    const batch = ALL_STATCAN_SERIES.slice(i, i + BATCH)
    let body: WdsDataEnvelope[]
    try {
      body = await post<WdsDataEnvelope[]>(
        'getDataFromVectorsAndLatestNPeriods',
        batch.map(s => ({ vectorId: s.vectorId, latestN: 6 })),
      )
    } catch (err) {
      console.error(`[StatCanWDS] sync batch ${i / BATCH + 1} failed:`, err)
      continue
    }
    for (const env of body) {
      const def = BY_VECTOR.get(env.object?.vectorId)
      if (!def) continue
      if (env.status !== 'SUCCESS' || !Array.isArray(env.object.vectorDataPoint)) {
        console.error(`[StatCanWDS] sync ${def.code} (v${def.vectorId}): status ${env.status}`)
        continue
      }
      upserts += storeStatcanObservations(def.code, def.unit, mapDataPoints(env.object.vectorDataPoint))
    }
    await sleep(THROTTLE_MS)
  }
  console.log(`[StatCanWDS] incremental sync done (${upserts} rows upserted).`)
}
