# TV Completed Bars — Phase 1 Rulings and Phase 2 Go-Ahead

Phase 1 gate report reviewed. The registry, `isBarComplete`, the fast-path proof, the full-symbol resolver, the upsert checksum comparison, and the `us_rates_realized_vol` finding are all accepted. Caching `viewAsOf` until the next ingest is correct: completeness depends on `captured_at`, not wall-clock time, so the answer cannot change between ingests.

Two rulings below change Phase 1 code. Apply them, commit, then proceed to Phase 2. Save this file to `docs/prompts/` and re-read all three spec files from disk first.

---

## R1 — Redefine `viewAsOf`: holidays must not block a view

**This corrects my own design from the Phase 0 decisions document.** Your note that NIFTY50's missing 20 Oct bar holds every NSE view at 19 Oct exposed a flaw in the min-of-`latestComplete` rule. A market that **didn't trade** on a date has no bar, so its `latestComplete` stalls on its last trading day, and every view including it stalls too. That stall lasts a day for a single holiday and a whole week for China's Golden Week (`CN_YIELDS`). That isn't what alignment is for. Alignment should only wait on bars that **exist but aren't finished yet**.

### New definition

- A group **blocks** a date only if it has an **incomplete row** at that date. A missing row (holiday, no trade) never blocks.
- For each group `G` in the view, `firstIncomplete(G)` = the earliest `time` of any row of `G`'s symbols where `tv_bar_complete` is false, or none if no such row exists.
- `frontier` = min of `firstIncomplete(G)` over the view's groups (ignoring groups with none).
- `viewAsOf` = the latest row `time` that exists in the table and is **strictly earlier than `frontier`**. If there is no frontier, it is the latest row `time` overall for the view's symbols.
- Readers are unchanged from the Phase 0 decisions: `time <= viewAsOf` plus the completeness predicate. A market on holiday at `viewAsOf` therefore shows its last close on or before that date, which is the right value.

### Why this is also stricter where it matters

- **Mixed-time downloads.** If the two files (`US03MY`, `US01MY`) are ever downloaded at different times, any incomplete row in a group blocks that date for the whole view. The max-over-symbols rule could not guarantee that.
- **Expired contracts and stale carries** still cannot pull a view backwards. Their rows are old and complete, so they never block.
- **Legacy `NULL` rows** never block, as before (`NULL` = complete).

### Performance

Incomplete rows can only sit near a group's most recent capture, so you may bound the `firstIncomplete` scan by a window derived from the registry's fast-path limit, measured from the group's max `captured_at`. Any such bound must come with a test proving it gives the same answer as the unbounded scan on fixtures.

### Tests

Replace or extend the Phase 1 `viewAsOf` tests:

1. **Holiday:** view {`US_EQUITY`, `NSE`} captured Tue 20 Oct after both closes, where NSE has no 20 Oct row → `viewAsOf` = **Tue 20 Oct**, and NIFTY50 returns its 19 Oct close.
2. **Multi-day holiday:** `CN_YIELDS` missing 5 consecutive dates; view {`US_YIELDS`, `CN_YIELDS`} advances with the US dates.
3. **Intraday:** at Tue 12:00 CT, {`US_YIELDS`, `EZ_YIELDS`, `JP_YIELDS`} → Monday, and {`JP_YIELDS`} → Tuesday (unchanged from Phase 1).
4. **Mixed-time files:** `US03MY` captured 12:00 CT and `US01MY` captured 17:00 CT on the same Tuesday, with a US yield symbol in each → `US_YIELDS` blocks Tuesday, and every US symbol in the view shows Monday.
5. **Expired contract** in `CME_RATES` → does not affect `viewAsOf` (unchanged from Phase 1).
6. **Legacy `NULL`** rows → never block.
7. If you add the scan bound: **bounded vs unbounded equivalence**.

Re-run the real 20 Oct worked example and paste the `firstIncomplete` per group, the frontier, and the resulting `viewAsOf` for the Global Rates Summary's 11 groups.

---

## R2 — A failed `stat` must fail the file, not fall back to ingest time

Ingest time is always **later** than the download, so falling back to it can label an intraday bar as complete. That is exactly the error this whole change prevents, and it would amount to a fabricated capture time.

- If `fs.stat` on the file fails, **do not ingest it**. Log at error level with the file path, and leave the file where it is so the next scan retries it.
- Add a test: a stat failure leaves the database unchanged and the file in place.

---

## Accepted, recorded only

- **Real database migrated by the dev server reload:** expected (nullable column, no backfill). From now on, any download into the running dev server writes `captured_at`, and readers ignore it until Phase 2, which is harmless.
- **Existing 20 Oct partial bars stay `NULL` and are treated as complete until overwritten:** as decided.
- **`processFile` exported for tests:** fine.

---

## Order of work

1. Apply R1 and R2 to the Phase 1 code. Server `tsc --noEmit` and the server test suite must be green; paste the output.
2. **Commit 1**, explicit paths only: the registry, `tvBarComplete`, `tvViewAsOf`, the `db.ts` migration and function registration, the `tvCsvIngest.ts` changes, their tests, and the `docs/prompts/` files. Paste `git show --stat HEAD`.
3. Proceed directly to **Phase 2** (route all readers through the helper and `viewAsOf`), per the original spec and the Phase 0 decisions document, using the R1 definition.
4. **STOP after Phase 2.** The gate report includes the R1/R2 evidence above, plus everything the original Phase 2 and the Phase 0 decisions require: the single- vs multi-group classification for all 18 readers, the cross-request alignment list, before/after timings for the three heaviest readers, the intraday-capture verification on a temp database, and the before/after identity diff with all-`NULL` `captured_at`.

---

## Acceptance criteria

- `viewAsOf` follows the R1 definition: only incomplete rows block a date, and holidays and missing rows never do. Tests 1–6 (and 7, if a bound is added) pass, with output pasted.
- The real 20 Oct example still gives `viewAsOf` = Mon 19 Oct for the Global Rates Summary.
- A `stat` failure rejects the file without writing anything, and the file stays in place for retry.
- Commit 1 contains only the listed Phase 1 paths, and the server is green on its own at that commit.
- All Phase 2 acceptance criteria from the original spec and the Phase 0 decisions document hold.
- All verification numbers are pasted from actual command output.

## What not to break

- Everything accepted in Phase 1: the registry values, `isBarComplete` semantics, the fast-path proof, the resolver coverage, and `ON CONFLICT … DO UPDATE` producing identical stored values.
- With every `captured_at` `NULL`, every reader's output stays identical to before.
- The date labels returned by every TV reader, including the Europe/London convention.
- Stale-tip detection and `cleanStaleTips`.
- Non-TradingView data sources.

## Out of scope

- Exchange holiday calendars. R1 makes them unnecessary for alignment.
- Deleting or backfilling existing rows.
- Aligning dates across separate client requests (report only, as before).
- Any change to close times.
- UI changes, including as-of labels.
- New dependencies.
