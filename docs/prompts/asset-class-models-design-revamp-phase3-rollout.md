# Phase 2 — Approved. Commit the pilot, then Phase 3 rollout.

The VOL pilot is approved as built. I reviewed it on the live page. Decisions recorded:

- **Grid:** keep dashed in both directions.
- **Tint alphas:** keep 10% / 15% / 8% as-is. The live z-score didn't breach, so these remain unjudged by eye; revisit only if a real breach looks too faint.
- **RMOVE line:** keep `#f59e0b`, even though it's ΔE 9.3 from `--acm-dir-up`. Different channels, accepted.
- **MOVE / RMOVE tile values:** stay primary text. No series-color exception.
- **The `primitivesCascade` fix** (doubled selectors) is approved.

## Commit the pilot

- Stage only the 16 tracked files plus `primitivesCascade.browser.test.ts` and its 2 fixtures. Paste `git diff --cached --stat` before committing.
- **Don't commit** `docs/design-review/`. Add `docs/design-review/` to `.gitignore` in the same commit, so review artifacts stay local.
- Paste the commit hash and `git status`.

---

## Phase 3 — convert the rest of Asset Class Models

Convert every remaining view to the tokens, primitives, chart theme and identity registry, following the VOL pilot exactly. **Work in the turns below, one turn at a time.** Each turn ends with a status block and a stop. I review each turn on the live dev server before you continue.

### Turn plan

**RATES (the largest batch; commit after R5 once I approve)**

- **R1 — Section shell and nav tiers.** In `STIRDashboardPage`, replace all three nav tiers (asset class, country, section) with `AcmNavTier`, and put `.acm-root` on the section's outer container so the whole section sits on navy. This removes the seam under the top bar; only `NavDropdown` stays unconverted. Don't convert section content in this turn.
- **R2 — US sections inline in `STIRDashboardPage`, part 1:** STIR STRIPS, FORWARD PRICING, UST CURVE.
- **R3 — US sections inline, part 2:** YIELD ATTRIBUTION, CREDIT, MONEY MARKETS. Include the GDPNow quarter palette and FF contract-year bands, using the registry functions built in Phase 1.
- **R4 — US standalone pages:** `PolicyRatePage`, `TreasuryAuctionContent`. **Unskip the pending cross-route test** and make it pass. Check `/treasury` mounts and renders.
- **R5 — Other countries and GLOBAL:** `CountryCurvePage`, `CountryTermStructure`, `XXFundamentalModelPanel` (all five), `GlobalRatesPage` and the four `Global*Section`s. Convert the `cellColor` grid to the `--acm-heat-dir-*` scale.

**MACRO, EQUITIES, FX, COMMODITIES (commit after each, once I approve)**

- **M1 — MACRO:** `CrossAssetVolPage` and the REGIMES placeholder.
- **E1 — EQUITIES US:** INDEX COMPARISON, SECTOR ATTRIBUTION, BREADTH, VOL.
- **E2 — EQUITIES GLOBAL and placeholders:** COUNTRY RETURNS, with `ReturnsHeatmap` on the `--acm-heat-*` valence scale (blue→green for up, red for down); plus the 5 placeholders.
- **F1 — FX:** `UsFxPage` and `ModelCurrencyFxPage` (all five currencies).
- **C1 — COMMODITIES:** ENERGY, CRUDE, METALS, and the AGS and SOFTS placeholders.

**Z — Cleanup and final gate**, below.

Don't split `STIRDashboardPage`. Convert it in place across R1–R3.

### Rules for every turn

These come from the decisions file, the turn approvals, and the pilot:

1. **Color families.** Every sign color maps to valence, direction, alert or status per Decision 2. Specifically:
   - hike = `--acm-dir-up`, cut = `--acm-dir-down`, everywhere
   - yield and rate changes use direction
   - returns use valence
   - z-score extremes use alert tints only
   - fix the calendar-spread inversion (`v>0 → .changeNegative`) in the turn where that code is converted, and call it out in that turn's report
