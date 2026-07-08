import Database from 'better-sqlite3'
import path from 'path'
import type { EconomicRelease, CategorizedRelease, StoredEconomicRelease, SurpriseLabel, SurpriseRule } from './economicCalendar/types'

// DB lives at the project root (two levels up from server/src/)
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'fred_data.db')

export const db = new Database(DB_PATH)

// WAL mode for safe concurrent reads while background writes happen
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS series_observations (
    series_id    TEXT     NOT NULL,
    date         TEXT     NOT NULL,
    value        REAL     NOT NULL,
    last_updated DATETIME NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (series_id, date)
  );

  CREATE TABLE IF NOT EXISTS series_metadata (
    series_id    TEXT PRIMARY KEY,
    title        TEXT,
    frequency    TEXT,
    units        TEXT,
    last_fetched DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_obs_series_date
    ON series_observations (series_id, date);

  CREATE TABLE IF NOT EXISTS news_articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guid         TEXT UNIQUE,
    source       TEXT,
    title        TEXT,
    description  TEXT,
    url          TEXT,
    published_at TEXT,
    fetched_at   TEXT,
    topics       TEXT,
    signals      TEXT,
    tag          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_news_published
    ON news_articles (published_at DESC);

  CREATE TABLE IF NOT EXISTS news_topics (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE,
    keywords TEXT
  );

  CREATE TABLE IF NOT EXISTS known_series (
    series_id  TEXT PRIMARY KEY,
    first_seen DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS negative_cache (
    series_id  TEXT PRIMARY KEY,
    error_msg  TEXT,
    cached_at  DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS treasury_auctions (
    cusip                   TEXT NOT NULL,
    auction_date            TEXT NOT NULL,
    security_type           TEXT NOT NULL,
    security_term           TEXT NOT NULL,
    issue_date              TEXT,
    maturity_date           TEXT,
    bid_to_cover            REAL,
    high_yield              REAL,
    interest_rate           REAL,
    total_accepted          REAL,
    total_tendered          REAL,
    competitive_accepted    REAL,
    competitive_tendered    REAL,
    direct_bidder_accepted  REAL,
    direct_bidder_tendered  REAL,
    indirect_bidder_accepted  REAL,
    indirect_bidder_tendered  REAL,
    allocation_pct          REAL,
    offering_amount         REAL,
    reopening               TEXT,
    fetched_at              TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (cusip, auction_date)
  );

  CREATE INDEX IF NOT EXISTS idx_tsy_auction_date  ON treasury_auctions(auction_date);
  CREATE INDEX IF NOT EXISTS idx_tsy_security_term ON treasury_auctions(security_term);
  CREATE INDEX IF NOT EXISTS idx_tsy_security_type ON treasury_auctions(security_type);

  CREATE TABLE IF NOT EXISTS gdpnow_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quarter TEXT NOT NULL,
    forecast_date TEXT NOT NULL,
    value REAL NOT NULL,
    UNIQUE(quarter, forecast_date)
  );

  CREATE INDEX IF NOT EXISTS idx_gdpnow_quarter ON gdpnow_forecasts(quarter);
  CREATE INDEX IF NOT EXISTS idx_gdpnow_date ON gdpnow_forecasts(forecast_date);

  CREATE TABLE IF NOT EXISTS gdpnow_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forecast_date TEXT NOT NULL,
    gdp REAL,
    pce REAL,
    equipment REAL,
    intell_prop REAL,
    nonres_struct REAL,
    resid_invest REAL,
    govt REAL,
    net_exports REAL,
    UNIQUE(forecast_date)
  );

  CREATE INDEX IF NOT EXISTS idx_gdpnow_contrib_date ON gdpnow_contributions(forecast_date);
`)

// Migration: add reopening column if table existed before this field was added
try {
  db.exec(`ALTER TABLE treasury_auctions ADD COLUMN reopening TEXT`)
} catch {
  // Column already exists — ignore
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ObsRow { date: string; value: number }

// ── Query helpers ─────────────────────────────────────────────────────────────

export function getObservations(
  seriesId: string,
  opts: { observationStart?: string; observationEnd?: string } = {}
): ObsRow[] {
  const params: (string | number)[] = [seriesId]
  let sql = 'SELECT date, value FROM series_observations WHERE series_id = ?'
  if (opts.observationStart) { sql += ' AND date >= ?'; params.push(opts.observationStart) }
  if (opts.observationEnd)   { sql += ' AND date <= ?'; params.push(opts.observationEnd)   }
  sql += ' ORDER BY date ASC'
  return db.prepare(sql).all(...params) as ObsRow[]
}

export function storeObservations(
  seriesId:     string,
  observations: { date: string; value: string | number }[],
  meta?:        { title?: string; frequency?: string; units?: string }
): void {
  const insertObs = db.prepare(
    `INSERT OR REPLACE INTO series_observations (series_id, date, value, last_updated)
     VALUES (?, ?, ?, datetime('now'))`
  )
  const insertMeta = db.prepare(
    `INSERT OR REPLACE INTO series_metadata (series_id, title, frequency, units, last_fetched)
     VALUES (?, ?, ?, ?, datetime('now'))`
  )

  db.transaction(() => {
    for (const obs of observations) {
      const v = typeof obs.value === 'string' ? parseFloat(obs.value) : obs.value
      if (!isNaN(v)) insertObs.run(seriesId, obs.date, v)
    }
    insertMeta.run(seriesId, meta?.title ?? null, meta?.frequency ?? null, meta?.units ?? null)
  })()
}

export function getSeriesLastFetched(seriesId: string): string | null {
  const row = db.prepare(
    'SELECT last_fetched FROM series_metadata WHERE series_id = ?'
  ).get(seriesId) as { last_fetched: string | null } | undefined
  return row?.last_fetched ?? null
}

export function isDatabaseEmpty(): boolean {
  const row = db.prepare('SELECT COUNT(*) as n FROM series_metadata').get() as { n: number }
  return row.n === 0
}

export function getDbStatus(): { lastUpdated: string | null; seriesCount: number } {
  const row = db.prepare(
    `SELECT MAX(last_fetched) as lastUpdated, COUNT(*) as seriesCount
     FROM series_metadata WHERE last_fetched IS NOT NULL`
  ).get() as { lastUpdated: string | null; seriesCount: number }
  return row
}

export interface GDPNowForecastRow {
  quarter: string
  forecast_date: string
  value: number
}

export function getGDPNowForecasts(): GDPNowForecastRow[] {
  return db.prepare(`
    SELECT quarter, forecast_date, value
    FROM gdpnow_forecasts
    ORDER BY quarter ASC, forecast_date ASC
  `).all() as GDPNowForecastRow[]
}

export function getGDPNowLatestDate(): string | null {
  const row = db.prepare(
    'SELECT MAX(forecast_date) AS latest FROM gdpnow_forecasts'
  ).get() as { latest: string | null } | undefined
  return row?.latest ?? null
}

export interface GDPNowContributionRow {
  forecast_date: string
  gdp: number | null
  pce: number | null
  equipment: number | null
  intell_prop: number | null
  nonres_struct: number | null
  resid_invest: number | null
  govt: number | null
  net_exports: number | null
}

export function getGDPNowContributions(): GDPNowContributionRow[] {
  return db.prepare(`
    SELECT forecast_date, gdp, pce, equipment, intell_prop, nonres_struct, resid_invest, govt, net_exports
    FROM gdpnow_contributions
    ORDER BY forecast_date ASC
  `).all() as GDPNowContributionRow[]
}

export function upsertGDPNowForecast(quarter: string, forecastDate: string, value: number): void {
  db.prepare(`
    INSERT INTO gdpnow_forecasts (quarter, forecast_date, value)
    VALUES (?, ?, ?)
    ON CONFLICT(quarter, forecast_date) DO UPDATE SET value = excluded.value
  `).run(quarter, forecastDate, value)
}

// Returns series from knownSeries that are stale (missing or older than maxAgeHours)
export function getStaleSeries(maxAgeHours: number, knownSeries: string[]): string[] {
  if (!knownSeries.length) return []
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const fresh = new Set(
    (db.prepare(
      'SELECT series_id FROM series_metadata WHERE last_fetched IS NOT NULL AND last_fetched >= ?'
    ).all(cutoff) as { series_id: string }[]).map(r => r.series_id)
  )
  return knownSeries.filter(id => !fresh.has(id))
}

// ── Known series tracking ────────────────────────────────────────────────────

export function registerKnownSeries(seriesId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO known_series (series_id) VALUES (?)`
  ).run(seriesId)
}

