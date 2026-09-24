# US Rates — VOL tab: Realized MOVE index & implied vol premium

## Context

Add a new **VOL** section to the **US** tab of the Rates asset-class model (`ASSET CLASS MODELS → RATES → US`), sitting in the same third-tier row as STIR STRIPS, FORWARD PRICING, POLICY RATE, UST CURVE, YIELD ATTRIBUTION, CREDIT, MONEY MARKETS, TREASURY AUCTIONS. Place it immediately after **UST CURVE**, since it is curve-derived; follow whatever ordering convention the existing nav registry uses rather than hardcoding a position.

The page computes a **realized analogue of the MOVE index** from Treasury yields and compares it against the implied MOVE, producing an **implied vol premium/discount**.

**Both inputs come from TradingView** — the MOVE index and the 2y/5y/10y/30y Treasury yields all read from `tv_series` / `tv_ohlcv`. Do **not** use FRED `DGS*` series for the yield legs. Using a single vendor keeps the trading calendar, the daily close convention, and the snapshot time consistent across implied and realized, which matters when the whole output is a difference between the two.

### Methodology

The ICE BofA MOVE index is a yield-curve-weighted average of **normalized (basis-point) implied volatility** on 1-month Treasury options, conventionally weighted 20% / 20% / 40% / 20% across the 2y, 5y, 10y and 30y, quoted in **annualized basis points**. The realized analogue mirrors that construction exactly, so the two series are directly comparable in the same units.

Per tenor, over a rolling window of **N = 21 trading days** (matching the 1-month option tenor):

```
Δy_t   = (y_t - y_{t-1}) × 100          // yields quoted in percent; Δ in basis points
σ_tenor = sqrt( (252 / N) × Σ Δy_t² )   // annualized bp, zero-mean
```

The blended index is a linear weighted average of the per-tenor vols:

```
RMOVE = 0.20·σ_2y + 0.20·σ_5y + 0.40·σ_10y + 0.20·σ_30y
```

Blending the vols linearly (rather than computing the vol of a weighted yield portfolio) is correct here — it is how the MOVE itself is constructed, and the point is to match the index's own arithmetic.

### Zero-mean is required — do not substitute sample variance

The realized vol above is **zero-mean (uncentered)**: square the daily changes as they come. Do **not** subtract the window mean, and do **not** use an `N−1` denominator.

This is not a stylistic preference and must not be "corrected" to textbook sample variance by anyone touching the module later. The two estimators differ by exactly the squared mean, so centering always reports less vol, and what it removes is whatever directional drift occurred in the window. If 10s sell off a steady 2bp per day for a month, zero-mean reports ≈31.7bp annualized while centered reports ≈0 — yet that month delivered daily P&L to a straddle holder and the MOVE would not have printed zero.

The underlying reason: an option prices the expected **second moment**, not variance around a drift. Uncentered realized vol is the quantity that belongs on the same axis as an implied number. Over a 21-observation window the estimated mean also carries a standard error of roughly σ/√21 ≈ 22% of σ, so centering subtracts mostly noise, always downward.

Tests 1 and 2 below exist specifically to pin this. A centered implementation fails test 1.

### Alignment

MOVE at date *t* prices volatility over the forward window *[t, t+21]*; trailing realized at *t* measures *[t−21, t]*. This page uses **contemporaneous alignment** — trailing realized against same-date implied — which is standard practice and the only version computable to the current date. The methodology panel should state the window convention plainly (21-day trailing realized vs same-date implied) so the construction is documented on the page. Naming in the UI is the user's call: **"implied vol premium"** and **"premium/discount"** are the intended labels.

---

## Phase 0 — Inventory (STOP at the gate; build nothing)

Read `CLAUDE.md` first. Then establish, with evidence from the actual database and code — no assumptions:

**A. Implied MOVE.** Locate the MOVE index in `tv_series` / `tv_ohlcv`. Report the exact symbol string, row count, first and last date, which column carries the level (`close`?), and any null, zero, or duplicate-date rows. Confirm the values read as index points ≈ annualized bp (recent readings roughly 60–140; if the scale differs, stop and report).

**B. Treasury yields — TradingView.** Locate the 2y, 5y, 10y and 30y yield series in `tv_series` / `tv_ohlcv` (likely `US02Y`, `US05Y`, `US10Y`, `US30Y` or vendor-prefixed equivalents). Report for each: exact symbol string, row count, first and last date, and the **units** — confirm whether they are quoted in percent (4.25) or decimal (0.0425), since the bp conversion depends on it. Do not assume percent.

**C. History depth and gaps.** Report the earliest date on which **all four** tenors plus the MOVE have data, since that bounds the index. Report every gap longer than five trading days in each yield series. Note specifically whether the 30y has a discontinuity analogous to FRED's 2002–2006 `DGS30` gap — TradingView may or may not carry one, and the answer determines whether the renormalization path below is ever exercised.

