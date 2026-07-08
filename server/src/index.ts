import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cron from 'node-cron'
import { fredRouter } from './routes/fred'
import { beaRouter }  from './routes/bea'
import { newsRouter } from './routes/news'
import { treasuryRouter } from './routes/treasury'
import { isDatabaseEmpty, getStaleSeries, getAllKnownSeriesIds, db } from './db'
import { fetchAllSeries, ALL_SERIES, STALE_HOURS } from './fetchAllSeries'
import { fetchAndIngestNews } from './newsFetcher'
import { syncTreasuryAuctions } from './treasuryAuctions'
import { syncInvestorClassData } from './investorClassData'
import { syncSCEData } from './sceData'
import { sceRouter }   from './routes/sce'
import { syncUMichExpectations } from './umichData'
import { umichRouter }  from './routes/umich'
import { fiscalRouter } from './routes/fiscal'
import { fiscalFlowsRouter } from './routes/fiscalFlows'
import { syncDtsFiscalFlows } from './dtsFiscalFlows'
import { syncDtsTaxDeposits } from './dtsTaxDeposits'
import { censusTradeRouter, isCensusTradeStale, fetchAndStoreCensusTrade } from './routes/census-trade'
import { mtsRouter } from './routes/mts'
import { syncMtsFiscalBalance } from './mtsFiscalBalance'
import { tvFuturesRouter } from './routes/tvFutures'
import { gdpnowRouter } from './routes/gdpnow'
import { syncGDPNow } from './gdpnowData'
import { rdeRouter } from './routes/rde'
import { syncRDE } from './rdeData'
import { onsRouter } from './routes/ons'
import { syncAllOnsSeries } from './fetchAllOnsSeries'
import { boeRouter } from './routes/boe'
import { syncAllBoeSeries } from './fetchAllBoeSeries'
import { boeYieldCurveRouter } from './routes/boeYieldCurve'
import { syncGiltYieldCurves, backfillGiltYieldCurves } from './boeYieldCurve'
import { syncMonthlyGDPContributions, backfillMonthlyGDPContributions } from './onsMonthlyGDPContribs'
import { ukHpiRouter } from './routes/ukHpi'
import { syncUkHpi } from './ukHpi'
import { hmrcReceiptsRouter } from './routes/hmrcReceipts'
import { syncHmrcReceipts } from './hmrcReceipts'
import { payeRtiRouter } from './routes/payeRti'
import { syncPayeRti } from './payeRti'
import { statcanRouter } from './routes/statcan'
import { verifyStatcanMetadata, syncAllStatcanSeries } from './fetchAllStatcanSeries'
import { estatRouter } from './routes/estat'
import { verifyEstatMetadata, syncAllEstatSeries } from './fetchAllEstatSeries'
import { bojTsRouter } from './routes/bojTs'
import { syncBojTsSeries } from './bojTsCollector'
import { syncJpTrade } from './jpTradeCsv'
import { eurostatRouter } from './routes/eurostat'
import { ecbRouter } from './routes/ecb'
import { verifyEurostatMetadata, syncAllEurostatSeries } from './fetchAllEurostatSeries'
import { tvRouter } from './routes/tv'
import { tvYieldCurveRouter } from './routes/tvYieldCurve'
import { globalRouter } from './routes/global'
import { ukFundamentalRouter } from './routes/ukFundamental'
import { commoditiesRouter } from './routes/commodities'
import { equitiesRouter } from './routes/equities'
import { fxRouter } from './routes/fx'
import { macroRouter } from './routes/macro'
import { startTvCsvWatcher, stopTvCsvWatcher } from './tvCsvIngest'
import { runStaleTipCleanup } from './migrations/cleanStaleTips'
import { runEcbHicpDatasetMigration } from './migrations/migrateEcbHicpDataset'
import { syncIncrementalFredOvernight } from './overnightFred'
import { syncIncrementalBocOvernight } from './overnightBoc'
import { syncIncrementalBojOvernight } from './overnightBoj'
import { syncIncrementalRbaOvernight } from './overnightRba'
import { overnightRatesRouter } from './routes/overnightRates'
import { euFundamentalRouter } from './routes/euFundamental'
import { syncIncremental as syncIncrementalEcb } from './collectors/ecbCollector'
import { caFundamentalRouter } from './routes/caFundamental'
import { syncIncremental as syncIncrementalStatcan } from './collectors/statcanCollector'
import { jpFundamentalRouter } from './routes/jpFundamental'
import { syncIncremental as syncIncrementalEstat } from './collectors/estatCollector'
import { auFundamentalRouter } from './routes/auFundamental'
import { syncIncremental as syncIncrementalAbs } from './collectors/absCollector'
import { syncEconomicCalendar, backfillMissingCategories, mergeDuplicateReleases } from './economicCalendar'
import { economicCalendarRouter } from './routes/economicCalendar'

