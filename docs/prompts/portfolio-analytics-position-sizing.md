# Portfolio Analytics — Position Sizing Model (port from Excel)

## Context

Add a **new section** to the terminal dropdown menu titled **PORTFOLIO ANALYTICS**, following the existing section-hub pattern (a section hub with pages beneath it, exactly like ECONOMIC DATA MODELS / ASSET CLASS MODELS). Its first and only page for now is **Position Sizing**.

This page is a faithful port of a working Excel model (`position_sizing.xlsx`, three sheets: `Setup`, `Instruments`, `Sizing Grid`) that sizes futures positions for a paper-trading portfolio. **All formulas, seed data, and formatting rules below were read directly out of that workbook** — implement them exactly as specified. Do not redesign the model, do not "improve" the math, and do not substitute your own risk framework.

**The workbook itself is not in the repo and you do not need it.** This file is the complete and authoritative spec — every formula, every seed row, and every format rule has already been extracted. Do not search the filesystem for it and do not ask for it.

The model's logic in one paragraph: two user inputs (Principle and Current Portfolio Value) produce a **Current Risk Budget**. Profits above Principle ("market money") are counted at 25% toward that budget. One **risk unit** is 0.25% of the Current Risk Budget; a trade may use up to **2.00%**, giving an **8-unit ladder** of dollar risk budgets. For a selected instrument, four grids then cross the unit ladder against either a stop-distance ladder (in ticks) or a contract-count ladder, computing contracts, margin required, actual dollars at risk after rounding, and the inverse (max stop width for a fixed contract count).

Read `CLAUDE.md` at repo root first for file paths, conventions, and the existing section/page registration pattern. Reference `docs/` for architecture rather than rediscovering it.

---

## Data model (SQLite, better-sqlite3)

Four new tables, all seeded on migration. Prefix `ps_` throughout.

### `ps_settings`
Single-row table (enforce `id = 1`) holding the Setup sheet's inputs. All editable in-app, persisted.

| column | type | seed | Excel cell |
|---|---|---|---|
| `id` | INTEGER PK CHECK(id=1) | 1 | — |
| `principle` | REAL | 500000 | Setup!B4 |
| `current_portfolio_value` | REAL | 500000 | Setup!B5 |
| `market_money_pct` | REAL | 0.25 | Setup!B7 |
| `max_drawdown_pct` | REAL | 0.05 | Setup!B10 |
| `unit_risk_pct` | REAL | 0.0025 | Setup!B12 |
| `max_units_risk_pct` | REAL | 0.02 | Setup!B14 |
| `updated_at` | TEXT | — | — |

Percentages are stored as **fractions** (0.0025 = 0.25%), matching the sheet.

### `ps_instruments`
Seeded with the 37 rows below, verbatim. `initial_margin` is **user-editable**; the tick specs are exchange contract terms and are **read-only in the UI**.

Columns: `symbol` TEXT PK, `group_name` TEXT, `tick_size_display` TEXT, `tick_size_decimal` REAL, `tick_value` REAL, `initial_margin` REAL, `sort_order` INTEGER, `updated_at` TEXT.

`$ per Point` is **derived, not stored** (`tick_value / tick_size_decimal`, Instruments!G).

**Note:** the source workbook has a `Margin Source` row at `Sizing Grid!B10` whose formula is broken (`=INDEX(Instruments!#REF!,...)`, pointing at a deleted column). That row is **deliberately dropped from this port** — do not reintroduce it, and do not add any margin-provenance column or badge.

Seed data — `symbol | group_name | tick_size_display | tick_size_decimal | tick_value | initial_margin`:

