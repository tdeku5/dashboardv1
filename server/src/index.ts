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

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
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

  // Census trade end-use data sync (non-blocking)
  if (isCensusTradeStale()) {
    fetchAndStoreCensusTrade().catch(err =>
      console.error('[startup] Census trade ingestion error:', err)
    )
  }

  // FRED: full refresh every day at 06:00 UTC (including on-demand series)
  cron.schedule('0 6 * * *', () => {
    const known = getAllKnownSeriesIds()
    const merged = [...new Set([...ALL_SERIES, ...known])]
    console.log(`[cron] 06:00 — refreshing ${merged.length} series…`)
    fetchAllSeries({ seriesList: merged }).catch(err => console.error('[cron] FRED error:', err))
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
  })
}

startup().catch(err => {
  console.error('[startup] Fatal error:', err)
  process.exit(1)
})
