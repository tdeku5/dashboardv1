# Turn 1 — Approved. Heatmap decision, then Turn 2.

Turn 1 is accepted as delivered:

- **The `--negative` adjustment to `#E16D6D` is correct.** The spec's 4.50 was rounded up from 4.49907, and fixing it was exactly what the one adjustment pass was for.
- **The `--acm-` prefix is approved.** It stops the new tokens shadowing the global `--positive`/`--negative` that `TreasuryAuctionPage` and unconverted pages still read. From here on, wherever the decisions file names a sign token (`--negative`, `--dir-up`, …), read it as the `--acm-` version.
- **The 2px half-step is approved.** It's for hairline gaps only.
- **Tint alphas (8–16%) stand for now.** Whether they're visible enough is a pilot call.

---

## Heatmaps — option (b): a named exception, scoped tightly

Rule 2 was written to stop alert tints and sign colors competing in the same data cell. A heatmap's job is to color the background of every cell, so moving its shading into text color, option (a), would remove the reason it's a heatmap. Use option (b), with these limits:

**Which components.** The exception covers only true heatmap grids: the `cellColor` grid (rates, using the direction family) and `ReturnsHeatmap` (returns, using the valence family). Name every component that uses it in the gate report. No other component may use background-fill sign colors.

**Tokens.** Add `--acm-heat-*` tokens as two diverging scales:

- **Direction scale**, from `--acm-dir-down` through neutral to `--acm-dir-up`. Used by `cellColor`.
- **Valence scale**, from `--acm-negative` through neutral to `--acm-positive`. Used by `ReturnsHeatmap`.

Each scale has a neutral midpoint (zero) plus **at most 4 steps on each side**. The neutral step is the underlying surface with no fill, so a zero reads as blank rather than faintly tinted.

**Remove the unused brown-teal scale** in `cellColor`, as the decisions file already instructs.

**Text over fills.** The number in every heatmap cell must reach ≥ **4.5:1** against the strongest fill step it can sit on, using the section's primary text color. If the strongest step can't pass with primary text, darken the fills; don't switch text color per cell. A single text color across the grid keeps it legible as a table. Add these checks to `acmTokens.test.ts`, computed over every step of both scales on both the `bg` and `panel` surfaces.

**No alerts inside heatmaps.** Heatmap cells never also carry an alert tint, badge or outline. In a heatmap, how extreme a value is shows as fill intensity. That keeps one cell from carrying two meanings at once.

**Sign stays in the number.** Every heatmap cell keeps its leading ASCII `-`, so the red/green valence scale's weakness under deuteranopia (ΔE 7.7) never changes what a cell says.

Also amend Rule 2 in your working notes: *"Valence and direction tokens color text only, except inside the named heatmap components, which use `--acm-heat-*` fills."*

---

## Then Turn 2

Turn 2 as planned: the identity-color registry, collision resolution, GDPNow colors keyed to the quarter, the U+2212 test, and registry-vs-sign distinctness checks. Add the heatmap tokens and their tests at the start of Turn 2. They're small and belong with the token file.

Also stage `docs/palette_check_reference.py` with the eventual Phase 1 commit. It's the reference the test is checked against, so it should live in the repo history, not just on disk.

Stop at the end of Turn 2 with a status line.

---

## Acceptance criteria

1. `--acm-heat-*` defines two diverging scales (direction, valence), each with a no-fill neutral midpoint and ≤ 4 steps per side.
2. Primary text passes ≥ 4.5:1 over every fill step of both scales, on both `bg` and `panel`, enforced by a test whose output is pasted.
3. Only the named heatmap components use background-fill sign colors. The gate report lists them, and no heatmap cell carries an alert treatment.
4. The brown-teal `cellColor` scale is removed.
5. Turn 2's registry scope is complete as specified in the resume file, with all counts pasted from command output.
6. `git diff --stat 7512e85` still shows no change to any page's rendered styling.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The Turn 1 token values and the passing 25 tests. Extend them; don't retune them.
- The global `--positive`/`--negative` that `TreasuryAuctionPage` reads.

## Out of scope

- Converting any heatmap or page to the new tokens (Phase 2 onward).
- Any background-fill sign coloring outside the named heatmap components.
- Retuning tint alphas before the pilot review.
