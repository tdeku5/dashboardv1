# TradingView Data — Show Only Completed Daily Bars

## Context

TradingView daily data reaches the terminal through the filewatcher/fileparser pipeline (`tvCsvIngest.processFile`), which writes into `tv_series` / `tv_ohlcv`. The most recent bar in each export is whatever TradingView showed **at the moment I downloaded the file**. If I download intraday, the latest bar is an unfinished session, and its "close" is just the intraday price at download time. That price then shows on the dashboard as if it were a close.

**Goal:** the latest price the dashboard shows for any TradingView ticker must always be a **completed daily close**.

- Download Tuesday 12:00 CT → dashboard shows **Monday's** close.
- Download Tuesday 19:00 CT (after the relevant market has closed) → dashboard shows **Tuesday's** close.

### Decisions already made (do not revisit)

1. **Completeness is per market.** A bar counts as complete once *its own exchange's session* has closed, not by a calendar-date cutoff.
2. **Filter at read time.** Ingest keeps storing every bar, including unfinished ones. Readers exclude unfinished bars through one shared helper.
3. **No cleanup of existing rows.** Partial bars already in the database are left alone, and the next download's completed close upserts over them.

### The key design point: judge completeness against capture time, not read time

Because filtering happens at read time, the reader cannot compare a bar's session close against *now*. A bar captured Tuesday 12:00 still holds the 12:00 intraday price at Tuesday 19:00, even though Tuesday's session has since closed. Comparing against "now" would wrongly promote that stale intraday price to a close.

So completeness must be judged against **when the data was captured**:

> A bar is complete if and only if `sessionClose(symbol, sessionDate) <= captured_at`

That requires ingest to **record a capture timestamp on each bar**. The filter itself stays entirely at read time. When a later download upserts a bar, `captured_at` updates with it, so a bar first captured intraday becomes complete as soon as a post-close download refreshes it.

### Standing conventions that apply

- `tv_series.time` is a unix epoch at **midnight Europe/London**, so plain UTC truncation labels BST session bars a day early, and adding 3600 recovers the true session date. **Use the true session date (+3600) internally** to compute the session close. **Do not change the dates readers return**; the terminal-wide off-by-one fix is a separate job.
- Nothing derived from TradingView data is persisted. `captured_at` is raw capture metadata, not derived data, so storing it is fine.
- Upsert, never delete-and-reinsert.
- TypeScript strict, no `any`, reuse existing helpers. No new dependencies without asking me first.
- Re-read this file from disk at every phase boundary. Paste every verification number from actual command output.

---

## Phase 0 — Controlled inspection (read-only, no edits)

Produce a gate report covering each item below, with file paths, line references, and pasted output.

1. **Ingest path.** Quote `tvCsvIngest.processFile` and the filewatcher code that calls it. Show:
   - How the target table(s) and rows are written: the upsert statement and its conflict key.
   - Which timestamp is available for "when this file was downloaded": the file's mtime, the watcher event time, or ingest time. Say which you recommend for `captured_at` and why. My expectation is file mtime, since it stays correct if a file is reprocessed later; confirm or argue otherwise.
2. **Schema.** Paste the current schema of `tv_series` and `tv_ohlcv` and explain how the two relate (which one holds the bars). Propose the exact migration that adds `captured_at`: nullable, unix epoch seconds UTC. Follow the terminal's existing migration pattern.
3. **Session-date semantics, verified empirically.** For one symbol in each market group from item 4, show the raw `time` of the last few bars, the +3600 session date, and the weekday. Confirm what TradingView labels a CME futures daily bar after the 17:00 CT reopen. My expectation is that a download Tuesday 19:00 CT already contains a bar dated **Wednesday**. Show the evidence from an actual file on disk if one exists.
4. **Market grouping.** Group all symbols in `tv_series` by exchange or prefix (e.g. `CME`, `CBOT`, `ICEEUR`, `ICEUS`, `EUREX`, `TVC`, `ASX`, `OSE`, …), with a symbol count per group. For each group, propose:
   - the IANA timezone,
   - the session close time (local),
   - the source or reasoning for that close time.

   For `TVC` yield symbols (US/DE/FR/IT/GB/JP/AU/CA tenors), propose a close per country. These are cash-market composites, so note any uncertainty plainly; don't guess silently. Present this as a table for me to confirm or edit.
5. **Readers.** List **every** code path that reads `tv_series` / `tv_ohlcv`, including the 14 known TV-reading modules plus anything else a grep finds. For each, give the file, function, the query, and whether it reads "latest N bars", a date range, or a single as-of value.
6. **Timezone handling available.** Report what date/timezone tooling already exists in the server (e.g. `Intl`, luxon, date-fns-tz) and whether it handles DST via IANA zones. Recommend which one to use without adding a dependency.
7. **Current exposure.** For each market group, report how many symbols' **latest stored bar** has a session date equal to the date of the most recently ingested file. These are candidates for being partial. Just report the counts; there is no way to know for certain yet, and nothing should be deleted.

**STOP after Phase 0.** Wait for me to confirm or edit the close-time table and the `captured_at` timestamp source.

---

## Phase 1 — Capture timestamp and completeness helper (server)

### 1a. Migration
- Add `captured_at` (nullable integer, unix epoch seconds UTC) to the bar table(s) identified in Phase 0.
- Existing rows stay `NULL`. Do not backfill.

### 1b. Ingest writes `captured_at`
- `processFile` sets `captured_at` to the confirmed capture timestamp for every bar row it writes.
- On upsert conflict, update `captured_at` along with the OHLC values, so a later download refreshes both.
- Make no other change to what ingest stores. Unfinished bars are still written.

