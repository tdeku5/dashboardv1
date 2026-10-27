# TV Completed Bars — Phase 0 Decisions and Phase 1 Go-Ahead

Phase 0 gate report reviewed. Proceed to **Phase 1** with the decisions below layered on the original spec (`tv-completed-bars-prompt.md`). Where they conflict, this document wins.

Save this file into `docs/prompts/` next to the original spec. Re-read both from disk at every phase boundary, from `docs/prompts/` and not a scratchpad copy.

---

## Answers to your five questions

### Q1 — Close table: confirmed with one edit

- **`CME_RATES` and `CME_ENERGY_METALS`: close = 16:30 America/Chicago** (not 16:00). This is a buffer for the post-close settlement revisions you observed.
- **Every other row is confirmed exactly as proposed**, including the low-confidence rows, `US_YIELDS` at 17:30 America/New_York, and the international equity closes.
- `BVOL` uses the conservative fallback, as proposed.
- **Crypto `24:00`:** support it as "end of the session date", i.e. 00:00 the following day in the zone. Do not parse it as an invalid hour.
- Keep the table in one registry module, in a shape I can edit by hand (one row per group: zone, close, a short basis note). The confidence notes from your Phase 0 table go in as comments.

### Q2 — `captured_at` = file mtime: confirmed

Add a code comment at the point of capture: copying a file into the drop folder with `cp` without `-p` resets its mtime to the copy time, so a stale export would be wrongly judged against the copy time. Make no behavioural change for this.

### Q3 — `INSERT OR REPLACE` → `INSERT … ON CONFLICT(key) DO UPDATE`: approved

- The update clause sets the value columns plus `source_file`, `ingested_at`, and `captured_at`.
- **Prove the stored values are identical:** in a **temp copy** of the database, re-ingest one archived file under the old statement and under the new one. Then compare row counts and a checksum over `(symbol, time, close)` for `tv_series` and `(symbol, timeframe, time, open, high, low, close, volume)` for `tv_ohlcv`. Paste both outputs.

### Q4 — SQL function approach: approved, with constraints

- Register `tv_bar_complete(symbol, time, captured_at)` through `db.function(...)`, backed by the **same** TypeScript `isBarComplete`. There must be one implementation, not two.
- **Fast path:** a capture at least 2 days after the bar's session date is complete. The fast path must be **proven safe from the registry, not asserted**. Add a test that computes the latest possible close, in UTC, across every registry group *and* the fallback, and asserts it falls before session date + 2 days 00:00 UTC. That way a future registry edit that breaks the fast path fails CI.
- **Performance:** in the Phase 2 gate, paste the before/after query timings for the three heaviest full-history readers (for example `breadth`, `crossAssetVol`, `getTvYieldHistoryFull`).

### Q5 — `us_rates_realized_vol`: accept the filtering, don't exempt it

Storing realized vol computed from a partial bar is exactly the error this change removes. In the Phase 1 gate, report whether that table's latest rows get **recomputed and upserted** on the next run, or whether rows built from partial bars would persist. Report only; do not delete anything (consistent with "leave existing bars to be overwritten").

---

## New decision — aligned as-of date per view

Phase 0 established that all 662 series share the US03MY chart's row dates, and that markets close at different times. Per-symbol filtering alone would let one table mix dates. For example, at Tuesday 12:00 CT DE and JP have closed but the US has not, so the Global Rates Summary would show Tuesday for DE/JP next to Monday for the US. Its 1D Δs would then cover different days.

**Decision: each view uses a single as-of date — the latest date that is complete for every market group the view shows.**

- **Group-level, not symbol-level.** For each market group `G`, define `latestComplete(G)` as the max `time` over rows of `G`'s symbols for which `tv_bar_complete` is true. Taking the max across the group means expired contracts and illiquid symbols can't drag a group's date backwards.
- **View as-of:** `viewAsOf = min(latestComplete(G))` over the groups the view uses.
- **Readers** then select with `time <= viewAsOf`, plus the completeness predicate. Keep the predicate for safety; it is cheap under the fast path.
- **Single-group views** (e.g. a single-country yield curve, a single STIR strip page) reduce to their own group's latest complete date, so a standalone JGB chart shows Tuesday at Tuesday noon.
- **Multi-group views** align. At Tuesday 12:00 CT, the Global Rates Summary shows Monday for every row, including its STIR strips and `curveDate`.