export function getAllKnownSeriesIds(): string[] {
  return (db.prepare('SELECT series_id FROM known_series').all() as { series_id: string }[])
    .map(r => r.series_id)
}

// ── Negative cache (invalid FRED IDs) ────────────────────────────────────────

const NEG_CACHE_HOURS = 1

export function getNegativeCacheEntry(seriesId: string): string | null {
  const cutoff = new Date(Date.now() - NEG_CACHE_HOURS * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const row = db.prepare(
    'SELECT error_msg FROM negative_cache WHERE series_id = ? AND cached_at >= ?'
  ).get(seriesId, cutoff) as { error_msg: string } | undefined
  return row?.error_msg ?? null
}

export function setNegativeCacheEntry(seriesId: string, errorMsg: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO negative_cache (series_id, error_msg, cached_at)
     VALUES (?, ?, datetime('now'))`
  ).run(seriesId, errorMsg)
}

export function isSeriesStale(seriesId: string, maxAgeHours: number): boolean {
  const lastFetched = getSeriesLastFetched(seriesId)
  if (!lastFetched) return true
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  return lastFetched < cutoff
}

// ── Treasury Auction helpers ────────────────────────────────────────────────

export interface ParsedAuction {
  cusip: string
  auctionDate: string
  securityType: string
  securityTerm: string
  issueDate: string | null
  maturityDate: string | null
  bidToCover: number | null
  highYield: number | null
  interestRate: number | null
  totalAccepted: number | null
  totalTendered: number | null
  competitiveAccepted: number | null
  competitiveTendered: number | null
  directBidderAccepted: number | null
  directBidderTendered: number | null
  indirectBidderAccepted: number | null
  indirectBidderTendered: number | null
  allocationPct: number | null
  offeringAmount: number | null
  reopening: string | null
}

const upsertAuctionStmt = db.prepare(`
  INSERT OR REPLACE INTO treasury_auctions (
    cusip, auction_date, security_type, security_term,
    issue_date, maturity_date,
    bid_to_cover, high_yield, interest_rate,
    total_accepted, total_tendered,
    competitive_accepted, competitive_tendered,
    direct_bidder_accepted, direct_bidder_tendered,
    indirect_bidder_accepted, indirect_bidder_tendered,
    allocation_pct, offering_amount, reopening, fetched_at
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?, ?, datetime('now')
  )
`)

export function upsertAuction(a: ParsedAuction): void {
  upsertAuctionStmt.run(
    a.cusip, a.auctionDate, a.securityType, a.securityTerm,
    a.issueDate, a.maturityDate,
    a.bidToCover, a.highYield, a.interestRate,
    a.totalAccepted, a.totalTendered,
    a.competitiveAccepted, a.competitiveTendered,
    a.directBidderAccepted, a.directBidderTendered,
    a.indirectBidderAccepted, a.indirectBidderTendered,
    a.allocationPct, a.offeringAmount, a.reopening,
  )
}

export function upsertAuctionsBatch(rows: ParsedAuction[]): void {
  db.transaction(() => {
    for (const a of rows) upsertAuction(a)
  })()
}

// Maturity-based ranges (years) for standard tenors — includes reopenings
const AUCTION_TERM_RANGES: Record<string, [number, number]> = {
  '2-Year':  [1.5, 2.75],
  '3-Year':  [2.75, 4],
  '5-Year':  [4, 6],
  '7-Year':  [6, 8.5],
  '10-Year': [8.5, 11.5],
  '20-Year': [17, 23],
  '30-Year': [27, 33],
}

export function getAuctions(opts: {
  securityTerm?: string
  securityType?: string
  startDate?: string
  endDate?: string
}): ParsedAuction[] {
  const params: (string | number)[] = []
  const clauses: string[] = []

  if (opts.securityTerm) {
    const range = AUCTION_TERM_RANGES[opts.securityTerm]
    if (range) {
      clauses.push('maturity_date IS NOT NULL AND (julianday(maturity_date) - julianday(auction_date)) / 365.25 BETWEEN ? AND ?')
      params.push(range[0], range[1])
    } else {
      clauses.push('security_term LIKE ?')
      params.push(`%${opts.securityTerm}%`)
    }
  }
  if (opts.securityType) {
    clauses.push('security_type = ?')
    params.push(opts.securityType)
  }
  if (opts.startDate) {
    clauses.push('auction_date >= ?')
    params.push(opts.startDate)
  }
  if (opts.endDate) {
    clauses.push('auction_date <= ?')
    params.push(opts.endDate)
  }

  let sql = `SELECT
    cusip, auction_date AS auctionDate, security_type AS securityType,
    security_term AS securityTerm, issue_date AS issueDate, maturity_date AS maturityDate,
    bid_to_cover AS bidToCover, high_yield AS highYield, interest_rate AS interestRate,
    total_accepted AS totalAccepted, total_tendered AS totalTendered,
    competitive_accepted AS competitiveAccepted, competitive_tendered AS competitiveTendered,
    direct_bidder_accepted AS directBidderAccepted, direct_bidder_tendered AS directBidderTendered,
    indirect_bidder_accepted AS indirectBidderAccepted, indirect_bidder_tendered AS indirectBidderTendered,
    allocation_pct AS allocationPct, offering_amount AS offeringAmount,
    reopening
    FROM treasury_auctions`

  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ')
  sql += ' ORDER BY auction_date ASC'

  return db.prepare(sql).all(...params) as ParsedAuction[]
}

export function getAuctionDbStatus(): { count: number; lastAuctionDate: string | null; lastFetchedAt: string | null } {
  const row = db.prepare(`
    SELECT COUNT(*) AS count,
           MAX(auction_date) AS lastAuctionDate,
           MAX(fetched_at) AS lastFetchedAt
    FROM treasury_auctions
  `).get() as { count: number; lastAuctionDate: string | null; lastFetchedAt: string | null }
  return row
}

export function isTreasuryTableEmpty(): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM treasury_auctions').get() as { n: number }
  return row.n === 0
}

// ── Investor Class Auction Allotment helpers ────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS treasury_investor_class (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    cusip                     TEXT NOT NULL,
    issue_date                TEXT NOT NULL,
    security_type             TEXT NOT NULL,
    coupon_rate               REAL,
    maturity_date             TEXT,
    total_issue_amount        REAL,
    federal_reserve           REAL,
    depository_institutions   REAL,
    individuals               REAL,
    dealers_and_brokers       REAL,
    pension_and_retirement    REAL,
    investment_funds          REAL,
    foreign_and_international REAL,
    other                     REAL,
    source_file               TEXT,
    UNIQUE(cusip, issue_date)
  );

  CREATE INDEX IF NOT EXISTS idx_ic_issue_date    ON treasury_investor_class(issue_date);
  CREATE INDEX IF NOT EXISTS idx_ic_security_type ON treasury_investor_class(security_type);
  CREATE INDEX IF NOT EXISTS idx_ic_cusip         ON treasury_investor_class(cusip);
`)

export interface InvestorClassRow {
  cusip: string
  issueDate: string
  securityType: string
  couponRate: number | null
  maturityDate: string | null
  totalIssueAmount: number | null
  federalReserve: number | null
  depositoryInstitutions: number | null
  individuals: number | null
  dealersAndBrokers: number | null
  pensionAndRetirement: number | null
  investmentFunds: number | null
  foreignAndInternational: number | null
  other: number | null
  sourceFile: string | null
}

const upsertICStmt = db.prepare(`
  INSERT INTO treasury_investor_class (
    cusip, issue_date, security_type, coupon_rate, maturity_date,
    total_issue_amount, federal_reserve, depository_institutions,
    individuals, dealers_and_brokers, pension_and_retirement,
    investment_funds, foreign_and_international, other, source_file
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cusip, issue_date) DO UPDATE SET
    security_type = excluded.security_type,
    coupon_rate = excluded.coupon_rate,
    maturity_date = excluded.maturity_date,
    total_issue_amount = excluded.total_issue_amount,
    federal_reserve = excluded.federal_reserve,
    depository_institutions = excluded.depository_institutions,
    individuals = excluded.individuals,
    dealers_and_brokers = excluded.dealers_and_brokers,
    pension_and_retirement = excluded.pension_and_retirement,
    investment_funds = excluded.investment_funds,
    foreign_and_international = excluded.foreign_and_international,
    other = excluded.other,
    source_file = excluded.source_file
`)

export function upsertInvestorClass(r: InvestorClassRow): void {
  upsertICStmt.run(
    r.cusip, r.issueDate, r.securityType, r.couponRate, r.maturityDate,
    r.totalIssueAmount, r.federalReserve, r.depositoryInstitutions,
    r.individuals, r.dealersAndBrokers, r.pensionAndRetirement,
    r.investmentFunds, r.foreignAndInternational, r.other, r.sourceFile,
  )
}

export function upsertInvestorClassBatch(rows: InvestorClassRow[]): void {
  db.transaction(() => {
    for (const r of rows) upsertInvestorClass(r)
  })()
}

// Approximate term ranges (years) for standard tenor buckets
const TERM_RANGES: Record<number, [number, number]> = {
  2:  [1.5, 2.75],
  3:  [2.75, 4],
  5:  [4, 6],
  7:  [6, 8.5],
  10: [8.5, 11.5],
  20: [17, 23],
  30: [27, 33],
}

export function getInvestorClassData(opts: {
  securityType?: string
  startDate?: string
  endDate?: string
  term?: number  // approximate years (2, 3, 5, 7, 10, 20, 30)
}): InvestorClassRow[] {
  const params: (string | number)[] = []
  const clauses: string[] = []

  if (opts.securityType) {
    clauses.push('security_type = ?')
    params.push(opts.securityType)
  }
  if (opts.startDate) {
    clauses.push('issue_date >= ?')
    params.push(opts.startDate)
  }
  if (opts.endDate) {
    clauses.push('issue_date <= ?')
    params.push(opts.endDate)
  }
  if (opts.term != null) {
    const range = TERM_RANGES[opts.term]
    if (range) {
      clauses.push('maturity_date IS NOT NULL AND (julianday(maturity_date) - julianday(issue_date)) / 365.25 BETWEEN ? AND ?')
      params.push(range[0], range[1])
    }
  }

  let sql = `SELECT
    cusip, issue_date AS issueDate, security_type AS securityType,
    coupon_rate AS couponRate, maturity_date AS maturityDate,
    total_issue_amount AS totalIssueAmount,
    federal_reserve AS federalReserve,
    depository_institutions AS depositoryInstitutions,
    individuals,
    dealers_and_brokers AS dealersAndBrokers,
    pension_and_retirement AS pensionAndRetirement,
    investment_funds AS investmentFunds,
    foreign_and_international AS foreignAndInternational,
    other, source_file AS sourceFile
    FROM treasury_investor_class`

  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ')
  sql += ' ORDER BY issue_date ASC'

  return db.prepare(sql).all(...params) as InvestorClassRow[]
}

export function getInvestorClassCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM treasury_investor_class').get() as { n: number }).n
}

