# Global Rates Summary — Phase 0 Decisions and Phase 1 Go-Ahead

Phase 0 gate report reviewed. Proceed to **Phase 1**, applying the decisions below on top of the original spec (`docs/prompts/global-rates-summary-curve-delta-eu-split.md`). Where this document and the original spec conflict, this document wins. Re-read both from disk at each phase boundary.

---

## Decisions

### D1 — +6M / +12M method: date-based interpolation (confirmed)

Use linear interpolation on `expiryDate` between the bracketing contracts, as recommended. This supersedes the original spec's instruction to reuse "the same contract-mapping approach," because that approach was index-based and the Phase 0 report showed it gives degenerate zeros.

Pin these details:

- **Anchor date is the strip's `curveDate`, not the wall clock.** Compute `+6M` and `+12M` as calendar-month offsets from the `curveDate` returned by `getTvCurve` (currently `2026-10-08`). Do not use `new Date()`. This keeps values stable over weekends and holidays, makes them reproducible against stored data, and makes the tests deterministic. Your Phase 0 table used `today = 2026-10-10`; the Phase 1 numbers will shift slightly, which is expected.
- **Definition:** this is the implied 3M rate for the period starting at the target date, interpolated between the contract-month dates. `expiryDate` is stored as the first of the contract month, not the true IMM date. Accept that approximation, and add a one-line code comment saying so.
- **No extrapolation.** If the target date falls before the first contract's `expiryDate` or after the last one's, return `null` and log once at warn level. Do not clamp to the nearest contract.
- **Terminal is unchanged.** Read it from the same `findTerminalContract` result that feeds `terminalMinusOcr`.
- **Rounding:** match the existing payload convention, `+(x * 100).toFixed(2)`. The UI renders 1dp.

Tests to add or adjust in 1d:
- A fixture strip where the target date lands between two contracts, asserting the interpolated value by hand arithmetic.
- A fixture where the target date lands exactly on a contract date.
- A fixture where +12M is past the last contract, asserting `null`.
- The inverted-strip fixture you proposed (a cutting path where terminal is a trough), so the positive branch is covered.
- A fixture where the target date is past the terminal contract, as AU is today, asserting correct sign.

### D2 — Curve Δ header carries the window (accepted)

Use the headers `2s10s Δ (20D)` and `10s30s Δ (20D)`. The window label must be driven by the selected Regime Lookback value (e.g. `60D`, `200D`), not hard-coded. Show it in the same muted style as the existing `(bps)` hints; the unit is understood. The Δ value itself still uses the Regime Lookback window, per spec 1a.

### D3 — Column widths (accepted, with a correction)

Your plan is right that under `border-box` the lever is the width declarations, not padding. Two corrections:

- **Arithmetic check.** The proposed widths sum to `74 + 84×6 + 100×2 + 110 + 100×3 = 1188px`, not exactly 1200px. That is fine and leaves 12px of headroom; please confirm the sum against the actual CSS in the gate report.
- **Padding.** Trimming `th`/`td` padding from 14px to 10px does not change the total width. It does give content room inside the narrower cells, and that room is needed: `Flt Twist` / `Stp Twist` in bold mono will likely clip in a 100px column at 14px padding. Keep the padding trim for that reason.

Constraints for Phase 2:
- No cell **values** may truncate or ellipsize.
- Headers may wrap to two lines. `+12M − TERMINAL (bps)` will not fit on one line at 100px. Keep header row height uniform across columns.
- `.globalSummarySection { max-width: 1200px }` stays unchanged.
- The Phase 2 gate screenshot must show the longest regime labels (`Flt Twist`, `Stp Twist`, `Bear Stp`) and the widest values (e.g. JP `+212.1`) fully visible.

### D4 — Lint (accepted)

There is no lint script, so run typecheck and tests and state plainly that lint does not exist. Do not add a lint script.

### D5 — Canada +12M going null after the December roll (accepted as designed)

Build it as specified: return `null` plus one warn-level log. Do not add CRA ingestion here. Note in the Phase 1 gate report that CA's `terminalMinusOcr` already falls back to "last contract" when there is no reversal, so with a 5-contract strip CA's "terminal" is end-of-strip rather than a true turning point. This is a pre-existing limitation; record it only and do not change it.

---

## Phase 1 gate report — additional requirements

On top of the original spec's Phase 1 gate requirements, include:

1. The resolved `+6M` and `+12M` target dates and the `curveDate` they were computed from.
2. For US and JP, the two bracketing contracts, their rates, the interpolation weight, and the resulting `+6M − TERMINAL` / `+12M − TERMINAL`. Paste the arithmetic from actual output.
3. The before/after diff of the five unchanged rows plus EU → DE, against the baseline you captured in Phase 0. Every field must be identical.
4. Confirmation that the EUR strip is fetched once per request, with the code location showing it hoisted out of the per-country loop.

**STOP after Phase 1**, as in the original spec.

---

## Acceptance criteria

- `+6M − TERMINAL` and `+12M − TERMINAL` use date-based interpolation anchored to `curveDate`, with no extrapolation, and return `null` with one warn log when out of range.
- Terminal values in the new columns are identical to the terminal behind `TERMINAL − OCR`.
- Curve Δ headers show the live Regime Lookback window label.
- Final column widths fit within the 1200px container, no cell values truncate, and the gate screenshot proves it.
- All D1 test fixtures exist and pass, with output pasted from the actual run.
- Everything in the original spec's acceptance criteria still holds.

## What not to break

- `findTerminalContract`, `getAnchorRate`, and the NEXT CB MOVE logic; read from them, do not modify them.
- The baseline values of US, UK, CA, JP, AU, and EU→DE captured in Phase 0.
- The EU per-country tab and its use of the `EU02Y`–`EU30Y` composite symbols.
- `.globalSummarySection` max-width, and font sizes anywhere in the table.
- Everything listed under "What not to break" in the original spec.

## Out of scope

- Ingesting more CRA contracts, or any other ingestion change.
- Replacing the static OCR anchor constants (UK 3.73, EUR 2.15, CRA 2.30, TOA3 0.727, AUS 4.10) with live sources.
- Changing `findTerminalContract`, including CA's end-of-strip fallback.
- Converting `expiryDate` to true IMM dates.
- Adding a lint script.
- Everything listed under "Out of scope" in the original spec.
