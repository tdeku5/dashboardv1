# R4 — Approved. Commit R4, one fix, then R5 (split).

R4 is accepted. POLICY RATE and TREASURY AUCTIONS are at zero literals, the cross-route test is unskipped and passing (client 484 passed, 0 skipped), `/treasury` renders with its shell untouched, the auction-metric classification (all levels, plain text) is approved, and the `mmBpAxis` helper is a good fix. Catching and reverting the `PolicyRatePage.module.css` overwrite, then confirming UK POLICY RATE unaffected, was exactly right.

Accepted as-is: the standard chart-frame legends replacing the custom ones, and the offering-amount bars losing their rounded tops. If an auction **tail** is ever added, it's a yield difference and comes back to me for a colour ruling.

## Step 1 — Commit R4

Commit the R4 work on `acm-revamp` as a normal commit (`R4: POLICY RATE, TREASURY AUCTIONS, MONEY MARKETS fixes`), staging explicit paths only, including this prompt file once it's saved to `docs/prompts/`. Show the staged stat (nothing under `server/`), push normally (fast-forward, no force), and paste the hash.

## Step 2 — Fix: even ticks on POLICY RATE's EFFR − inflation axis

The axis shows `1.8, 1.4, 0.9, 0.5, 0.0pp`: 0.45 spacing rounded to 1dp, which reads unevenly. Generalise `mmBpAxis` (or add a sibling) into a **"nice ticks" helper** that picks a step of 1, 2, 2.5 or 5 × 10ⁿ, so labels are evenly spaced at the displayed precision and never repeat. Use it on this axis. Report the before and after ticks and add tests. In R5, use the same helper on any axis the probe shows with uneven or repeated labels.

## The 404

One 404 in the first probe run, none in the second, is noted. From now on, the probe logs the **URL of any 4xx/5xx response**. If one recurs, report the URL. Don't chase it unless it repeats.

---

## R5 — Other countries and GLOBAL (split into sub-turns)

R5 is the largest remaining RATES batch. **Split it up front**, declare the split in the first status block, and stop at the end of every sub-turn. Suggested split; adjust if the literal counts say otherwise, keeping each sub-turn to about 300 literals:

- **R5a:** `CountryCurvePage` and `CountryTermStructure`, including the legacy `PolicyRatePage.module.css` rules it still uses (convert them to token-only classes, so that module's legacy rules can die at Z)
- **R5b:** the five `XXFundamentalModelPanel`s (UK, EU, CAD, JPY, AUS)
- **R5c:** `GlobalRatesPage` plus `GlobalPolicyPathRealRateSection` and `GlobalPolicyTermStructureSection`
- **R5d:** `GlobalForwardCurvesSection`, `Global2s10sRegimeSection`, and any remaining GLOBAL pieces, including the GLOBAL z-score grid on `--acm-heat-rate-*`

All rules apply: Phase 3 rules, rule 6 (changes increase = red, levels plain), rule 6(b) (`cellColor` grid red/blue, including the GLOBAL z-score grid), the near-zero rule (migrate these pages' signed formatters to `roundForDisplay` / `fmtSignedFixed` and list them), identity colours from the registry, and the probe on every chart.

Known Y-axis candidates from Phase 1, to watch in the probe: `GlobalPolicyTermStructureSection` (36px), `GlobalForwardCurvesSection` (40px), `GlobalPolicyPathRealRateSection` (40px), and the fundamental-model panels' 16 axes at 42px. Widen only the axes that clip.

If anything in these pages is ambiguous under rule 6, for example policy-path or real-rate displays that could be a level or a change, **report it; don't decide**.

## After R5d — RATES gate (stop for my approval)

When the last sub-turn is done, give a RATES summary:

- `scripts/acm-literals.py` counts for every RATES file, which should all be zero except legacy CSS rules listed for Z
- the full probe across every RATES view (all six markets and GLOBAL), plus `/treasury`
- the remaining direction-token users, which should be the VOL premium plus definitions
- all suites, `tsc`, the harness and the smoke tests

Then **stop**. Don't run the squash-merge until I approve. When I do, follow the squash-merge procedure in the design notes' Process section.

---

## Acceptance criteria

1. R4 is committed on `acm-revamp` from an explicit staged list and pushed normally; the hash is pasted.
2. The EFFR − inflation axis shows evenly spaced, non-repeating ticks via a tested nice-ticks helper; before and after are pasted.
3. The probe logs URLs for any 4xx/5xx.
4. R5 is split and declared up front, and each sub-turn ends with a status block and a stop.
5. All R5 pages are at zero TSX literals; the GLOBAL z-score grid uses the rate scale; formatters are migrated and listed; the probe is clean; ambiguities are reported.
6. The RATES gate summary is delivered, and the turn stops before any squash-merge.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Any page sharing CSS modules with R5 pages. Check every importer before editing a shared module, as R4 learned.
- `main`, `origin/acm-revamp` history (no force-push), and every data-ingestion commit.
- Plotted data. Only presentation changes.

## Out of scope

- The squash-merge itself (after my approval).
- MACRO, EQUITIES, FX, COMMODITIES (on `acm-revamp-2` after the merge).
- Deleting legacy CSS (Z).
