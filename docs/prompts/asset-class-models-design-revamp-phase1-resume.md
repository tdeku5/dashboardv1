# Phase 1 — Recovery accepted. Resume with fixed seed colors and a stopping rule.

The recovery report is accepted. The tree is clean against `7512e85`, nothing is out of bounds, and the checklist is clear.

**What the report shows:** 7h 22m produced the prompt files and two font files. The rest of the time went into searching for colors in scratch scripts, and none of it reached the repo. That happened because the decisions file gave no stopping rule and asked for hues that collide with each other:

- the obvious "direction down" blue `#60a5fa` vs the accent `#5B9DD9`: ΔE2000 = **4.2** (reads as the same color)
- the obvious "direction up" orange `#fb923c` vs the amber alert `#f59e0b`: ΔE2000 = **9.4** (too close in a dense table)

That's a spec defect, not yours. This file fixes it with fixed starting values, numeric pass/fail thresholds, and a hard stop.

---

## Sign-color seed values

Use these exact values. They were checked against all four Hephaestus surfaces (`#0E1621`, `#121A27`, `#1B2637`, `#1E2A3C`):

| Token | Value | Min contrast across surfaces |
|---|---|---|
| `--dir-up` (yield/rate up, hike) | `#F0954A` | 6.27 |
| `--dir-down` (yield/rate down, cut) | `#7CC4F2` | 7.60 |
| `--positive` | `#4CC38A` | 6.53 |
| `--negative` | `#E06C6C` (Hephaestus's own) | 4.50 |
| `--alert-mild` | `#E8C547` | 8.62 |
| `--alert-strong` | `#F05BA0` | 4.62 |
| `--status-warning` | same value as `--alert-mild` | 8.62 |

`--alert-mild` is a gold-yellow rather than amber so it stays clear of the orange. `--alert-strong` leans pink-magenta so a breach never reads as a down move.

Measured separation, ΔE2000. "Deut" and "Prot" simulate the two common types of red-green colorblindness (Machado 2009 matrices, severity 1.0):

| Pair | Normal | Deut | Prot |
|---|---|---|---|
| `--dir-up` vs `--dir-down` | 45.6 | 48.2 | 45.4 |
| `--negative` vs `--alert-strong` | 16.2 | 17.3 | 25.3 |
| `--dir-up` vs `--alert-mild` | 21.5 | 7.0 | 11.3 |
| `--dir-down` vs accent `#5B9DD9` | 11.3 | — | — |
| `--positive` vs `--negative` | 63.1 | 7.7 | 18.0 |

The direction pair is clearly distinct for colorblind users too, which is why the direction family is blue/orange.

Two pairs are weak under deuteranopia: valence green/red and direction-up vs alert-mild. The two rules below handle them, rather than shifting hues.

## Two rules that remove the remaining overlap

1. **Color is never the only signal of sign.** Every signed number keeps its leading `-` (ASCII, per Decision 3), so a red/green confusion never changes what a number says.
2. **Alerts use a different visual channel from sign.** Valence and direction tokens color the **text** of a value. Alert tokens color a **cell background tint, badge or outline**, never value text. A cell can show both a direction (text color) and an extreme z-score (tint) without the two competing. Status-warning applies to notes and banners, not data cells.

## The contrast and distinctness test (pass/fail)

Port the reference implementation at **`docs/palette_check_reference.py`** (WCAG contrast, CIEDE2000, Machado CVD simulation) into a repo test in TypeScript. That file holds the functions only. The colors, surfaces and pairs to check are the ones in the tables above, and the ported test must reproduce those tables' numbers to ±0.1 before you trust it.

Leave the `.py` file in `docs/` as the reference. Don't run it as part of the test suite, and don't delete it.

The test **fails** if any of the following is not met:

- every text token and every sign/alert token as text: ≥ **4.5:1** on every surface it appears on; tertiary/disabled text ≥ **3:1**
- `--dir-up` vs `--dir-down`: ΔE ≥ **30**, under normal, deut and prot
- `--negative` vs `--alert-strong`: ΔE ≥ **15** normal
- `--dir-up` vs `--alert-mild`: ΔE ≥ **15** normal
- `--dir-down` vs accent: ΔE ≥ **10** normal
- no sign-family token is identical to any identity-registry color (checked once the registry exists in Turn 2)

The seeds pass all of these. The test exists so a later edit can't quietly break them.

## Stopping rule

If any seed fails your own computation (for example, the test computes contrast differently), make **one** adjustment pass: change only the failing token, by the smallest step that passes.

If it still fails after that one pass, **stop**. Report the failing pair, the numbers, and the two best candidates, and let me choose. No open-ended searching.

---

## Turn plan

Each turn ends with a one-line status and stops. Don't chain turns.

1. **Token file and fonts.** The full additive token layer (surfaces, four-step text hierarchy, accent variants, the seed sign/alert colors above, type scale ≤6 sizes, ≤3 weights, 4px spacing, radii, focus ring); `@font-face` for Plex Sans and the two Plex Mono weights; the section-scoped mono token; the contrast/distinctness test. Paste the test output.
2. **Identity-color registry.** One module for country (merge the four rates maps and normalize keys), currency, tenor, sector, regime and STIR pack colors. Resolve the collisions: VIX gets one color; for tenor vs country, report every chart that shows both. Key GDPNow colors to the quarter. Add the U+2212 test. Extend the distinctness test to cover registry-vs-sign collisions.
3. **Shared chart theme.** Grid, axis, ticks and tooltip consolidated. No page adopts it yet.
4. **Shared primitives.** Page header, nav tiers, panel, data table, stat tile, chart container, collapsible panel. No page adopts them yet.
5. **55-view mount harness.**
6. **Phase 1 gate report,** as specified in the decisions file. Re-read all three prompt files from disk and attest.

The section must look identical to `7512e85` throughout Phase 1. Nothing here converts a page.

---

## Acceptance criteria

1. The seed values above are used unless the test shows one failing; any change is reported with before/after numbers.
2. The TS distinctness test reproduces the reference numbers to ±0.1 and enforces every threshold listed.
3. Alert tokens are applied only as background, tint, badge or outline, never as value text. Valence and direction tokens are applied only as text color.
4. No turn runs past its listed scope. Each ends with a status line and a stop.
5. All numbers at every turn are pasted from command output.
6. At the end of Turn 5, `git diff --stat 7512e85` shows no change to any page component's rendered styling.

## What not to break

- Everything listed in both earlier prompt files' "What not to break."
- The prompt files and Plex Mono fonts already on disk. Keep and use them; don't re-download or rewrite them.
- Hephaestus, `NavDropdown`, `FredRefreshButton`, `/treasury`, and existing `:root` variables.

## Out of scope

- Choosing colors by eye. Any color question past the stopping rule comes to me.
- Converting any page (Phase 2 onward).
- Retuning the accent `#5B9DD9` or any other Hephaestus value except the faint-text fix already mandated.
