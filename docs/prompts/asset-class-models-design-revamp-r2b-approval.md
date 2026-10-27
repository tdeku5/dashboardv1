# R2b — Approved. Rates colour rule, three fixes, then R2c.

R2b is accepted. FORWARD PRICING is at zero literals in all six markets; the probe is clean (14 charts, 0 clipped, 0 overlaps); the neutral most-likely highlight in the probability matrix and the new chart titles and legends are approved. The R2a changes are approved as built, including the quartile-of-column-max thresholds and the opaque panel base under fills.

This file **supersedes the R2a approval's colour rule 6 and Decision 2** wherever they conflict. If a sub-turn is in progress, finish it and stop as normal, then apply Parts 1–2 before continuing R2c.

---

## Part 1 — The rates colour rule (replaces colour rule 6)

By my decision: **any change in a yield, rate or spread uses the valence family, with an increase shown red and a decrease shown green.**

- yield / rate / spread **up** → `--acm-negative` (red)
- yield / rate / spread **down** → `--acm-positive` (green)
- futures **price up** (rate down) → `--acm-positive`; **price down** (rate up) → `--acm-negative`
- heatmaps showing these use the valence heat scale with the same orientation: `--acm-heat-negative-*` for increases and `--acm-heat-positive-*` for decreases

This covers every such display in Asset Class Models, including:

- STIR strip implied-rate and price moves (already done)
- **calendar spreads** and their Δ columns (back − front up → red)
- **NEXT MOVE and hike/cut** everywhere, including the FORWARD PRICING summary table and badges: hike → red, cut → green. A priced hike is a rate increase.
- **Terminal-OCR and the ±OCR column**
- the **FORWARD PRICING "Change vs benchmark" bars** in all six markets (rate up → red), with the legend and any bar-label tones following suit, plus the summary table's bps and implied-move cells
- every yield and rate Δ on UST CURVE, YIELD ATTRIBUTION, MONEY MARKETS, POLICY RATE, country curve and term-structure pages, GLOBAL rates, GlobalForwardCurves and DailyChangeModal
- **credit spreads** (widening → red) and curve spreads, for example 2s10s (spread up → red)
- the **`cellColor` grid**, which moves from the direction heat scale to the valence heat scale

**Orientation note.** In rates displays red means *up*. In returns displays (equities, FX, commodities) red means *down*. That's intended: rates follow the bond-price view. Record this explicitly in the design notes so nobody later "corrects" one to match the other.

**Not covered:**

- Returns (equities, FX, commodities) stay on valence with up = green.
- Z-score extremes stay on alert tints.
- **VOL page implied-vol premium (MOVE − RMOVE)** stays on direction (orange/blue) unless I say otherwise. It's a spread between volatilities, not yields.
- Any other case where it's unclear whether something is a yield or spread change: **report it, don't decide**.

### Sweep of already-converted sections

Apply the rule now to everything converted so far: R1 through R2b (STIR STRIPS in all markets, FORWARD PRICING in all markets, modals, hover popups) and anything an in-progress sub-turn converted. Report each display changed from direction to valence, with its nav path.

### The direction family

After the sweep, `--acm-dir-up` / `--acm-dir-down` and the direction heat scale may have few or no users. **Keep the tokens defined**; don't delete them. List their remaining users in each status block. At Z, report whether any remain, and I'll decide whether to remove them.

---

## Part 2 — Three fixes

### 2a. FF table price-change cells — add valence heat fills

Extend the third named heatmap to the FF table's price-change cells:

- **Valence heat scale:** price down / rate up → `--acm-heat-negative-*`, price up / rate down → `--acm-heat-positive-*`. Same 4 steps and same quartile-of-column-max thresholds as the strip, with no-fill neutral and muted text for zero or null.
- Cell text becomes **primary**, per the heatmap rule, and the red/green text tone is removed. This also resolves the reported contrast failures (red text at 4.39 / 4.35 / 4.19 on the teal, blue and gold year bands).
- Use the **same opaque panel base** under the fill as the strip cells, so the year-band tint can't stack under it. Confirm by computed contrast in the browser that primary text over step 4 is ≥ 4.5 on **every** year-band row. Paste the minimum.

### 2b. Negative bar labels — fix placement

A negative bar's value label sits 14px below the bar's **top** edge, so on short bars it overlaps the bar. Place negative-bar labels **beyond the bar's end** (below the bottom of a negative bar), mirroring positive labels above positive bars. Positioning only; values and formatting stay unchanged. Re-run the probe on the bar chart and report label-on-bar overlaps (expect zero).

### 2c. Modal ticks

Keep 10px. No change.

---

## Part 3 — Docs and tests

- Rewrite colour rule 6 in `docs/asset-class-models-design-notes.md` as Part 1's rule, including the orientation note, what's not covered and the VOL premium exception. Update the named-heatmap entry to include the FF price-change cells, with the `cellColor` grid now on the valence scale.
- Update the Rule 2 comment in `acm-tokens.css` to match.
- **Rewrite `STIRDashboardPage.stripTones.test.tsx`.** It currently asserts calendar spreads, NEXT MOVE and OCR on direction, and FF as "valence text, no fill". It must now assert valence with increase = red for all of them, FF with heat fills and primary text, and the Δ bars on valence.
- Update `assetClassModels.heatmaps.test.ts` for the FF price-change selectors and the `cellColor` grid moving to the valence heat scale.
- Add a section-wide test that fails if any rates-area file uses a direction token for a yield, rate or spread change. The VOL premium is the one allowed exception, named explicitly in the test.

---

## Part 4 — Then R2c: US FUNDAMENTAL MODEL panel

Proceed as declared (about 210 literals, including the GDPNow quarter palette via `gdpnowQuarterColor`), with every Phase 3 rule and Part 1's colour rule applying. Any yield or spread change in the panel follows Part 1. Report anything ambiguous.

R2b took 1h 32m for about 65 literals plus the R2a changes. Parts 1–3 add a sweep on top, so if R2c's total work looks likely to run much longer than R2b, split it (for example, Parts 1–3 as their own sub-turn, then the panel) and say so up front. Every sub-turn ends with a status block and a stop.

---

## Acceptance criteria

1. Every yield, rate and spread change in the converted sections shows increase = red and decrease = green, with hike = red and cut = green. Price moves follow price (price up = green). Each changed display is listed with its nav path.
2. FORWARD PRICING Δ bars are on valence (rate up = red) in all six markets.
3. FF price-change cells render valence heat fills with primary text on an opaque panel base. The computed minimum contrast over step 4 across all year-band rows is ≥ 4.5 and is pasted.
4. The `cellColor` grid uses the valence heat scale.
5. Negative-bar labels sit beyond the bar end; the probe reports zero label-on-bar overlaps.
6. The VOL premium is the only direction-token user named in the new section-wide test. Any other remaining direction-token users are listed.
7. The design notes and token comment record the rule, the orientation note, what's not covered, the VOL exception and the updated heatmap list.
8. The rewritten, updated and new tests pass; all suites, `tsc`, the harness and the probe are clean, from command output.
9. R2c's status block is as specified in the Phase 3 rollout file.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Returns colouring (up = green) in equities, FX and commodities.
- Alert tints and the heatmap text-contrast guarantees.
- R2a and R2b work other than the colour reassignments and fixes above.
- Data, values and formats. Only colour assignment and label positioning change.

## Out of scope

- Deleting direction tokens (decided at Z).
- Changing the VOL premium's colours.
- Deciding ambiguous yield-or-spread cases. Report them.
- Fills on any component beyond the strip Δ columns, the FF price-change cells and the `cellColor` grid.