```
ES   | Equity Index | 0.25       | 0.25        | 12.5    | 22980.1
MES  | Equity Index | 0.25       | 0.25        | 1.25    | 2297.9
NQ   | Equity Index | 0.25       | 0.25        | 5       | 43667.8
MNQ  | Equity Index | 0.25       | 0.25        | 0.5     | 4367
RTY  | Equity Index | 0.1        | 0.1         | 5       | 9941.8
VX   | Volatility   | 0.05       | 0.05        | 50      | 8525
ZT   | Rates        | 0'001      | 0.00390625  | 7.8125  | 1320
ZF   | Rates        | 0'002      | 0.0078125   | 7.8125  | 1375
ZN   | Rates        | 0'005      | 0.015625    | 15.625  | 2062.5
TN   | Rates        | 0'005      | 0.015625    | 15.625  | 2805
ZB   | Rates        | 0'01       | 0.03125     | 31.25   | 4070
UB   | Rates        | 0'01       | 0.03125     | 31.25   | 5665
SR3  | STIR         | 0.005      | 0.005       | 12.5    | 475
SR1  | STIR         | 0.0025     | 0.0025      | 10.4175 | 300
ZQ   | STIR         | 0.005      | 0.005       | 20.835  | 375
GC   | Metals       | 0.1        | 0.1         | 10      | 26211.9
MGC  | Metals       | 0.1        | 0.1         | 1       | 2621.3
SI   | Metals       | 0.005      | 0.005       | 25      | 46845.7
HG   | Metals       | 0.0005     | 0.0005      | 12.5    | 11000
MHG  | Metals       | 0.0005     | 0.0005      | 1.25    | 1100
PL   | Metals       | 0.1        | 0.1         | 5       | 12130.8
PA   | Metals       | 0.5        | 0.5         | 50      | 23093.4
CL   | Energy       | 0.01       | 0.01        | 10      | 3858.8
MCL  | Energy       | 0.01       | 0.01        | 1       | 388.3
BZ   | Energy       | 0.01       | 0.01        | 10      | 3934.7
NG   | Energy       | 0.001      | 0.001       | 10      | 5888.3
ZC   | Grains       | 1/4 cent   | 0.25        | 12.5    | 935
ZW   | Grains       | 1/4 cent   | 0.25        | 12.5    | 1870
ZS   | Grains       | 1/4 cent   | 0.25        | 12.5    | 2090
SB   | Softs        | 0.01       | 0.01        | 11.2    | 114620
6E   | FX           | 0.00005    | 0.00005     | 6.25    | 2310
6J   | FX           | 0.0000005  | 0.0000005   | 6.25    | 2640
6B   | FX           | 0.0001     | 0.0001      | 6.25    | 1870
6A   | FX           | 0.0001     | 0.0001      | 10      | 1925
6C   | FX           | 0.00005    | 0.00005     | 5       | 880
6S   | FX           | 0.0001     | 0.0001      | 12.5    | 3960
6N   | FX           | 0.0001     | 0.0001      | 10      | 1320
```

`6J`'s tick size is `0.0000005` — five-tenths of a millionth. Store it exactly; do not round it to zero. It is the reason `6J`'s $/point is 12,500,000.

### `ps_stop_ladder`
User-editable list of stop distances in ticks (rows of grids 1–3). Columns: `id` INTEGER PK AUTOINCREMENT, `stop_ticks` INTEGER NOT NULL UNIQUE, `sort_order` INTEGER.
Seed: `20, 40, 60, 80, 100, 120, 160, 200`.

### `ps_contract_ladder`
User-editable list of contract counts (rows of grid 4). Columns: `id` INTEGER PK AUTOINCREMENT, `contracts` INTEGER NOT NULL UNIQUE, `sort_order` INTEGER.
Seed: `1` through `10`.

---

## Calculation module

Create a **pure, dependency-free TypeScript module** (e.g. `src/lib/positionSizing.ts`) holding every formula. No calculation logic in components. Export typed functions with exported result interfaces, so the same module can be unit-tested and reused later.

### Rounding semantics
Excel `ROUNDDOWN(x, 0)` truncates toward zero. All inputs here are non-negative, so `Math.floor` is correct — but write a named helper `roundDownToInt()` and use it everywhere, so the intent is explicit and a future negative case doesn't silently misbehave.

### Setup derivations (Setup sheet)

```
additionalRiskFromMarketMoney = currentPortfolioValue - principle          // B6 = B5-B4
additionalRiskBudget          = additionalRiskFromMarketMoney * marketMoneyPct   // B8 = B6*B7
currentRiskBudget             = principle + additionalRiskBudget          // B9 = B4+B8
maxDrawdownDollars            = currentRiskBudget * maxDrawdownPct        // B11 = B9*B10
dollarBudgetPerUnit           = currentRiskBudget * unitRiskPct           // B13 = B9*B12
maxRiskBudget                 = currentRiskBudget * maxUnitsRiskPct       // B15 = B9*B14
```

Note `B6` can go **negative** if the portfolio is below Principle (a drawdown), which shrinks the risk budget. Do not clamp it to zero — that behaviour is intentional in the source model. Display negatives in parentheses per the number formats below.