**D. Stale and filled rows.** TradingView series sometimes carry forward-filled or repeated closes across holidays and vendor outages. A repeated close injects a false zero change and biases realized vol **downward**, which would show up as a spuriously wide premium. For each yield series, report the count of consecutive-identical-close runs of length ≥2 over the last five years, with a few example dates. If these are material, report and stop — do not silently filter them; the handling decision is the user's.

**E. Existing helpers.** Search for any realized-volatility or rolling-window helper already in the codebase (the terminal carries equity vol metrics). If one exists and fits, reuse it rather than writing a second implementation. Report what you find either way.

**F. Persistence targets.** Report the schema of `series_catalog` — every column, which are required, and how an existing derived (non-vendor) series is registered, with one real row as an example. Also report the migration pattern used by recent tables so the new one matches.

**G. Calendar consistency.** Confirm the MOVE and the four yield series share a trading calendar within `tv_ohlcv`. Report any dates present in one and absent in another over the last two years. This should be cleaner than a cross-vendor join, but verify rather than assume.

**Deliverable:** a written findings summary, then **STOP** for confirmation. Do not create tables or write computation code in this phase.

---

## Phase 1 — Computation module, table, backfill (STOP at the gate)

### Calculation module

A pure, dependency-free TypeScript module (e.g. `server/src/lib/realizedMove.ts`), fully typed, no `any`, with exported result interfaces. No computation logic in routes or components.

Requirements:

- Convert yield differences to **basis points** using the units confirmed in Phase 0-B. Assert the convention explicitly in the module rather than inferring it at the call site.
- Window **N = 21** trading days as a named constant.
- **Zero-mean** per the Context section. No mean subtraction, `N` denominator.
- Require **exactly 21 valid Δy observations** in the window. If fewer are available, return **null** for that tenor on that date. Do not scale a partial window up, do not forward-fill yields, do not interpolate.
- **Weight renormalization:** if a tenor is null on a given date, renormalize the remaining weights to sum to 1 and set a `weights_renormalized` flag on that row (a missing 30y gives 0.25 / 0.25 / 0.50 across 2s/5s/10s). If **two or more** tenors are missing, return null for the blend entirely — at that point it is a different index. Whether this path is ever exercised depends on the Phase 0-C findings.
- Weights are named constants in one place, not scattered literals.

### Table

New table `us_rates_realized_vol`, migrated in the established pattern:

| column | type | notes |
|---|---|---|
| `date` | TEXT PK | ISO date |
| `rv_2y`, `rv_5y`, `rv_10y`, `rv_30y` | REAL NULL | annualized bp, per tenor |
| `rv_move` | REAL NULL | blended index |
| `weights_renormalized` | INTEGER | 0/1 |
| `n_obs` | INTEGER | observations used in the window |
| `updated_at` | TEXT | |

Nullable throughout — a missing value stays null and renders `–`. Never write 0 for "unknown".

### Backfill & refresh

- Full backfill on first run, from the earliest date where a complete 21-day window exists across all required series.
- Incremental refresh recomputes a trailing window (**40 business days** is ample) and **upserts**. Non-destructive: never delete rows, never overwrite a computed value with null because a transient read came back empty.
- Wire the refresh into whatever scheduling the existing TradingView-fed collectors use, so it runs after the fileparser has landed new rows. Do not invent a new scheduler.

### Series catalog

Register the derived series so Hephaestus can chart them: the blended `rv_move` plus the four per-tenor series. Follow the exact `series_catalog` conventions found in Phase 0 — identifiers, units (annualized bp), frequency (daily), source label marking them as terminal-derived rather than vendor data.

### Tests

Deterministic, hand-checkable:

1. Constant +1bp daily change for 21 days → σ = √252 ≈ **15.87 bp**. *(A centered implementation returns ≈0 and must fail here.)*
2. Alternating +1 / −1 bp → also **15.87 bp**.
3. All four tenors at 100 bp → `rv_move` = **100**.
4. Tenors at 50 / 50 / 100 / 50 → `rv_move` = **75**.
5. 30y null → weights renormalize to 0.25 / 0.25 / 0.50, flag set; with tenors at 50 / 50 / 100 → `rv_move` = **62.5**.
6. Two tenors null → `rv_move` null, flag not set.
7. 20 valid observations in the window → null, not a scaled partial.
8. Unit conversion: a 0.01 move in the 10y series registers as 1 bp, not 0.01 (assuming percent quoting per Phase 0-B).

Then **STOP** for confirmation. Build no UI in this phase.

---

## Phase 2 — Route and page (STOP at the gate)

### Route

`GET /api/rates/us/vol` returning the joined series: date, `rv_move`, per-tenor RV, implied MOVE, and the derived comparison metrics. Join implied and realized on date with an **inner join** — emit only dates where both exist, per the Phase 0-G findings.

Derived metrics, computed in the route from persisted values:

- `premium_bp` = MOVE − RMOVE
- `ratio` = MOVE / RMOVE (null when RMOVE is 0 or null)
- `premium_z_252` = z-score of `premium_bp` over a trailing 252 trading days
- `ratio_pct_252` = percentile rank of `ratio` over a trailing 252 trading days

