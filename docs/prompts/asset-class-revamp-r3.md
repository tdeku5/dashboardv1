# R2d — Approved. Two decisions, one doc fix, then R3.

R2d is accepted. UST CURVE is at zero literals, the symmetric `--acm-heat-rate-*` grid is live on UST, the country curves and GLOBAL (minimum contrast 4.62), the R2d pending test passes, `scripts/acm-literals.py` is in place with re-measured baselines, `.comingSoon` stays inside the section, and the probe is clean. The quartile bucketing of the old 0.7 power curve and the visible UST changes are approved.

## Decision 1 — Levels get no colour

By my decision: **spread, butterfly and other levels render as plain primary text.** Examples are 2s10s +31bp, 2s5s10s -5bp, 5s10s real and 5s10s BE levels. Colour is reserved for **changes**.

- This applies section-wide, now and in every later turn: curve spreads, flies, credit spread levels, breakeven levels, and any other level that the old code coloured by sign.
- Identity colours may stay on tile labels, legend chips and chart lines. Only the **value** goes to primary text.
- Sweep the already-converted views (STIR STRIPS, FORWARD PRICING, the US FUNDAMENTAL MODEL panel, UST CURVE) and report each level display that changed, with its nav path.
- Record this in rule 6 as a clarification: *levels → no colour; changes → per rule 6.*
- Add or extend a test asserting UST spread and fly level values carry no sign tone.

## Decision 2 — Breakeven changes: rise = red

Keep breakeven changes as spread changes under rule 6: a rise is red. Note it explicitly in rule 6's coverage list.

## Doc fix — rule 3's first bullet

Fix the stale first bullet in rule 3 (it still says the grid uses the "direction scale") to say it uses the `--acm-heat-rate-*` scales per rule 6(b). Change nothing else, and re-confirm by diff against `1cfa75e` that rules 1, 2, 4 and 5 are byte-identical.

The unused `--acm-heat-dir-*` steps stay defined until Z.

---

## R3 — YIELD ATTRIBUTION, CREDIT, MONEY MARKETS

Convert the three remaining US sections inline in `STIRDashboardPage`. At the R2a count they were 39/7/3, 61/13/13 and 86/28/26, roughly 280 literals, so split by section if the total with Decision 1's sweep looks like going past about 300. Say up front which split you're using.

- **Colours follow rule 6:**
  - credit spread **changes**: widening is red, tightening green
  - credit spread **levels**: plain text, per Decision 1
  - money market rate changes: increase red
  - yield attribution components: report how each is classified before colouring (yield change, level, or contribution share). If a component's classification is ambiguous, report it; don't decide.
- **Legacy `ust*` / `histChanges*` classes:** move these views onto token-only classes as UST did. Leave the legacy rules in place for R5's pages. Z deletes whatever ends up dead.
- Probe every chart. The status block is as specified, using `scripts/acm-literals.py` for all counts, and includes nav paths and the remaining direction-token users.

Stop at the end of R3, or at the end of each sub-turn if you split.

---

## Acceptance criteria

1. Level values (spreads, flies, credit and breakeven levels) render in primary text in every converted view, with identity colours kept only on labels, legends and lines. The sweep is listed with nav paths, and a test covers the UST levels.
2. Rule 6 records the levels clarification and breakevens (rise = red). Rule 3's first bullet points to rule 6(b), and rules 1, 2, 4 and 5 are byte-identical to `1cfa75e`.
3. YIELD ATTRIBUTION, CREDIT and MONEY MARKETS are at zero literals, with colours per rule 6 and ambiguous yield-attribution components reported.
4. The probe is clean, counts come from `scripts/acm-literals.py`, and all suites, `tsc` and the harness are green, from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Checkpoint `91f02a8`. No amending, no pushing.
- The legacy `ust*` / `histChanges*` rules still used by R5's pages.
- The symmetric rate grid and its contrast guarantees.

## Out of scope

- R4 (POLICY RATE, TREASURY AUCTIONS) and later.
- Deleting legacy CSS (Z).
- Deciding ambiguous colour classifications.