### Risk unit ladder (Setup!E3:F11)

```
unitCount = roundDownToInt(maxUnitsRiskPct / unitRiskPct)     // 0.02 / 0.0025 = 8
riskBudget[u] = dollarBudgetPerUnit * u    for u = 1 .. unitCount
```

**Derive `unitCount`; do not hardcode 8.** The source sheet hardcodes eight rows, but its own note states the ladder tops out at 8 *because* 2.00% / 0.25% = 8. Since both percentages are now user-editable, the ladder length must follow them. Guard: if `unitRiskPct <= 0`, render `unitCount = 0` and show an inline validation message rather than dividing by zero.

### Selected-instrument lookups (Sizing Grid B5:B11)

```
group, tickSizeDecimal, tickValue, initialMargin  ← from ps_instruments by symbol
dollarPerPoint  = tickValue / tickSizeDecimal                   // Instruments!G
capitalAvailable = currentPortfolioValue                        // B11 = Setup!B5
```

`capitalAvailable` tracks **Current Portfolio Value**, not Current Risk Budget. Keep that distinction — margin is a funding constraint tested against real capital, while risk is tested against the budget.

### Grid 1 — Contracts (`Sizing Grid!D16:K23`)

```
stopPrice[r]      = stopTicks[r] * tickSizeDecimal              // B16 = A16*$B$6
riskPerContract[r] = stopTicks[r] * tickValue                   // C16 = A16*$B$7
contracts[r][u]   = riskPerContract[r] <= 0 ? 0
                  : roundDownToInt(riskBudget[u] / riskPerContract[r])
```

### Grid 2 — Initial margin required (`D31:K38`)

```
marginRequired[r][u] = contracts[r][u] * initialMargin          // D31 = D16*$B$9
```

### Grid 3 — Actual $ at risk (`D46:K53`)

```
actualRisk[r][u] = contracts[r][u] * riskPerContract[r]         // D46 = D16*$C46
```

### Grid 4 — Inverse: max stop width in ticks (`D61:K70`)

```
marginUsed[c]     = contractCount[c] * initialMargin            // B61 = A61*$B$9
riskPerTick[c]    = contractCount[c] * tickValue                // C61 = A61*$B$7
maxStopTicks[c][u] = riskPerTick[c] <= 0 ? 0
                   : roundDownToInt(riskBudget[u] / riskPerTick[c])
```

---

## API

Standard Express routes on the existing server, matching current conventions:

- `GET  /api/portfolio/position-sizing/settings` → the `ps_settings` row
- `PUT  /api/portfolio/position-sizing/settings` → update; validate all six numeric fields (finite; percentages within `0 … 1`; principle and portfolio value `>= 0`)
- `GET  /api/portfolio/position-sizing/instruments` → all rows, ordered by `sort_order`
- `PUT  /api/portfolio/position-sizing/instruments/:symbol` → update `initial_margin` **only**; reject attempts to modify tick specs
- `GET  /api/portfolio/position-sizing/ladders` → `{ stopLadder, contractLadder }`
- `PUT  /api/portfolio/position-sizing/ladders` → replace either or both ladders; validate positive integers, deduplicate, sort ascending, and enforce a sane max length (e.g. 20 rows each) so the grids stay readable

All grid computation happens **client-side** in the calculation module. The API serves inputs only.

---

## UI

New page under the PORTFOLIO ANALYTICS section hub, styled consistently with existing terminal pages (same monospace table treatment, same dark palette, same section-header conventions). Full-width stacked sections, top to bottom.

### 1. Setup panel
Two-column layout mirroring the Setup sheet:

**Left — inputs and derived values**, in the sheet's order and with its exact labels: Principle, Current Portfolio Value, Additional Risk From Market Money (Profits), % of Additional Risk From Market Money, Additional Risk Budget From Market Money, Current Risk Budget, Max Drawdown On Principle, Max Drawdown On Principle ($), Unit of Risk Per Trade, $ Budget of Risk based on unit of risk per trade, Max Units of Risk Per Trade, Max Risk Budget.

Apply the workbook's colour convention as text colour: **blue for editable inputs**, **plain/default for computed values**. The two headline inputs (Principle, Current Portfolio Value) get the **yellow key-assumption treatment** — the sheet flags them as "the two you actually update". The four percentage assumptions are editable but visually secondary.

Inputs are inline-editable, commit on blur or Enter, and `PUT` to the settings endpoint. Every grid recomputes immediately from local state; do not wait on the round-trip to re-render, but do surface a save failure.

