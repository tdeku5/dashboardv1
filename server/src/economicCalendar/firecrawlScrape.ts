// Firecrawl scraper for the Trading Economics economic calendar. Uses the
// @mendable/firecrawl-js SDK (FIRECRAWL_API_KEY from the root .env). One retry
// with a 5-minute backoff; if both attempts fail it throws loudly — the
// orchestrator decides whether that exits the process (standalone run) or is
// logged non-fatally (server cron). Stealth proxy + waitFor handle TE's
// client-rendered, bot-sensitive calendar.
//
// HORIZON: the public calendar's default GET view only renders ~10 days. TE
// ignores URL date params and resists synthetic datepicker events, but its own
// range dropdown options ("This Month" / "Next Month") DO reload the calendar
// reliably. So to widen the window we click TE's native option via an
// executeJavascript action and let its handler refetch. The orchestrator scrapes
// "This Month" + "Next Month" and merges → gap-free coverage from the start of
// the current month through the end of the next (≈ today + 5 weeks, rolling).

import Firecrawl from '@mendable/firecrawl-js'

const CALENDAR_BASE = 'https://tradingeconomics.com/calendar'
const RETRY_BACKOFF_MS = 5 * 60_000   // 5 minutes
const WAIT_FOR_MS = 3000

// TE range dropdown labels we drive (verbatim, as they appear in TE's own range
// dropdown: Recent, Today, Tomorrow, This Week, Next Week, This Month, Next
// Month, Yesterday, Previous Week, Previous Month, Custom). 'This Week' is the
// default view (no action). 'Previous Month' is the trailing range that lets a
// run re-scrape recently-released events so their actuals get filled in — see
// SCRAPE_RANGES in index.ts.
export type CalendarRange = 'This Week' | 'This Month' | 'Next Month' | 'Previous Month'

export interface ScrapeResult {
  markdown: string
  html: string
  url: string
  range: CalendarRange
  scrapedAt: string
}

// Minimal shape of the Firecrawl client we depend on (for test injection).
export interface FirecrawlLike {
  scrape(url: string, options: unknown): Promise<{ markdown?: string; html?: string }>
}

// Importance is passed as a query param to narrow the payload server-side.
// importance=2 = medium + high (the economically meaningful releases). We
// deliberately do NOT scrape importance=1: over a full-month window the low tier
// (bond auctions, minor surveys, holidays) balloons the event count past what a
// single Claude parse can emit, and floods the calendar with noise. The Impact
// filter therefore offers the native levels present (Medium / High).
export function buildCalendarUrl(importance: number): string {
  const params = new URLSearchParams({ importance: String(importance) })
  return `${CALENDAR_BASE}?${params.toString()}`
}

// Firecrawl actions that select a TE range by clicking its native dropdown
// option (its click handler reloads the calendar). 'This Week' is the default —
// no action needed.
function rangeActions(range: CalendarRange): unknown[] {
  if (range === 'This Week') return [{ type: 'wait', milliseconds: WAIT_FOR_MS }]
  const script = `(function(){
    var a=[].slice.call(document.querySelectorAll('li.te-c-option a')).find(function(x){return x.textContent.trim()==='${range}';});
    if(a){a.click();}
  })();`
  return [
    { type: 'wait', milliseconds: WAIT_FOR_MS },
    { type: 'executeJavascript', script },
    { type: 'wait', milliseconds: 6000 },   // let TE's AJAX repaint the table
  ]
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface ScrapeOpts {
  importance?: number
  range?: CalendarRange
  client?: FirecrawlLike
  backoffMs?: number      // overridable for tests
}

async function scrapeOnce(client: FirecrawlLike, url: string, range: CalendarRange): Promise<ScrapeResult> {
  const doc = await client.scrape(url, {
    formats: ['markdown', 'html'],
    onlyMainContent: true,
    proxy: 'stealth',
    actions: rangeActions(range),
  })
  const markdown = doc.markdown ?? ''
  if (markdown.trim() === '') throw new Error('Firecrawl returned empty markdown')
  return { markdown, html: doc.html ?? '', url, range, scrapedAt: new Date().toISOString() }
}

// Scrapes one calendar range with one retry after a backoff. Throws if both
// attempts fail (loud — caller logs/exits).
export async function scrapeCalendar(opts: ScrapeOpts = {}): Promise<ScrapeResult> {
  const importance = opts.importance ?? 2
  const range = opts.range ?? 'This Week'
  const backoffMs = opts.backoffMs ?? RETRY_BACKOFF_MS
  const url = buildCalendarUrl(importance)

  let client = opts.client
  if (!client) {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set')
    client = new Firecrawl({ apiKey }) as unknown as FirecrawlLike
  }

  try {
    return await scrapeOnce(client, url, range)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[econ-calendar] Scrape attempt 1 (${range}) failed: ${msg} — retrying in ${Math.round(backoffMs / 1000)}s`)
    await sleep(backoffMs)
    try {
      return await scrapeOnce(client, url, range)
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2)
      console.error(`[econ-calendar] Scrape attempt 2 (${range}) failed: ${msg2} — giving up`)
      throw new Error(`Trading Economics scrape (${range}) failed twice: ${msg2}`)
    }
  }
}
