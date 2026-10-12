# Global Rates Summary — Phase 2 Sign-off and Phase 3 Go-Ahead

Phase 2 gate report reviewed. The logic, types, rounding, header labelling, heatmap scaling, and null rendering are all accepted. I cross-checked every regime label in both the 20D and 60D tables against its Δ sign and leg directions, and all are consistent.

Before Phase 3, one gap in the layout evidence must be closed. Re-read all four spec files from disk first.

---

## Open item — layout has not yet been proven in a real browser

The D3 evidence came from a vitest/jsdom harness. **jsdom has no layout engine**, so it cannot show that the table fits 1200px or that no value is visually clipped:

- The "1188px budget" assertion sums declared CSS values. It does not measure rendered width.
- The "no ellipsis" assertion checks text content. Text that is visually clipped or overflowing is still fully present in the DOM.
- In an auto-layout table, a `td` `width` acts as a minimum. `nowrap` content wider than its column widens the table instead of clipping it, so the failure to look for is horizontal overflow, not truncation.

### Required check

1. Start the dev server and load **RATES → GLOBAL** in a real browser at the normal desktop window size.
2. In the browser console, run the following and paste the output:
   ```js
   const s = document.querySelector('[class*="globalSummarySection"]');
   const t = s.querySelector('table');
   ({ sectionClientWidth: s.clientWidth, tableScrollWidth: t.scrollWidth, tableOffsetWidth: t.offsetWidth, overflows: t.scrollWidth > s.clientWidth });
   ```
   If the selector doesn't match, adjust it to the real section and table elements and say what you used.
3. Run it at Regime Lookback **20D** and **200D**, since 200D Δ values are the widest (e.g. DE `−35.7`).
4. Pass condition: `overflows: false` in both cases.
5. If a headless browser is not available in your environment, say so plainly and stop. I'll run the check myself. Do not substitute another jsdom assertion.

If it overflows, the fix stays within D3: adjust column width declarations only. Do not change font size, `max-width`, or column count. Report before and after numbers.

---

## Minor correction (no code change)

The null-rendering check described CA with five numeric fields nulled as "the exact state CA reaches after the December roll." That is not accurate. After the roll, only `fwd12mMinusTerminal` goes null; the curve Δ fields, `terminalMinusOcr`, and `fwd6mMinusTerminal` still populate. The check itself is still valid as a rendering test. Don't carry the wrong description into the commit message or any docs.

---

## Phase 3 — Verification and commit

Run this once the layout check passes.

1. Run client `tsc --noEmit` and the client test suite, and server `tsc --noEmit` and the server test suite. Paste the actual output. State that no lint script exists (D4).
2. **Spot-check (original spec, Phase 3 step 2):** for US and DE at 20D, hand-compute `2s10s Δ = (10Y_now − 2Y_now) − (10Y_prev − 2Y_prev)` from the raw `tv_series` closes on `2026-10-08` and the 20-row lookback date. Paste the four raw yields per country and the arithmetic. Confirm the result equals the rendered value.
3. **Commit 2 (frontend)**, explicit paths only:
   - `client/src/hooks/useGlobalRatesSummary.ts`
   - `client/src/pages/GlobalRatesPage.tsx`
   - `client/src/pages/STIRDashboardPage.module.css`
   - `client/src/pages/GlobalRatesSummary.demo.test.tsx`
   - `client/src/pages/__fixtures__/ratesSummaryPayloads.ts`
   - plus `docs/prompts/global-rates-summary-phase1-signoff.md` and this file, if they aren't already committed
4. Paste `git show --stat HEAD` and `git status --short`. The working tree must be clean apart from untracked build output (`client/dist/`).

**STOP after Phase 3.**

---

## Acceptance criteria

- The real-browser measurement shows `overflows: false` at 20D and 200D, with the console output pasted. Otherwise you have stated that no browser is available and stopped.
- Client and server typecheck and tests are green, with output pasted from the actual run.
- The US and DE `2s10s Δ` hand computations match the rendered values.
- Commit 2 contains exactly the listed client and docs paths, and `git status` is clean apart from `client/dist/`.

## What not to break

- Commit 1 (`03d4991`). No server changes in this phase.
- Everything accepted in Phase 2: column order, header labels from `regimeLookbackDays`, per-column heatmap scaling, `fmtSignedBps` rounding, null rendering.
- `.globalSummarySection { max-width: 1200px }` and font sizes.
- The other 11 importers of `STIRDashboardPage.module.css`.

## Out of scope

- Any further change to the header wording or the 1D-vs-regime-window display (handled by D2).
- Server changes, the CA terminal fallback, and CRA ingestion.
- The Asset Class Models design revamp.
- Adding a lint script or a headless-browser test dependency.
