# MACRO approved — three rulings, merge, then E1 (EQUITIES US)

The MACRO gate is accepted (case B: `97e6f5a`, `4635f32`, pushed). Cross Asset Vol and the REGIMES shell are converted, `VolSummaryTable` is only used by Cross Asset Vol, and the five-axis VOL LEVELS "uneven" flag is a confirmed false alarm. Giving you this prompt is my approval to merge MACRO once the rulings below are in.

## Step 1 — Three rulings

1. **Vol point changes (for example VIX 1D Δ): plain primary text.** They're neither returns nor yield moves. Add this to the colour rules in the design notes alongside "levels → no colour".
2. **IV rank and IV percentile (0–100): alert tint at both ends.**
   - `≥ 90` or `≤ 10` → `--acm-alert-mild`
   - `≥ 98` or `≤ 2` → `--acm-alert-strong`
   - As a cell tint, badge or outline only, with primary text, exactly like the z-score cells. Add tests for 89/90, 97/98, 10/11 and 2/3. Record the thresholds in the design notes. This applies wherever IV rank or percentile renders, in this batch and later ones.
3. **VIX identity colour `#ef4444`: keep it for now.** Recheck in E1. If Equities VOL shows VIX next to red/green sign colours, report it there.

Commit these as `M1: IV rank/percentile alert tints, vol-change and VIX rulings`, using a green check, explicit paths (including this prompt saved to `docs/prompts/`) and a normal push.

## Step 2 — Squash-merge MACRO to main

Follow the design notes' Process section:

- Pre-merge checks: green on `acm-revamp-2`, which is in sync with origin.
- `git switch main` and `git pull --ff-only`. If `main` has moved beyond `cfb9a01`, **stop and report**.
- `git merge --squash acm-revamp-2`. Paste the staged stat: nothing under `server/`.
- Run the checks on the staged state, then commit as `Asset Class Models revamp: MACRO (M1)` with the standing Co-Authored-By line. Push normally and paste the hash.
- `git switch -c acm-revamp-3` and `git push -u origin acm-revamp-3`. Leave `acm-revamp-2` untouched as the archive.

## Step 3 — E1: EQUITIES US (INDEX COMPARISON, SECTOR ATTRIBUTION, BREADTH, VOL)

**Declare the split up front.** If the four pages total well over about 300 literals, run one sub-turn per page or pair (E1a, E1b, …). Each sub-turn ends with a green check, an explicit-path commit, a normal push and a status block, then stops.

**Colours (non-rates):**

- **Returns and performance:** valence, up = green, down = red.
- **Levels:** plain. That includes index levels, breadth percentages, vol levels and realized vol.
- **Vol point changes:** plain (ruling 1).
- **Z-scores:** alert tints, `|z| > 2` / `> 3`. **IV rank and percentile:** alert tints per ruling 2.
- **Sector attribution:** report before colouring whether contributions are returns (valence) or shares of a total (plain). Don't decide.
- **Breadth:** the d50 and d200 colours come from the registry (d200 was lifted in Phase 1 and must stay darker than d50).
- Sector colours come from `SECTOR_COLORS` in the registry (XLB was lifted in Phase 1).
- **VIX:** it's the same `#ef4444` here. Report whether any chart or table shows it next to red/green sign colours.

**Also:**

- U+2212 ratchet: this batch's entries must reach zero. Report the remaining section total.
- Near-zero: migrate signed formatters to `roundForDisplay` / `fmtSignedFixed` and list them.
- Axes: `niceAxis` for uneven or repeated ticks. Known Y-axes to watch from Phase 1: `IndexComparisonPage:200` (56px) and `VolPage` ×6 (44px). Widen only what clips.
- Probe every converted chart, logging the URL of any 4xx/5xx.
- Shared modules: check every importer before editing a shared module.

After the last E1 sub-turn, give its status block and stop. E2 (EQUITIES GLOBAL and the placeholders) is the next prompt; the EQUITIES gate comes after E2.

---

## Acceptance criteria

1. The three rulings are recorded in the design notes; IV rank and percentile tints are implemented and tested at the boundaries; the work is committed and pushed.
2. MACRO is squash-merged as one commit on `main` (nothing under `server/`, pushed normally); `acm-revamp-3` is created and pushed; `acm-revamp-2` is untouched.
3. E1 pages are at zero TSX literals with colours per the rules above; the sector-attribution classification and VIX adjacency are reported, not decided.
4. The U+2212 entries for E1 files are at zero, formatters are migrated, the probe is clean, and every sub-turn is committed and pushed.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- RATES and MACRO on `main`.
- `main` history, the archive branches, and every data-ingestion commit (no force-push).
- Plotted data.

## Out of scope

- E2, FX, COMMODITIES and Z.
- Changing the VIX colour (pending re-check).
- Deleting legacy CSS (Z).
