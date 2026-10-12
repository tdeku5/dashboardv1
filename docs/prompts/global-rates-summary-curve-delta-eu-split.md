# Global Rates Summary — Curve Δ Columns, EU → DE/FR/IT Split, Forward-vs-Terminal Columns

## Context

The **Asset Class Models → RATES → GLOBAL** tab renders the **Global Rates Summary** table. It currently has these columns:

`COUNTRY | 2Y Δ | 5Y Δ | 10Y Δ | 30Y Δ | 2s10s (regime) | 10s30s (regime) | NEXT CB MOVE | TERMINAL − OCR (bps) | FRONT − 12M (bps)`

and these rows: `US, UK, EU, CA, JP, AU`.

Two controls drive the table: **Yield Δ Lookback** (e.g. 1D) and **Regime Lookback** (e.g. 20D). Regime labels (Bear Stp, Bull Flt, Flt Twist, etc.) are classified over the Regime Lookback window.

This page is built on **TradingView data** from the filewatcher/fileparser pipeline (`tv_series`, `tv_ohlcv`). Per terminal convention, nothing derived from TradingView data is persisted — every TV-reading module computes on read. Inherit the existing `tv_series.time` date handling exactly as the current Global summary does (do not fix the terminal-wide UTC/London off-by-one here; that is a separate job and new work must stay joinable with existing pages).

Re-read this prompt file from disk at each phase boundary. Do not rely on compaction summaries for spec details.

### Requested changes

1. **Add a Δ column next to each regime column** — a `2s10s Δ` column immediately right of the `2s10s` regime column, and a `10s30s Δ` column immediately right of the `10s30s` regime column.
2. **Remove the EU row; add Germany, France, and Italy rows**, sourced from TradingView data that should already be ingested.
3. **Remove the `FRONT − 12M` column; add two columns in its place:** `+6M − TERMINAL (bps)` and `+12M − TERMINAL (bps)`.

---

## Phase 0 — Controlled inspection (read-only, no edits)

Produce a gate report that answers each item below with file paths, line references, and pasted command/query output. No narrated or estimated numbers.

1. **Locate the implementation.** Identify the frontend component(s) rendering the Global Rates Summary, the server route(s)/module(s) that compute its payload, and any shared registry that defines the country list and per-country symbol mapping.
2. **Document current computations exactly**, quoting the code:
   - How 2Y/5Y/10Y/30Y Δ are computed (units, lookback handling, which bar/close is used).
   - How the 2s10s and 10s30s regimes are classified (inputs, window, thresholds, twist logic).
   - How `NEXT CB MOVE`, `TERMINAL − OCR`, and `FRONT − 12M` are computed — specifically: which STIR/OIS/futures strip each country uses, how "terminal" is defined (peak/trough of the implied path? a fixed tenor?), what "OCR"/current policy rate source is, and what "front" and "12M" refer to on the strip.
   - How the heatmap cell colouring for Δ columns is applied (shared helper vs inline).
3. **Germany / France / Italy data availability.** Query `tv_series` and report, for each of DE, FR, IT:
   - The TradingView symbols present for 2Y, 5Y, 10Y, and 30Y government yields (exact symbol strings), row counts, and latest bar date.
   - Any tenor that is missing or stale (> 5 business days behind the latest US bar). Do not substitute a different tenor or source silently — report it.
   - The EU row's current symbol mapping, so it is clear what is being removed.
4. **Euro-area policy path.** DE, FR, and IT share the ECB policy path. Report which strip the current EU row uses for `NEXT CB MOVE` / `TERMINAL − OCR` / `FRONT − 12M`, and confirm that same source will feed all three new rows.
5. **+6M / +12M availability.** For every country (US, UK, DE/FR/IT via EUR, CA, JP, AU), confirm the existing implied-path data supports reading an implied policy rate at +6M and +12M from today, and show the method you'd use (contract mapping or interpolation) based on what already exists. If any country's strip does not reach +12M, report it.
6. **Spread Δ consistency check.** For the current rows, compute `2s10s Δ` and `10s30s Δ` from the existing yield data over both the Yield Δ Lookback and the Regime Lookback, and paste the values. Confirm `2s10s Δ = 10Y Δ − 2Y Δ` holds over the Yield Δ window to within rounding.

**STOP after Phase 0.** Post the gate report and wait for my confirmation before writing any code.

---

## Phase 1 — Server

### 1a. Curve Δ fields
- Add `s2s10Delta` and `s10s30Delta` (or names consistent with existing payload conventions) to each country row, in **bps**.
- Definition: change in the spread (`10Y − 2Y`, `30Y − 10Y`) over the **Regime Lookback** window — the same window used to classify the regime label it sits next to, so the number explains the label.
- Compute from the same yield series and the same bar-selection logic the regime classifier already uses. Reuse existing helpers; do not write a parallel spread calculator.

### 1b. Country list: EU → DE, FR, IT
- Remove `EU` from the Global summary's country list.
- Add `DE`, `FR`, `IT` with display labels `DE`, `FR`, `IT`, ordered where EU was: `US, UK, DE, FR, IT, CA, JP, AU`.
- Map yields to the exact TradingView symbols confirmed in Phase 0.
- `NEXT CB MOVE` and all policy-path columns for DE/FR/IT come from the existing EUR/ECB strip used by the old EU row — one computation, reused for three rows, not three separate fetches.
- If a tenor confirmed missing in Phase 0 has no data, return `null` for that field. Never fabricate, forward-fill across a gap, or proxy from another country.
- If the country list lives in a registry, change it there (single source of truth). Do not hard-code the new rows in the component.

