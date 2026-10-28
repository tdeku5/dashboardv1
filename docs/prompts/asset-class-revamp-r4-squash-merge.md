# Step 0 cleared — continue with R4

The Step 0 report is accepted. All four commits above `main` (`9210bcf`, `b45282e`, `8a27d76`, `5f61fce`) are design work, there's no data work on the branch, and pushing `acm-revamp` was done at my request in another session. Thanks for the correction to the R3b report.

## Decision — RATES lands by squash-merge, with no force-push

**No force-push of `acm-revamp`, now or later.** This replaces every earlier instruction to `git reset --soft` and squash on the branch.

At the end of R5, once I approve RATES:

1. Commit any remaining R5 work on `acm-revamp` normally, and push the branch normally (no force).
2. `git switch main`, then `git merge --squash acm-revamp`.
3. Show me `git diff --cached --stat` and confirm that **no `server/` or data-ingestion file appears** in it. Only design work should differ from `main`. If anything else appears, stop and report.
4. Commit on `main` as a single RATES commit, with a message summarising R1–R5 and the colour rules. Push `main` normally.
5. Leave `acm-revamp` untouched on GitHub as an archive. Don't delete it unless I ask.
6. Continue MACRO and the later batches on a **new branch from the updated `main`**, called `acm-revamp-2`.

Add this to `docs/asset-class-models-design-notes.md` (process section) and to the Phase 3 rollout's commit rules, so later turns follow it.

Commit the current uncommitted R3b work on `acm-revamp` now, as a normal commit (`R3b: credit heatmap, breakeven colour, near-zero, MONEY MARKETS`). Use explicit paths only, including the 4 untracked prompt files and `docs/prompts/…-r4.md` if present. Show the staged stat first, push normally, and paste the hash.

## Then

Carry out the rest of `asset-class-revamp-r4.md` in full: the three changes (MONEY MARKETS reference lines, display fixes, near-zero rule going forward), then R4 (POLICY RATE and TREASURY AUCTIONS). Give R4's status block and stop.

---

## Acceptance criteria

1. R3b is committed on `acm-revamp` from an explicit staged list and pushed normally; the hash is pasted.
2. The squash-merge procedure is recorded in the design notes and the rollout commit rules, and the old `reset --soft` instruction is marked superseded.
3. No force-push happens in this turn or any later one.
4. The three changes and R4 are completed per `asset-class-revamp-r4.md`.

## What not to break

- `origin/acm-revamp`'s existing history.
- `main` and every data-ingestion commit.
- Everything listed in the earlier prompt files' "What not to break."

## Out of scope

- The squash-merge itself (end of R5).
- Deleting any branch.
- R5 and later.
