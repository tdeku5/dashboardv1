# TV Completed Bars — Phase 2 Sign-off and Phase 3 Go-Ahead

Phase 2 gate report reviewed and accepted. Save this file to `docs/prompts/`, re-read all spec files from disk, then run Phase 3.

---

## Rulings on the open items

### Scan-bound deviation (dropped column with an intraday last bar): accepted

The bounded scan stops blocking on a symbol that disappears from the export while its last row was captured intraday. The unbounded scan would have blocked that group forever, so the bounded scan is the better behaviour. Its row is still hidden at row level by the completeness predicate, so a partial value is never shown as a close.

Make sure this case is a **named test**, e.g. `dropped symbol with intraday last bar stops blocking after the bound`, so the deviation is pinned on purpose rather than incidental. If it already exists, name it in the gate output.

### `/api/tv/symbols` left unfiltered: accepted

It is a coverage inventory (MIN/MAX/count) with no client caller. Keep it exempt. Add a one-line comment at the route saying its MAX includes unfinished bars by design, so a future caller doesn't treat it as a latest-close source.

### The five marker-comment exemptions: accepted

The inventory, the existence checks, and Hephaestus (whose dynamic `WHERE` already applies `tvVisible`) are all fine as they are.

### Views built from separate requests: recorded, not fixed here

Fixing these is out of scope for this change. Add a short `docs/` note listing the pages from the Phase 2 report (GlobalRatesPage, VolPage, DxyForeignYieldsChart, Global2s10sRegimeSection, CrudeOilPage, MetalsPage), each with one line on how its requests can disagree during an intraday window. Include that note in Commit 2.

### Timings: accepted

The overhead is about +7% on the all-`NULL` copy and about +13% once rows carry `captured_at`. The slow endpoints (`metals/basis/gold` at ~3.6s, `crude/spread` at ~2.9s, `rates-summary` at ~1.5s) were slow before this change. Record them in the same `docs/` note as candidates for later optimisation. Do not optimise them here.

---

## Phase 3 — Verify and commit

1. Run server `tsc --noEmit` and the server test suite, and client `tsc --noEmit` and the client test suite. Paste the output, and state that no lint script exists.
2. **Commit 2**, explicit paths only: the 18 reader modules as changed, the `tvVisible` helper if it lives outside Commit 1's files, the guard test, the `/symbols` comment, the `docs/` note above, and the Phase 2 spec files in `docs/prompts/`. Never stage harness, scratch, or baseline-capture files.
3. Paste `git show --stat HEAD`, `git log --oneline -3`, and `git status --short`. The tree must be clean.

**STOP after Phase 3.**

---

## Acceptance criteria

- The dropped-symbol bound behaviour is covered by a named test.
- The `/symbols` route carries the by-design comment.
- The `docs/` note lists the cross-request pages and the pre-existing slow endpoints.
- Client and server typecheck and tests are green, with output pasted from the actual run.
- Commit 2 contains only the listed paths, sits on top of Commit 1 (`70ffa12`), and the working tree is clean.

## What not to break

- Commit 1. Do not amend or rewrite it.
- The 76-response all-`NULL` identity result. No reader logic changes in this phase beyond the comment.
- The real `fred_data.db` and the running dev server.

## Out of scope

- Aligning views built from separate client requests.
- Optimising the slow endpoints.
- Any change to close times, `viewAsOf`, or reader logic.
- UI changes and new dependencies.
