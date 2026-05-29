# Economic Data Log — Feature Guide

The **Economic Data Log** scrapes the [Trading Economics economic calendar](https://tradingeconomics.com/calendar), parses it with Claude, stores releases in SQLite, classifies each release's surprise against a rule set, and surfaces it all in a terminal view (dropdown → **Economic Data Log**, route `/economic-log`).

---

## Pipeline at a glance

```
Firecrawl scrape ──▶ Claude parse ──▶ SQLite upsert ──▶ surprise classify
 (TE calendar)       (markdown→JSON)   (economic_releases)  (rules → label)
```

1. **Scrape** — `server/src/economicCalendar/firecrawlScrape.ts`. Uses the `@mendable/firecrawl-js` SDK (`FIRECRAWL_API_KEY` from root `.env`) to fetch `https://tradingeconomics.com/calendar?importance=2` as markdown + HTML with `onlyMainContent`, the **stealth proxy** (TE is client-rendered and bot-sensitive), and a Firecrawl **`actions`** sequence that drives the window (below). One retry after a **5-minute backoff**; if both attempts fail it throws loudly.
2. **Parse** — `parseReleases.ts`. The scraped markdown is sent to **`claude-opus-4-7`** with a structured-output prompt; the returned JSON is validated against the canonical schema before anything is persisted. **This LLM step is the resilience layer** — it survives TE markup changes that would break CSS selectors, so there is deliberately **no selector fallback**. The call **streams** (`messages.stream().finalMessage()`) with `max_tokens: 64000` — a full month of medium+high watchlist releases is several hundred rows; streaming is also required because that `max_tokens` trips the SDK's non-streaming 10-minute guard. Truncation (a too-small `max_tokens`) leaves an unterminated array and fails loudly.
3. **Categorize** — `categorize.ts`. Each parsed event is mapped to one `category` (below) at ingestion.
4. **Persist** — `db.ts` `upsertEconomicReleases()`. Upsert keyed on `(release_date, country, event)`, so re-running fills in `actual`/`category` without duplicating rows (idempotent; back-fills are safe). A changed `actual` clears the stored `surprise` so it gets re-classified.
5. **Classify surprise** — `classifySurprise.ts` + `ruleLookup.ts`. Each release is labelled `cold | cool | in line | warm | hot`, or `unclassified` (no rule), or `NULL` (rule exists but the print isn't out yet — distinct from unclassified).

Watchlist (normalized in `countries.ts`): United States, United Kingdom, Eurozone, Germany, France, Japan, China, Australia, Canada. Off-watchlist rows are dropped. Importance floor = **2 (medium + high)** — `importance=1` (all levels) floods a full-month window with minor auctions/holidays and overruns a single parse, so it's deliberately not scraped. Native importance (1–3) is stored per row and surfaced as the **Impact** column.

### Horizon (rolling, gap-free)

The public calendar's default GET view renders only ~10 days, TE ignores URL date params, and its custom-range datepicker resists synthetic events. But TE's **own range dropdown options reload the calendar reliably**, so the scraper clicks them via an `executeJavascript` action. The orchestrator (`index.ts`, `SCRAPE_RANGES`) scrapes **"This Month" + "Next Month"** and merges on the row key → continuous coverage from the start of the current month through the end of the next (≈ today + 5 weeks). This **rolls automatically** each run (always current + next month) and is gap-free (unlike "this week + next month", which gaps mid-month). Each range is scraped + parsed independently, in parallel, then merged.

### Schedule & manual runs

- **Cron:** daily at **23:00 UTC** (`server/src/index.ts`), matching the repo's UTC cron convention. Idempotent.
- **First run:** the server scrapes once on startup only if `economic_releases` is empty (avoids burning Firecrawl/Claude credits on every restart).
- **Manual (CLI):** `npm run econ-calendar` (from `server/`) — runs the full pipeline and **exits non-zero on failure** (for a cron wrapper / CI to catch breakage within a day).
- **Manual (UI):** the **↻ Refresh now** button in the view header runs the same full pipeline via `POST /api/economic-calendar/refresh` (guarded against concurrent runs) and then re-reads the DB so the table updates. While running it disables + shows a spinner ("Refreshing…") plus a "Fetching latest events…" status line; on success it shows a brief "Refreshed at HH:MM:SS · N events" toast (fades ~3s), on failure a persistent "Refresh failed: … — retry?". A **Last refreshed: HH:MM:SS (N min ago)** readout sits beside it (from `MAX(scraped_at)`; absolute time on hover). A hover tooltip explains the button.

---

## Surprise classification

A release's surprise is `s = (actual − expected) × direction`, bucketed by magnitude:

| `s` | Label |
|---|---|
| `|s| ≤ in_line_threshold` | **in line** |
| `0 < s`, `< hot_threshold` | **warm** |
| `s ≥ hot_threshold` | **hot** |
| `0 > s`, `> −hot_threshold` | **cool** |
| `s ≤ −hot_threshold` | **cold** |

- **`direction`** is `+1` when a higher-than-expected print is the "hot" (economically strong) outcome, `−1` for inverted indicators (unemployment, jobless claims — lower is hot).
- **`unit`** (`percent | thousands | absolute`) controls how the raw TE string is parsed (`"2.8%"` → 2.8, `"200K"` → 200, `"1.2M"` → 1200). Multi-horizon strings like `"0.2% MoM, 2.8% YoY"` use the **first/headline** figure.
- With five labels the active boundaries are `in_line_threshold` and `hot_threshold`; `warm_threshold` is the documented midpoint (reserved for shade gradation / a finer scale).

### Adding / editing rules

Rules live in two places, merged at classify time (DB wins on collision — see `ruleLookup.ts`):

1. **Static seeds** — `server/src/config/economicSurpriseRules.ts` (committed; the canonical starter set).
2. **Runtime rules** — the `economic_surprise_rules` SQLite table, added via the **Triage** tab in the UI (no redeploy).

**To classify an unknown event from the UI:** open the **Triage** tab. It lists every event with no rule (sourced from the DB, the same queue mirrored to `needs_classification.log`) with a sample value. Click **+ Rule**, set the thresholds, pick direction and unit (the unit is pre-guessed from the sample), and **Save**. The server upserts the rule and **re-classifies all stored rows immediately**, so the new labels appear on the data tabs at once.

> **Why the first runs show mostly "—" (unclassified):** the seed rule keys are canonical short names (`CPI`, `Initial Claims`) while Trading Economics emits verbose names (`Core Inflation Rate YoY Flash`, `Initial Jobless Claims`, `Chicago PMI`). Closing that gap is exactly what the Triage tab is for. Matching is exact (case/punctuation-insensitive) by design — fuzzy matching would mis-bucket releases.

API equivalents: `GET /api/economic-calendar/unclassified`, `GET/POST /api/economic-calendar/rules`, `DELETE /api/economic-calendar/rules/:event`.

---

## Event categories

Each event is assigned one `category` at ingestion by **`categorize.ts`** — a single function with an ordered regex table (first match wins). Categories: **Labor, Growth, Inflation, CB Speeches, Housing, Production, Trade, Consumption, Surveys**, plus **Other** (fallback). One category per event (no multi-tagging). Order matters, so specific patterns sit above general ones — e.g. "GDP Price Index" → Inflation before generic "GDP" → Growth; "Manufacturing PMI" → Surveys before Production; "Consumer Confidence" → Consumption while "Consumer Sentiment" → Surveys.

Unmatched events become **Other** and log a one-time `[econ-calendar] Uncategorized event → 'Other'` warning. To extend coverage, add a rule to the `RULES` array in `categorize.ts` — it applies on the next scrape/refresh (and `backfillMissingCategories()` fills `category` for legacy rows on startup). Don't aim for exhaustive; scan the **Other** category periodically and add patterns for what shows up.

---

## UI (`/economic-log`)

Two tabs: **Calendar** (default) and **Triage**.

**Calendar** — a date-windowed table with a left filter sidebar:
- **Date range:** quick buttons (This Week · Next Week · This Month · Next Month · Thru Jun 30, default This Week) plus From/To date pickers. The window is fetched server-side; the picker overrides the quick-select.
- **Columns:** Week · Day · Country · **Category** · Event · Expected · Actual · Surprise · **Impact**. Week/Day use merged cells (shown once per week/day); each row carries a **very faint country-color background tint** (~7%, darkening slightly on hover) for at-a-glance country grouping — palette in `lib/economicCalendar.ts` (`countryHex`/`countryTint`), reused from the Global Policy Paths section. Surprise badges colored cold=red → hot=green (unclassified=muted gray). Impact = native importance as Low/Medium/High.
- **Filter sidebar:** three collapsible sections — **Categories** (the 9 + Other), **Countries** (generated dynamically from the loaded events, watchlist-ordered), **Impact** (native levels present). All boxes default checked; unchecking removes matching rows instantly (client-side, no apply button). A **Reset Filters** button restores all.

**Triage** — the surprise-rule classification queue (see above), unchanged.

A **stale banner** appears when the latest `scraped_at` is more than **36 hours** old. The view queries the DB at render time (no client cache). The COLD/COOL/IN LINE/WARM/HOT/UNCLASSIFIED legend sits above the table.

---

## Runbook: when scrapes start failing

Trading Economics changes its markup periodically and occasionally blocks scrapers. Symptoms and fixes:

1. **Where to look first.** The standalone runner (`npm run econ-calendar`) exits non-zero and logs `[econ-calendar]` errors. On a parse failure the **raw scrape is dumped** to `server/econ-calendar-failed-scrape-<ts>.md` (gitignored) — open it to see what TE actually returned.
2. **Empty / blocked scrape** (`Firecrawl returned empty markdown`, or the dump is a captcha/consent page): TE blocked the request. The stealth proxy + retry usually recover; re-run `npm run econ-calendar`. Confirm `FIRECRAWL_API_KEY` is set and has credit.
3. **Parse produced 0 valid releases** / **No JSON array found**: the markup changed enough that Claude's output didn't validate, *or* the response **truncated** (`stop_reason: max_tokens` — the dumped text starts with `[` but has no closing `]`). The LLM parse normally adapts to markup changes on its own; just re-run. If a window legitimately grew past the limit, raise `max_tokens` in `parseReleases.ts` (currently 64000, streamed). Re-confirm the scrape stays at `importance=2` — scraping all levels over a month reliably overruns the parse.
4. **Rows land but everything is `unclassified`**: not a scrape failure — the events need surprise rules. Use the **Triage** tab. (Note: that's the temperature classification; the `category` column is separate and populated by `categorize.ts`.)
5. **Lots of events show category `Other`**: extend the `RULES` table in `categorize.ts` — scan the warnings (`Uncategorized event → 'Other'`) for the names to add.
6. **Do _not_ add CSS-selector parsing as a "more reliable" fallback.** For this site it isn't; the LLM parse is the intended resilience layer.

### Key files

| Concern | File |
|---|---|
| Scrape (+ horizon ranges) | `server/src/economicCalendar/firecrawlScrape.ts` |
| Parse (LLM) | `server/src/economicCalendar/parseReleases.ts` |
| Category classifier | `server/src/economicCalendar/categorize.ts` |
| Surprise classify | `server/src/economicCalendar/classifySurprise.ts` |
| Seed rules | `server/src/config/economicSurpriseRules.ts` |
| Rule merge (seed + DB) | `server/src/economicCalendar/ruleLookup.ts` |
| Orchestrator + `reclassifyAll` | `server/src/economicCalendar/index.ts` |
| CLI runner | `server/src/scripts/runEconomicCalendar.ts` |
| Schema + helpers | `server/src/db.ts` (`economic_releases`, `economic_surprise_rules`) |
| API routes | `server/src/routes/economicCalendar.ts` |
| UI | `client/src/pages/EconomicDataLogPage.tsx` |
