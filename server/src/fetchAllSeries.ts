import dotenv from 'dotenv'
import path from 'path'
import { storeObservations, getSeriesLastFetched } from './db'

// Load .env when run as a standalone script (index.ts loads it first when used as a module)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

// ── Series list ───────────────────────────────────────────────────────────────

export const ALL_SERIES: string[] = [
  // Main dashboard
  'USALOLITONOSTSAM', 'PCEPILFE', 'CPILFESL', 'UNRATE', 'PAYEMS', 'TOTLL', 'DTWEXBGS',
  'FEDFUNDS', 'BAMLH0A0HYM2', 'M2SL', 'MZMSL', 'RPI', 'DPCERA3M086SBEA', 'RSXFS',
  'INDPRO', 'DGORDER', 'CES0500000003', 'GDP', 'GDPC1',
  // CPS / unemployment detail
  'CE16OV', 'CLF16OV', 'UNEMPLOY',
  'U1RATE', 'U2RATE', 'U4RATE', 'U5RATE', 'U6RATE',
  'LNS14024887', 'LNS14000060', 'LNU04000095',
  'LNS13026638', 'LNS13023557', 'LNS13023569', 'LNS13023705', 'LNS13026637', 'LNS13023653',
  'EMRATIO', 'LNS12300060', 'CIVPART', 'LNS11300060',
  // Claims
  'ICNSA', 'ICSA', 'CCNSA', 'CCSA',
  // CES payroll sectors
  'USMINE', 'USCONS', 'MANEMP', 'USWTRADE', 'USTRADE',
  'CES4300000001', 'CES4422000001', 'USINFO', 'USFIRE',
  'USPBS', 'USEHS', 'USLAH', 'USSERV', 'USGOVT',
  'CES9091000001', 'CES9092000001', 'CES9093000001',
  'USPRIV', 'USGOOD', 'CES0800000001',
  'SRVPRD', 'USTPU', 'USTRANSUTIL', 'USUTIL',
  // CES AHE (Average Hourly Earnings) series
  'CES0500000003', 'CES0600000003', 'CES0800000003',
  'CES1000000003', 'CES2000000003', 'CES3000000003',
  'CES4000000003', 'CES4142000003', 'CES4200000003', 'CES4300000003', 'CES4422000003',
  'CES5000000003', 'CES5500000003', 'CES6000000003', 'CES6500000003', 'CES7000000003', 'CES8000000003',
  // CES AWH (Average Weekly Hours) series
  'AWHAETP', 'AWHAEGP', 'AWHAEPSP',
  'AWHAEMAL', 'AWHAECON', 'AWHAEMAN',
  'AWHAETTU', 'AWHAEWT', 'AWHAERT', 'AWHAETAW', 'AWHAEUTIL',
  'AWHAEINFO', 'AWHAEFA', 'AWHAEPBS', 'AWHAEEHS', 'AWHAELAH', 'AWHAEOS',
  // JOLTS
  'JTSJOL', 'JTSHIL', 'JTSQUL', 'JTSLDL', 'JTSOSL', 'JTSTSL',
  // Productivity & Unit Labor Costs
  'OPHNFB', 'ULCNFB',
  // CPI Dashboard — Inflation Model (104 series)
  'CPIAUCSL', 'CPIFABSL', 'CPIUFDSL', 'CUSR0000SAF11', 'CUSR0000SAF111',
  'CUSR0000SAF112', 'CUSR0000SEFJ', 'CUSR0000SAF113', 'CUSR0000SAF114',
  'CUSR0000SEFP01', 'CUSR0000SAF115', 'CUSR0000SEFR', 'CUSR0000SEFS',
  'CUSR0000SEFT', 'CUSR0000SEFV', 'CUSR0000SEFV05', 'CUSR0000SAF116',
  'CUSR0000SEFW', 'CUSR0000SEFX', 'CPIHOSSL', 'CUSR0000SAH1', 'CUSR0000SEHA',
  'CUSR0000SEHB', 'CUSR0000SEHC', 'CUSR0000SEHC01', 'CUSR0000SAH2',
  'CUSR0000SAH21', 'CUSR0000SEHE', 'CUSR0000SEHF', 'CUSR0000SEHF01',
  'CUSR0000SEHF02', 'CUSR0000SEHG', 'CUSR0000SAH3', 'CPIAPPSL', 'CUSR0000SAA1',
  'CUSR0000SAA2', 'CUSR0000SEAE', 'CUSR0000SEAF', 'CPITRNSL', 'CUSR0000SAT1',
  'CUSR0000SETA', 'CUSR0000SETA01', 'CUSR0000SETA02', 'CUSR0000SETB',
  'CUSR0000SETB01', 'CUSR0000SETC', 'CUSR0000SETD', 'CUSR0000SETG',
  'CUSR0000SETG01', 'CPIMEDSL', 'CUSR0000SAM1', 'CUSR0000SAM2', 'CUSR0000SEMC',
  'CUSR0000SEMC04', 'CUSR0000SEMD', 'CPIRECSL', 'CUSR0000SERA', 'CUSR0000SERA02',
  'CUSR0000SS61031', 'CUSR0000SERE01', 'CUSR0000SERE03', 'CUSR0000SERF01',
  'CUSR0000SS62031', 'CUSR0000SERF03', 'CPIEDUSL', 'CUSR0000SAE1', 'CUSR0000SEEA',
  'CUSR0000SEEB', 'CUSR0000SAE2', 'CUSR0000SAE21', 'CUSR0000SEEE',
  'CUSR0000SEEE01', 'CPIOGSSL', 'CUSR0000SEGA', 'CUSR0000SAG1', 'CUSR0000SEGD',
  'CUSR0000SEGD03', 'CUUS0000SEHE02', 'CUSR0000SA0L5', 'CPILEGSL', 'CPIULFSL',
  'CUSR0000SA0L2', 'CUSR0000SA311', 'CUSR0000SAC', 'CUSR0000SACL1',
  'CUSR0000SACL11', 'CUSR0000SACL1E', 'CPIENGSL', 'CUSR0000SACE', 'CUSR0000SAD',
  'CUSR0000SAN', 'CUSR0000SANL1', 'CUSR0000SANL13', 'CUSR0000SANL11',
  'CUSR0000SANL113', 'CUSR0000SAS367', 'CUSR0000SAS2RS', 'CUSR0000SAS',
  'CUSR0000SASLE', 'CUSR0000SASL5', 'CUSR0000SASL2RS', 'CUSR0000SAS4',
  'CUSR0000SERAC',
  // PPI Dashboard — Inflation Model (SA series from BLS Table 7)
  'PPIFIS', 'PPIFES', 'WPSFD49116',
  'PPIDSS', 'PPIDFS', 'PPIDES',
  'PPIDGS', 'WPSFD413',
  'PPIAWS', 'PPITWS',
  'PPIDCS',
  'WPSFD4131', 'WPSFD49207',
  'WPSFD49201', 'WPSFD49215',
  'WPSFD4111', 'WPSFD431',
  'WPSFD4121',
  // Other Inflation — alternative inflation measures
  'MICH',                    // University of Michigan Inflation Expectations
  'PCETRIM12M159SFRBDAL',   // Trimmed Mean PCE Inflation Rate (Dallas Fed)
  'CP0000USM086NEST',       // Harmonized CPI for US (OECD)
  'CORESTICKM159SFRBATL',   // Sticky Price CPI Less Food and Energy (Atlanta Fed)
  'PCEPI',                   // PCE Price Index (headline)
  // Growth Model — GDP, Income, Investment, Trade (238 series)
  // GDP components (nominal)
  'PCEC', 'DGDSRC1Q027SBEA', 'PCDG', 'DMOTRC1Q027SBEA', 'DFDHRC1Q027SBEA',
  'DREQRC1Q027SBEA', 'DODGRC1Q027SBEA', 'PCND', 'DFXARC1Q027SBEA', 'DCLORC1Q027SBEA',
  'DGOERC1Q027SBEA', 'DONGRC1Q027SBEA', 'PCESV', 'DHCERC1Q027SBEA', 'DHUTRC1Q027SBEA',
  'DHLCRC1Q027SBEA', 'DTRSRC1Q027SBEA', 'DRCARC1Q027SBEA', 'DFSARC1Q027SBEA',
  'DIFSRC1Q027SBEA', 'DOTSRC1Q027SBEA',
  // Gross private domestic investment (nominal)
  'GPDI', 'FPI', 'PNFI', 'B009RC1Q027SBEA', 'Y033RC1Q027SBEA', 'Y034RC1Q027SBEA',
  'A680RC1Q027SBEA', 'A681RC1Q027SBEA', 'A862RC1Q027SBEA', 'Y001RC1Q027SBEA',
  'B985RC1Q027SBEA', 'Y006RC1Q027SBEA', 'Y020RC1Q027SBEA', 'PRFI', 'CBI',
  // Net exports (nominal)
  'NETEXP', 'EXPGS', 'A253RC1Q027SBEA', 'A646RC1Q027SBEA',
  'IMPGS', 'A255RC1Q027SBEA', 'B656RC1Q027SBEA',
  // Government (nominal)
  'GCE', 'FGCE', 'FDEFX', 'FNDEFX', 'SLCE',
  // GDP components (real / chained 2017$)
  'PCECC96', 'DGDSRX1Q020SBEA', 'PCDGCC96', 'DMOTRX1Q020SBEA', 'DFDHRX1Q020SBEA',
  'DREQRX1Q020SBEA', 'DODGRX1Q020SBEA', 'PCNDGC96', 'DFXARX1Q020SBEA', 'DCLORX1Q020SBEA',
  'DGOERX1Q020SBEA', 'DONGRX1Q020SBEA', 'PCESVC96', 'DHCERX1Q020SBEA', 'DHUTRX1Q020SBEA',
  'DHLCRX1Q020SBEA', 'DTRSRX1Q020SBEA', 'DRCARX1Q020SBEA', 'DFSARX1Q020SBEA',
  'DIFSRX1Q020SBEA', 'DOTSRX1Q020SBEA',
  // Investment (real)
  'GPDIC1', 'FPIC1', 'PNFIC1', 'B009RX1Q020SBEA', 'Y033RX1Q020SBEA', 'Y034RX1Q020SBEA',
  'A680RX1Q020SBEA', 'A681RX1Q020SBEA', 'A862RX1Q020SBEA', 'Y001RX1Q020SBEA',
  'B985RX1Q020SBEA', 'Y006RX1Q020SBEA', 'Y020RX1Q020SBEA', 'PRFIC1', 'CBIC1',
  // Net exports (real)
  'NETEXC', 'EXPGSC1', 'A253RX1Q020SBEA', 'A646RX1Q020SBEA',
  'IMPGSC1', 'A255RX1Q020SBEA', 'B656RX1Q020SBEA',
  // Government (real)
  'GCEC1', 'FGCEC1', 'A824RX1Q020SBEA', 'A825RX1Q020SBEA', 'SLCEC1',
  // Personal income
  'PI', 'W209RC1', 'A576RC1', 'A132RC1', 'N231RC1M027SBEA', 'N552RC1M027SBEA',
  'N233RC1M027SBEA', 'N234RC1M027SBEA', 'N235RC1M027SBEA', 'B202RC1', 'A038RC1',
  'B040RC1M027SBEA', 'B039RC1M027SBEA', 'A041RC1', 'B042RC1', 'A045RC1', 'A048RC1',
  'PIROA', 'PII', 'PDI', 'PCTR',
  // Government transfers & contributions
  'A063RC1', 'W823RC1', 'W824RC1', 'W729RC1', 'W825RC1', 'W826RC1', 'W827RC1',
  'B931RC1', 'A061RC1', 'W055RC1',
  // Disposable income, saving
  'DSPI', 'A068RC1', 'PCE', 'B069RC1', 'W211RC1', 'W062RC1M027SBEA', 'B070RC1M027SBEA',
  'PMSAVE', 'PSAVERT', 'W875RX1', 'DSPIC96',
  // Retail & consumer
  'GASREGW', 'RSAFS', 'RSFSXMV', 'MRTSSM44W72USS', 'RSMVPD', 'RSAOMV',
  'MRTSSM4413USS', 'RSFHFS', 'RSEAS', 'RSBMGESD', 'RSDBS', 'RSHPCS', 'RSGASS',
  'RSCCAS', 'RSSGHBMS', 'RSGMS', 'RSMSR', 'RSNSR', 'RSFSDP',
  // Household balance sheet & debt
  'TNWBSHNO', 'CMDEBT', 'HHMSDODNS', 'HCCSDODNS', 'TBSDODNS', 'BCNSDODNS',
  'FGSDODNS', 'SLGSDODNS', 'MMMFFAQ027S', 'WRBWFRBL',
  // Bank credit
  'ODSACBW027SBOG', 'TOTCI', 'RREACBW027SBOG', 'CREACBW027SBOG',
  'CLSACBW027SBOG', 'AOLACBW027SBOG', 'BOGMBASE',
  // Delinquency & credit conditions
  'DODFS', 'DRCCLACBS', 'DRCLACBS', 'DRSFRMACBS', 'DRBLACBS', 'DRCRELEXFACBS',
  'DRCCLT100S', 'DRCCLOBS', 'RCCCBBALTOT', 'BOGZ1FL192090005Q',
  // Debt service
  'TDSP', 'MDSP', 'CDSP',
  // Gross domestic income
  'GDI', 'GDICOMP', 'A4102C1Q027SBEA', 'W270RC1Q027SBEA', 'B4189C1Q027SBEA',
  'A038RC1Q027SBEA', 'GDITAXES', 'GDISUBS', 'GDINOS', 'W260RC1Q027SBEA',
  'W272RC1Q027SBEA', 'B029RC1Q027SBEA', 'PROPINC', 'RENTIN',
  'A445RC1Q027SBEA', 'A054RC1Q027SBEA', 'W273RC1Q027SBEA', 'A449RC1Q027SBEA',
  'W274RC1Q027SBEA', 'A108RC1Q027SBEA', 'COFC', 'A024RC1Q027SBEA',
  'A264RC1Q027SBEA', 'A261RX1Q020SBEA',
  // Balance of payments / trade
  'BOPGSTB', 'BOPGTB', 'BOPSTB',
  'BOPTEXP', 'BOPGEXP', 'BOPSEXP',
  'ITXMARM133S', 'ITXTRAM133S', 'ITXTAEM133S', 'ITXINSM133S', 'ITXFISM133S',
  'ITXCIPM133S', 'ITXTCIM133S', 'ITXOBSM133S', 'ITXGGSM133S',
  'BOPTIMP', 'BOPGIMP', 'BOPSIMP',
  'ITMMARM133S', 'ITMTRAM133S', 'ITMTAEM133S', 'ITMINSM133S', 'ITMFISM133S',
  'ITMCIPM133S', 'ITMTCIM133S', 'ITMOBSM133S', 'ITMGGSM133S',
  // UMich consumer sentiment
  'UMCSENT',
  // ─── H.8 Bank Credit — All Commercial Banks (SA) ───
  'TOTBKCR', 'TOTLL', 'TOTCI',
  'RELACBW027SBOG', 'RREACBW027SBOG', 'RHEACBW027SBOG', 'CRLACBW027SBOG',
  'CREACBW027SBOG', 'CLDACBW027SBOG', 'SBFACBW027SBOG', 'SMPACBW027SBOG', 'SNFACBW027SBOG',
  'CLSACBW027SBOG', 'CCLACBW027SBOG', 'OCLACBW027SBOG', 'CARACBW027SBOG', 'AOCACBW027SBOG',
  'AOLACBW027SBOG', 'LNFACBW027SBOG', 'OLNACBW027SBOG', 'ALLACBW027SBOG',
]