// ── DTS Tax Deposits ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS dts_tax_deposits (
    record_date  TEXT NOT NULL,
    deposit_type TEXT NOT NULL,
    amount       REAL NOT NULL,
    PRIMARY KEY (record_date, deposit_type)
  );

  CREATE INDEX IF NOT EXISTS idx_dts_tax_date ON dts_tax_deposits(record_date);
`)

// ── DTS Fiscal Flows ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS dts_fiscal_flows (
    record_date     TEXT NOT NULL,
    fiscal_year     INTEGER NOT NULL,
    day_index       INTEGER NOT NULL,
    net_fiscal_flow REAL NOT NULL DEFAULT 0,
    cumulative_flow REAL NOT NULL,
    PRIMARY KEY (record_date)
  );

  CREATE INDEX IF NOT EXISTS idx_dts_fy ON dts_fiscal_flows(fiscal_year);
`)

// ── MTS Fiscal Balance ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS mts_fiscal_balance (
    record_date    TEXT PRIMARY KEY,
    fiscal_year    INTEGER NOT NULL,
    month_index    INTEGER NOT NULL,
    monthly_amount REAL NOT NULL,
    cumulative     REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mts_fy ON mts_fiscal_balance(fiscal_year);
`)

// ── RDE Estimates ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS rde_estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    median REAL,
    p16 REAL,
    p84 REAL,
    p2_5 REAL,
    p97_5 REAL,
    UNIQUE(date)
  );

  CREATE INDEX IF NOT EXISTS idx_rde_date ON rde_estimates(date);
`)

export interface RDEEstimateRow {
  date: string
  median: number | null
  p16: number | null
  p84: number | null
  p2_5: number | null
  p97_5: number | null
}

