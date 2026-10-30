# RATES merged — M1: MACRO

The RATES merge is accepted: `cfb9a01` is on `main`, pushed normally, `acm-revamp` is archived untouched, and `acm-revamp-2` is live.

## Process for the remaining batches

The same approach as RATES, one batch at a time:

- Work on the batch branch, with **a green check, an explicit-path commit and a normal push at the end of every sub-turn**.
- At the batch gate, stop for my approval, then squash-merge into `main` per the design notes' Process section (pre-merge checks, `git pull --ff-only`, staged stat with nothing under `server/`, one commit, normal push).
- After each merge, start the next batch on a new branch from the updated `main`: `acm-revamp-3` (EQUITIES), `acm-revamp-4` (FX), `acm-revamp-5` (COMMODITIES), `acm-revamp-6` (Z). Leave merged branches untouched as archives.

Add this to the design notes' Process section, and include `docs/prompts/asset-class-revamp-rates-merge.md` and this prompt in M1's first commit.

---

## M1 — MACRO: `CrossAssetVolPage` and the REGIMES placeholder

Convert both. If `CrossAssetVolPage` plus its components look like they'll run well past about 300 literals, split it and say so up front.

### Colour rules outside rates

MACRO is the first non-rates batch, so rule 6 (rates: increase = red) **doesn't** apply here except to genuine yield or spread changes, such as a MOVE or rates panel on this page. Instead:

- **Returns** (equity, FX, commodity): valence, up = green, down = red.
- **Levels** (vol index levels, realized vol, implied vol, correlation): plain primary text; series lines take registry identity colours.
- **Z-scores, IV rank and IV percentile** (the `VolSummaryTable` intensity): alert family as **cell tint, badge or outline only**: `|z| > 2` alert-mild, `|z| > 3` alert-strong. Text stays primary. This is Phase 0's Decision 2.
- **Vol changes** (for example VIX 1D Δ): **report how you'd classify them before colouring**. They're neither returns nor yields, and I'll decide.
- Anything else ambiguous: report it; don't decide.

### Specific checks

- **VIX identity colour.** It's `#ef4444` in the registry (unified in Phase 1), which is close to `--acm-negative`. Report its ΔE2000 from `--acm-negative` and `--acm-positive`, and whether any chart on this page shows VIX alongside red/green sign colours. Don't change it; report it, and I'll decide (breakeven had the same problem in R3b).
- **U+2212 ratchet:** this page's entries must reach zero.
- **Near-zero:** migrate signed formatters to `roundForDisplay` / `fmtSignedFixed` and list them.
- **Axes:** use `niceAxis` for uneven or repeated ticks. `CrossAssetVolPage:204` (44px) is a known Y-axis to watch; widen only what clips.
- **Shared modules:** check every importer before editing a shared CSS module or helper, especially anything shared with Equities VOL, which converts in the EQUITIES batch.
- **REGIMES placeholder:** convert its shell to the primitives so it matches the section.

### Status block, then the MACRO gate

After converting, give the usual status block (counts from `scripts/acm-literals.py`, the probe with 4xx/5xx URLs, nav paths, migrated formatters, the U+2212 ratchet total, all suites, `tsc`, the harness and the smoke tests). Commit and push per the process above.

M1 is the whole MACRO batch, so its status block is also the **MACRO gate**: include `git diff --stat main..acm-revamp-2` showing nothing under `server/`. Then stop. Don't squash-merge until I approve and answer any colour questions.

---

## Acceptance criteria

1. The process for the remaining batches is recorded in the design notes; M1's first commit includes both prompt files.
2. `CrossAssetVolPage` and the REGIMES placeholder are at zero TSX literals, with colours per the non-rates rules; vol-change classification and the VIX ΔE are reported, not decided.
3. The U+2212 entries for this page are at zero, formatters are migrated, the probe is clean with no 4xx/5xx, and widened axes are listed.
4. All checks are green; the work is committed and pushed normally on `acm-revamp-2`; the gate stops before any merge.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Every RATES view now on `main`.
- Equities VOL and any other page sharing modules with Cross Asset Vol.
- `main` history, `origin/acm-revamp` (archive), and every data-ingestion commit.
- Plotted data.

## Out of scope

- EQUITIES, FX, COMMODITIES and Z.
- Changing the VIX identity colour (pending my ruling).
- Deleting legacy CSS (Z).