dotenv.config({ path: '../.env' })

const app  = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

app.use('/api/fred',     fredRouter)
app.use('/api/bea',      beaRouter)
app.use('/api/news',     newsRouter)
app.use('/api/treasury', treasuryRouter)
app.use('/api/sce',      sceRouter)
app.use('/api/umich',    umichRouter)
app.use('/api/fiscal',   fiscalRouter)
app.use('/api/fiscal-flows', fiscalFlowsRouter)
app.use('/api/census-trade', censusTradeRouter)
app.use('/api/mts',          mtsRouter)
app.use('/api/futures',      tvFuturesRouter)
app.use('/api/gdpnow',       gdpnowRouter)
app.use('/api/rde',          rdeRouter)
app.use('/api/ons',          onsRouter)
app.use('/api/boe/yield-curve', boeYieldCurveRouter)
app.use('/api/boe',          boeRouter)
app.use('/api/uk-hpi',       ukHpiRouter)
app.use('/api/hmrc-receipts', hmrcReceiptsRouter)
app.use('/api/paye-rti',     payeRtiRouter)
app.use('/api/statcan',      statcanRouter)
app.use('/api/estat',        estatRouter)
app.use('/api/boj-ts',       bojTsRouter)
app.use('/api/eurostat',     eurostatRouter)
app.use('/api/ecb',          ecbRouter)
app.use('/api/tv/yield-curve', tvYieldCurveRouter)
app.use('/api/tv',           tvRouter)
app.use('/api/global',       globalRouter)
app.use('/api/uk/fundamental', ukFundamentalRouter)
app.use('/api/eu/fundamental', euFundamentalRouter)
app.use('/api/ca/fundamental', caFundamentalRouter)
app.use('/api/jp/fundamental', jpFundamentalRouter)
app.use('/api/au/fundamental', auFundamentalRouter)
app.use('/api/commodities',  commoditiesRouter)
app.use('/api/equities',     equitiesRouter)
app.use('/api/fx',           fxRouter)
app.use('/api/macro',        macroRouter)
app.use('/api/overnight-rates', overnightRatesRouter)
app.use('/api/economic-calendar', economicCalendarRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  // One-time data migrations (gated by PRAGMA user_version, safe to call every start).
  // Order matters: each sets an absolute user_version, so lower-versioned
  // migrations must run first or they'd be skipped on a fresh DB.
  try {
    runStaleTipCleanup()
  } catch (err) {
    console.error('[startup] Stale-tip cleanup error:', err)
  }
  try {
    runEcbHicpDatasetMigration()
  } catch (err) {
    console.error('[startup] ECB HICP dataset migration error:', err)
  }

  if (isDatabaseEmpty()) {
    console.log('[startup] Database is empty — running initial fetch (this may take ~1 min)…')
    await fetchAllSeries({ force: true })
    console.log('[startup] Initial fetch complete.')
  } else {
    // Merge static ALL_SERIES with any on-demand series the server has learned about
    const known = getAllKnownSeriesIds()
    const merged = [...new Set([...ALL_SERIES, ...known])]
    const stale = getStaleSeries(STALE_HOURS, merged)
    if (stale.length > 0) {
      console.log(`[startup] ${stale.length}/${merged.length} series are stale — refreshing in background…`)
      fetchAllSeries({ seriesList: stale }).catch(err =>
        console.error('[startup] Background refresh error:', err)
      )
    } else {
      console.log(`[startup] All ${merged.length} series are current.`)
    }
  }

  // Pre-populate news if table is empty
  const newsCount = (db.prepare('SELECT COUNT(*) as n FROM news_articles').get() as { n: number }).n
  if (newsCount === 0) {
    console.log('[startup] News table empty — running initial news fetch…')
    fetchAndIngestNews().catch(err =>
      console.error('[startup] Initial news fetch error:', err)
    )
  }

  // Economic Data Log: only scrape on first run (empty table) to avoid burning
  // Firecrawl/Claude credits on every restart — steady-state refresh is the
  // 23:00 UTC cron below. Non-blocking; a failed scrape logs but never aborts
  // startup (the standalone runner is the entrypoint that exits non-zero).
  const releaseCount = (db.prepare('SELECT COUNT(*) as n FROM economic_releases').get() as { n: number }).n
  if (releaseCount === 0) {
    console.log('[startup] Economic releases table empty — running initial calendar scrape…')
    syncEconomicCalendar().catch(err =>
      console.error('[startup] Initial economic calendar sync error:', err)
    )
  } else {
    // Backfill `category` for rows ingested before the column existed (idempotent).
    try { backfillMissingCategories() } catch (err) { console.error('[startup] Category backfill error:', err) }
    // One-shot dedup sweep for rows split by TE's reference-period suffix (idempotent).
    try { mergeDuplicateReleases() } catch (err) { console.error('[startup] Duplicate-merge error:', err) }
  }

  // Treasury auction data sync (non-blocking)
  syncTreasuryAuctions().catch(err =>
    console.error('[startup] Treasury sync error:', err)
  )

  // Treasury investor class data sync (non-blocking)
  syncInvestorClassData().catch(err =>
    console.error('[startup] Investor class sync error:', err)
  )

  // NY Fed SCE inflation expectations sync (non-blocking)
  syncSCEData().catch(err =>
    console.error('[startup] SCE sync error:', err)
  )

  // UMichigan 5-year inflation expectations sync (non-blocking)
  syncUMichExpectations().catch(err =>
    console.error('[startup] UMich sync error:', err)
  )

  // DTS fiscal flows sync (non-blocking)
  syncDtsFiscalFlows().catch(err =>
    console.error('[startup] DTS fiscal flows sync error:', err)
  )

  // DTS tax deposits sync (non-blocking)
  syncDtsTaxDeposits().catch(err =>
    console.error('[startup] DTS tax deposits sync error:', err)
  )

  // MTS fiscal balance sync (non-blocking)
  syncMtsFiscalBalance().catch(err =>
    console.error('[startup] MTS fiscal balance sync error:', err)
  )

  // Atlanta Fed GDPNow sync (non-blocking)
  syncGDPNow().catch(err =>
    console.error('[startup] GDPNow sync error:', err)
  )

  // NY Fed Reserve Demand Elasticity sync (non-blocking)
  syncRDE().catch(err =>
    console.error('[startup] RDE sync error:', err)
  )

  // ONS UK data sync (non-blocking)
  syncAllOnsSeries().catch(err =>
    console.error('[startup] ONS sync error:', err)
  )

  // ONS monthly GDP contributions sync (non-blocking)
  syncMonthlyGDPContributions().catch(err =>
    console.error('[startup] ONS GDP contributions sync error:', err)
  )

  // ONS GDP contributions historical backfill (non-blocking, skips if >60 months exist)
  backfillMonthlyGDPContributions().catch(err =>
    console.error('[startup] ONS GDP contributions backfill error:', err)
  )

  // Bank of England data sync (non-blocking)
  syncAllBoeSeries().catch(err =>
    console.error('[startup] BoE sync error:', err)
  )

  // UK HPI (Land Registry) sync — full-file download covers backfill +
  // refresh; internally skips unless a new reference month is due (non-blocking)
  syncUkHpi().catch(err =>
    console.error('[startup] UK HPI sync error:', err)
  )

  // HMRC tax receipts sync — ODS republishes full history monthly (non-blocking)
  syncHmrcReceipts().catch(err =>
    console.error('[startup] HMRC receipts sync error:', err)
  )

  // PAYE RTI earnings & employment sync — xlsx republishes full history
  // monthly (non-blocking)
  syncPayeRti().catch(err =>
    console.error('[startup] PAYE RTI sync error:', err)
  )

  // Canada econ-model StatCan series: metadata health check FIRST (vector
  // renumbering defense — sync is skipped entirely if any PID/title mismatches),
  // then incremental sync (falls back to full backfill on empty table).
  verifyStatcanMetadata()
    .then(() => syncAllStatcanSeries())
    .catch(err => console.error('[startup] StatCan WDS sync error:', err))

  // Japan econ-model e-Stat series: metadata health check first (base-year
  // renumbering + lang=E-hides-table defense), then full-refetch sync with
  // frozen-feed staleness warnings.
  verifyEstatMetadata()
    .then(() => syncAllEstatSeries())
    .catch(err => console.error('[startup] eStat generic sync error:', err))

  // Japan BoJ Time-Series API (PPI + bank lending) — non-blocking.
  syncBojTsSeries().catch(err =>
    console.error('[startup] BoJ-TS sync error:', err)
  )

  // Japan merchandise trade totals — Customs CSV (full history each pull).
  syncJpTrade().catch(err =>
    console.error('[startup] JP trade sync error:', err)
  )

  // EU3 (DE/FR/IT) Eurostat series: dataset metadata health check first
  // (dimension-order + title assertions), then geo-batched full sync. The
  // country-level ECB series ride the existing ECB syncIncremental above.
  verifyEurostatMetadata()
    .then(() => syncAllEurostatSeries())
    .catch(err => console.error('[startup] Eurostat sync error:', err))

  // BoE gilt yield curve sync (non-blocking)
  syncGiltYieldCurves().catch(err =>
    console.error('[startup] Gilt yield curve sync error:', err)
  )

  // ECB euro-area HICP + unemployment sync (non-blocking). syncIncremental
  // falls back to a full 2000-01 backfill when the table is empty for a series,
  // so this single call covers both first-run and steady-state.
  syncIncrementalEcb().catch(err =>
    console.error('[startup] ECB sync error:', err)
  )

  // StatCan Canadian CPI (headline + ex food/energy + BoC core trio) +
  // unemployment sync (non-blocking). syncIncremental falls back to a full
  // backfill when the table is empty, so this single call covers both
  // first-run and steady-state.
  syncIncrementalStatcan().catch(err =>
    console.error('[startup] StatCan sync error:', err)
  )

  // e-Stat Japanese CPI (headline + core + core-core) + unemployment sync
  // (non-blocking). syncIncremental falls back to a full backfill when the table
  // is empty, so this single call covers both first-run and steady-state.
  syncIncrementalEstat().catch(err =>
    console.error('[startup] e-Stat sync error:', err)
  )

  // ABS Australian CPI (monthly + quarterly headline/trimmed/weighted-median) +
  // unemployment (SA + trend) sync (non-blocking). syncIncremental falls back to
  // a full backfill when the table is empty, so this covers first-run + steady-state.
  syncIncrementalAbs().catch(err =>
    console.error('[startup] ABS sync error:', err)
  )

  // BoE gilt yield curve historical backfill (non-blocking, skips if data exists)
  backfillGiltYieldCurves().catch(err =>
    console.error('[startup] Gilt yield curve backfill error:', err)
  )

  // Census trade end-use data sync (non-blocking)
  if (isCensusTradeStale()) {
    fetchAndStoreCensusTrade().catch(err =>
      console.error('[startup] Census trade ingestion error:', err)
    )
  }

  // Overnight rates (SONIA, ECBDFR, CORRA, TONA, AONIA) — non-blocking.
  // syncIncremental* collectors fall back to a full backfill when the table
  // is empty for that series, so this single call covers both cases.
  syncIncrementalFredOvernight().catch(err =>
    console.error('[startup] FRED overnight sync error:', err)
  )
  syncIncrementalBocOvernight().catch(err =>
    console.error('[startup] BoC overnight sync error:', err)
  )
  syncIncrementalBojOvernight().catch(err =>
    console.error('[startup] BoJ overnight sync error:', err)
  )
  syncIncrementalRbaOvernight().catch(err =>
    console.error('[startup] RBA overnight sync error:', err)
  )

  // Overnight rates: daily 03:00 UTC. Per the integration guide, this single
  // slot catches the final values for all four sources:
  //   • CORRA: final by 11:00 ET = 15:00–16:00 UTC of prior day — well stale by 03:00.
  //   • TONA:  final at 10:00 JST = 01:00 UTC — fresh by 03:00.
  //   • AONIA: published morning Sydney = ~22:00 UTC prior — fresh by 03:00.
  //   • SONIA / ECBDFR: FRED publishes T+1, picked up here.
  cron.schedule('0 3 * * *', () => {
    console.log('[cron] 03:00 — refreshing overnight rates…')
    syncIncrementalFredOvernight().catch(err => console.error('[cron] FRED overnight error:', err))
    syncIncrementalBocOvernight().catch(err => console.error('[cron] BoC overnight error:', err))
    syncIncrementalBojOvernight().catch(err => console.error('[cron] BoJ overnight error:', err))
    syncIncrementalRbaOvernight().catch(err => console.error('[cron] RBA overnight error:', err))
  })

  // FRED: full refresh every day at 06:00 UTC (including on-demand series)
  cron.schedule('0 6 * * *', () => {
    const known = getAllKnownSeriesIds()
    const merged = [...new Set([...ALL_SERIES, ...known])]
    console.log(`[cron] 06:00 — refreshing ${merged.length} series…`)
    fetchAllSeries({ seriesList: merged }).catch(err => console.error('[cron] FRED error:', err))
    syncAllOnsSeries().catch(err => console.error('[cron] ONS error:', err))
    syncAllBoeSeries().catch(err => console.error('[cron] BoE error:', err))
    syncGiltYieldCurves().catch(err => console.error('[cron] Gilt YC error:', err))
    // UK sources with full-history republication — cheap no-ops until a new
    // reference month is published (UK HPI gates internally on data age).
    syncUkHpi().catch(err => console.error('[cron] UK HPI error:', err))
    syncHmrcReceipts().catch(err => console.error('[cron] HMRC receipts error:', err))
    syncPayeRti().catch(err => console.error('[cron] PAYE RTI error:', err))
    // Canada econ-model StatCan series (health check then incremental; most
    // days a no-op — CPI/LFS publish on fixed mid-month dates).
    verifyStatcanMetadata()
      .then(() => syncAllStatcanSeries())
      .catch(err => console.error('[cron] StatCan WDS error:', err))
    // Japan econ-model series (e-Stat health check + sync, BoJ, customs trade).
    verifyEstatMetadata()
      .then(() => syncAllEstatSeries())
      .catch(err => console.error('[cron] eStat generic error:', err))
    syncBojTsSeries().catch(err => console.error('[cron] BoJ-TS error:', err))
    syncJpTrade().catch(err => console.error('[cron] JP trade error:', err))
    // EU3 Eurostat series (health check then sync).
    verifyEurostatMetadata()
      .then(() => syncAllEurostatSeries())
      .catch(err => console.error('[cron] Eurostat error:', err))
    // ECB (HICP + euro-area unemployment) — macro collector, runs with ONS/BoE/FRED.
    // (The other macro collectors share this 06:00 slot; 03:00 is reserved for
    // overnight rates. Incremental sync is a no-op on days with no ECB release.)
    syncIncrementalEcb().catch(err => console.error('[cron] ECB error:', err))
    // StatCan (Canadian CPI + unemployment) — macro collector, shares the 06:00
    // slot. CPI publishes mid-month for the prior month, so most days are no-ops.
    syncIncrementalStatcan().catch(err => console.error('[cron] StatCan error:', err))
    // e-Stat (Japanese CPI + unemployment) — macro collector, shares the 06:00
    // slot. CPI publishes mid-late month for the prior month; no-op most days.
    syncIncrementalEstat().catch(err => console.error('[cron] e-Stat error:', err))
    // ABS (Australian CPI monthly + quarterly + unemployment) — macro collector,
    // shares the 06:00 slot. CPI/LFS publish with multi-week lags; no-op most days.
    syncIncrementalAbs().catch(err => console.error('[cron] ABS error:', err))
  })

  // News: refresh at 06:00 and 21:00 UTC
  cron.schedule('0 6 * * *', () => {
    console.log('[cron] 06:00 — running news ingest…')
    fetchAndIngestNews().catch(err => console.error('[cron] News error:', err))
  })
  cron.schedule('0 21 * * *', () => {
    console.log('[cron] 21:00 — running news ingest…')
    fetchAndIngestNews().catch(err => console.error('[cron] News error:', err))
  })

  // Economic Data Log: daily scrape of the Trading Economics calendar at 23:00
  // UTC (matches the repo's UTC cron convention). Idempotent — fills in `actual`
  // values for releases that printed during the day. Non-fatal on failure here;
  // the standalone runner is what surfaces a hard failure (exit non-zero).
  cron.schedule('0 23 * * *', () => {
    console.log('[cron] 23:00 — running economic calendar scrape…')
    syncEconomicCalendar().catch(err => console.error('[cron] Economic calendar error:', err))
  })

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
    startTvCsvWatcher()
  })
}

// Graceful shutdown
process.on('SIGTERM', () => { stopTvCsvWatcher(); process.exit(0) })
process.on('SIGINT', () => { stopTvCsvWatcher(); process.exit(0) })

startup().catch(err => {
  console.error('[startup] Fatal error:', err)
  process.exit(1)
})