export function getRDEEstimates(): RDEEstimateRow[] {
  return db.prepare('SELECT date, median, p16, p84, p2_5, p97_5 FROM rde_estimates ORDER BY date ASC').all() as RDEEstimateRow[]
}

// ── ONS (UK Office for National Statistics) ─────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS ons_observations (
    cdid       TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    date       TEXT NOT NULL,
    value      REAL,
    PRIMARY KEY (cdid, dataset_id, date)
  );

  CREATE TABLE IF NOT EXISTS ons_series_meta (
    cdid         TEXT NOT NULL,
    dataset_id   TEXT NOT NULL,
    title        TEXT,
    units        TEXT,
    frequency    TEXT,
    last_fetched TEXT,
    PRIMARY KEY (cdid, dataset_id)
  );
`)

export function storeOnsObservations(
  cdid: string,
  datasetId: string,
  observations: Array<{ date: string; value: number | null }>
): void {
  const stmt = db.prepare(`
    INSERT INTO ons_observations (cdid, dataset_id, date, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cdid, dataset_id, date) DO UPDATE SET value = excluded.value
  `)
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value !== null && obs.value !== undefined) {
        stmt.run(cdid.toUpperCase(), datasetId.toLowerCase(), obs.date, obs.value)
      }
    }
  })
  tx()
}

export function getOnsObservations(
  cdid: string,
  datasetId: string
): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM ons_observations
    WHERE cdid = ? AND dataset_id = ?
    ORDER BY date ASC
  `).all(cdid.toUpperCase(), datasetId.toLowerCase()) as Array<{ date: string; value: number }>
}

export function upsertOnsSeriesMeta(
  cdid: string,
  datasetId: string,
  meta: { title?: string; units?: string; frequency?: string }
): void {
  db.prepare(`
    INSERT INTO ons_series_meta (cdid, dataset_id, title, units, frequency, last_fetched)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(cdid, dataset_id) DO UPDATE SET
      title = COALESCE(excluded.title, title),
      units = COALESCE(excluded.units, units),
      frequency = COALESCE(excluded.frequency, frequency),
      last_fetched = datetime('now')
  `).run(cdid.toUpperCase(), datasetId.toLowerCase(), meta.title || null, meta.units || null, meta.frequency || null)
}

export function isOnsSeriesStale(cdid: string, datasetId: string, maxAgeHours: number = 12): boolean {
  const row = db.prepare(`
    SELECT last_fetched FROM ons_series_meta
    WHERE cdid = ? AND dataset_id = ?
  `).get(cdid.toUpperCase(), datasetId.toLowerCase()) as { last_fetched: string } | undefined
  if (!row) return true
  const lastFetched = new Date(row.last_fetched + 'Z')
  const ageMs = Date.now() - lastFetched.getTime()
  return ageMs > maxAgeHours * 60 * 60 * 1000
}

// ── UK HPI (HM Land Registry) ────────────────────────────────────────────────
// Monthly UK House Price Index by region, ingested from the Land Registry
// full-file CSV (complete history republished monthly). Prices in £, index
// Jan-2015=100, changes in %.

db.exec(`
  CREATE TABLE IF NOT EXISTS uk_hpi (
    region             TEXT NOT NULL,
    date               TEXT NOT NULL,
    average_price      REAL,
    average_price_sa   REAL,
    index_value        REAL,
    index_sa           REAL,
    annual_change      REAL,
    monthly_change     REAL,
    price_detached     REAL,
    price_semi         REAL,
    price_terraced     REAL,
    price_flat         REAL,
    sales_volume       REAL,
    PRIMARY KEY (region, date)
  );
`)

export interface UkHpiRow {
  region: string
  date: string
  average_price: number | null
  average_price_sa: number | null
  index_value: number | null
  index_sa: number | null
  annual_change: number | null
  monthly_change: number | null
  price_detached: number | null
  price_semi: number | null
  price_terraced: number | null
  price_flat: number | null
  sales_volume: number | null
}

export function storeUkHpiRows(rows: UkHpiRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO uk_hpi (
      region, date, average_price, average_price_sa, index_value, index_sa,
      annual_change, monthly_change, price_detached, price_semi, price_terraced,
      price_flat, sales_volume
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(region, date) DO UPDATE SET
      average_price = excluded.average_price,
      average_price_sa = excluded.average_price_sa,
      index_value = excluded.index_value,
      index_sa = excluded.index_sa,
      annual_change = excluded.annual_change,
      monthly_change = excluded.monthly_change,
      price_detached = excluded.price_detached,
      price_semi = excluded.price_semi,
      price_terraced = excluded.price_terraced,
      price_flat = excluded.price_flat,
      sales_volume = excluded.sales_volume
  `)
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.region, r.date, r.average_price, r.average_price_sa, r.index_value,
        r.index_sa, r.annual_change, r.monthly_change, r.price_detached,
        r.price_semi, r.price_terraced, r.price_flat, r.sales_volume
      )
    }
  })
  tx()
}

export function getUkHpi(region: string): UkHpiRow[] {
  return db.prepare(
    'SELECT * FROM uk_hpi WHERE region = ? ORDER BY date ASC'
  ).all(region) as UkHpiRow[]
}

export function getUkHpiLatestDate(): string | null {
  const row = db.prepare('SELECT MAX(date) AS d FROM uk_hpi').get() as { d: string | null }
  return row?.d ?? null
}

// ── HMRC tax receipts (monthly, £m, cash basis) ─────────────────────────────
// Ingested from the HMRC "tax receipts and NICs for the UK" ODS (monthly rows
// from April 2017, one column per tax head).

db.exec(`
  CREATE TABLE IF NOT EXISTS hmrc_receipts (
    tax_head TEXT NOT NULL,
    date     TEXT NOT NULL,
    value    REAL,
    PRIMARY KEY (tax_head, date)
  );
`)

export function storeHmrcReceipts(rows: Array<{ taxHead: string; date: string; value: number }>): void {
  const stmt = db.prepare(`
    INSERT INTO hmrc_receipts (tax_head, date, value)
    VALUES (?, ?, ?)
    ON CONFLICT(tax_head, date) DO UPDATE SET value = excluded.value
  `)
  const tx = db.transaction(() => {
    for (const r of rows) stmt.run(r.taxHead, r.date, r.value)
  })
  tx()
}

export function getHmrcReceipts(taxHead?: string): Array<{ tax_head: string; date: string; value: number }> {
  if (taxHead) {
    return db.prepare(
      'SELECT tax_head, date, value FROM hmrc_receipts WHERE tax_head = ? ORDER BY date ASC'
    ).all(taxHead) as Array<{ tax_head: string; date: string; value: number }>
  }
  return db.prepare(
    'SELECT tax_head, date, value FROM hmrc_receipts ORDER BY tax_head, date ASC'
  ).all() as Array<{ tax_head: string; date: string; value: number }>
}

export function getHmrcTaxHeads(): string[] {
  return (db.prepare('SELECT DISTINCT tax_head FROM hmrc_receipts ORDER BY tax_head').all() as Array<{ tax_head: string }>)
    .map(r => r.tax_head)
}

// ── PAYE RTI earnings & employment (monthly, UK, SA) ────────────────────────
// Ingested from the ONS "Earnings and employment from PAYE RTI" reference
// tables (seasonally adjusted). Metrics: payrolled_employees (count),
// median_pay / mean_pay (£ per month), aggregate_pay (£m per month).

db.exec(`
  CREATE TABLE IF NOT EXISTS paye_rti (
    metric TEXT NOT NULL,
    date   TEXT NOT NULL,
    value  REAL,
    PRIMARY KEY (metric, date)
  );
`)

export function storePayeRti(rows: Array<{ metric: string; date: string; value: number }>): void {
  const stmt = db.prepare(`
    INSERT INTO paye_rti (metric, date, value)
    VALUES (?, ?, ?)
    ON CONFLICT(metric, date) DO UPDATE SET value = excluded.value
  `)
  const tx = db.transaction(() => {
    for (const r of rows) stmt.run(r.metric, r.date, r.value)
  })
  tx()
}

export function getPayeRti(metric: string): Array<{ date: string; value: number }> {
  return db.prepare(
    'SELECT date, value FROM paye_rti WHERE metric = ? ORDER BY date ASC'
  ).all(metric) as Array<{ date: string; value: number }>
}

export function getPayeRtiMetrics(): string[] {
  return (db.prepare('SELECT DISTINCT metric FROM paye_rti ORDER BY metric').all() as Array<{ metric: string }>)
    .map(r => r.metric)
}

// ── ECB Data Portal (euro area HICP + unemployment) ─────────────────────────
// Dedicated per-source table, consistent with ons_observations / boe_observations
// / overnight_rates (the dashboard stores each external macro source in its own
// table rather than a single unified macro_series table). Series codes:
// HICP_HEADLINE, HICP_CORE, HICP_SUPERCORE (index, unit='index'); UNRATE_EA
// (unit='percent'). obs_status carries ECB's A/E/P flags.

db.exec(`
  CREATE TABLE IF NOT EXISTS ecb_observations (
    date        TEXT NOT NULL,
    series_code TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    obs_status  TEXT,
    source      TEXT NOT NULL DEFAULT 'ECB',
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_ecb_observations_code_date
    ON ecb_observations(series_code, date ASC);
`)

export function storeEcbObservations(
  seriesCode: string,
  unit: string,
  observations: Array<{ date: string; value: number | null; obsStatus?: string | null }>
): number {
  const stmt = db.prepare(`
    INSERT INTO ecb_observations (date, series_code, value, unit, obs_status, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, 'ECB', datetime('now'))
    ON CONFLICT(date, series_code) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      obs_status = excluded.obs_status,
      ingested_at = excluded.ingested_at
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) continue
      stmt.run(obs.date, seriesCode, obs.value, unit, obs.obsStatus ?? null)
      n += 1
    }
  })
  tx()
  return n
}