### Phase 1 additions for this
- Add a helper `viewAsOf(groups: MarketGroup[]): number | null`, plus `groupsForSymbols(symbols)` that uses the resolver.
- Tests:
  - At Tuesday 12:00 CT, the view {`US_YIELDS`, `EZ_YIELDS`, `JP_YIELDS`} resolves to Monday, and the view {`JP_YIELDS`} alone resolves to Tuesday.
  - A group whose only symbols are expired contracts must not determine the view date. Add a fixture with one expired symbol and one live symbol in the same group.

### Phase 2 additions for this
- For each of the 18 readers from Phase 0, the gate must state whether it is **single-group** or **multi-group**, and which groups it uses.
- Multi-group readers compute `viewAsOf` once per request and apply it to every symbol in the response.
- Where a response from `routes/tv.ts` (`/series`, `/ohlcv`) can carry several symbols in one request, align it per request. If a client page assembles a single view from several separate requests, report it. Do not try to align across requests in this change.
- `usRatesVol` (MOVE joined to realized vol) is a multi-group view: `ICE_MOVE` + `US_YIELDS`.

---

## Corrections to the original spec, from Phase 0 evidence

- **Next-day rows.** My expectation that a new-date row appears at the 17:00 CT CME reopen was wrong; the archive shows them appearing at roughly 20:15–21:43 CT. Keep the original "row dated Wednesday captured Tuesday 19:00 CT → incomplete" fixture, since the logic still holds if such a row exists. Also add the real case seen in the archive: a **Friday-dated row captured Thursday 21:43 CT is incomplete** for `US_YIELDS`, `CME_RATES`, `JP_YIELDS`, and `AU_YIELDS`.
- **Symbol resolver.** Symbols carry no exchange prefix, apart from `TSX:TSX`, so the resolver keys on ticker roots and exact names. Add a test that resolves **all 662 current symbols** from `tv_series`. Every symbol must map to a named group, except an explicit allowlist that goes to the fallback (currently `BVOL`). An unexpected fallback fails the test.
- **Allowlist of non-bar readers.** Approved as proposed: `catalogSearch`, the ingest-internal queries, `cleanStaleTips`, the two scripts, and the client test. They go on the guard test's allowlist.

---

## Phase 1 gate report — required evidence

In addition to the original spec's Phase 1 gate requirements:

1. The `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE` checksum comparison (Q3).
2. Fast-path safety test output (Q4).
3. Full-symbol resolver test output, with the fallback list (correction above).
4. `viewAsOf` test output, including the expired-symbol fixture.
5. The `us_rates_realized_vol` recompute finding (Q5).
6. A worked example on a real archived intraday capture (if one exists; otherwise a temp-database re-ingest with an overridden `captured_at`). Show `latestComplete(G)` for `US_YIELDS`, `EZ_YIELDS`, `JP_YIELDS`, `CME_RATES`, and the resulting `viewAsOf` for the Global Rates Summary's group set.

**STOP after Phase 1.**

---

## Acceptance criteria

- The registry matches the confirmed table, with CME groups at 16:30 CT, `24:00` handled, and DST correct through `Intl`.
- `captured_at` is taken from file mtime, and ingest uses `ON CONFLICT … DO UPDATE`, with stored values proven identical by checksum.
- One `isBarComplete` implementation backs both TypeScript and the `tv_bar_complete` SQL function, and the fast path is proven safe from the registry by a test.
- All 662 current symbols resolve, with only allowlisted symbols going to the fallback.
- `viewAsOf` aligns multi-group views to the latest date that is complete across their groups, and expired or illiquid symbols cannot pull a group's date back.
- With every `captured_at` still `NULL` (the current database), every reader's output is identical before and after.
- Every verification number is pasted from actual command output.

## What not to break

- Ingest picks up the same files and writes the same stored values; only the write mechanism and `captured_at` change.
- The date labels returned by every TV reader, including the Europe/London off-by-one convention.
- The existing stale-tip detection and `cleanStaleTips`.
- Global Rates Summary behaviour verified in the previous build (`curveDate`-anchored +6M/+12M, curve Δ, DE/FR/IT shared EUR path). With `NULL` `captured_at` the output must be identical.
- The `us_rates_realized_vol` table contents, until a normal recompute runs. No deletions.
- Non-TradingView data sources.

## Out of scope

- Deleting or rewriting existing partial bars, or backfilling `captured_at`.
- Aligning dates **across separate client requests** — report it, don't fix it.
- Changing any close time beyond the CME edit above without coming back to me.
- Settlement-vs-last-trade handling beyond the CME buffer.
- Exchange holiday calendars.
- Fixing the terminal-wide `tv_series.time` off-by-one.
- Any UI change, including as-of or freshness labels.
- New dependencies.
