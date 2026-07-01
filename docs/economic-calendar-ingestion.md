# Economic Calendar — Ingestion & Data Behavior

_Last updated: 2026-07-01 by Claude Code — added the `Previous Month` trailing range, a non-destructive upsert, and the `econ-backfill` script._

A practical reference for how the Economic Calendar's data actually gets in, when, with what filters, and what's kept. Read this before changing the ingestion pipeline or wondering "where did that row come from."

## Auto-update schedule

**Yes, auto-update is configured** via in-process `node-cron`, registered in `server/src/index.ts` inside `startup()`:

```ts
cron.schedule('0 23 * * *', () => {
  console.log('[cron] 23:00 — running economic calendar scrape…')
  syncEconomicCalendar().catch(err => console.error('[cron] Economic calendar error:', err))
})
```

So the pipeline runs **daily at 23:00 UTC**. This matches the repo's all-UTC cron convention (the other syncs run at 03:00 and 06:00 UTC). On a fresh start, an additional one-shot sync also fires when the `economic_releases` table is empty — guarded so it doesn't burn credits on every dev restart:

```ts
if (releaseCount === 0) syncEconomicCalendar().catch(…)
```

**Per-run window:** `syncEconomicCalendar` (in `server/src/economicCalendar/index.ts`) scrapes **three TE calendar ranges** and merges them:

```ts
const TRAILING_RANGE: CalendarRange = 'Previous Month'
const SCRAPE_RANGES: CalendarRange[] = [TRAILING_RANGE, 'This Month', 'Next Month']
```

This gives gap-free coverage from the **start of last month** through the end of the next — roughly **today − 4 weeks … today + 5 weeks**, rolling forward automatically.

**Why the trailing `Previous Month`:** `This Month + Next Month` alone is forward-only, so a released event's `actual` (which TE posts *after* the print) was only captured while the event was still in the forward window. At a **month boundary** — e.g. viewing on July 1, when `This Month`=July and `Next Month`=August — all of late June had already rolled out of scope, so its actuals (and any late-published forecasts) were never re-scraped and stayed blank. `Previous Month` is the **trailing lookback**: it re-scrapes the whole prior month every run so recently-released events get their actuals filled onto the existing rows. (TE's date-range dropdown really does offer `Previous Month` / `Previous Week` / `Yesterday` — the earlier forward-only design simply never used a backward one.)

