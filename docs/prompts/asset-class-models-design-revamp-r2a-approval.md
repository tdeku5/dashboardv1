# R2a — Approved with three changes. Then R2b.

R2a is accepted. The calendar-spread inversion fix, hike/cut direction tones, the popup Y-axis widening (42 → 60, clearing `100.0bp` / `-14.0bp`), the R2 split, and the registry-keyed FF year bands are all approved as built. FF bands and GDPNow moving from R3 to R2a/R2c is fine. Modal charts using the theme without `AcmChartFrame` is approved.

Make the three changes below at the start of R2b and report them in R2b's status block.

---

## 1. STIR strip yield/price moves — red/green (user exception)

By my decision, **yield and price move cells in the STIR STRIPS view** (the SR3 strip and the FF table) use the **valence** family, colored from the futures-price point of view:

- price down / implied rate up → `--acm-negative` (red)
- price up / implied rate down → `--acm-positive` (green)

This applies to the implied-rate Δ columns, the price-change columns and the FF table's price-change cells.

**Scope.** All countries' STIR STRIPS views (US SR3 and FF, UK, EU, CAD, JPY, AUS), since they share the strip component. US and the other markets must not diverge.

**What stays on the direction family (orange/blue).** Calendar spreads and their Δ columns, NEXT MOVE hike/cut, Terminal-OCR and the ±OCR column, and every rate display outside STIR STRIPS. Those are policy-path and spread readings, not price moves.

Record this as a named exception to Decision 2 in `docs/asset-class-models-design-notes.md`, with its scope and rationale ("user preference: futures-price P&L view for strip yield/price moves").

## 2. Strip implied-rate Δ columns — third named heatmap (valence scale)

The magnitude shading on these columns carried information: it showed where the moves were. Restore it as a **third named heatmap component** under the option-(b) exception, on the **valence heat scale** to match change 1:

- `--acm-heat-negative-*` for price down / rate up, and `--acm-heat-positive-*` for price up / rate down.
- 4 steps per side, no-fill neutral, the same as `ReturnsHeatmap`.
- Map magnitude to steps with the same bucketing approach the old magnitude-scaled opacity used. Report the thresholds.
- Cell text stays primary, per the heatmap rule. The valence scale's text-over-fill contrast is already tested; confirm these cells use it.
- No alert treatment inside these cells.
- Add this component to the named-heatmap list in the design notes and in the token file's Rule 2 comment. Extend any test that enumerates the allowed heatmap components.

Scope: only the strip implied-rate Δ columns that previously had magnitude shading. Nothing else gains fills.

## 3. Modal ticks

Keep 10px. No change.

## Test

Add a test asserting:

- strip yield/price move cells (SR3, FF, and one non-US market) use valence tones or valence heat fills, with price down = negative;
- calendar spreads, NEXT MOVE and the OCR displays in the same view stay on direction tones.

That keeps the exception from either spreading or quietly reverting.

---

## Then R2b — FORWARD PRICING

Proceed with R2b as declared in the split, with every Phase 3 rule and status-block item applying. FORWARD PRICING is **not** covered by the strip exception unless I say so: its rate displays stay on the direction family. If any FORWARD PRICING element shows futures price moves the same way the strip does, report it rather than deciding.

---

## Acceptance criteria

1. Strip yield/price move cells in every market's STIR STRIPS view use valence: price down / rate up = `--acm-negative`, price up / rate down = `--acm-positive`. The exception is recorded in the design notes.
2. The strip implied-rate Δ columns render valence heat fills with ≤ 4 steps per side, primary text, and no alerts. They're added to the named-heatmap list in the docs and the token file comment, and the enumerating test is updated.
3. Calendar spreads, NEXT MOVE and OCR displays remain on direction tones, proven by test.
4. Both changes, the magnitude thresholds, and the nav paths to check them live are in R2b's status block.
5. All suites, `tsc`, the harness and the probe are clean, from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- R2a as approved: calendar-spread fix, hike/cut tones, popup axis fix, modals.
- The heatmap text-contrast guarantees already tested.

## Out of scope

- Applying red/green to any rate display outside the STIR STRIPS yield/price move cells.
- Adding fills to any component other than the strip implied-rate Δ columns.
- Changing modal tick size.