export function getEcbObservations(seriesCode: string): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM ecb_observations
    WHERE series_code = ? AND value IS NOT NULL
    ORDER BY date ASC
  `).all(seriesCode) as Array<{ date: string; value: number }>
}

export function getEcbLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) AS d FROM ecb_observations WHERE series_code = ?
  `).get(seriesCode) as { d: string | null } | undefined
  return row?.d ?? null
}

// ── Statistics Canada (StatCan WDS) ──────────────────────────────────────────
// Canadian macro series for the CAD rates fundamental model. Same per-source
// table pattern as ecb_observations / ons_observations (the dashboard keeps each
// external source in its own table rather than a unified macro_series table).
// Series codes (unit):
//   CPI_HEADLINE (index, 2002=100), CPI_XFE (index, 2002=100, ex food & energy)
//   CPI_TRIM / CPI_MEDIAN / CPI_COMMON (percent — BoC core measures, YoY % only)
//   UNRATE_CA (percent, SA). obs_status carries StatCan's status/symbol flags.
db.exec(`
  CREATE TABLE IF NOT EXISTS statcan_observations (
    date        TEXT NOT NULL,
    series_code TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    obs_status  TEXT,
    source      TEXT NOT NULL DEFAULT 'StatCan',
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_statcan_observations_code_date
    ON statcan_observations(series_code, date ASC);
`)

export function storeStatcanObservations(
  seriesCode: string,
  unit: string,
  observations: Array<{ date: string; value: number | null; obsStatus?: string | null }>
): number {
  const stmt = db.prepare(`
    INSERT INTO statcan_observations (date, series_code, value, unit, obs_status, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, 'StatCan', datetime('now'))
    ON CONFLICT(date, series_code) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      obs_status = excluded.obs_status,
      ingested_at = excluded.ingested_at
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) continue
      stmt.run(obs.date, seriesCode, obs.value, unit, obs.obsStatus ?? null)
      n += 1
    }
  })
  tx()
  return n
}

export function getStatcanObservations(seriesCode: string): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM statcan_observations
    WHERE series_code = ? AND value IS NOT NULL
    ORDER BY date ASC
  `).all(seriesCode) as Array<{ date: string; value: number }>
}

export function getStatcanLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) AS d FROM statcan_observations WHERE series_code = ?
  `).get(seriesCode) as { d: string | null } | undefined
  return row?.d ?? null
}

// ── Statistics Bureau of Japan (e-Stat WDS) ──────────────────────────────────
// Japanese macro series for the JPY rates fundamental model. Same per-source
// table pattern as ecb_observations / statcan_observations (each external source
// keeps its own table; there is no unified macro_series table). Series codes:
//   CPI_HEADLINE_JP / CPI_CORE_JP / CPI_CORECORE_JP (index, 2020=100 — Japan
//     "core" = ex fresh food, "core-core" = ex fresh food & energy)
//   UNRATE_JP (percent, NSA monthly unemployment rate). obs_status optional.
db.exec(`
  CREATE TABLE IF NOT EXISTS estat_observations (
    date        TEXT NOT NULL,
    series_code TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    obs_status  TEXT,
    source      TEXT NOT NULL DEFAULT 'eStat',
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_estat_observations_code_date
    ON estat_observations(series_code, date ASC);
`)

export function storeEstatObservations(
  seriesCode: string,
  unit: string,
  observations: Array<{ date: string; value: number | null; obsStatus?: string | null }>,
  source = 'eStat', // Japan trade totals live in this table with source 'Customs'
): number {
  const stmt = db.prepare(`
    INSERT INTO estat_observations (date, series_code, value, unit, obs_status, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, series_code) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      obs_status = excluded.obs_status,
      ingested_at = excluded.ingested_at
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) continue
      stmt.run(obs.date, seriesCode, obs.value, unit, obs.obsStatus ?? null, source)
      n += 1
    }
  })
  tx()
  return n
}

export function getEstatObservations(seriesCode: string): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM estat_observations
    WHERE series_code = ? AND value IS NOT NULL
    ORDER BY date ASC
  `).all(seriesCode) as Array<{ date: string; value: number }>
}

export function getEstatLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) AS d FROM estat_observations WHERE series_code = ?
  `).get(seriesCode) as { d: string | null } | undefined
  return row?.d ?? null
}

