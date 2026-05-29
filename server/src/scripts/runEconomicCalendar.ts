// Standalone runner for the Economic Data Log pipeline:
//   npm run econ-calendar   (from server/)   or   tsx src/scripts/runEconomicCalendar.ts
//
// Unlike the in-server cron (which logs failures non-fatally so a bad scrape
// can't take down the terminal backend), this entrypoint EXITS NON-ZERO if the
// scrape/parse fails both attempts — so a cron wrapper or CI catches the break
// within a day, as required.

import { syncEconomicCalendar } from '../economicCalendar'

syncEconomicCalendar()
  .then(result => {
    console.log(`[econ-calendar] Done: ${JSON.stringify(result)}`)
    process.exit(0)
  })
  .catch(err => {
    console.error('[econ-calendar] FATAL — pipeline failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
