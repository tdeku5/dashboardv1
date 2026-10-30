# R3a — Approved. Three changes, then R3b.

R3a is accepted. YIELD ATTRIBUTION and CREDIT are at zero literals; the levels sweep, rule 6's levels clarification, breakevens (rise = red), the rule 3 fix, the float-noise fix and the R3a/R3b split are all approved. The yield-attribution classification (lines and stacked bars coloured by identity, not sign) is approved.

Make the three changes below at the start of R3b and report them in R3b's status block.

---

## 1. Credit table Δ cells — fourth named heatmap (valence)

Restore the magnitude shading on the credit table's Δ cells as a **fourth named heatmap**:

- **Valence heat scale:** widening → `--acm-heat-negative-*`, tightening → `--acm-heat-positive-*`. Same as the STIR strip heatmap.
- 4 steps per side with the same quartile-of-column-max bucketing as the strip, no-fill neutral, **primary text** (the rule-6 text tone is removed), an opaque panel base, and no alerts.
- Applies wherever this table renders (US CREDIT and EU CREDIT).
- Add it to the named-heatmap list in the design notes and the Rule 2 comment. Extend `assetClassModels.heatmaps.test.ts` with its selectors, and confirm in the browser that the computed text contrast over step 4 is ≥ 4.5. Paste the minimum.
- The `Last (bp)` level column stays plain.

## 2. Breakeven identity colour — not red or green

Breakeven Δ's identity colour `#ef5350` makes a falling breakeven draw a red bar. Change it in the identity registry to a colour that is:

- neither red nor green: ΔE2000 ≥ 15 from `--acm-negative`, `--acm-positive`, `--acm-dir-up` and `--acm-dir-down`
- ≥ 3:1 contrast on all four surfaces
- ΔE ≥ 10 from every other series shown in the same YIELD ATTRIBUTION chart (Nominal Δ, Real Yield Δ)

A purple or amber family is the likely fit. Report the chosen value and its numbers from the palette test. Apply it everywhere the registry's breakeven key is used, and list those places. Add a registry test asserting the breakeven colour stays clear of all sign tokens.

## 3. Near-zero values render as untoned zero

A calendar-spread Δ of about -0.04 prints as `-0.0` in green. Any value that **rounds to zero at its displayed precision** must render as `0.0` (no sign) with **no tone**, section-wide. This is a formatting fix in the shared formatter / tone helper:

- The underlying value is unchanged; only the display and the tone decision use the rounded value.
- Add a test covering `-0.04` → `0.0`, untoned, at 1dp, plus a non-zero control case.

Credit RoC bars staying coloured by curve regime is accepted as-is.

---

## R3b — MONEY MARKETS

Convert MONEY MARKETS (about 150 literals). After it, `STIRDashboardPage.tsx` should be at or near zero.

- **Colours follow rule 6:** money-market rate and spread **changes** increase red; **levels** are plain text. Report anything ambiguous; don't decide it.
- Use token-only classes; legacy rules stay for R5.
- Probe every chart. Give the status block as specified, with counts from `scripts/acm-literals.py`, nav paths, and remaining direction-token users. Report the whole-file count for `STIRDashboardPage.tsx` and `STIRDashboardPage.module.css`, and list anything left in either and why.

Stop at the end of R3b.

---

## Acceptance criteria

1. Credit Δ cells render valence heat fills with primary text on an opaque base, in US and EU. The named-heatmap list, Rule 2 comment and heatmaps test are updated, and the computed minimum contrast is ≥ 4.5 and pasted.
2. The breakeven identity colour meets the three thresholds above, is applied everywhere the key is used, and a test guards it against sign tokens.
3. Values that round to zero render as `0.0`, untoned, section-wide, covered by a test.
4. MONEY MARKETS is at zero literals with colours per rule 6, the probe is clean, and remaining literals in the STIR files are listed with reasons.
5. All suites, `tsc` and the harness are green; counts come from `scripts/acm-literals.py`, pasted from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Checkpoint `91f02a8`. No amending, no pushing.
- Data and calculations. Only display rounding of zero and colour assignment change.
- Other identity colours in the registry.

## Out of scope

- R4 (POLICY RATE, TREASURY AUCTIONS) and later.
- Recolouring credit RoC bars.
- Deleting legacy CSS (Z).