### 1c. Replace FRONT − 12M with +6M − TERMINAL and +12M − TERMINAL
- Remove the `FRONT − 12M` field from the payload.
- Add `fwd6mMinusTerminal` and `fwd12mMinusTerminal` (or convention-consistent names), in **bps**:
  - `+6M − TERMINAL = implied policy rate at +6M − terminal rate`
  - `+12M − TERMINAL = implied policy rate at +12M − terminal rate`
- "Terminal" must be the **identical value** already used in `TERMINAL − OCR`. Read it from the same function/variable; do not recompute it a second way.
- The +6M/+12M implied rate must come from the same strip and the same contract-mapping/interpolation approach already used for the existing columns (as documented in Phase 0).
- If a strip does not reach +12M, return `null` for that field and log it once at warn level.

### 1d. Types and tests
- TypeScript strict, no `any`. Update the shared response type so the frontend fails to compile if it still references `FRONT − 12M`.
- Add/extend unit tests covering:
  - Spread Δ on a hand-built fixture (known 2Y/10Y/30Y paths → known bps outputs).
  - `+6M − TERMINAL` and `+12M − TERMINAL` on a fixture strip, including sign (a strip where +6M is below terminal must return a negative number).
  - DE/FR/IT share identical policy-path values.
  - A missing tenor returns `null`, not 0.

**STOP after Phase 1.** Gate report must include: pasted test output, pasted sample JSON for US, DE, IT, and JP rows, and a spec-vs-implementation diff attestation covering every item in 1a–1d.

---

## Phase 2 — Frontend

### Column order (final)
`COUNTRY | 2Y Δ | 5Y Δ | 10Y Δ | 30Y Δ | 2s10s | 2s10s Δ | 10s30s | 10s30s Δ | NEXT CB MOVE | TERMINAL − OCR (bps) | +6M − TERMINAL (bps) | +12M − TERMINAL (bps)`

### Rendering
- **2s10s Δ / 10s30s Δ:** signed, one decimal, bps (e.g. `+4.2`, `−1.8`). Apply the same heatmap cell styling helper used by the yield Δ columns, so colour semantics match the rest of the table. Header shows the unit hint in the same muted style as `(bps)` on the existing policy columns.
- **+6M − TERMINAL / +12M − TERMINAL:** signed, one decimal, same text styling and sign-colouring treatment as the existing `TERMINAL − OCR` column.
- **Nulls:** render `—` in muted text. Never render `0.0` or `NaN` for missing data.
- **DE/FR/IT rows:** render identically to other rows; their CB columns will show the same values by design.
- Table must not overflow the existing container at the current layout width. If the two added columns cause overflow, tighten column padding uniformly — do not shrink font size or drop columns.

**STOP after Phase 2.** Gate report must include a screenshot (or rendered DOM excerpt) of the table with all 8 rows and 13 columns, plus the lookback dropdowns changed to a different value showing the Δ columns update.

---

## Phase 3 — Verification and commit

1. Run the full typecheck, lint, and test suites. Paste actual output.
2. Spot-check: for US and DE, hand-compute `2s10s Δ` from the raw yields shown in the 2Y Δ / 10Y Δ inputs over the Regime Lookback and confirm it matches the rendered value. Paste the arithmetic.
3. Commit with explicit path staging only (no `git add -A`):
   - Commit 1 — server: payload, registry, tests. Confirm green standalone at this commit.
   - Commit 2 — frontend: component and styling.

---

## Acceptance criteria

- Global Rates Summary shows rows `US, UK, DE, FR, IT, CA, JP, AU` — no EU row.
- `2s10s Δ` sits immediately right of `2s10s`; `10s30s Δ` sits immediately right of `10s30s`; both in bps over the Regime Lookback window and update when that dropdown changes.
- `FRONT − 12M` is gone from both the payload and the UI.
- `+6M − TERMINAL (bps)` and `+12M − TERMINAL (bps)` appear in its place, using the exact same terminal value as `TERMINAL − OCR`.
- DE, FR, IT yield columns are sourced from TradingView symbols confirmed in Phase 0; their CB/policy columns come from the single EUR/ECB computation.
- Missing data renders `—`; no fabricated or proxied values anywhere.
- All tests pass; verification numbers in every gate report are pasted from command output.

## What not to break

- Existing country rows (US, UK, CA, JP, AU) — their yield Δ, regime labels, `NEXT CB MOVE`, and `TERMINAL − OCR` values must be unchanged before vs. after. Show a before/after diff of these fields in the Phase 1 gate report.
- Regime classification logic and thresholds.
- Yield Δ Lookback and Regime Lookback controls and their existing behaviour.
- The per-country tabs (US, UK, EU, CAD, JPY, AUS) — the EU per-country tab stays as-is; only the GLOBAL summary row changes.
- `tv_series.time` date handling convention, and compute-on-read (no new persisted tables for TV-derived values).
- Any other page or module that reads the Global summary payload or the country registry — search for consumers and confirm none break.

## Out of scope

- Adding per-country tabs for Germany, France, or Italy.
- Fixing the terminal-wide `tv_series.time` UTC/London off-by-one.
- The Asset Class Models design revamp (palette, typography, sans chrome).
- Changing regime label colours, regime definitions, or adding new regime types.
- Ingesting new TradingView symbols. If DE/FR/IT tenors are missing, report it at Phase 0 — do not add ingestion.
- Changing how `TERMINAL − OCR` or `NEXT CB MOVE` are computed.