### 1c. Market close registry
- Add one registry module (single source of truth) that maps each market group to `{ timeZone, closeLocal: 'HH:MM' }`, using the table confirmed at the Phase 0 gate.
- Add a resolver from symbol to market group, keyed on whatever Phase 0 showed is reliable (exchange prefix or `tv_series` metadata).
- **Unknown symbol fallback (conservative):** treat the session as closing at 23:59 Pacific/Honolulu on the session date. That is later than every exchange close in the terminal, so an unknown symbol's same-day bar is only accepted from a capture after that moment. Log once per symbol at warn level.

### 1d. Completeness helper
- `isBarComplete(symbol, barTime, capturedAt): boolean`
  - `sessionDate` = the true session date from `barTime + 3600`.
  - `sessionClose` = `sessionDate` at `closeLocal` in `timeZone`, converted to an epoch. Must be DST-correct.
  - Return `capturedAt != null ? sessionClose <= capturedAt : true`.
- **`captured_at IS NULL` means the bar is complete (legacy rows).** This is what implements "leave existing bars to be overwritten." Document it in a code comment.
- Also provide a query-level form for SQL readers, e.g. a function that filters a fetched row set, or a reusable SQL fragment if Phase 0 shows readers are pure SQL. Use whichever fits the readers as found. The semantics must be identical to `isBarComplete`.

### 1e. Tests
Fixture cases, each asserting complete or incomplete:
- CME futures bar for Tuesday, captured Tuesday 12:00 CT → **incomplete**.
- The same bar captured Tuesday 19:00 CT → **complete**.
- CME bar dated **Wednesday** (post-reopen), captured Tuesday 19:00 CT → **incomplete**.
- A European symbol: a bar captured on the session date at 12:00 CT (after the European close) → **complete**.
- A JGB/Australian symbol where the session closed hours before a same-day morning capture in CT → **complete**.
- DST boundary: a capture on the day after a US or European clock change still resolves correctly.
- `captured_at = NULL` → **complete**.
- An unknown symbol uses the fallback and logs once.
- Re-ingesting a later file updates `captured_at` (integration test against a temp SQLite database).

**STOP after Phase 1.** The gate report includes pasted test output, the migration SQL, and a real example: one symbol's last 3 rows with `captured_at` populated after a manual re-ingest of a file on disk, plus `isBarComplete` evaluated on each.

---

## Phase 2 — Route all readers through the helper

- Update every reader listed in Phase 0, item 5, so that bars failing `isBarComplete` are excluded **before** any "latest", lookback-index, or as-of selection. Example: "latest 21 rows" means the latest 21 *complete* rows; an incomplete bar must not consume a slot.
- Readers keep returning the same date labels they return today; only rows are filtered.
- If any reader cannot sensibly use the helper, stop and report it rather than working around it.
- Add a guard test that fails if a new raw query against `tv_series` / `tv_ohlcv` appears outside the approved helper or readers list. Use whatever mechanism fits the codebase: a grep-based test or an import boundary.

### Verification
1. Take a file I downloaded intraday, or, if none is on disk, simulate one by re-ingesting an existing file with `captured_at` overridden to an intraday time **in a temp copy of the database only**. Show for three symbols (one CME, one European yield, one JGB/AU) that:
   - the stored latest bar is the unfinished session, and
   - every page or route that reads it now returns the prior session's close.
2. Re-run the global rates summary route and the US rates pages. Paste the latest-bar date each uses before and after.
3. Show that a real database with all-`NULL` `captured_at` returns **exactly the same output as before** for every reader: a before/after diff on the main routes.

**STOP after Phase 2.**

---

## Phase 3 — Verify and commit

1. Server and client typecheck and full test suites; paste the output. No lint script exists; say so.
2. Commits, explicit path staging only (`git add -A` prohibited):
   - Commit 1: migration, ingest change, registry, helper, and their tests. Must be green on its own.
   - Commit 2: reader changes and the guard test.
3. Paste `git show --stat` for both commits and `git status --short`.

---

## Acceptance criteria

- Every TV bar written by ingest from now on carries `captured_at`, and upserts refresh it.
- A bar is shown only if its market's session close is at or before its `captured_at`. Legacy `NULL` rows are treated as complete.
- An intraday download (e.g. Tuesday 12:00 CT) makes every reader show the prior completed close. A post-close download (Tuesday 19:00 CT) shows that day's close for markets that have closed, and CME bars dated the next session are excluded.
- Close times come from one registry confirmed by me at the Phase 0 gate, are DST-correct via IANA zones, and unknown symbols use the conservative fallback with a warn log.
- Every reader goes through the helper, and a guard test enforces it.
- With the current all-`NULL` database, all reader outputs are identical before and after.
- All verification numbers are pasted from actual command output.

## What not to break

- The ingest pipeline's existing behaviour: same files picked up, same rows written, same upsert key. The only addition is `captured_at`.
- Date labels returned by every TV reader, including the existing Europe/London off-by-one convention.
- The Global Rates Summary (`curveDate`, the +6M/+12M forward columns, curve Δ), the US Rates VOL realized-MOVE work, STIR strip pages, and Hephaestus series reads. Each must still render, and with `NULL` `captured_at` must render identically.
- Compute-on-read: no derived TV values get persisted.
- Non-TradingView data sources (FRED, ECB, BoE, ONS, etc.).

## Out of scope

- Deleting or rewriting existing partial bars (decided: leave them to be overwritten).
- Backfilling `captured_at` for historical rows.
- Fixing the terminal-wide `tv_series.time` UTC/London off-by-one.
- Exchange holiday calendars. A missing session simply has no bar.
- Settlement-vs-last-trade differences in TradingView's daily close.
- Showing an intraday or "live" price anywhere in the UI.
- Any UI indicator of data freshness or as-of time.
- Adding new dependencies.
