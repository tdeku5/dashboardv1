import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cron from 'node-cron'
import { fredRouter } from './routes/fred'
import { newsRouter } from './routes/news'
import { isDatabaseEmpty, getStaleSeries, db } from './db'
import { fetchAllSeries, ALL_SERIES, STALE_HOURS } from './fetchAllSeries'
import { fetchAndIngestNews } from './newsFetcher'

dotenv.config({ path: '../.env' })

const app  = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

app.use('/api/fred',  fredRouter)
app.use('/api/news',  newsRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  if (isDatabaseEmpty()) {
    console.log('[startup] Database is empty — running initial fetch (this may take ~1 min)…')
    await fetchAllSeries({ force: true })
    console.log('[startup] Initial fetch complete.')
  } else {
    const stale = getStaleSeries(STALE_HOURS, ALL_SERIES)
    if (stale.length > 0) {
      console.log(`[startup] ${stale.length} series are stale — refreshing in background…`)
      fetchAllSeries({ seriesList: stale }).catch(err =>
        console.error('[startup] Background refresh error:', err)
      )
    } else {
      console.log('[startup] All series are current.')
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

  // FRED: full refresh every day at 06:00 UTC
  cron.schedule('0 6 * * *', () => {
    console.log('[cron] 06:00 — running scheduled FRED refresh…')
    fetchAllSeries().catch(err => console.error('[cron] FRED error:', err))
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
