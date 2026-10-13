# Turn 5 — Approved. Proceed to Turn 6 (Phase 1 gate report).

Turn 5 is accepted. The harness reaches each view through the real nav and identifies the seven loading-state curve pages by the data request they make. The deliberate OAT→BUND mismatch failed on exactly the right view. That's the proof this harness needed.

Fold two small items into the Turn 6 gate report.

## 1. Account for the harness count

The report gives 71 harness tests: 55 views plus 15 nav-tier checks is 70. Name the 71st from the test output (for example a suite-level sanity check), so the count reconciles exactly. Per `CLAUDE.md`, a count must close.

## 2. Y-axis width — flag for the pilot, don't change

The theme fixes Y-axis width at 60px, Recharts' own default, so today's behavior is unchanged. But at 10px Plex Mono (≈6px per character), labels of more than about 9–10 characters can clip, for example `$-217.5B` with padding, or large notionals.

In the gate report, list every section chart whose Y-axis currently sets its own width, and any whose tick formatter can produce labels over 9 characters. Change nothing now; this is a pilot watch item. Pages keep any explicit width they already set.

## Turn 6

Produce the Phase 1 gate report as specified in the decisions file. Re-read all prompt files under `docs/prompts/` and `docs/asset-class-models-design-notes.md` from disk, and attest line by line. Paste everything from command output: the contrast matrix, the final sign-token hexes, the heatmap text-over-fill results, the registry adjustments, the harness result, `tsc`, both suite counts, and `git diff --stat 7512e85`.

Then propose the Phase 1 commit: the exact file list for explicit staging, including `docs/palette_check_reference.py`. Don't commit until I approve.

---

## Acceptance criteria

1. The 71-test harness count is reconciled to named tests from command output.
2. Charts with explicit Y-axis widths, and formatters able to exceed ~9 characters, are listed, with no code change.
3. The gate report covers every item the decisions file requires, plus the Turn 1–5 additions, attested against the on-disk prompt files.
4. A proposed commit file list is given, with nothing committed yet.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The 427 passing tests and the 1 deliberately skipped `TreasuryAuctionContent` test.

## Out of scope

- Changing Y-axis widths or tick formatters.
- Converting any page (Phase 2 onward).
- Committing before approval.