// ── Bank of Japan Time-Series Data Search API ────────────────────────────────
// Japanese financial-side series for the JP Economic Data Models (PPI PR01,
// bank lending/deposits MD13). Same per-source table pattern. The BoJ requires
// a UI attribution line ("uses the BoJ Time-Series Data Search API; content
// not guaranteed by the Bank of Japan") — rendered on the consuming panels.

db.exec(`
  CREATE TABLE IF NOT EXISTS bojts_observations (
    date        TEXT NOT NULL,
    series_code TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_bojts_observations_code_date
    ON bojts_observations(series_code, date ASC);
`)

export function storeBojTsObservations(
  seriesCode: string,
  unit: string,
  observations: Array<{ date: string; value: number | null }>
): number {
  const stmt = db.prepare(`
    INSERT INTO bojts_observations (date, series_code, value, unit, ingested_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, series_code) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      ingested_at = excluded.ingested_at
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) continue
      stmt.run(obs.date, seriesCode, obs.value, unit)
      n += 1
    }
  })
  tx()
  return n
}

export function getBojTsObservations(seriesCode: string): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM bojts_observations
    WHERE series_code = ? AND value IS NOT NULL
    ORDER BY date ASC
  `).all(seriesCode) as Array<{ date: string; value: number }>
}

export function getBojTsLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) AS d FROM bojts_observations WHERE series_code = ?
  `).get(seriesCode) as { d: string | null } | undefined
  return row?.d ?? null
}

// ── Australian Bureau of Statistics (ABS Data API, SDMX) ─────────────────────
// Australian macro series for the AUD rates fundamental model. Same per-source
// table pattern as the other macro collectors. Unlike the others, Australian CPI
// is in a mixed monthly/quarterly transition window (Nov-2025 onward), so each
// row carries its `frequency` ('M' | 'Q') — the dashboard renders the two
// cadences differently. Series codes:
//   AU_CPI_M_HEADLINE / AU_CPI_M_TRIMMED / AU_CPI_M_WGTMED  (monthly index, ~2023-24=100)
//   AU_CPI_Q_HEADLINE / AU_CPI_Q_TRIMMED / AU_CPI_Q_WGTMED  (quarterly index)
//   AU_UNRATE_SA / AU_UNRATE_TREND                          (percent, monthly)
db.exec(`
  CREATE TABLE IF NOT EXISTS au_macro_series (
    date        TEXT NOT NULL,
    series_code TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    frequency   TEXT,
    source      TEXT NOT NULL DEFAULT 'ABS',
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_au_macro_series_code_date
    ON au_macro_series(series_code, date ASC);
`)

export function storeAbsObservations(
  seriesCode: string,
  unit: string,
  frequency: string,
  observations: Array<{ date: string; value: number | null }>
): number {
  const stmt = db.prepare(`
    INSERT INTO au_macro_series (date, series_code, value, unit, frequency, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, 'ABS', datetime('now'))
    ON CONFLICT(date, series_code) DO UPDATE SET
      value = excluded.value,
      unit = excluded.unit,
      frequency = excluded.frequency,
      ingested_at = excluded.ingested_at
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const obs of observations) {
      if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) continue
      stmt.run(obs.date, seriesCode, obs.value, unit, frequency)
      n += 1
    }
  })
  tx()
  return n
}

export function getAbsObservations(seriesCode: string): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM au_macro_series
    WHERE series_code = ? AND value IS NOT NULL
    ORDER BY date ASC
  `).all(seriesCode) as Array<{ date: string; value: number }>
}

export function getAbsLatestDate(seriesCode: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) AS d FROM au_macro_series WHERE series_code = ?
  `).get(seriesCode) as { d: string | null } | undefined
  return row?.d ?? null
}

// ── Bank of England IADB ─────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS boe_observations (
    series_code TEXT NOT NULL,
    date        TEXT NOT NULL,
    value       REAL,
    PRIMARY KEY (series_code, date)
  );

  CREATE TABLE IF NOT EXISTS boe_series_meta (
    series_code  TEXT NOT NULL PRIMARY KEY,
    description  TEXT,
    frequency    TEXT,
    last_fetched TEXT
  );

  CREATE TABLE IF NOT EXISTS gilt_yield_curve (
    date       TEXT NOT NULL,
    curve_type TEXT NOT NULL,
    maturity   REAL NOT NULL,
    value      REAL,
    PRIMARY KEY (date, curve_type, maturity)
  );

  CREATE INDEX IF NOT EXISTS idx_gilt_yc_type_date ON gilt_yield_curve(curve_type, date);
  CREATE INDEX IF NOT EXISTS idx_gilt_yc_type_maturity ON gilt_yield_curve(curve_type, maturity);

  CREATE TABLE IF NOT EXISTS ons_gdp_contributions (
    date        TEXT NOT NULL,
    period_type TEXT NOT NULL,
    sector      TEXT NOT NULL,
    value       REAL,
    PRIMARY KEY (date, period_type, sector)
  );
`)

export function storeBoeObservations(
  seriesCode: string,
  observations: Array<{ date: string; value: number | null }>
): void {
  const stmt = db.prepare(`
    INSERT INTO boe_observations (series_code, date, value)
    VALUES (?, ?, ?)
    ON CONFLICT(series_code, date) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    for (const obs of observations) {
      if (obs.value !== null && obs.value !== undefined) {
        stmt.run(seriesCode.toUpperCase(), obs.date, obs.value)
      }
    }
  })()
}

export function getBoeObservations(
  seriesCode: string
): Array<{ date: string; value: number }> {
  return db.prepare(`
    SELECT date, value FROM boe_observations
    WHERE series_code = ?
    ORDER BY date ASC
  `).all(seriesCode.toUpperCase()) as Array<{ date: string; value: number }>
}

export function upsertBoeSeriesMeta(
  seriesCode: string,
  meta: { description?: string; frequency?: string }
): void {
  db.prepare(`
    INSERT INTO boe_series_meta (series_code, description, frequency, last_fetched)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(series_code) DO UPDATE SET
      description = COALESCE(excluded.description, description),
      frequency = COALESCE(excluded.frequency, frequency),
      last_fetched = datetime('now')
  `).run(seriesCode.toUpperCase(), meta.description || null, meta.frequency || null)
}

// ── Gilt Yield Curve helpers ─────────────────────────────────────────────────