export const STALE_HOURS = 20

// ── Internals ─────────────────────────────────────────────────────────────────

const FRED_BASE     = 'https://api.stlouisfed.org/fred/series/observations'
const FETCH_DELAY   = 150  // ms between requests to stay under FRED rate limits

interface FredResponse {
  observations?: { date: string; value: string }[]
  error_message?: string
}

export function getApiKey(): string {
  const key = process.env.FRED_API_KEY
  if (!key || key === 'your_fred_api_key_here' || key === 'your_32_character_key_here') {
    throw new Error('FRED_API_KEY is not configured in .env')
  }
  return key
}

function nowSqlite(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function isStale(lastFetched: string | null): boolean {
  if (!lastFetched) return true
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  return lastFetched < cutoff
}

export async function fetchOneSeries(seriesId: string, apiKey: string): Promise<number> {
  const params = new URLSearchParams({
    series_id:         seriesId,
    api_key:           apiKey,
    file_type:         'json',
    observation_start: '1900-01-01',
  })

  const res  = await fetch(`${FRED_BASE}?${params}`)
  const body = await res.json() as FredResponse

  if (!res.ok) {
    throw new Error(`FRED ${res.status}: ${body.error_message ?? 'unknown error'}`)
  }
  if (!body.observations) {
    throw new Error(`No observations field in FRED response`)
  }

  storeObservations(seriesId, body.observations)
  return body.observations.length
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ProgressStatus = 'ok' | 'skip' | 'error'

export interface FetchProgress {
  done:     number
  total:    number
  seriesId: string
  status:   ProgressStatus
}

export async function fetchAllSeries(opts: {
  force?:      boolean
  seriesList?: string[]
  onProgress?: (p: FetchProgress) => void
} = {}): Promise<void> {
  const apiKey = getApiKey()
  const list   = opts.seriesList ?? ALL_SERIES
  const total  = list.length
  let fetched  = 0, skipped = 0, errors = 0
  let done     = 0

  console.log(
    `[fetch] Starting — ${total} series${opts.force ? ' (forced)' : ''}  ${nowSqlite()}`
  )

  for (const seriesId of list) {
    done++

    if (!opts.force && !isStale(getSeriesLastFetched(seriesId))) {
      skipped++
      console.log(`[fetch] SKIP  [${done}/${total}] ${seriesId}`)
      opts.onProgress?.({ done, total, seriesId, status: 'skip' })
      continue
    }

    try {
      const count = await fetchOneSeries(seriesId, apiKey)
      fetched++
      console.log(`[fetch] OK    [${done}/${total}] ${seriesId} — ${count} obs`)
      opts.onProgress?.({ done, total, seriesId, status: 'ok' })
    } catch (err) {
      errors++
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[fetch] ERR   [${done}/${total}] ${seriesId}: ${msg}`)
      opts.onProgress?.({ done, total, seriesId, status: 'error' })
    }

    if (done < total) {
      await new Promise<void>(r => setTimeout(r, FETCH_DELAY))
    }
  }

  console.log(
    `[fetch] Done — fetched=${fetched} skipped=${skipped} errors=${errors}  ${nowSqlite()}`
  )
}

// ── Standalone script ─────────────────────────────────────────────────────────

if (require.main === module) {
  const force = process.argv.includes('--force')
  console.log(`Running standalone fetch (force=${force})`)
  fetchAllSeries({ force })
    .then(() => { console.log('Complete.'); process.exit(0) })
    .catch(err => { console.error('Failed:', err); process.exit(1) })
}