Require a full 252-observation window for the z-score and percentile; otherwise null.

### Page

Follow the existing rates-page layout, chart, and date-range conventions. Recharts, terminal aesthetic, no new design language.

1. **Stat strip** — latest MOVE, latest RMOVE (21d), premium in bp, ratio, 1y z-score, 1y percentile, each with its as-of date. Premium and z-score colour-coded by sign using the existing palette.
2. **Implied vs realized chart** — MOVE and RMOVE overlaid, shared bp axis.
3. **Premium chart** — `premium_bp` against a zero line, with ±1σ and ±2σ bands from the trailing 252 days.
4. **Per-tenor realized vol chart** — the four tenor series, individually toggleable.
5. **Contribution table** — tenor, weight, current realized vol, weighted contribution to RMOVE, and share of total. The 2y routinely dominates the index and this table makes that visible.
6. **Methodology panel** (collapsible) — the formula, N = 21, √252 annualization, the zero-mean convention and why, the weights, the renormalization rule, and the 21-day-trailing-vs-same-date-implied window convention.
7. **Data-quality note** — any date ranges where `weights_renormalized` is set, so a differently-weighted stretch is visibly marked rather than silently different.

Nulls render `–` throughout. Charts break the line across null gaps rather than interpolating across them.

---

## What NOT to change

- Every existing tab in the US rates section (STIR STRIPS, FORWARD PRICING, POLICY RATE, UST CURVE, YIELD ATTRIBUTION, CREDIT, MONEY MARKETS, TREASURY AUCTIONS) and all other country tabs, asset classes, and dropdown sections.
- The TradingView filewatcher/fileparser pipeline, `tv_series`, and `tv_ohlcv` — this work reads from them only.
- Existing `series_catalog` rows; only additive registration.
- Shared nav components, the three-tier navigation hierarchy, and the theme.
- Hephaestus, the Economic Calendar pipeline, and Portfolio Analytics.

---

## Acceptance criteria

1. VOL appears in the US rates section row after UST CURVE; every pre-existing tab in that row still loads.
2. All eight calculation tests pass, with counts pasted from actual command output.
3. `us_rates_realized_vol` is populated from the earliest complete window to the latest available date; report first date, last date, row count, and the count of rows with `weights_renormalized = 1`, each from a real query.
4. Spot-check one date by hand: pick a recent date, pull the 22 TradingView 10y observations ending there, compute σ manually, and show it matches `rv_10y` to within floating-point tolerance. Show the working.
5. Where any tenor is missing, the blend uses renormalized weights with the flag set — not null, and not silently weighted as though the tenor were present. If Phase 0-C found no such gaps, say so and demonstrate the path with a synthetic fixture instead.
6. A date with fewer than 21 valid observations produces null, rendered `–`, with no line interpolated across it.
7. The route returns only dates where both implied and realized exist; report how many dates were dropped by the join and why.
8. The five derived series are registered in `series_catalog` and chartable from Hephaestus.
9. The methodology panel documents the zero-mean convention and the 21-day trailing window against same-date implied.
10. `tsc --noEmit` clean on both packages, strict, no `any`; both suites green, counts pasted from command output.

## What not to break

- Any existing page, route, collector, cron job, or table.
- Any other page that reads the same TradingView yield or MOVE symbols — confirm each still renders identically after any shared-helper refactor.
- Existing `series_catalog` entries and Hephaestus chart resolution.
- Commit hygiene: explicit path staging only, `git add -A` prohibited, server commit first with standalone green verification, then frontend.

## Out of scope

- Additional lookback windows beyond 21d, and any realized-vol measure other than zero-mean close-to-close (no Parkinson, Garman-Klass, Yang-Zhang, or EWMA), even though `tv_ohlcv` carries the OHLC bars to support them.
- Options data, vol surfaces, skew, term structure of implied vol, and any attempt to reconstruct the MOVE's own option-level construction.
- Non-US rates vol, equity vol, and FX vol.
- Signal generation, backtests, trade recommendations, or alerting off the premium.
- Changes to TradingView ingestion itself — if the MOVE or yield data proves incomplete or stale-filled in Phase 0, report it and stop rather than building a second ingest path or filtering rows unilaterally.

---

## Guardrails

- **Diagnostic-first.** Phase 0 is inspection only. If the data isn't where expected, report and stop rather than working around it.
- **Never fabricate data.** No forward-filling yields, no interpolating gaps, no scaling partial windows, no substituting a nearby tenor for a missing one. Missing stays null and renders `–`.
- **All verification numbers pasted from command output**, never narrated or estimated, per the `CLAUDE.md` convention. If a number wasn't measured in that gate, say so rather than supplying one.
- **Re-read this file from disk at each gate** rather than relying on a compaction summary, and attest the implementation against it line by line, flagging any deviation explicitly.
- Targeted minimal changes; reuse existing helpers, chart components, and page-layout patterns rather than introducing new ones.
