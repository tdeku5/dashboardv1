import Database from 'better-sqlite3'
import path from 'path'

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

export function getAuctions(opts: {
  securityTerm?: string
  securityType?: string
  startDate?: string
  endDate?: string
}): ParsedAuction[] {
  const params: string[] = []
  const clauses: string[] = []

  if (opts.securityTerm) {
    clauses.push('security_term LIKE ?')
    params.push(`%${opts.securityTerm}%`)
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