2. **Identity colors come only from the registry.** Replace each of the 22 series arrays and maps with registry imports as their pages convert. No local color maps remain.
3. **Charts** use `AcmChartFrame` and the chart theme. Pages may keep explicit layout props (height, Y-axis width, `minTickGap` above 10, stroke widths), as the pilot did.
4. **Zero color, font-size and spacing literals** in each converted file's TSX and CSS. Report before and after per file.
5. **Formatting.** Nulls stay `—`, negatives use ASCII `-`. Each converted file's U+2212 ratchet entry must reach zero in that turn. Subtraction signs in label and formula text stay as they are.
6. **Remove `#4e6070`** from every converted file.
7. **No behavior change.** Data, calculations, routes, series content, refresh behavior and methodology wording are untouched. Markup may change to adopt primitives.
8. **Y-axis clipping.** For every chart converted in the turn, run the probe from the pilot (`probe.mjs`, generalized) against the live dev server. Report any Y-axis label that's clipped or within 2px of the edge, and any overlapping X-axis tick labels. Fix clipping by widening that axis only. `STIRDashboardPage:3172` (42px, `-12.5bp`) is the known candidate for R2/R3.
9. **Cross-section pages:** `preexistingPages.smoke` 8/8 and `renderSmoke` 108/108 must still pass every turn.

### Status block, every turn

Paste from command output:

- the files changed (`git diff --stat` against the last commit)
- `tsc --noEmit` for both packages, both suite counts, the 55-view harness
- the literal counts before and after, per converted file
- the remaining U+2212 ratchet total
- the probe results: clipped labels and overlapping ticks (expect zero after fixes)
- **the nav path for every view converted this turn** (for example `RATES → US → STIR STRIPS`), so I can check each one live
- anything you couldn't convert without a behavior change. Stop and report it rather than forcing the change.

No aesthetic judgements; I'll make those live.

### Commits

Commit only after I approve the batch:

- **RATES:** one commit after R5.
- **MACRO, EQUITIES, FX, COMMODITIES:** one commit each after approval.

Explicit path staging, `git diff --cached --stat` pasted before each commit, no `git add -A`.

---

## Z — Cleanup and final gate

1. **Dead CSS.** Delete rules in the section's 18 CSS modules that are no longer referenced. Delete modules that end up empty, provided nothing outside the section imports them. Report CSS lines before and after against the Phase 0 baseline (4,619 lines, with 805 exact-duplicate lines).
2. **Final counts against the Phase 0-D baselines,** for CSS and TSX: distinct font sizes (34 and 15 at baseline), color literals (91/523 and 124/1,531), spacing values (27 and 24). The target is zero literals; name and justify anything remaining.
3. **U+2212 ratchet empty,** with the test's allow-list removed.
4. **Every chart in the section uses the theme.** Prove it with a check that fails if any `CartesianGrid`, `XAxis`, `YAxis` or `Tooltip` in the section sets color or font props directly.
5. **The 55-view harness, suites, `tsc` and the probe across all 47 real views** are clean.
6. **Re-read every prompt file** under `docs/prompts/` from disk and attest line by line.
7. **Then stop and ask me about `NavDropdown`:** convert it now, or leave it for the terminal-wide pass. Don't touch it before I answer.

---

## Acceptance criteria

1. The pilot commit contains exactly the approved files plus the `.gitignore` entry. `docs/design-review/` is untracked and ignored.
2. All 47 real views and 8 placeholders are converted. Every turn and batch was reviewed by me before the next began.
3. Every sign color in the section belongs to one of the four families, and the calendar-spread inversion is fixed and reported.
4. No local color maps remain; every identity color comes from the registry.
5. The cross-route `TreasuryAuctionContent` test is unskipped and passing, and `/treasury` renders.
6. The probe reports zero clipped Y-axis labels and zero overlapping ticks across all 47 real views.
7. The U+2212 ratchet is empty, `#4e6070` appears nowhere in section styles, and the 179 em-dash nulls are intact.
8. The final report gives literal, font-size, spacing and CSS-line deltas against the Phase 0 baselines, all from command output.
9. Every out-of-section page still mounts, and `NavDropdown`, `FredRefreshButton`, Hephaestus, `globals.css` `:root` and `server/` are unchanged throughout.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The VOL page as approved.
- Data, calculations, routes and behavior on every view.
- `/treasury` beyond `TreasuryAuctionContent`'s own content.
- The terminal's information density.

## Out of scope

- `NavDropdown` (decided after Z), `FredRefreshButton`, and other sections of the terminal.
- Splitting `STIRDashboardPage` or any other restructuring.
- New features, charts or metrics.
- Retuning tokens, tint alphas or registry values. If a value looks wrong on a converted page, report it; don't change it.
