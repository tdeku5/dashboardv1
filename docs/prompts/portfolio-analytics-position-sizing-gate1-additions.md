# Gate 1 — Approved. Additions before/within Gate 2.

Gate 1 is accepted. Both flagged deviations are approved as-implemented:

- **Only-when-empty ladder seeding** — correct. Per-row `INSERT OR IGNORE` would resurrect user-deleted rows on every restart. Keep it.
- **Nullable `initial_margin`** — approved as schema, but it creates a semantic question that must be resolved *before* the calculation module is written. See item 2.

Proceed to Gate 2 (`client/src/lib/positionSizing.ts` + unit tests) with the following five additions folded in.

---

## 1. Verify the seed *values*, not just the row count — do this first

Gate 1 confirmed 37 rows return in `sort_order`. It did not confirm they hold the right numbers. Before writing any calculation code, diff the seeded `ps_instruments` rows against the seed table in the original prompt file — all 37 rows, all four numeric columns (`tick_size_decimal`, `tick_value`, `initial_margin`, and `tick_size_display`).

Report the diff result explicitly. A single transposed digit here produces grids that are wrong but entirely plausible-looking, and every downstream gate would pass.

Also confirm `ps_settings` holds exactly: principle 500000, current_portfolio_value 500000, market_money_pct 0.25, max_drawdown_pct 0.05, unit_risk_pct 0.0025, max_units_risk_pct 0.02.

## 2. Null-margin semantics — pin these down explicitly

`initial_margin` is nullable, so define the propagation now and encode it in the module's types (make the margin-dependent outputs `number | null`, not `number`):

- `marginRequired[r][u]` where `initialMargin` is null → **null**, rendered `–`.
- `marginUsed[c]` in grid 4 where `initialMargin` is null → **null**, rendered `–`.
- `maxContractsOnCapital` where `initialMargin` is null or 0 → **null**, rendered `–` (also guards division by zero).
- **Null must never coerce to 0 anywhere.** `$0` in a margin cell reads as "requires no funding," which is the precise inverse of "funding requirement unknown," in the one grid whose purpose is flagging what you cannot fund.
- Conditional formatting: a null margin cell is **not** red (it is unknown, not breaching). Only a real number greater than `capitalAvailable` turns red.
- Grids 1 and 3 are unaffected — they depend on `tick_value`, not margin — so a null margin must not blank out contract counts or dollars at risk.

Unit-test each of these null paths.

## 3. Tighten API validation for the two divisor percentages

Current validation covers `> 1` and negatives on portfolio value. Add:

- Reject `unit_risk_pct <= 0` with 400. It is a divisor in the ladder-length derivation; zero is not a meaningful input.
- Reject negative values for all four percentage fields with 400.
- `max_units_risk_pct < unit_risk_pct` is **valid** and must be accepted (it simply yields `unitCount = 0`) — do not reject it.

Keep the calculation module's `unitRiskPct <= 0` guard regardless, as defence in depth. The module must be safe when called with arbitrary inputs, independent of what the API allows.

## 4. Degenerate-state handling in the module

Define and test these, rather than letting them throw or render `NaN`:

- `unitCount === 0` (when `max_units_risk_pct < unit_risk_pct`) → all four grids render with zero unit columns and an inline message explaining that Max Units of Risk is below one Unit of Risk. Not a crash, not an empty page.
- **Empty stop ladder or empty contract ladder** → the affected grids render an empty state prompting the user to add rows. Note that a fully-emptied ladder will re-seed on next server restart, a consequence of the only-when-empty seeding approved above. That is acceptable; just make sure the UI does not break in the interim.
- Any `tick_value` of 0 or null → `riskPerContract` is 0, and the existing `<= 0` guard returns 0 contracts. Confirm this path is tested rather than assumed.

## 5. At least one test must read from the actual seeded DB

The acceptance-criteria figures (ES: stop 20 → `5,10,15,20,25,30,35,40`; stop 40 → `2,5,7,10,12,15,17,20`; stop 120 → `0,1,2,3,4,5,5,6`; grid 2 stop-20/1-unit → `$114,901`; grid 3 stop-40/1-unit → `$1,000`; grid 4 3-contracts/4-units → `133`) are the workbook's own outputs and remain the oracle.

Most tests can pass inputs directly to the pure functions. But **at least one end-to-end test must pull `ps_settings` and the ES row from the seeded database** and reproduce the ES grid-1 column above. Tests built solely on hardcoded inputs validate the arithmetic while remaining blind to a bad seed — which is the failure mode item 1 is guarding against, and this test is what keeps it guarded as the code changes.

---

## Unchanged from the original spec

Everything else in the prompt file stands: derive `unitCount` rather than hardcoding 8; do not clamp negative market money; `roundDownToInt()` used everywhere rather than bare `Math.floor`; zeros render `–` and negatives in parentheses; no Margin Source anywhere; strict TypeScript, no `any`.

At Gate 2, re-read the original prompt file from disk and attest the calculation module against it line by line, exactly as you did for Gate 1. Do not build any UI at Gate 2 — stop once the module and its tests are green.
