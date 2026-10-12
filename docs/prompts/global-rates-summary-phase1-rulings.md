# Global Rates Summary — Phase 1 Sign-off and Phase 2 Go-Ahead

Phase 1 gate report reviewed and accepted. I independently re-checked the US, JP, and EUR interpolations, the 40/92 fixture, and the DE/FR/IT Δ values against the Phase 0 regime table, and all of them match.

Apply the two rulings below, then proceed to **Phase 2**. The original spec and `global-rates-summary-phase0-decisions.md` still govern; re-read all three from disk before starting.

---

## Rulings on the open items

### R1 — 1d shared-type deviation: accepted

There is no shared response type, so keeping the client untouched in Phase 1 was correct; that keeps the server commit green on its own. In Phase 2:

- Remove `frontMinus12m` from `RatesSummaryRow` in `client/src/hooks/useGlobalRatesSummary.ts`, and add `delta2s10s`, `delta10s30s`, `fwd6mMinusTerminal`, and `fwd12mMinusTerminal`. Use `number | null` for any field the server can return as `null`.
- Add the new envelope fields: `curveDate`, `fwd6mDate`, `fwd12mDate`, `regimeLookbackDays`.
- After the change, `grep -rn "frontMinus12m\|FRONT − 12M\|Front - 12M" client/ server/` must return nothing. Paste that output.
- Do not create a shared server/client type package. That is out of scope.

### R2 — Commit the server work now

Make **Commit 1 (server)** now, before starting UI work. Stage explicit paths only:

- `server/src/routes/global.ts`
- the three new `server/src/lib/*.ts` files
- the two new `*.test.ts` files
- the `docs/prompts/*.md` spec files

Before committing, re-run server `tsc --noEmit` and server tests, and paste the output. After committing, paste `git show --stat HEAD`. Commit 2 (frontend) stays in Phase 3 as originally specified.

---

## Phase 2 notes

- **Rounding.** The gate table showed DE `2s10s Δ` as `+7.2` from a server value of `7.25`. The browser's `toFixed(1)` will render `7.25` as `+7.3`, so that table was not produced by the client formatter. Render every new column through the existing `fmtSignedBps` (or the formatter the current columns use). In the Phase 2 gate, take the expected values from the rendered UI, not from the Phase 1 table.
- **Header labels.** Drive the window label (`(20D)`, `(60D)`, `(200D)`) from `regimeLookbackDays` in the response envelope, per D2. Do not derive it from the dropdown's local state; that way the label can never disagree with the data it describes.
- **Heatmap scaling.** `columnAbsMax` is computed per column, so the two curve Δ columns get their own scale. Keep it that way; do not pool them with the yield Δ columns.
- **Nulls.** Nothing is `null` in live data today. The Phase 2 gate must still show the `—` rendering once, by temporarily feeding a null for one field in a local, uncommitted check, or with a component test if one exists for this table. Do not commit any fixture hack to the page.
- **Gate evidence.** Everything required by the original Phase 2 spec and D3 applies: all 8 rows, all 13 columns, the longest regime labels and the widest values (JP `+212.1`, JP `−106.6`) fully visible, and headers wrapping cleanly. Also include the regime dropdown switched to 60D, showing both the header label and the values change.

**STOP after Phase 2.**

---

## Acceptance criteria

- The server commit exists, contains only the listed server and docs paths, and server typecheck and tests are green at that commit (output pasted).
- The client `RatesSummaryRow` type matches the server payload; the grep for `frontMinus12m` / Front-12M labels returns nothing.
- The table renders 8 rows × 13 columns in the specified order within 1200px, with no truncated values.
- Curve Δ header windows come from `regimeLookbackDays` in the response.
- All new numeric columns use the existing signed-bps formatter, and nulls render as `—`.
- Client typecheck and tests pass, with output pasted.

## What not to break

- The server code just committed. Phase 2 is client-only; if a server change seems necessary, stop and report it.
- The existing yield Δ columns, the regime cell colours, NEXT CB MOVE styling, and `TERMINAL − OCR` rendering.
- The yield-change matrix further down `GlobalRatesPage.tsx` that uses `getCellColor`.
- `.globalSummarySection { max-width: 1200px }`, and font sizes.
- The per-country RATES tabs.

## Out of scope

- A shared server/client type package.
- Any server-side change.
- The Asset Class Models design revamp.
- Changing `fmtSignedBps` or the heatmap helpers' behaviour (reusing them is fine).
- CRA ingestion and the CA end-of-strip terminal fallback.
