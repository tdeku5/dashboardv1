# R5c — Approved. Two rulings, then R5d, then the RATES gate.

R5c is accepted (`b65b47e`, pushed). The three GLOBAL files are at zero, the z-score grid and summary cells are at a 4.60 minimum, the widened axes (40 → 48 and 36 → 46) are approved, the page is off the legacy spread rules, and moving `policyMoveTone` into `ratesShared.tsx` is approved. The summary-table test rewrites are approved: they now test behaviour rather than legacy class names.

## Ruling 1 — GLOBAL summary Δ columns: keep the red/blue heatmap

Keep these columns as built: the 2Y/5Y/10Y/30Y, 2s10s Δ and 10s30s Δ columns on the `--acm-heat-rate-*` red/blue scale, with primary text. Make rule 6(b)'s exception list in the design notes name them explicitly next to the `cellColor` grids, so this file and the addendum agree. The table's Terminal–OCR and ±6M/12M columns stay red/green text per rule 6.

## Ruling 2 — Regime cells: tinted fill with primary text

Curve-regime cells (Bull/Bear Steepener/Flattener and the rest) change from full identity fills to a **tint of the regime colour with primary text**:

- Fill: the regime's registry colour at a fixed alpha, **the same alpha for every regime**, composited over an opaque panel base.
- Choose the highest single alpha at which primary text is ≥ 4.5:1 on **every** regime, checked over both `bg` and `panel`. Report the alpha and the per-regime minimum.
- Text is always primary; drop the pick-whichever-contrasts-more logic.
- Add a contrast test over all seven regimes.
- Apply this wherever regime cells render, including any converted earlier, and list the places.
- **This doesn't change the regime identity colours themselves.** Chart lines and legend chips keep the full colour.

Do both rulings at the start of R5d.

---

## R5d — `GlobalForwardCurvesSection`, `Global2s10sRegimeSection`, `DailyChangeModal`, `lib/curveRegime.ts`

Convert these four (about 165 literals). All rules apply: Phase 3 rules, rule 6 (changes increase = red, levels plain), rule 6(b), the near-zero rule, registry identity colours (the 7 regime colours come from the registry via `curveRegime.ts`), and the shared-module importer check.

- `DailyChangeModal` shows daily yield changes, so rule 6 applies (increase = red). Check whether it's used outside RATES. If it is, list where, and make sure those uses don't change appearance (cross-route rule).
- `GlobalForwardCurvesSection` (40px) is a known Y-axis candidate; widen only what clips. Use `niceAxis` for any uneven or repeated ticks.
- Report anything ambiguous; don't decide it.

Then commit (`R5d: GLOBAL forward curves, regimes, daily-change modal`) per the standing rule.

---

## RATES gate — then stop

After R5d, give the RATES summary:

- `scripts/acm-literals.py` counts for every RATES file (all zero except legacy CSS listed for Z), plus section TSX
- the full probe across every RATES view in all six markets plus GLOBAL and `/treasury`: clipped, overlaps, uneven or repeated ticks, 4xx/5xx
- remaining direction-token users (expected: the VOL premium, the `cellColor` grids and summary Δ via `rate-down`, plus definitions)
- the U+2212 ratchet total
- all suites, `tsc`, the harness, the smoke tests and the cross-route test
- the list of commits on `acm-revamp` above `main`, with `git diff --stat main..acm-revamp` showing **nothing under `server/`**

Then **stop**. Don't squash-merge until I approve.

---

## Acceptance criteria

1. Rule 6(b) names the GLOBAL summary Δ columns; the design notes and the addendum agree.
2. Regime cells use one uniform tint alpha with primary text at ≥ 4.5:1 on every regime (tested), applied everywhere they render; identity colours are unchanged.
3. The four R5d files are at zero TSX literals; `DailyChangeModal`'s cross-route uses are listed and unchanged in appearance; the probe is clean; R5d is committed and pushed.
4. The RATES gate summary is complete, from command output, and the turn stops before any squash-merge.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Every view converted in R1–R5c.
- `main`, `origin/acm-revamp` history (no force-push), and every data-ingestion commit.
- Plotted data.

## Out of scope

- The squash-merge (after my approval).
- MACRO and later batches.
- Deleting legacy CSS (Z).