**Right — the risk unit ladder**: `Risk Units | $ Risk Budget`, rows `1 … unitCount`. Reproduce the two notes as small print beneath: that one unit equals the Unit of Risk Per Trade percentage of Current Risk Budget, and that the ladder length is Max Units ÷ Unit of Risk.

### 2. Instrument selector
A dropdown of all instruments, **grouped by `group_name`** using disabled `<option>` headers as non-selectable section dividers (the established pattern in this codebase). Default selection: `ES`.

Beneath it, the selected instrument's specs as a compact read-only strip: Group, Tick Size (display), Tick Size (decimal), Tick Value, $ per Point, Initial Margin, Capital Available.

### 3–6. The four grids
Render in the sheet's order, each with its section heading text carried over verbatim:

1. `CONTRACTS — largest size whose full stop-out stays inside the risk budget (rounded down)`
2. `INITIAL MARGIN REQUIRED — red where the position is risk-legal but cannot be funded`
3. `ACTUAL $ AT RISK — what a full stop-out really costs after rounding down`
4. `INVERSE — you have fixed the contract count; how wide can the stop be? (ticks)`

Grids 1–3 share row headers `Stop (ticks) | Stop (price) | $ Risk / Contract`; grid 4 uses `Contracts | Margin Used | $ Risk / Tick`. All four share the same column headers: a unit-number row (`1 … unitCount`) above a dollar-budget row.

Carry over each grid's footnote as small print below it, verbatim from the workbook:
- Grid 1: red means the stop is so wide that even one contract breaches the budget — trade the micro, or widen the risk unit.
- Grid 2: margin is a funding constraint, not a risk constraint; both grids must clear before a size is tradeable.
- Grid 3: the gap to the budget row is rounding slack — capital the chosen stop distance will not let you deploy.
- Grid 4: multiply by Tick Size for price distance (worked example: ES, 3 contracts, 4 units → 133 ticks × 0.25 = 33.25 points).

### Conditional formatting
Three rules, ported exactly from the workbook's conditional formatting (fill `#F4A9A9` in Excel — use the terminal's existing "breach" red rather than that literal hex if one is already defined, otherwise match it):

| Grid | Range | Rule |
|---|---|---|
| 1 — Contracts | body cells | cell `== 0` → red |
| 2 — Margin required | body cells | cell `> capitalAvailable` → red |
| 4 — Inverse | `Margin Used` column | cell `> capitalAvailable` → red |

Grid 3 has no conditional formatting.

### Number formats
Match the workbook: currency as `$#,##0.00` in the Setup panel and `$#,##0` in the grids; negatives in parentheses; **zeros render as `–`**, not `0` or `$0`; percentages as `0.00%` (stored as fractions); contract counts and tick counts as plain integers with thousands separators. Tick Size (decimal) needs enough precision to show `0.0000005` for `6J` — do not truncate it.

### 7. Reference & assumptions
Two collapsible panels at the bottom:

**Instrument reference** — the full `ps_instruments` table with all columns plus derived `$ per Point` and `Max Contracts on Capital` (`roundDownToInt(currentPortfolioValue / initialMargin)`, Instruments!H). `initial_margin` inline-editable here; tick specs read-only. Below it, the workbook's instrument notes carried over: the $/point derivation, the 32nds notation explanation for rates, the SR3/SR1/ZQ variable-tick caveat (front contracts trade at half the loaded tick value, which doubles the contract count at any given stop), the 6J six-decimal note, the grains cents-per-bushel note, the SB/VX exchange-and-multiplier note, and the caveat that Max Contracts on Capital ignores risk entirely and is a funding ceiling, not a sizing recommendation.

**Assumption log** — the six notes from the Setup sheet, carried over verbatim.

Also expose the ladder editors here (or in a small settings affordance on the page): add/remove/edit rows for both the stop-tick ladder and the contract-count ladder, persisted via the ladders endpoint.

---

## What NOT to change

- The existing dropdown sections (US MACRO SNAPSHOT, ECONOMIC DATA MODELS, ASSET CLASS MODELS, ECONOMIC CALENDAR, NEWS AGGREGATOR, and all their pages) — PORTFOLIO ANALYTICS is purely additive.
- Any existing table, migration, collector, cron job, or API route. All new tables are `ps_`-prefixed and touch nothing existing.
- Shared components, the theme, or global styles — reuse them, don't edit them.
- The Hephaestus agent, the `series_catalog`, and the TradingView ingest pipeline.