The three ranges are scraped in parallel (`Promise.allSettled` — a range that fails to scrape/parse is logged and **skipped**, not fatal, so one bad TE pull can't abort the run or blank good data; only if *all* ranges fail does the run throw and keep existing DB data), each parsed by its own streaming Claude call, then merged on the `(release_date, country, event)` key. The "why two month ranges and not a URL date param" story is in [`economic-data-log-guide.md`](economic-data-log-guide.md#horizon-rolling-gap-free): TE ignores URL date params and resists synthetic datepicker events, but clicking its native "Next Month" dropdown option via a Firecrawl `executeJavascript` action reliably switches the rendered window.

**Volume per run (today's snapshot, 2026-05-28):**

- Total in DB: **656 rows**, spanning 2026-05-01 → 2026-07-01, across all 9 watchlist countries (US, UK, Eurozone, Germany, France, Japan, China, Australia, Canada).
- A single live sync run took ~3 minutes (two Firecrawl scrapes, two Opus streaming parses) and upserted **615 rows** (the May + June 2026 windows, after the importance ≥ 2 floor — see Q3 below).
- Per month, expect roughly **250–350 watchlist events at medium + high impact**. Two-month window → ~500–650 rows per run, most of which are re-upserts of unchanged rows.

The Refresh Now button shares this exact pipeline (see [Refresh Now button behavior](#refresh-now-button-behavior) below).

## Historical data persistence

**Yes, all ingested event data persists permanently. No code change was needed — persistence was already the design.**

The ingestion pipeline never deletes from `economic_releases`. There is no `DELETE`, no `TRUNCATE`, no rolling-window retention, no "drop and reload" anywhere — verified by `grep -rn 'DELETE.*economic_releases'` returning nothing. Every persistence operation goes through `upsertEconomicReleases()` (in `server/src/db.ts`), which is a pure `INSERT … ON CONFLICT … DO UPDATE`:

```sql
INSERT INTO economic_releases
  (release_date, day_of_week, country, event, category, expected, actual, previous, importance, scraped_at)
VALUES (…)
ON CONFLICT(release_date, country, event) DO UPDATE SET
  day_of_week      = excluded.day_of_week,
  reference_period = COALESCE(excluded.reference_period, economic_releases.reference_period),
  category         = excluded.category,
  -- Non-destructive: a blank re-scrape never clobbers a populated value.
  expected         = COALESCE(NULLIF(excluded.expected, ''), economic_releases.expected),
  previous         = COALESCE(NULLIF(excluded.previous, ''), economic_releases.previous),
  importance       = excluded.importance,
  scraped_at       = excluded.scraped_at,
  surprise         = CASE WHEN NULLIF(excluded.actual, '') IS NOT NULL
                           AND economic_releases.actual IS NOT excluded.actual
                          THEN NULL ELSE economic_releases.surprise END,
  actual           = COALESCE(NULLIF(excluded.actual, ''), economic_releases.actual)
```

The key mechanics:

- **Primary key `(release_date, country, event)`** uniquely identifies an event across re-pulls. Re-scraping the same event today vs. tomorrow lands on the same row, not a new one.
- **The Actual flows forward.** When an event transitions from upcoming (no Actual) to released (Actual populated), the next sync's upsert fills it. Once captured, that Actual is what's stored.
- **Non-destructive.** `expected`/`actual`/`previous` use `COALESCE(NULLIF(excluded, ''), stored)` — a re-scrape that returns a **blank** value (common when TE's `Previous Month` view drops the forecast/actual for an aged row) **never blanks a populated value**. This is what makes the trailing `Previous Month` re-scrape safe.
- **A changed non-blank Actual nulls `surprise`** on the same upsert (the `CASE` guards on `NULLIF(excluded.actual,'') IS NOT NULL`), so a *revised* actual triggers re-classification — but a blank re-scrape leaves both the actual and its surprise untouched.
- **Recently-passed events are re-scraped** for up to a month (the `Previous Month` trailing range), so their actuals fill in even after the print. Events older than that roll out of scope and stay frozen with whatever was last captured.

**Verification** (today): the table has rows back to 2026-05-01. A query for May 1–15 returns events with their final Actuals (e.g. US ISM Manufacturing PMI: expected 53, actual 52.7). The Calendar's date range controls (From/To pickers, "This Week"/"Next Week"/etc. buttons) can navigate to any window the user types — past or future — and the table will populate from whatever's stored. There is no future-only restriction in `getEconomicReleases` (the filter is just `release_date BETWEEN startDate AND endDate`).

**Trade-off worth knowing:** because past events are not re-scraped, **late upstream revisions are not captured**. If TE revises a payrolls Actual two months after the print, our DB keeps the original. This is acceptable for an "event log" use case; if revision history matters, that's a separate feature (re-scraping a wider window or pulling the TE historical API). Document this as a known limit, not a bug.

## Impact-level filtering

The requirement: ingest only **medium and high impact** events (TE 2★ and 3★). 1★ low-impact events should not enter the database.

**Star → dashboard mapping** (`importance` column, INTEGER):

| TE source | DB `importance` | UI Impact column |
|---|---|---|
| 3★ (high) | `3` | High |
| 2★ (medium) | `2` | Medium |
| 1★ (low) | `1` | Low — **excluded by policy** |

**Where the filter is applied (after this change):**

1. **At the source URL** (`firecrawlScrape.ts`): `?importance=2` tells TE to render its 2+ view. This is the primary, server-side filter and catches the bulk of low-impact events before they're scraped.
2. **Post-parse in the orchestrator** (`server/src/economicCalendar/index.ts`, `syncEconomicCalendar`): after merging the parsed ranges, rows are filtered with `if (r.importance < 2) continue` before persisting.

**A change was needed.** Before this prompt the pipeline relied only on the URL filter, and the orchestrator carried a (stale) comment claiming "all native impact levels are ingested." In practice that left a small leak: TE occasionally returns low-tier events even under a 2+ request — specifically the energy-stocks / mortgage-rate cluster (`API Crude Oil Stock Change`, `EIA Gasoline Stocks Change`, `MBA 30-Year Mortgage Rate`) — and Claude's parse correctly tagged those at `importance=1`. The DB ended up with **15 rows at importance=1** (all of that same cluster), which the post-parse floor now blocks. The existing 15 low-impact rows are preserved (per "don't delete existing data") and will simply age out over time; from this run forward, no new 1-star rows enter.

The Impact sidebar filter on the page is generated dynamically from the impact levels present in the loaded data, so it will show the `Low` option only while the 15 historical rows are within the visible date range. As they age out, the option naturally disappears.

## TRIAGE tab purpose

The TRIAGE tab is the **surprise-rule classification queue** — a small admin UI to fill in surprise rules for events the classifier doesn't yet know.

**What it actually does** (`TriageView` in `client/src/pages/EconomicDataLogPage.tsx`):

1. Fetches `/api/economic-calendar/unclassified` → a list of every distinct event name in the DB with `surprise = 'unclassified'` (no matching rule), with a sample country / expected / actual to inform unit and threshold choices.
2. Renders that list with a `+ Rule` button per row.
3. Clicking `+ Rule` opens an inline form pre-filled with the event name, where the user enters `in_line / warm / hot` thresholds, picks `direction` (+1 / −1 — inverted for unemployment, claims, etc.), and `unit` (`absolute` / `percent` / `thousands` — pre-guessed from the sample value).
4. Saving `POST`s to `/api/economic-calendar/rules`, which **upserts the rule into the `economic_surprise_rules` SQLite table and then runs `reclassifyAll()`** so every stored row in `economic_releases` is re-labelled against the merged rule set immediately. The event then disappears from the triage list.

The rule set is **merged at classify time** (`server/src/economicCalendar/ruleLookup.ts`): static TS seeds in `server/src/config/economicSurpriseRules.ts` are the canonical starter set, and DB rules override on key collision. This lets the user add coverage without a redeploy.

**Why the page needs a triage tab at all:** the seed rule names are canonical short forms (`CPI`, `Initial Claims`) while Trading Economics emits verbose names (`Core Inflation Rate YoY Flash`, `Initial Jobless Claims`, `Chicago PMI`). Most rows therefore land as `unclassified` on first ingestion. Closing the name-coverage gap is exactly what the triage tab is for. Matching is exact (case- and punctuation-insensitive) by design — fuzzy matching would mis-bucket releases.

Not to be confused with the `category` column, which is a separate single-function classifier (`server/src/economicCalendar/categorize.ts`) that runs at ingestion and is **not** managed via this tab.

## Refresh Now button behavior

The header's ↻ Refresh now button (top-right of the page) **runs the exact same pipeline as the cron**, on demand.

Implementation: `handleRefresh` in `EconomicDataLogPage.tsx` calls `triggerEconomicRefresh()` (in `client/src/lib/economicCalendar.ts`), which `POST`s to `/api/economic-calendar/refresh`. That route handler simply calls `syncEconomicCalendar()` with no arguments — so it uses the same default `SCRAPE_RANGES = ['Previous Month', 'This Month', 'Next Month']` and the same `importance ≥ 2` floor as the cron. There's a single-flight guard (`refreshInProgress`) that returns HTTP 409 if a refresh is already running.

So:

- **Date range:** identical to the cron — This Month + Next Month, ≈ today through end of next month.
- **Volume:** identical — ~500–650 upserts per click (most are no-op updates of unchanged rows).
- **What's different from the cron:** only the trigger (a click instead of 23:00 UTC) and the user feedback. The button disables and shows a spinner + status line ("Fetching latest events from Trading Economics…") while running, a 3-second auto-clearing toast on success ("Refreshed at HH:MM:SS · N events"), and a persistent red "Refresh failed: … — retry?" on failure. The "Last refreshed" timestamp beside the button reads from `MAX(scraped_at)` and updates on success.

Because the windows are identical, a Refresh Now never narrows the visible data — it can only fill in newly-published Actuals or revise category/importance for events already in the window. With the `Previous Month` trailing range now included, that window also covers all of last month, so a Refresh Now (or the nightly cron) **fills in actuals for recently-passed events** — including days that fell just before a month boundary.

**Observability:** each run logs the window scraped, ranges ok/failed, `upserted` split into `inserted` vs `updated`, `actualsFilled` (rows whose actual went blank→populated), and `parseLoss` (a >0 count means a parsed expected/actual failed to land — should always be 0). Watch `updated`/`actualsFilled` to confirm a run actually repaired past rows.

## One-off backfill script

`npm run econ-backfill` (in `server/`) repairs rows that predate the trailing-range fix (e.g. events that were frozen blank at an earlier month boundary).

- **Dry run (default):** scrapes `Previous Month`, parses, and prints the exact diff vs the DB (`would insert / update / fill actual / fill expected`) plus a sample — **writes nothing**. Review before applying.
- **`--apply`:** upserts the scraped rows via the same non-destructive upsert as the cron, then re-runs surprise classification. Idempotent; never deletes, duplicates, or blanks a populated value.
- **`--from-file <path>`:** parse+apply from a previously-captured TE markdown file instead of a live Firecrawl scrape — deterministic, and a fallback when Firecrawl's proxy is flaky.

## Data source

**Trading Economics economic calendar (`https://tradingeconomics.com/calendar`)**, scraped via the **Firecrawl API** (`@mendable/firecrawl-js`), with the rendered markdown parsed by **Claude Opus 4.7** (`claude-opus-4-7`) into a strict JSON schema.

- Auth: `FIRECRAWL_API_KEY` (Firecrawl) + `ANTHROPIC_API_KEY` (Claude) — both already present in the root `.env`.
- Firecrawl options: `formats: ['markdown','html']`, `onlyMainContent: true`, `proxy: 'stealth'`, plus an `actions` array that drives TE's own range dropdown (`executeJavascript` clicks its native "This Month" / "Next Month" option, then waits 6s for AJAX repaint).
- The parse step **streams** (`anthropic.messages.stream(…).finalMessage()`) with `max_tokens: 64000` — a month of medium+high releases is several hundred rows, and the SDK refuses non-streaming calls at that limit.
- This LLM parse is the resilience layer: TE markup changes are absorbed by Claude's structured extraction. There is deliberately **no CSS-selector fallback** — for this site, selectors are less reliable than the LLM read.

Failure handling: one retry after a 5-minute backoff at the Firecrawl level; if both attempts fail, the orchestrator throws loudly. The CLI runner (`npm run econ-calendar`) exits non-zero in that case. The Express cron logs the error non-fatally (so a bad scrape never takes down the terminal backend). On parse-validation failure the raw scrape is dumped to `server/econ-calendar-failed-scrape-<ts>.md` (gitignored) for diagnosis.

## Database schema

Table: **`economic_releases`** (SQLite, `fred_data.db` at repo root).

```sql
CREATE TABLE IF NOT EXISTS economic_releases (
  release_date TEXT NOT NULL,    -- ISO date, e.g. '2026-05-28'
  day_of_week  TEXT,             -- e.g. 'Wednesday'
  country      TEXT NOT NULL,    -- normalized watchlist string
  event        TEXT NOT NULL,    -- TE event name (verbose)
  category     TEXT,             -- one of CATEGORIES + 'Other'
  expected     TEXT,             -- raw TE string, e.g. '0.2% MoM, 2.8% YoY'
  actual       TEXT,             -- raw TE string; nullable until released
  previous     TEXT,
  importance   INTEGER,          -- 2 or 3 (1 excluded by policy)
  surprise     TEXT,             -- cold|cool|in line|warm|hot|unclassified
  scraped_at   TEXT NOT NULL,    -- ISO timestamp of most recent upsert
  PRIMARY KEY (release_date, country, event)
);

CREATE INDEX IF NOT EXISTS idx_economic_releases_date
  ON economic_releases(release_date DESC);
```

**Primary key:** `(release_date, country, event)`. This is the same key the orchestrator dedups on after merging the two range scrapes (`merged.set(\`${release_date}|${country}|${event}\`, r)`), so the dedup logic and the SQL upsert agree. The key is stable across re-pulls (TE event names are consistent enough that the same event lands on the same row day after day) and **no source-provided event ID is needed** — TE doesn't expose one cleanly through the calendar page.

**Auxiliary table** for runtime surprise rules added via the Triage tab:

```sql
CREATE TABLE IF NOT EXISTS economic_surprise_rules (
  event             TEXT PRIMARY KEY,
  in_line_threshold REAL NOT NULL,
  warm_threshold    REAL NOT NULL,
  hot_threshold     REAL NOT NULL,
  direction         INTEGER NOT NULL,   -- 1 or -1
  unit              TEXT NOT NULL,      -- 'absolute' | 'percent' | 'thousands'
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

User rules merge over the static TS seeds at classify time (see [TRIAGE tab purpose](#triage-tab-purpose) above).

## Known limitations / notes

- **Recent actuals now refresh; only *old* revisions are missed.** The scrape window is `Previous Month + This Month + Next Month`, so a released event is re-pulled for up to ~a month after its print and its actual fills in. A revision printed *two months* later (after the event ages out of `Previous Month`) still isn't captured — the DB shows the value current when the event was last in scope.
- **The `Low` impact UI option will show until the 15 historical 1★ rows age out.** They're preserved per the "don't delete existing data" rule; no new 1★ rows enter from this run forward.
- **TE date params don't work** — `?d1=…&d2=…` is ignored, and synthetic datepicker events don't trigger TE's AJAX. Driving its native dropdown options is the only reliable way to widen the window. If TE changes that DOM, the `rangeActions` JS in `firecrawlScrape.ts` is the place to fix.
- **`max_tokens` headroom is the parse fragility point.** A run with importance=1 over a full month exceeds 32000 output tokens (we hit `stop_reason: max_tokens` in testing); at importance=2 we're comfortably under 64000. If TE radically expands its medium+high coverage, watch the orchestrator logs for parse failures with that signature.
- **Deep history is not backfilled automatically.** A run captures whatever TE's `Previous / This / Next Month` currently shows; events older than the start of last month aren't pulled. TE's dropdown only reaches one month back (`Previous Month`), so there's no way to drive the LLM-parse pipeline further into the past. The `npm run econ-backfill` script exists to repair the recent past (last month) on demand.
- **Refresh Now and the cron share the same volume.** A Refresh Now click does not give you a wider window than the daily cron — both scrape the same `Previous + This + Next Month` span (~3 scrapes, ~750–950 rows, most no-op re-upserts).