export function storeGiltCurveData(
  rows: Array<{ date: string; curve_type: string; maturity: number; value: number | null }>
): void {
  const stmt = db.prepare(`
    INSERT INTO gilt_yield_curve (date, curve_type, maturity, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, curve_type, maturity) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    for (const row of rows) {
      if (row.value !== null && row.value !== undefined && !isNaN(row.value)) {
        stmt.run(row.date, row.curve_type, row.maturity, row.value)
      }
    }
  })()
}

export function getGiltCurve(
  date: string,
  curveType: string
): Array<{ maturity: number; value: number }> {
  return db.prepare(`
    SELECT maturity, value FROM gilt_yield_curve
    WHERE date = ? AND curve_type = ?
    ORDER BY maturity ASC
  `).all(date, curveType) as Array<{ maturity: number; value: number }>
}

export function getGiltCurveLatestDate(curveType: string): string | null {
  const row = db.prepare(`
    SELECT MAX(date) as latest FROM gilt_yield_curve WHERE curve_type = ?
  `).get(curveType) as { latest: string | null } | undefined
  return row?.latest || null
}

export function getGiltCurveTimeSeries(
  curveType: string,
  maturity: number,
  startDate?: string,
  endDate?: string
): Array<{ date: string; value: number }> {
  let sql = `SELECT date, value FROM gilt_yield_curve WHERE curve_type = ? AND maturity = ?`
  const params: (string | number)[] = [curveType, maturity]
  if (startDate) { sql += ` AND date >= ?`; params.push(startDate) }
  if (endDate) { sql += ` AND date <= ?`; params.push(endDate) }
  sql += ` ORDER BY date ASC`
  return db.prepare(sql).all(...params) as Array<{ date: string; value: number }>
}

export function getGiltCurveAvailableDates(curveType: string): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM gilt_yield_curve WHERE curve_type = ? ORDER BY date DESC LIMIT 30
  `).all(curveType) as Array<{ date: string }>
  return rows.map(r => r.date)
}

export function isBoeSeriesStale(seriesCode: string, maxAgeHours: number = 12): boolean {
  const row = db.prepare(`
    SELECT last_fetched FROM boe_series_meta WHERE series_code = ?
  `).get(seriesCode.toUpperCase()) as { last_fetched: string } | undefined
  if (!row) return true
  const ageMs = Date.now() - new Date(row.last_fetched + 'Z').getTime()
  return ageMs > maxAgeHours * 60 * 60 * 1000
}

// ── ONS Monthly GDP Contributions ────────────────────────────────────────────