---

## Acceptance criteria

1. PORTFOLIO ANALYTICS appears in the dropdown as a section hub with a Position Sizing page beneath it; all pre-existing sections still navigate correctly.
2. With seed values (Principle 500,000 / Portfolio Value 500,000 / ES selected), the page reproduces the workbook exactly:
   - Current Risk Budget `$500,000.00`; $ Budget per unit `$1,250.00`; Max Risk Budget `$10,000.00`; Max Drawdown ($) `$25,000.00`.
   - Unit ladder runs 1–8, `$1,250 … $10,000`.
   - Grid 1, ES: stop 20 ticks → `5, 10, 15, 20, 25, 30, 35, 40`; stop 40 → `2, 5, 7, 10, 12, 15, 17, 20`; stop 60 → `1, 3, 5, 6, 8, 10, 11, 13`; stop 120 → `–, 1, 2, 3, 4, 5, 5, 6`; stop 200 → `–, 1, 1, 2, 2, 3, 3, 4`.
   - Grid 2, ES, stop 20, 1 unit → `$114,901` (5 × 22,980.1), and every cell above `$500,000` is red.
   - Grid 3, ES, stop 40, 1 unit → `$1,000` (2 × 500), i.e. $250 of rounding slack against the $1,250 budget.
   - Grid 4, ES, 3 contracts, 4 units → `133` ticks.
3. Editing Current Portfolio Value to a value above Principle increases Current Risk Budget by 25% of the excess, and every grid updates. Setting it *below* Principle reduces the budget (negative market money is not clamped).
4. Editing Max Units of Risk to 3.00% extends the ladder to 12 units and widens all four grids; editing Unit of Risk to 0.50% shortens it to 4.
5. Settings, margin edits, and ladder edits all survive a page reload (verify the values are in SQLite, not just React state).
6. Switching instruments re-derives every grid from that instrument's tick value and margin — spot-check `MES` (tick value 1.25 → 10× the ES contract counts) and `6J` (tick size 0.0000005 renders in full, $/point 12,500,000).
7. Zero values render as `–` throughout; negatives render in parentheses.
8. Initial Margin is inline-editable in the reference panel and persists; tick specs are read-only and a `PUT` attempting to change one is rejected. No margin-source column, badge, or `Margin Source` row exists anywhere in the port.
9. TypeScript strict mode passes with no `any`.

---

## Testing

- Unit-test the calculation module against the acceptance-criteria figures above — these are the workbook's own computed values, so any divergence is a port bug. Cover at minimum: the Setup derivations, ladder length derivation, all four grid functions, and the `riskPerContract <= 0` guard.
- Test the ladder-length derivation independently at 0.25%/2.00% (→ 8), 0.50%/2.00% (→ 4), and 0.25%/3.00% (→ 12).
- Verify persistence by editing a setting, restarting the server, and reloading.
- Verify API validation rejects a percentage above 1, a negative portfolio value, and an attempt to `PUT` a tick spec.
- Confirm no existing page regressed: load one page from each pre-existing section.

---

## Guardrails

- **Port, don't redesign.** Every formula above came out of the workbook. If something looks mathematically odd to you, implement it as specified and note the observation — do not "fix" it silently.
- **No fabricated data.** Do not invent margins, tick values, or instruments beyond the 37 seeded rows. If a value is missing, leave it null and show `–`.
- **Diagnostic-first on any surprise.** If the acceptance-criteria numbers don't reproduce, find the root cause before adjusting anything; do not tune a formula until the output matches.
- Do not add live price feeds, P&L tracking, a trade blotter, or broker integration — this page is a calculator, and scope beyond the workbook is out of bounds.
- Do not add charts. The model is tabular.
- Targeted minimal changes; reuse existing helpers and components; single source of truth through the calculation module.

## Gates

Stop for confirmation at each of these three points:

1. **After schema + seed + API**, with the seeded data queryable and the endpoints returning it.
2. **After the calculation module + its unit tests**, with the acceptance-criteria figures passing — before any UI is built.
3. **After the full page renders**, with a demo covering *every* item in the acceptance criteria, not just the ES happy path.

At each gate, state explicitly which spec items are implemented and which remain, diffed against this file. Re-read this file from disk at each gate rather than relying on a compaction summary.
