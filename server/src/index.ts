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
import { syncIncrementalFredOvernight } from './overnightFred'
import { syncIncrementalBocOvernight } from './overnightBoc'
import { syncIncrementalBojOvernight } from './overnightBoj'
import { syncIncrementalRbaOvernight } from './overnightRba'
import { overnightRatesRouter } from './routes/overnightRates'

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
app.use('/api/tv/yield-curve', tvYieldCurveRouter)
app.use('/api/tv',           tvRouter)
app.use('/api/global',       globalRouter)
app.use('/api/uk/fundamental', ukFundamentalRouter)
app.use('/api/commodities',  commoditiesRouter)
app.use('/api/equities',     equitiesRouter)
app.use('/api/fx',           fxRouter)
app.use('/api/macro',        macroRouter)
app.use('/api/overnight-rates', overnightRatesRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  // One-time data migrations (gated by PRAGMA user_version, safe to call every start)
  try {
    runStaleTipCleanup()
  } catch (err) {
    console.error('[startup] Stale-tip cleanup error:', err)
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

  // BoE gilt yield curve sync (non-blocking)
  syncGiltYieldCurves().catch(err =>
    console.error('[startup] Gilt yield curve sync error:', err)
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