export function storeGDPContributions(
  rows: Array<{ date: string; period_type: string; sector: string; value: number }>
): void {
  const stmt = db.prepare(`
    INSERT INTO ons_gdp_contributions (date, period_type, sector, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, period_type, sector) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    for (const row of rows) {
      if (row.value !== null && row.value !== undefined && !isNaN(row.value)) {
        stmt.run(row.date, row.period_type, row.sector, row.value)
      }
    }
  })()
}

export function getGDPContributions(
  periodType: string,
  startDate?: string
): Array<{ date: string; sector: string; value: number }> {
  let sql = `SELECT date, sector, value FROM ons_gdp_contributions WHERE period_type = ?`
  const params: (string | number)[] = [periodType]
  if (startDate) { sql += ` AND date >= ?`; params.push(startDate) }
  sql += ` ORDER BY date ASC, sector ASC`
  return db.prepare(sql).all(...params) as Array<{ date: string; sector: string; value: number }>
}

// ── TradingView OHLCV ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS tv_ohlcv (
    symbol    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    time      TEXT NOT NULL,
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    INTEGER,
    ingested_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, timeframe, time)
  );

  CREATE INDEX IF NOT EXISTS idx_tv_ohlcv_symbol_tf ON tv_ohlcv(symbol, timeframe);

  CREATE TABLE IF NOT EXISTS tv_ingest_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT NOT NULL,
    symbol         TEXT,
    timeframe      TEXT,
    rows_ingested  INTEGER,
    status         TEXT NOT NULL,
    error_message  TEXT,
    ingested_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tv_series (
    symbol      TEXT NOT NULL,
    time        TEXT NOT NULL,
    close       REAL,
    source_file TEXT,
    ingested_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (symbol, time)
  );

  CREATE INDEX IF NOT EXISTS idx_tv_series_symbol ON tv_series(symbol);

  -- Unified daily overnight policy / market rates across central banks.
  -- Populated by overnight* collectors (FRED for SONIA/ECBDFR, BoC Valet for
  -- CORRA, BoJ for TONA, RBA F1 CSV for AONIA + cash rate target).
  CREATE TABLE IF NOT EXISTS overnight_rates (
    date           TEXT NOT NULL,
    series_code    TEXT NOT NULL,   -- 'SONIA' | 'ECBDFR' | 'CORRA' | 'CA_TARGET' | 'TONA' | 'AONIA' | 'AU_CASH_RATE_TARGET'
    value          REAL,
    is_provisional INTEGER DEFAULT 0,
    source         TEXT,             -- 'FRED' | 'BoC' | 'BoJ' | 'RBA'
    ingested_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, series_code)
  );

  CREATE INDEX IF NOT EXISTS idx_overnight_rates_series_date
    ON overnight_rates(series_code, date DESC);
`)

// Migration: drop old columns if they exist (previous schema had delta_tga, delta_debt)
try {
  // SQLite doesn't support DROP COLUMN before 3.35.0, so just recreate if needed
  const cols = db.pragma('table_info(dts_fiscal_flows)') as { name: string }[]
  if (cols.some((c) => c.name === 'delta_tga')) {
    db.exec('DELETE FROM dts_fiscal_flows') // will be rebuilt on next sync
  }
} catch {
  // table doesn't exist yet — will be created above
}

// ── Economic Data Log (Trading Economics calendar) ───────────────────────────
// One row per release. Upsert keyed on (release_date, country, event) so re-runs
// fill in `actual` as it publishes without duplicating, and back-fills are safe.
// `surprise` is written by the classifier after persistence (NULL = a rule
// exists but the surprise isn't computable yet; 'unclassified' = no rule).
db.exec(`
  CREATE TABLE IF NOT EXISTS economic_releases (
    release_date     TEXT NOT NULL,
    day_of_week      TEXT,
    country          TEXT NOT NULL,
    event            TEXT NOT NULL,    -- base event name; suffix lives in reference_period
    reference_period TEXT,             -- e.g. "APR", "MAY/23", "Q1 2026"; null if none
    category         TEXT,
    expected         TEXT,
    actual           TEXT,
    previous         TEXT,
    importance       INTEGER,
    surprise         TEXT,
    scraped_at       TEXT NOT NULL,
    PRIMARY KEY (release_date, country, event)
  );

  CREATE INDEX IF NOT EXISTS idx_economic_releases_date
    ON economic_releases(release_date DESC);
`)

// Migrations: ALTER TABLE columns onto pre-existing tables (CREATE TABLE IF NOT
// EXISTS won't add columns to a table that already exists). Idempotent.
try {
  const cols = (db.pragma('table_info(economic_releases)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('category'))         db.exec('ALTER TABLE economic_releases ADD COLUMN category TEXT')
  if (!cols.includes('reference_period')) db.exec('ALTER TABLE economic_releases ADD COLUMN reference_period TEXT')
} catch { /* fresh DB — columns already present from CREATE */ }

// Upserts release rows incl. ingestion-time `category`. Leaves `surprise`
// untouched (the classifier owns it) — but clears it when `actual` changes so a
// stale label can't survive a revised/late print until the classifier re-runs.
export function upsertEconomicReleases(rows: CategorizedRelease[]): number {
  // The PK uses the BASE event name (no reference-period suffix) so a later
  // pull that carries "Core PCE Price Index MoM APR" matches the earlier
  // "Core PCE Price Index MoM" row and updates it, instead of inserting a
  // duplicate. The reference_period is stored alongside, preferring whichever
  // value is non-null (so an early pull with no period doesn't clobber a later
  // pull's "APR").
  const stmt = db.prepare(`
    INSERT INTO economic_releases
      (release_date, day_of_week, country, event, reference_period, category, expected, actual, previous, importance, scraped_at)
    VALUES
      (@release_date, @day_of_week, @country, @event, @reference_period, @category, @expected, @actual, @previous, @importance, @scraped_at)
    ON CONFLICT(release_date, country, event) DO UPDATE SET
      day_of_week      = excluded.day_of_week,
      reference_period = COALESCE(excluded.reference_period, economic_releases.reference_period),
      category         = excluded.category,
      -- Non-destructive: a re-scrape that returns a blank value (common when
      -- TE's "Previous Month" view drops the forecast/actual for an already-
      -- released event) must NEVER clobber a populated value. Keep the stored
      -- value unless the incoming one is non-empty.
      expected         = COALESCE(NULLIF(excluded.expected, ''), economic_releases.expected),
      previous         = COALESCE(NULLIF(excluded.previous, ''), economic_releases.previous),
      importance       = excluded.importance,
      scraped_at       = excluded.scraped_at,
      -- Only clear the surprise (forcing re-classification) when a *non-blank*
      -- actual actually differs from what's stored — a blank re-scrape leaves
      -- both the actual and its surprise untouched.
      surprise         = CASE
                           WHEN NULLIF(excluded.actual, '') IS NOT NULL
                                AND economic_releases.actual IS NOT excluded.actual
                           THEN NULL ELSE economic_releases.surprise END,
      actual           = COALESCE(NULLIF(excluded.actual, ''), economic_releases.actual)
  `)
  let n = 0
  const tx = db.transaction(() => {
    for (const r of rows) { stmt.run(r); n += 1 }
  })
  tx()
  return n
}

// Rows missing a category (ingested before the category column existed). Used
// by the startup backfill so the column is populated without waiting for a scrape.
export function getReleasesMissingCategory(): Array<{ release_date: string; country: string; event: string }> {
  return db.prepare(`
    SELECT release_date, country, event FROM economic_releases WHERE category IS NULL
  `).all() as Array<{ release_date: string; country: string; event: string }>
}

export function setReleaseCategory(release_date: string, country: string, event: string, category: string): void {
  db.prepare('UPDATE economic_releases SET category = ? WHERE release_date = ? AND country = ? AND event = ?')
    .run(category, release_date, country, event)
}

export function updateReleaseSurprise(
  release_date: string, country: string, event: string, surprise: SurpriseLabel | null,
): void {
  db.prepare(`
    UPDATE economic_releases SET surprise = ?
    WHERE release_date = ? AND country = ? AND event = ?
  `).run(surprise, release_date, country, event)
}

export interface EconomicReleaseFilter {
  countries?: string[]
  minImportance?: number
  startDate?: string   // inclusive ISO date
  endDate?: string     // inclusive ISO date
  eventSearch?: string // case-insensitive substring on event name
}

export function getEconomicReleases(filter: EconomicReleaseFilter = {}): StoredEconomicRelease[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.countries && filter.countries.length > 0) {
    where.push(`country IN (${filter.countries.map((_, i) => `@c${i}`).join(', ')})`)
    filter.countries.forEach((c, i) => { params[`c${i}`] = c })
  }
  if (filter.minImportance != null) { where.push('importance >= @minImportance'); params.minImportance = filter.minImportance }
  if (filter.startDate) { where.push('release_date >= @startDate'); params.startDate = filter.startDate }
  if (filter.endDate)   { where.push('release_date <= @endDate');   params.endDate = filter.endDate }
  if (filter.eventSearch) { where.push('LOWER(event) LIKE @eventSearch'); params.eventSearch = `%${filter.eventSearch.toLowerCase()}%` }

  const sql = `
    SELECT release_date, day_of_week, country, event, reference_period, category, expected, actual, previous, importance, surprise, scraped_at
    FROM economic_releases
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY release_date ASC, country ASC, event ASC
  `
  return db.prepare(sql).all(params) as StoredEconomicRelease[]
}

export function getLatestReleaseScrapedAt(): string | null {
  const row = db.prepare('SELECT MAX(scraped_at) AS t FROM economic_releases').get() as { t: string | null } | undefined
  return row?.t ?? null
}

// ── User-added surprise rules (Phase 3 triage) ───────────────────────────────
// Runtime-editable rules that augment/override the static TS seed config
// (config/economicSurpriseRules.ts). The classifier merges these over the seeds
// (see economicCalendar/ruleLookup.ts) so the triage UI can classify events
// without a code change/redeploy.
db.exec(`
  CREATE TABLE IF NOT EXISTS economic_surprise_rules (
    event             TEXT PRIMARY KEY,
    in_line_threshold REAL NOT NULL,
    warm_threshold    REAL NOT NULL,
    hot_threshold     REAL NOT NULL,
    direction         INTEGER NOT NULL,
    unit              TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

export interface StoredSurpriseRule extends SurpriseRule { event: string }

export function upsertSurpriseRule(event: string, rule: SurpriseRule): void {
  db.prepare(`
    INSERT INTO economic_surprise_rules (event, in_line_threshold, warm_threshold, hot_threshold, direction, unit)
    VALUES (@event, @in_line_threshold, @warm_threshold, @hot_threshold, @direction, @unit)
    ON CONFLICT(event) DO UPDATE SET
      in_line_threshold = excluded.in_line_threshold,
      warm_threshold    = excluded.warm_threshold,
      hot_threshold     = excluded.hot_threshold,
      direction         = excluded.direction,
      unit              = excluded.unit
  `).run({ event, ...rule })
}

export function getSurpriseRulesFromDb(): StoredSurpriseRule[] {
  return db.prepare(`
    SELECT event, in_line_threshold, warm_threshold, hot_threshold, direction, unit
    FROM economic_surprise_rules
    ORDER BY event ASC
  `).all() as StoredSurpriseRule[]
}

export function deleteSurpriseRule(event: string): void {
  db.prepare('DELETE FROM economic_surprise_rules WHERE event = ?').run(event)
}

export interface UnclassifiedEventSummary {
  event: string
  count: number
  sampleCountry: string
  sampleExpected: string | null
  sampleActual: string | null
}

// Distinct events with no matching rule (surprise = 'unclassified'), with a
// sample expected/actual so the triage UI can show the value format and the
// user can pick a sensible unit/thresholds. MAX() skips NULLs to surface a
// non-empty sample where one exists.
export function getUnclassifiedEvents(): UnclassifiedEventSummary[] {
  return db.prepare(`
    SELECT event,
           COUNT(*)       AS count,
           MIN(country)   AS sampleCountry,
           MAX(expected)  AS sampleExpected,
           MAX(actual)    AS sampleActual
    FROM economic_releases
    WHERE surprise = 'unclassified'
    GROUP BY event
    ORDER BY count DESC, event ASC
  `).all() as UnclassifiedEventSummary[]
}
